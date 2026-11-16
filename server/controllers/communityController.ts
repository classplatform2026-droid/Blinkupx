import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import {
  Community,
  type CommunityRole,
  type ICommunity,
  type ICommunitySettings,
} from '../models/Community.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import { User } from '../models/User.ts';
import {
  getBlockRelationship,
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
  type PrivacyTargetUserLike,
} from '../services/privacyService.ts';
import { dispatchCommunityActivityPushNotifications } from '../services/pushService.ts';
import { getIO } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import {
  createCommunitySchema,
  handleJoinRequestSchema,
  inviteCommunityMembersSchema,
  transferOwnershipSchema,
  updateCommunitySettingsSchema,
} from '../validators/schemas.ts';

async function emitCommunityActivityNotification(
  recipientIds: string[],
  payload: {
    event:
      | 'join_request'
      | 'request_resolved'
      | 'invited'
      | 'member_updated'
      | 'removed'
      | 'deleted';
    communityId: string;
    communityName: string;
    title: string;
    body: string;
  }
) {
  const io = getIO();
  if (recipientIds.length === 0) return;

  const uniqueIds = Array.from(new Set(recipientIds));
  const users = await User.find({ _id: { $in: uniqueIds } })
    .select('settings')
    .lean();

  if (io) {
    for (const u of users) {
      const notif = resolveUserSettings(u.settings).notifications;
      if (!notif.communityActivity) continue;
      io.to(`user:${u._id.toString()}`).emit('notification:community', {
        ...payload,
        soundEnabled: notif.soundEnabled,
        soundTone: notif.soundTone,
        vibrationEnabled: notif.vibrationEnabled,
        createdAt: new Date().toISOString(),
      });
    }
  }

  void dispatchCommunityActivityPushNotifications({
    ...payload,
    recipients: users,
  }).catch((err) => {
    console.error('[Push] Failed to dispatch community activity push:', err);
  });
}

const DEFAULT_SETTINGS: ICommunitySettings = {
  whoCanInvite: 'admins',
  whoCanPinMessages: 'moderators',
  whoCanPost: 'all_members',
};

function resolveSettings(c: ICommunity): ICommunitySettings {
  return {
    whoCanInvite: c.settings?.whoCanInvite || DEFAULT_SETTINGS.whoCanInvite,
    whoCanPinMessages: c.settings?.whoCanPinMessages || DEFAULT_SETTINGS.whoCanPinMessages,
    whoCanPost: c.settings?.whoCanPost || DEFAULT_SETTINGS.whoCanPost,
  };
}

function canInviteByRole(
  role: CommunityRole | null | undefined,
  settings: ICommunitySettings
): boolean {
  if (!role) return false;
  if (role === 'owner') return true;
  if (role === 'admin') return settings.whoCanInvite !== 'owner_only';
  if (role === 'moderator') {
    return settings.whoCanInvite === 'moderators' || settings.whoCanInvite === 'all_members';
  }
  return settings.whoCanInvite === 'all_members';
}

function canChangeMemberRole(
  actorRole: CommunityRole,
  targetRole: CommunityRole,
  nextRole: 'admin' | 'moderator' | 'member'
): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') {
    return (
      (targetRole === 'member' || targetRole === 'moderator') &&
      (nextRole === 'member' || nextRole === 'moderator')
    );
  }
  return false;
}

function canRemoveTargetMember(
  actorRole: CommunityRole,
  targetRole: CommunityRole
): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'moderator' || targetRole === 'member';
  if (actorRole === 'moderator') return targetRole === 'member';
  return false;
}

function assertValidObjectId(id: string, message = 'Community not found.') {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(message, 404, 'COMMUNITY_NOT_FOUND');
  }
}

function emitCommunitySystemMessage(
  convId: string,
  sender: { id: string; fullName: string; username: string; avatar?: string },
  sysMsg: { _id: Types.ObjectId; content: string; createdAt: Date }
) {
  const io = getIO();
  io?.to(`conversation:${convId}`).emit('message:new', {
    id: sysMsg._id.toString(),
    conversationId: convId,
    senderId: sender.id,
    sender: {
      id: sender.id,
      fullName: sender.fullName,
      username: sender.username,
      avatar: sender.avatar || '',
    },
    content: sysMsg.content,
    messageType: 'system',
    attachments: [],
    links: [],
    replyTo: null,
    forwardedFrom: null,
    reactions: [],
    editedAt: null,
    deletedAt: null,
    deliveredTo: [],
    readBy: [],
    deliveryStatus: 'sent',
    createdAt: sysMsg.createdAt,
  });
}

