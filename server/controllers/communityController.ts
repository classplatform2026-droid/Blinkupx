import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { Community, type ICommunity } from '../models/Community.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import { getIO } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { serializePublicUser } from '../utils/serializers.ts';
import { createCommunitySchema } from '../validators/schemas.ts';

function serializeCommunitySummary(c: ICommunity, userId: string) {
  const member = c.members.find((m) => m.userId.toString() === userId);
  const isPending = c.pendingRequests.some((id) => id.toString() === userId);
  return {
    id: c._id.toString(),
    name: c.name,
    description: c.description,
    image: c.image,
    privacy: c.privacy,
    ownerId: c.ownerId.toString(),
    conversationId: c.conversationId.toString(),
    memberCount: c.members.length,
    isMember: Boolean(member),
    myRole: member?.role || null,
    isPending,
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
  const community = await Community.findById(req.params.id)
    .populate('members.userId', 'fullName username avatar onlineStatus lastSeen')
    .populate('pendingRequests', 'fullName username avatar onlineStatus lastSeen');

  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const selfMember = community.members.find(
    (m) => m.userId && (m.userId as unknown as { _id: Types.ObjectId })._id.toString() === userId
  );

  if (community.privacy === 'private' && !selfMember) {
    return res.json({
      success: true,
      data: {
        id: community._id.toString(),
        name: community.name,
        description: community.description,
        image: community.image,
        privacy: community.privacy,
        memberCount: community.members.length,
        isMember: false,
        isPending: community.pendingRequests.some(
          (u) => (u as unknown as { _id: Types.ObjectId })._id.toString() === userId
        ),
        conversationId: null,
        members: [],
        pendingRequests: [],
      },
    });
  }

  const canManage = selfMember && ['owner', 'admin'].includes(selfMember.role);

  res.json({
    success: true,
    data: {
      id: community._id.toString(),
      name: community.name,
      description: community.description,
      image: community.image,
      privacy: community.privacy,
      ownerId: community.ownerId.toString(),
      conversationId: community.conversationId.toString(),
      memberCount: community.members.length,
      isMember: Boolean(selfMember),
      myRole: selfMember?.role || null,
      isPending: false,
      members: community.members.map((m) => ({
        role: m.role,
        joinedAt: m.joinedAt,
        user: serializePublicUser(m.userId as unknown as Parameters<typeof serializePublicUser>[0]),
      })),
      pendingRequests: canManage
        ? community.pendingRequests.map((u) =>
            serializePublicUser(u as unknown as Parameters<typeof serializePublicUser>[0])
          )
        : [],
      createdAt: community.createdAt,
    },
  });
}

export async function joinCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const already = community.members.some((m) => m.userId.toString() === userId);
  if (already) {
    return res.json({
      success: true,
      message: 'Already a member.',
      data: serializeCommunitySummary(community, userId),
    });
  }

  if (community.privacy === 'private') {
    const alreadyRequested = community.pendingRequests.some(
      (id) => id.toString() === userId
    );
    if (!alreadyRequested) {
      community.pendingRequests.push(new Types.ObjectId(userId));
      await community.save();
    }
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

    const io = getIO();
    io?.to(`conversation:${conv._id.toString()}`).emit('message:new', {
      id: sysMsg._id.toString(),
      conversationId: conv._id.toString(),
      senderId: userId,
      sender: {
        id: userId,
        fullName: req.user!.fullName,
        username: req.user!.username,
        avatar: req.user!.avatar,
      },
      content: sysMsg.content,
      messageType: 'system',
      attachments: [],
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
    io?.to(`conversation:${conv._id.toString()}`).emit('group:join', {
      communityId: community._id.toString(),
      conversationId: conv._id.toString(),
      userId,
    });
  }

  res.json({
    success: true,
    message: 'Joined community.',
    data: serializeCommunitySummary(community, userId),
  });
}

export async function leaveCommunity(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
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

    const io = getIO();
    io?.to(`conversation:${conv._id.toString()}`).emit('group:leave', {
      communityId: community._id.toString(),
      conversationId: conv._id.toString(),
      userId,
    });
  }

  res.json({ success: true, message: 'Left community.' });
}

export async function handleJoinRequest(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const { targetUserId, decision } = req.body as {
    targetUserId?: string;
    decision?: 'approve' | 'reject';
  };
  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  const actor = community.members.find((m) => m.userId.toString() === userId);
  if (!actor || !['owner', 'admin'].includes(actor.role)) {
    throw new AppError('Only owners or admins can review join requests.', 403, 'FORBIDDEN');
  }

  if (!targetUserId) {
    throw new AppError('Target user is required.', 400, 'BAD_REQUEST');
  }

  community.pendingRequests = community.pendingRequests.filter(
    (id) => id.toString() !== targetUserId
  );

  if (decision === 'approve') {
    const already = community.members.some((m) => m.userId.toString() === targetUserId);
    if (!already) {
      community.members.push({
        userId: new Types.ObjectId(targetUserId),
        role: 'member',
        joinedAt: new Date(),
      });
    }
    await Conversation.updateOne(
      { _id: community.conversationId },
      {
        $push: {
          participants: {
            userId: new Types.ObjectId(targetUserId),
            role: 'member',
            joinedAt: new Date(),
            lastReadAt: new Date(),
          },
        },
      }
    );
  }

  await community.save();
  res.json({ success: true, message: `Request ${decision === 'approve' ? 'approved' : 'declined'}.` });
}

export async function updateMemberRole(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const { memberId } = req.params;
  const { role } = req.body as { role?: 'admin' | 'moderator' | 'member' };

  if (!role || !['admin', 'moderator', 'member'].includes(role)) {
    throw new AppError('Invalid role specified.', 400, 'BAD_REQUEST');
  }

  const community = await Community.findById(req.params.id);
  if (!community) {
    throw new AppError('Community not found.', 404, 'COMMUNITY_NOT_FOUND');
  }

  if (community.ownerId.toString() !== userId) {
    throw new AppError('Only the community owner can change member roles.', 403, 'FORBIDDEN');
  }
  if (memberId === userId) {
    throw new AppError('Owner role cannot be downgraded.', 400, 'BAD_REQUEST');
  }

  const target = community.members.find((m) => m.userId.toString() === memberId);
  if (!target) {
    throw new AppError('Member not found in community.', 404, 'NOT_FOUND');
  }

  target.role = role;
  await community.save();

  await Conversation.updateOne(
    { _id: community.conversationId, 'participants.userId': new Types.ObjectId(memberId) },
    { $set: { 'participants.$.role': role } }
  );

  res.json({ success: true, message: 'Member role updated.' });
}