function serializeCommunitySummary(c: ICommunity, userId: string) {
  const member = c.members.find((m) => m.userId.toString() === userId);
  const isPending = c.pendingRequests.some((id) => id.toString() === userId);
  const myRole = member?.role || null;
  const canManageRequests = Boolean(myRole && ['owner', 'admin'].includes(myRole));

  return {
    id: c._id.toString(),
    name: c.name,
    description: c.description,
    image: c.image,
    privacy: c.privacy,
    ownerId: c.ownerId.toString(),
    conversationId: member ? c.conversationId.toString() : '',
    memberCount: c.members.length,
    isMember: Boolean(member),
    myRole,
    isPending,
    pendingRequestsCount: canManageRequests ? c.pendingRequests.length : 0,
    settings: member ? resolveSettings(c) : undefined,
    createdAt: c.createdAt,
  };
}

export async function listCommunities(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const tab = String(req.query.tab || 'joined');
  const q = String(req.query.q || '').trim();

  const query: Record<string, unknown> = {};
  if (tab === 'joined') {
    query['members.userId'] = new Types.ObjectId(userId);
  } else {
    query.privacy = 'public';
  }

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    query.$or = [{ name: regex }, { description: regex }];
  }

  const list = await Community.find(query).sort({ createdAt: -1 }).limit(60);
  res.json({
    success: true,
    data: list.map((c) => serializeCommunitySummary(c, userId)),
  });
}

export async function createCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const parsed = createCommunitySchema.parse(req.body);

  const communityId = new Types.ObjectId();
  const conv = await Conversation.create({
    type: 'community',
    name: parsed.name,
    avatar: parsed.image || '',
    communityId,
    participants: [
      {
        userId: new Types.ObjectId(userId),
        role: 'owner',
        joinedAt: new Date(),
        lastReadAt: new Date(),
      },
    ],
    createdBy: new Types.ObjectId(userId),
  });

  const community = await Community.create({
    _id: communityId,
    name: parsed.name,
    description: parsed.description,
    image: parsed.image,
    privacy: parsed.privacy,
    ownerId: new Types.ObjectId(userId),
    conversationId: conv._id,
    members: [
      {
        userId: new Types.ObjectId(userId),
        role: 'owner',
        joinedAt: new Date(),
      },
    ],
    settings: { ...DEFAULT_SETTINGS },
  });

  const sysMsg = await Message.create({
    conversationId: conv._id,
    senderId: new Types.ObjectId(userId),
    content: `${req.user!.fullName} created the community "${parsed.name}"`,
    messageType: 'system',
    readBy: [new Types.ObjectId(userId)],
  });

  conv.lastMessage = {
    messageId: sysMsg._id as Types.ObjectId,
    senderId: new Types.ObjectId(userId),
    content: sysMsg.content,
    messageType: 'system',
    createdAt: sysMsg.createdAt,
  };
  await conv.save();

  res.status(201).json({
    success: true,
    data: serializeCommunitySummary(community, userId),
  });
}

export async function getCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);

  const community = await Community.findById(req.params.id)
    .populate('members.userId', PUBLIC_USER_SELECT)
    .populate('pendingRequests', PUBLIC_USER_SELECT);

  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const selfMember = community.members.find(
    (m) => m.userId && (m.userId as unknown as { _id: Types.ObjectId })._id.toString() === userId
  );

  // Strict privacy guard: non-members cannot access private community members, settings, chat id, or requests
  if (community.privacy === 'private' && !selfMember) {
    return res.json({
      success: true,
      data: {
        id: community._id.toString(),
        name: community.name,
        description: community.description,
        image: community.image,
        privacy: community.privacy,
        ownerId: '',
        memberCount: community.members.length,
        isMember: false,
        myRole: null,
        isPending: community.pendingRequests.some(
          (u) => u && (u as unknown as { _id: Types.ObjectId })._id.toString() === userId
        ),
        pendingRequestsCount: 0,
        conversationId: null,
        settings: null,
        permissions: {
          canInvite: false,
          canManageRoles: false,
          canManageSettings: false,
          canManageRequests: false,
          canChangePrivacy: false,
          canTransferOwnership: false,
          canDeleteCommunity: false,
        },
        members: [],
        pendingRequests: [],
        createdAt: community.createdAt,
      },
    });
  }

  const settings = resolveSettings(community);
  const myRole = selfMember?.role || null;
  const canManageRequests = Boolean(myRole && ['owner', 'admin'].includes(myRole));
  const canManageSettings = Boolean(myRole && ['owner', 'admin'].includes(myRole));
  const canManageRoles = Boolean(myRole && ['owner', 'admin'].includes(myRole));
  const canInvite = canInviteByRole(myRole, settings);
  const isOwner = myRole === 'owner';

  const targetIds = Array.from(
    new Set([
      ...community.members
        .filter((m) => m.userId)
        .map((m) => (m.userId as unknown as PrivacyTargetUserLike)._id.toString()),
      ...community.pendingRequests
        .filter(Boolean)
        .map((u) => (u as unknown as PrivacyTargetUserLike)._id.toString()),
    ])
  );
  const viewerContext = await getViewerRelationshipContext(userId, targetIds);

  const serializedMembers = community.members
    .filter((m) => m.userId)
    .map((m) => ({
      role: m.role,
      joinedAt: m.joinedAt,
      user: serializeUserWithPrivacy(
        m.userId as unknown as PrivacyTargetUserLike,
        viewerContext
      ),
    }));

  // Public preview for non-members: show details + admins only if needed, hide chat conversationId
  const visibleMembers = selfMember
    ? serializedMembers
    : serializedMembers.filter((m) => m.role === 'owner' || m.role === 'admin');

  res.json({
    success: true,
    data: {
      id: community._id.toString(),
      name: community.name,
      description: community.description,
      image: community.image,
      privacy: community.privacy,
      ownerId: community.ownerId.toString(),
      conversationId: selfMember ? community.conversationId.toString() : null,
      memberCount: community.members.length,
      isMember: Boolean(selfMember),
      myRole,
      isPending: false,
      pendingRequestsCount: canManageRequests ? community.pendingRequests.length : 0,
      settings,
      permissions: {
        canInvite,
        canManageRoles,
        canManageSettings,
        canManageRequests,
        canChangePrivacy: isOwner,
        canTransferOwnership: isOwner,
        canDeleteCommunity: isOwner,
      },
      members: visibleMembers,
      pendingRequests: canManageRequests
        ? community.pendingRequests
            .filter(Boolean)
            .map((u) =>
              serializeUserWithPrivacy(
                u as unknown as PrivacyTargetUserLike,
                viewerContext
              )
            )
        : [],
      createdAt: community.createdAt,
    },
  });
}

export async function listCommunityMembers(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);

  const q = String(req.query.q || '').trim().toLowerCase();
  const filter = String(req.query.role || 'all').toLowerCase();

  const community = await Community.findById(req.params.id)
    .populate('members.userId', PUBLIC_USER_SELECT)
    .populate('pendingRequests', PUBLIC_USER_SELECT);

  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const selfMember = community.members.find(
    (m) => m.userId && (m.userId as unknown as { _id: Types.ObjectId })._id.toString() === userId
  );

  if (!selfMember) {
    throw new AppError(
      'You must be a member of this community to view its members.',
      403,
      'FORBIDDEN'
    );
  }

  const settings = resolveSettings(community);
  const myRole = selfMember.role;
  const canManageRequests = myRole === 'owner' || myRole === 'admin';

  const targetIds = Array.from(
    new Set([
      ...community.members
        .filter((m) => m.userId)
        .map((m) => (m.userId as unknown as PrivacyTargetUserLike)._id.toString()),
      ...community.pendingRequests
        .filter(Boolean)
        .map((u) => (u as unknown as PrivacyTargetUserLike)._id.toString()),
    ])
  );
  const viewerContext = await getViewerRelationshipContext(userId, targetIds);

  const roleWeight: Record<CommunityRole, number> = {
    owner: 0,
    admin: 1,
    moderator: 2,
    member: 3,
  };

  const allMembers = community.members
    .filter((m) => m.userId)
    .map((m) => ({
      role: m.role,
      joinedAt: m.joinedAt,
      user: serializeUserWithPrivacy(
        m.userId as unknown as PrivacyTargetUserLike,
        viewerContext
      ),
    }))
    .sort((a, b) => {
      const diff = roleWeight[a.role] - roleWeight[b.role];
      if (diff !== 0) return diff;
      return a.user.fullName.localeCompare(b.user.fullName);
    });

  const counts = {
    all: allMembers.length,
    admins: allMembers.filter((m) => m.role === 'owner' || m.role === 'admin').length,
    moderators: allMembers.filter((m) => m.role === 'moderator').length,
    members: allMembers.filter((m) => m.role === 'member').length,
    requests: canManageRequests ? community.pendingRequests.length : 0,
  };

  let filteredMembers = allMembers;
  if (filter === 'admins') {
    filteredMembers = allMembers.filter((m) => m.role === 'owner' || m.role === 'admin');
  } else if (filter === 'moderators') {
    filteredMembers = allMembers.filter((m) => m.role === 'moderator');
  } else if (filter === 'members') {
    filteredMembers = allMembers.filter((m) => m.role === 'member');
  }

  if (q) {
    filteredMembers = filteredMembers.filter(
      (m) =>
        m.user.fullName.toLowerCase().includes(q) ||
        m.user.username.toLowerCase().includes(q)
    );
  }

  let pendingRequests = canManageRequests
    ? community.pendingRequests
        .filter(Boolean)
        .map((u) =>
          serializeUserWithPrivacy(
            u as unknown as PrivacyTargetUserLike,
            viewerContext
          )
        )
    : [];

  if (q && pendingRequests.length > 0) {
    pendingRequests = pendingRequests.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }

  res.json({
    success: true,
    data: {
      communityId: community._id.toString(),
      communityName: community.name,
      myRole,
      counts,
      permissions: {
        canInvite: canInviteByRole(myRole, settings),
        canManageRoles: myRole === 'owner' || myRole === 'admin',
        canManageRequests,
      },
      members: filteredMembers,
      pendingRequests,
    },
  });
}

export async function joinCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const already = community.members.some((m) => m.userId.toString() === userId);
  if (already) {
    throw new AppError(
      'You are already a member of this community.',
      409,
      'ALREADY_MEMBER'
    );
  }

  if (community.privacy === 'private') {
    const alreadyRequested = community.pendingRequests.some(
      (id) => id.toString() === userId
    );
    if (alreadyRequested) {
      throw new AppError(
        'You have already requested to join this community.',
        409,
        'ALREADY_REQUESTED'
      );
    }

    community.pendingRequests.push(new Types.ObjectId(userId));
    await community.save();

    // Notify all community Owners & Admins in real time
    const io = getIO();
    const adminIds = community.members
      .filter((m) => m.role === 'owner' || m.role === 'admin')
      .map((m) => m.userId.toString());

    if (io) {
      for (const adminId of adminIds) {
        io.to(`user:${adminId}`).emit('community:join_request', {
          communityId: community._id.toString(),
          communityName: community.name,
          requester: {
            id: userId,
            fullName: req.user!.fullName,
            username: req.user!.username,
            avatar: req.user!.avatar || '',
          },
        });
      }
      io.to(`conversation:${community.conversationId.toString()}`).emit('community:updated', {
        communityId: community._id.toString(),
      });
    }

    await emitCommunityActivityNotification(adminIds, {
      event: 'join_request',
      communityId: community._id.toString(),
      communityName: community.name,
      title: community.name,
      body: `${req.user!.fullName} requested to join ${community.name}.`,
    });

    return res.json({
      success: true,
      message: 'Join request sent to community administrators.',
      data: serializeCommunitySummary(community, userId),
    });
  }

  community.members.push({
    userId: new Types.ObjectId(userId),
    role: 'member',
    joinedAt: new Date(),
  });
  await community.save();

  const conv = await Conversation.findById(community.conversationId);
  if (conv) {
    const existsInConv = conv.participants.some((p) => p.userId.toString() === userId);
    if (!existsInConv) {
      conv.participants.push({
        userId: new Types.ObjectId(userId),
        role: 'member',
        joinedAt: new Date(),
        pinnedAt: null,
        mutedUntil: null,
        archivedAt: null,
        deletedAt: null,
        lastReadAt: new Date(),
      });
    } else {
      const existingPart = conv.participants.find((p) => p.userId.toString() === userId);
      if (existingPart) {
        existingPart.deletedAt = null;
        existingPart.role = 'member';
      }
    }

    const sysMsg = await Message.create({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      content: `${req.user!.fullName} joined the community`,
      messageType: 'system',
    });

    conv.lastMessage = {
      messageId: sysMsg._id as Types.ObjectId,
      senderId: new Types.ObjectId(userId),
      content: sysMsg.content,
      messageType: 'system',
      createdAt: sysMsg.createdAt,
    };
    await conv.save();

    emitCommunitySystemMessage(conv._id.toString(), {
      id: userId,
      fullName: req.user!.fullName,
      username: req.user!.username,
      avatar: req.user!.avatar,
    }, sysMsg);

    const io = getIO();
    io?.to(`conversation:${conv._id.toString()}`).emit('group:join', {
      communityId: community._id.toString(),
      conversationId: conv._id.toString(),
      userId,
    });
    io?.to(`conversation:${conv._id.toString()}`).emit('community:updated', {
      communityId: community._id.toString(),
    });
  }

  res.json({
    success: true,
    message: 'Joined community.',
    data: serializeCommunitySummary(community, userId),
  });
}

export async function cancelJoinRequest(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const hadRequest = community.pendingRequests.some((id) => id.toString() === userId);
  if (!hadRequest) {
    throw new AppError('No pending join request found.', 404, 'REQUEST_NOT_FOUND');
  }

  community.pendingRequests = community.pendingRequests.filter(
    (id) => id.toString() !== userId
  );
  await community.save();

  const io = getIO();
  io?.to(`conversation:${community.conversationId.toString()}`).emit('community:updated', {
    communityId: community._id.toString(),
  });

  res.json({
    success: true,
    message: 'Join request cancelled.',
    data: serializeCommunitySummary(community, userId),
  });
}

export async function leaveCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  if (community.ownerId.toString() === userId) {
    throw new AppError(
      'Community owners cannot leave without transferring ownership.',
      400,
      'OWNER_CANNOT_LEAVE'
    );
  }

  const wasMember = community.members.some((m) => m.userId.toString() === userId);
  if (!wasMember) {
    throw new AppError('You are not a member of this community.', 400, 'NOT_A_MEMBER');
  }

  community.members = community.members.filter((m) => m.userId.toString() !== userId);
  await community.save();

  const conv = await Conversation.findById(community.conversationId);
  if (conv) {
    conv.participants = conv.participants.filter((p) => p.userId.toString() !== userId);
    const sysMsg = await Message.create({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      content: `${req.user!.fullName} left the community`,
      messageType: 'system',
    });
    conv.lastMessage = {
      messageId: sysMsg._id as Types.ObjectId,
      senderId: new Types.ObjectId(userId),
      content: sysMsg.content,
      messageType: 'system',
      createdAt: sysMsg.createdAt,
    };
    await conv.save();

    emitCommunitySystemMessage(conv._id.toString(), {
      id: userId,
      fullName: req.user!.fullName,
      username: req.user!.username,
      avatar: req.user!.avatar,
    }, sysMsg);

    const io = getIO();
    io?.to(`conversation:${conv._id.toString()}`).emit('group:leave', {
      communityId: community._id.toString(),
      conversationId: conv._id.toString(),
      userId,
    });
    io?.to(`conversation:${conv._id.toString()}`).emit('community:updated', {
      communityId: community._id.toString(),
    });
  }

  res.json({ success: true, message: 'Left community.' });
}

export async function handleJoinRequest(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);
  const { targetUserId, decision } = handleJoinRequestSchema.parse(req.body);

  if (!Types.ObjectId.isValid(targetUserId)) {
    throw new AppError('Invalid target user.', 400, 'BAD_REQUEST');
  }

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const actor = community.members.find((m) => m.userId.toString() === userId);
  if (!actor || !['owner', 'admin'].includes(actor.role)) {
    throw new AppError('Only owners or admins can review join requests.', 403, 'FORBIDDEN');
  }

  const isPending = community.pendingRequests.some((id) => id.toString() === targetUserId);
  if (!isPending) {
    throw new AppError('Join request not found or already processed.', 404, 'REQUEST_NOT_FOUND');
  }

  community.pendingRequests = community.pendingRequests.filter(
    (id) => id.toString() !== targetUserId
  );

  const io = getIO();

  if (decision === 'approve') {
    const already = community.members.some((m) => m.userId.toString() === targetUserId);
    if (!already) {
      community.members.push({
        userId: new Types.ObjectId(targetUserId),
        role: 'member',
        joinedAt: new Date(),
      });
    }

    const targetUser = await User.findById(targetUserId).select('fullName username avatar');
    const conv = await Conversation.findById(community.conversationId);
    if (conv) {
      const existsInConv = conv.participants.some(
        (p) => p.userId.toString() === targetUserId
      );
      if (!existsInConv) {
        conv.participants.push({
          userId: new Types.ObjectId(targetUserId),
          role: 'member',
          joinedAt: new Date(),
          pinnedAt: null,
          mutedUntil: null,
          archivedAt: null,
          deletedAt: null,
          lastReadAt: new Date(),
        });
      }

      const sysMsg = await Message.create({
        conversationId: conv._id,
        senderId: new Types.ObjectId(targetUserId),
        content: `${targetUser?.fullName || 'A user'} joined the community`,
        messageType: 'system',
      });
      conv.lastMessage = {
        messageId: sysMsg._id as Types.ObjectId,
        senderId: new Types.ObjectId(targetUserId),
        content: sysMsg.content,
        messageType: 'system',
        createdAt: sysMsg.createdAt,
      };
      await conv.save();

      if (targetUser) {
        emitCommunitySystemMessage(conv._id.toString(), {
          id: targetUserId,
          fullName: targetUser.fullName,
          username: targetUser.username,
          avatar: targetUser.avatar,
        }, sysMsg);
      }

      io?.to(`conversation:${conv._id.toString()}`).emit('group:join', {
        communityId: community._id.toString(),
        conversationId: conv._id.toString(),
        userId: targetUserId,
      });
      io?.to(`user:${targetUserId}`).emit('conversation:new', {
        conversationId: conv._id.toString(),
      });
    }
  }

  await community.save();

  io?.to(`user:${targetUserId}`).emit('community:request_resolved', {
    communityId: community._id.toString(),
    communityName: community.name,
    decision,
  });
  io?.to(`conversation:${community.conversationId.toString()}`).emit('community:updated', {
    communityId: community._id.toString(),
  });

  await emitCommunityActivityNotification([targetUserId], {
    event: 'request_resolved',
    communityId: community._id.toString(),
    communityName: community.name,
    title: community.name,
    body:
      decision === 'approve'
        ? `Your request to join ${community.name} was approved.`
        : `Your request to join ${community.name} was declined.`,
  });

  res.json({
    success: true,
    message: `Request ${decision === 'approve' ? 'approved' : 'declined'}.`,
  });
}

export async function inviteMembers(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);
  const { userIds } = inviteCommunityMembersSchema.parse(req.body);

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const actor = community.members.find((m) => m.userId.toString() === userId);
  if (!actor) {
    throw new AppError('You must be a member to invite users.', 403, 'FORBIDDEN');
  }

  const settings = resolveSettings(community);
  if (!canInviteByRole(actor.role, settings)) {
    throw new AppError(
      'You do not have permission to invite members to this community.',
      403,
      'INVITE_FORBIDDEN'
    );
  }

  const validIds = Array.from(new Set(userIds)).filter((id) => Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new AppError('No valid users selected.', 400, 'BAD_REQUEST');
  }

  const users = await User.find({ _id: { $in: validIds }, isVerified: true }).select(
    'fullName username avatar'
  );
  if (users.length === 0) {
    throw new AppError('No valid verified users found.', 404, 'USERS_NOT_FOUND');
  }

  const existingMemberIds = new Set(community.members.map((m) => m.userId.toString()));
  const nonMembers = users.filter((u) => !existingMemberIds.has(u._id.toString()));

  if (nonMembers.length === 0) {
    throw new AppError(
      'Selected users are already members of this community.',
      409,
      'ALREADY_MEMBER'
    );
  }

  const addedUsers = [];
  for (const candidate of nonMembers) {
    const rel = await getBlockRelationship(userId, candidate._id.toString());
    if (!rel.blocked) {
      addedUsers.push(candidate);
    }
  }

  if (addedUsers.length === 0) {
    throw new AppError(
      'Selected users cannot be invited due to blocking restrictions.',
      403,
      'USER_BLOCKED'
    );
  }

  const addedIds = new Set(addedUsers.map((u) => u._id.toString()));
  for (const u of addedUsers) {
    community.members.push({
      userId: u._id as Types.ObjectId,
      role: 'member',
      joinedAt: new Date(),
    });
  }
  community.pendingRequests = community.pendingRequests.filter(
    (id) => !addedIds.has(id.toString())
  );
  await community.save();

  const conv = await Conversation.findById(community.conversationId);
  const io = getIO();
  if (conv) {
    for (const u of addedUsers) {
      const uid = u._id.toString();
      const existingPart = conv.participants.find((p) => p.userId.toString() === uid);
      if (existingPart) {
        existingPart.deletedAt = null;
        existingPart.role = 'member';
      } else {
        conv.participants.push({
          userId: u._id as Types.ObjectId,
          role: 'member',
          joinedAt: new Date(),
          pinnedAt: null,
          mutedUntil: null,
          archivedAt: null,
          deletedAt: null,
          lastReadAt: new Date(),
        });
      }
    }

    const names = addedUsers.map((u) => u.fullName).join(', ');
    const sysMsg = await Message.create({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      content: `${req.user!.fullName} added ${names} to the community`,
      messageType: 'system',
    });

    conv.lastMessage = {
      messageId: sysMsg._id as Types.ObjectId,
      senderId: new Types.ObjectId(userId),
      content: sysMsg.content,
      messageType: 'system',
      createdAt: sysMsg.createdAt,
    };
    await conv.save();

    emitCommunitySystemMessage(
      conv._id.toString(),
      {
        id: userId,
        fullName: req.user!.fullName,
        username: req.user!.username,
        avatar: req.user!.avatar,
      },
      sysMsg
    );

    for (const u of addedUsers) {
      const uid = u._id.toString();
      io?.to(`user:${uid}`).emit('community:invited', {
        communityId: community._id.toString(),
        communityName: community.name,
        invitedBy: req.user!.fullName,
      });
      io?.to(`user:${uid}`).emit('conversation:new', {
        conversationId: conv._id.toString(),
      });
      io?.to(`conversation:${conv._id.toString()}`).emit('group:join', {
        communityId: community._id.toString(),
        conversationId: conv._id.toString(),
        userId: uid,
      });
    }
    io?.to(`conversation:${conv._id.toString()}`).emit('community:updated', {
      communityId: community._id.toString(),
    });

    await emitCommunityActivityNotification(
      addedUsers.map((u) => u._id.toString()),
      {
        event: 'invited',
        communityId: community._id.toString(),
        communityName: community.name,
        title: community.name,
        body: `${req.user!.fullName} added you to ${community.name}.`,
      }
    );
  }

  res.status(201).json({
    success: true,
    message: `Added ${addedUsers.length} member${addedUsers.length === 1 ? '' : 's'} to the community.`,
    data: { addedCount: addedUsers.length },
  });
}

export async function updateMemberRole(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);
  const { memberId } = req.params;
  const { role } = req.body as { role?: 'admin' | 'moderator' | 'member' };

  if (!role || !['admin', 'moderator', 'member'].includes(role)) {
    throw new AppError('Invalid role specified.', 400, 'BAD_REQUEST');
  }

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const actor = community.members.find((m) => m.userId.toString() === userId);
  if (!actor || !['owner', 'admin'].includes(actor.role)) {
    throw new AppError('You do not have permission to manage member roles.', 403, 'FORBIDDEN');
  }

  if (memberId === community.ownerId.toString() || memberId === userId) {
    throw new AppError('The owner role cannot be modified here.', 403, 'OWNER_PROTECTED');
  }

  const target = community.members.find((m) => m.userId.toString() === memberId);
  if (!target) {
    throw new AppError('Member not found in community.', 404, 'NOT_FOUND');
  }

  if (!canChangeMemberRole(actor.role, target.role, role)) {
    throw new AppError(
      'Only the community owner can assign or modify Admin roles.',
      403,
      'FORBIDDEN'
    );
  }

  target.role = role;
  await community.save();

  await Conversation.updateOne(
    { _id: community.conversationId, 'participants.userId': new Types.ObjectId(memberId) },
    { $set: { 'participants.$.role': role } }
  );

  const io = getIO();
  io?.to(`conversation:${community.conversationId.toString()}`).emit('community:updated', {
    communityId: community._id.toString(),
  });
  io?.to(`user:${memberId}`).emit('community:member_updated', {
    communityId: community._id.toString(),
    communityName: community.name,
    role,
  });

  await emitCommunityActivityNotification([memberId], {
    event: 'member_updated',
    communityId: community._id.toString(),
    communityName: community.name,
    title: community.name,
    body: `Your role in ${community.name} was updated to ${role}.`,
  });

  res.json({ success: true, message: 'Member role updated.' });
}

export async function removeMember(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);
  const { memberId } = req.params;

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const actor = community.members.find((m) => m.userId.toString() === userId);
  if (!actor) {
    throw new AppError('Access denied.', 403, 'FORBIDDEN');
  }

  if (memberId === userId) {
    throw new AppError('Use Leave Community to exit on your own.', 400, 'BAD_REQUEST');
  }

  if (memberId === community.ownerId.toString()) {
    throw new AppError('The community owner cannot be removed.', 403, 'OWNER_PROTECTED');
  }

  const target = community.members.find((m) => m.userId.toString() === memberId);
  if (!target) {
    throw new AppError('Member not found in community.', 404, 'NOT_FOUND');
  }

  if (!canRemoveTargetMember(actor.role, target.role)) {
    throw new AppError(
      'You do not have permission to remove this member.',
      403,
      'FORBIDDEN'
    );
  }

  const targetUser = await User.findById(memberId).select('fullName username avatar');

  community.members = community.members.filter((m) => m.userId.toString() !== memberId);
  await community.save();

  const conv = await Conversation.findById(community.conversationId);
  const io = getIO();

  if (conv) {
    conv.participants = conv.participants.filter((p) => p.userId.toString() !== memberId);
    const sysMsg = await Message.create({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      content: `${targetUser?.fullName || 'A member'} was removed by ${req.user!.fullName}`,
      messageType: 'system',
    });
    conv.lastMessage = {
      messageId: sysMsg._id as Types.ObjectId,
      senderId: new Types.ObjectId(userId),
      content: sysMsg.content,
      messageType: 'system',
      createdAt: sysMsg.createdAt,
    };
    await conv.save();

    emitCommunitySystemMessage(
      conv._id.toString(),
      {
        id: userId,
        fullName: req.user!.fullName,
        username: req.user!.username,
        avatar: req.user!.avatar,
      },
      sysMsg
    );

    io?.to(`conversation:${conv._id.toString()}`).emit('group:leave', {
      communityId: community._id.toString(),
      conversationId: conv._id.toString(),
      userId: memberId,
    });
    io?.to(`conversation:${conv._id.toString()}`).emit('community:updated', {
      communityId: community._id.toString(),
    });
  }

  io?.to(`user:${memberId}`).emit('community:removed', {
    communityId: community._id.toString(),
    communityName: community.name,
  });

  await emitCommunityActivityNotification([memberId], {
    event: 'removed',
    communityId: community._id.toString(),
    communityName: community.name,
    title: community.name,
    body: `You were removed from ${community.name}.`,
  });

  res.json({ success: true, message: 'Member removed from community.' });
}

export async function updateCommunitySettings(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);
  const parsed = updateCommunitySettingsSchema.parse(req.body);

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const actor = community.members.find((m) => m.userId.toString() === userId);
  if (!actor || !['owner', 'admin'].includes(actor.role)) {
    throw new AppError(
      'Only owners or admins can update community settings.',
      403,
      'FORBIDDEN'
    );
  }

  if (parsed.privacy !== undefined && parsed.privacy !== community.privacy) {
    if (actor.role !== 'owner') {
      throw new AppError(
        'Only the community owner can change privacy settings.',
        403,
        'OWNER_ONLY'
      );
    }
    community.privacy = parsed.privacy;
  }

  if (parsed.name !== undefined) community.name = parsed.name;
  if (parsed.description !== undefined) community.description = parsed.description;
  if (parsed.image !== undefined) community.image = parsed.image;

  const currentSettings = resolveSettings(community);
  if (parsed.settings) {
    community.settings = {
      whoCanInvite: parsed.settings.whoCanInvite ?? currentSettings.whoCanInvite,
      whoCanPinMessages:
        parsed.settings.whoCanPinMessages ?? currentSettings.whoCanPinMessages,
      whoCanPost: parsed.settings.whoCanPost ?? currentSettings.whoCanPost,
    };
  }

  await community.save();

  // Keep linked conversation name and avatar synchronized
  await Conversation.updateOne(
    { _id: community.conversationId },
    {
      $set: {
        name: community.name,
        avatar: community.image,
      },
    }
  );

  const io = getIO();
  io?.to(`conversation:${community.conversationId.toString()}`).emit('community:updated', {
    communityId: community._id.toString(),
  });

  res.json({
    success: true,
    message: 'Community settings updated.',
    data: serializeCommunitySummary(community, userId),
  });
}

export async function transferOwnership(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);
  const { newOwnerId } = transferOwnershipSchema.parse(req.body);

  if (!Types.ObjectId.isValid(newOwnerId)) {
    throw new AppError('Invalid target member.', 400, 'BAD_REQUEST');
  }

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  if (community.ownerId.toString() !== userId) {
    throw new AppError('Only the community owner can transfer ownership.', 403, 'OWNER_ONLY');
  }

  if (newOwnerId === userId) {
    throw new AppError('You are already the owner of this community.', 400, 'BAD_REQUEST');
  }

  const currentOwnerMember = community.members.find((m) => m.userId.toString() === userId);
  const newOwnerMember = community.members.find((m) => m.userId.toString() === newOwnerId);
  if (!newOwnerMember || !currentOwnerMember) {
    throw new AppError('Selected user must be an active member of the community.', 404, 'NOT_FOUND');
  }

  currentOwnerMember.role = 'admin';
  newOwnerMember.role = 'owner';
  community.ownerId = new Types.ObjectId(newOwnerId);
  await community.save();

  const conv = await Conversation.findById(community.conversationId);
  if (conv) {
    for (const p of conv.participants) {
      if (p.userId.toString() === userId) p.role = 'admin';
      if (p.userId.toString() === newOwnerId) p.role = 'owner';
    }

    const newOwnerUser = await User.findById(newOwnerId).select('fullName');
    const sysMsg = await Message.create({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      content: `${req.user!.fullName} transferred ownership to ${newOwnerUser?.fullName || 'a member'}`,
      messageType: 'system',
    });
    conv.lastMessage = {
      messageId: sysMsg._id as Types.ObjectId,
      senderId: new Types.ObjectId(userId),
      content: sysMsg.content,
      messageType: 'system',
      createdAt: sysMsg.createdAt,
    };
    await conv.save();

    emitCommunitySystemMessage(
      conv._id.toString(),
      {
        id: userId,
        fullName: req.user!.fullName,
        username: req.user!.username,
        avatar: req.user!.avatar,
      },
      sysMsg
    );
  }

  const io = getIO();
  io?.to(`conversation:${community.conversationId.toString()}`).emit('community:updated', {
    communityId: community._id.toString(),
  });
  io?.to(`user:${newOwnerId}`).emit('community:member_updated', {
    communityId: community._id.toString(),
    communityName: community.name,
    role: 'owner',
  });

  res.json({ success: true, message: 'Community ownership transferred.' });
}

export async function deleteCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  assertValidObjectId(req.params.id);

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  if (community.ownerId.toString() !== userId) {
    throw new AppError('Only the community owner can delete this community.', 403, 'OWNER_ONLY');
  }

  const convId = community.conversationId.toString();
  const memberIds = community.members.map((m) => m.userId.toString());

  await Promise.all([
    Message.deleteMany({ conversationId: community.conversationId }),
    Conversation.deleteOne({ _id: community.conversationId }),
    Community.deleteOne({ _id: community._id }),
  ]);

  const io = getIO();
  io?.to(`conversation:${convId}`).emit('community:deleted', {
    communityId: community._id.toString(),
    communityName: community.name,
  });
  for (const memberId of memberIds) {
    io?.to(`user:${memberId}`).emit('community:deleted', {
      communityId: community._id.toString(),
      communityName: community.name,
    });
  }

  await emitCommunityActivityNotification(
    memberIds.filter((id) => id !== userId),
    {
      event: 'deleted',
      communityId: community._id.toString(),
      communityName: community.name,
      title: community.name,
      body: `${community.name} was deleted by the owner.`,
    }
  );

  res.json({ success: true, message: 'Community deleted permanently.' });
}
