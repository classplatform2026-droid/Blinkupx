import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { Community } from '../models/Community.ts';
import { Conversation, type IConversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import { User } from '../models/User.ts';
import {
  getBlockRelationship,
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
  type ViewerRelationshipContext,
} from '../services/privacyService.ts';
import { getIO } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { extractUrlsFromText } from '../utils/linkPreview.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import { createConversationSchema } from '../validators/schemas.ts';

async function formatConversation(
  conv: IConversation,
  currentUserId: string,
  sharedContext?: ViewerRelationshipContext
) {
  const selfPart = conv.participants.find(
    (p) => p.userId.toString() === currentUserId
  );

  const participantIds = conv.participants.map((p) => p.userId);
  const users = await User.find({ _id: { $in: participantIds } }).select(
    PUBLIC_USER_SELECT
  );
  const context =
    sharedContext ||
    (await getViewerRelationshipContext(
      currentUserId,
      users.map((u) => u._id.toString())
    ));
  const userMap = new Map(
    users.map((u) => [u._id.toString(), serializeUserWithPrivacy(u, context)])
  );

  let communityRoles: Record<string, string> = {};
  if (conv.communityId) {
    const community = await Community.findById(conv.communityId).select('members');
    if (community) {
      for (const m of community.members) {
        communityRoles[m.userId.toString()] = m.role;
      }
    }
  }

  const participants = conv.participants.map((p) => ({
    userId: p.userId.toString(),
    role: communityRoles[p.userId.toString()] || p.role,
    user: userMap.get(p.userId.toString()) || null,
    lastReadAt: p.lastReadAt,
  }));

  const peer =
    conv.type === 'direct'
      ? participants.find((p) => p.userId !== currentUserId)?.user || null
      : null;

  const unreadCount = await Message.countDocuments({
    conversationId: conv._id,
    senderId: { $ne: currentUserId },
    createdAt: { $gt: selfPart?.lastReadAt || new Date(0) },
    deletedAt: null,
    deletedFor: { $ne: currentUserId },
  });

  let pinnedMessage = null;
  if (conv.pinnedMessageId) {
    const pm = await Message.findById(conv.pinnedMessageId)
      .populate('senderId', 'fullName username avatar')
      .lean();
    if (pm && !pm.deletedAt) {
      pinnedMessage = {
        id: pm._id.toString(),
        content: pm.content,
        messageType: pm.messageType,
        sender: pm.senderId,
      };
    }
  }

  return {
    id: conv._id.toString(),
    type: conv.type,
    name: conv.type === 'direct' ? peer?.fullName || 'Unknown User' : conv.name,
    username: conv.type === 'direct' ? peer?.username || '' : '',
    avatar: conv.type === 'direct' ? peer?.avatar || '' : conv.avatar,
    onlineStatus: conv.type === 'direct' ? Boolean(peer?.onlineStatus) : false,
    lastSeen: conv.type === 'direct' ? peer?.lastSeen || null : null,
    isBlockedByMe: conv.type === 'direct' ? Boolean(peer?.isBlockedByMe) : false,
    hasBlockedMe: conv.type === 'direct' ? Boolean(peer?.hasBlockedMe) : false,
    peerPrivacy: conv.type === 'direct' ? peer?.privacyStatus || null : null,
    communityId: conv.communityId ? conv.communityId.toString() : null,
    participants,
    lastMessage: conv.lastMessage
      ? {
          messageId: conv.lastMessage.messageId?.toString() || null,
          senderId: conv.lastMessage.senderId?.toString() || null,
          content: conv.lastMessage.content,
          messageType: conv.lastMessage.messageType,
          createdAt: conv.lastMessage.createdAt,
        }
      : null,
    pinnedMessage,
    unreadCount,
    isPinned: Boolean(selfPart?.pinnedAt),
    pinnedAt: selfPart?.pinnedAt || null,
    isMuted: Boolean(selfPart?.mutedUntil && selfPart.mutedUntil > new Date()),
    mutedUntil: selfPart?.mutedUntil || null,
    isArchived: Boolean(selfPart?.archivedAt),
    updatedAt: conv.updatedAt,
    createdAt: conv.createdAt,
  };
}

export async function listConversations(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const filter = String(req.query.filter || 'all');

  const query: Record<string, unknown> = {
    participants: {
      $elemMatch: {
        userId: new Types.ObjectId(userId),
        deletedAt: null,
      },
    },
  };

  if (filter === 'groups') {
    query.type = { $in: ['group', 'community'] };
  }

  const convs = await Conversation.find(query).sort({ updatedAt: -1 }).limit(100);
  const formatted = await Promise.all(convs.map((c) => formatConversation(c, userId)));

  let filtered = formatted;
  if (filter === 'archived') {
    filtered = formatted.filter((c) => c.isArchived);
  } else {
    filtered = formatted.filter((c) => !c.isArchived);
    if (filter === 'unread') {
      filtered = filtered.filter((c) => c.unreadCount > 0);
    }
  }

  filtered.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aTime = new Date(a.lastMessage?.createdAt || a.updatedAt).getTime();
    const bTime = new Date(b.lastMessage?.createdAt || b.updatedAt).getTime();
    return bTime - aTime;
  });

  res.json({ success: true, data: filtered });
}

export async function createConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const parsed = createConversationSchema.parse(req.body);

  const uniqueMemberIds = Array.from(
    new Set([userId, ...parsed.participantIds])
  );

  if (parsed.type === 'direct') {
    if (uniqueMemberIds.length !== 2) {
      throw new AppError('Direct conversations require one other user.', 400, 'INVALID_PARTICIPANTS');
    }
    const peerId = uniqueMemberIds.find((id) => id !== userId)!;
    const peerExists = await User.findOne({ _id: peerId, isVerified: true }).select('_id');
    if (!peerExists) {
      throw new AppError('Selected user was not found.', 404, 'USER_NOT_FOUND');
    }

    const blockRel = await getBlockRelationship(userId, peerId);
    if (blockRel.blocked) {
      throw new AppError(
        blockRel.blockedByA
          ? 'You blocked this contact. Unblock them to start a conversation.'
          : 'You cannot start a conversation with this user.',
        403,
        'USER_BLOCKED'
      );
    }

    const existing = await Conversation.findOne({
      type: 'direct',
      $and: [
        { 'participants.userId': new Types.ObjectId(userId) },
        { 'participants.userId': new Types.ObjectId(peerId) },
      ],
    });

    if (existing) {
      await Conversation.updateOne(
        { _id: existing._id, 'participants.userId': new Types.ObjectId(userId) },
        { $set: { 'participants.$.deletedAt': null, 'participants.$.archivedAt': null } }
      );
      const refreshed = await Conversation.findById(existing._id);
      const formatted = await formatConversation(refreshed!, userId);
      return res.json({ success: true, data: formatted });
    }
  } else {
    if (!parsed.name || parsed.name.trim().length < 2) {
      throw new AppError('Group name is required.', 400, 'GROUP_NAME_REQUIRED');
    }
    if (uniqueMemberIds.length < 2) {
      throw new AppError('Select at least one participant for the group.', 400, 'INVALID_PARTICIPANTS');
    }
    for (const memberId of uniqueMemberIds) {
      if (memberId === userId) continue;
      const blockRel = await getBlockRelationship(userId, memberId);
      if (blockRel.blocked) {
        throw new AppError(
          'Cannot add blocked contacts to a new group conversation.',
          403,
          'USER_BLOCKED'
        );
      }
    }
  }

  const participants = uniqueMemberIds.map((id) => ({
    userId: new Types.ObjectId(id),
    role: (id === userId && parsed.type === 'group' ? 'owner' : 'member') as 'owner' | 'member',
    joinedAt: new Date(),
    lastReadAt: new Date(),
  }));

  const conv = await Conversation.create({
    type: parsed.type,
    name: parsed.type === 'group' ? parsed.name?.trim() || 'New Group' : '',
    avatar: parsed.avatar || '',
    participants,
    createdBy: new Types.ObjectId(userId),
  });

  const io = getIO();
  if (io) {
    for (const memberId of uniqueMemberIds) {
      io.to(`user:${memberId}`).emit('conversation:new', {
        conversationId: conv._id.toString(),
      });
    }
  }

  const formatted = await formatConversation(conv, userId);
  res.status(201).json({ success: true, data: formatted });
}

export async function getConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const conv = await Conversation.findOne({
    _id: req.params.id,
    'participants.userId': new Types.ObjectId(userId),
  });

  if (!conv) {
    throw new AppError('Conversation not found or access denied.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const formatted = await formatConversation(conv, userId);
  res.json({ success: true, data: formatted });
}

export async function updateConversationMeta(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const conv = await Conversation.findOne({
    _id: req.params.id,
    'participants.userId': new Types.ObjectId(userId),
  });

  if (!conv) {
    throw new AppError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const { action, pinnedMessageId } = req.body as {
    action?: 'pin' | 'unpin' | 'mute' | 'unmute' | 'archive' | 'unarchive' | 'read' | 'pinMessage' | 'unpinMessage';
    pinnedMessageId?: string;
  };

  const partIndex = conv.participants.findIndex((p) => p.userId.toString() === userId);
  if (partIndex === -1) {
    throw new AppError('Access denied.', 403, 'FORBIDDEN');
  }

  const now = new Date();
  switch (action) {
    case 'pin':
      conv.participants[partIndex].pinnedAt = now;
      break;
    case 'unpin':
      conv.participants[partIndex].pinnedAt = null;
      break;
    case 'mute':
      conv.participants[partIndex].mutedUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      break;
    case 'unmute':
      conv.participants[partIndex].mutedUntil = null;
      break;
    case 'archive':
      conv.participants[partIndex].archivedAt = now;
      break;
    case 'unarchive':
      conv.participants[partIndex].archivedAt = null;
      break;
    case 'read':
      conv.participants[partIndex].lastReadAt = now;
      break;
    case 'pinMessage':
    case 'unpinMessage': {
      let role = conv.participants[partIndex].role;
      let allowedPinRoles = ['owner', 'admin', 'moderator'];
      if (conv.communityId) {
        const community = await Community.findById(conv.communityId).select('members settings');
        const commMember = community?.members.find((m) => m.userId.toString() === userId);
        if (commMember) role = commMember.role;
        if (community?.settings?.whoCanPinMessages === 'admins') {
          allowedPinRoles = ['owner', 'admin'];
        }
      }
      if (conv.type !== 'direct' && !allowedPinRoles.includes(role)) {
        throw new AppError(
          'You do not have permission to pin or unpin messages here.',
          403,
          'FORBIDDEN'
        );
      }
      if (action === 'pinMessage') {
        if (!pinnedMessageId) {
          throw new AppError('Message ID is required to pin.', 400, 'BAD_REQUEST');
        }
        conv.pinnedMessageId = new Types.ObjectId(pinnedMessageId);
      } else {
        conv.pinnedMessageId = null;
      }
      break;
    }
    default:
      throw new AppError('Unsupported conversation action.', 400, 'BAD_REQUEST');
  }

  await conv.save();
  const formatted = await formatConversation(conv, userId);

  if (action === 'pinMessage' || action === 'unpinMessage') {
    const io = getIO();
    io?.to(`conversation:${conv._id.toString()}`).emit('conversation:updated', {
      conversationId: conv._id.toString(),
      pinnedMessage: formatted.pinnedMessage,
    });
  }

  res.json({ success: true, data: formatted });
}

export async function markAllAsRead(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const now = new Date();
  const userObjectId = new Types.ObjectId(userId);

  const [convs, currentUser] = await Promise.all([
    Conversation.find({
      'participants.userId': userObjectId,
    }).select('_id type participants.userId'),
    User.findById(userObjectId).select('settings blockedUsers'),
  ]);

  const resolvedSettings = resolveUserSettings(currentUser?.settings);
  const allowDirectReadReceipts = resolvedSettings.privacy.readReceipts;
  const blockedSet = new Set(
    (currentUser?.blockedUsers || []).map((id) => id.toString())
  );

  await Conversation.updateMany(
    { 'participants.userId': userObjectId },
    { $set: { 'participants.$.lastReadAt': now } }
  );

  const allConvIds = convs.map((c) => c._id);

  // Keep delivery tracking independent from read receipts
  await Message.updateMany(
    {
      conversationId: { $in: allConvIds },
      senderId: { $ne: userObjectId },
      deliveredTo: { $ne: userObjectId },
    },
    {
      $addToSet: { deliveredTo: userObjectId },
    }
  );
  await Message.updateMany(
    {
      conversationId: { $in: allConvIds },
      senderId: { $ne: userObjectId },
      deliveryStatus: 'sent',
    },
    {
      $set: { deliveryStatus: 'delivered' },
    }
  );

  const readReceiptConvIds = convs
    .filter((c) => {
      if (c.type !== 'direct') return true;
      if (!allowDirectReadReceipts) return false;
      const peer = c.participants.find((p) => p.userId.toString() !== userId);
      if (peer && blockedSet.has(peer.userId.toString())) return false;
      return true;
    })
    .map((c) => c._id);

  if (readReceiptConvIds.length > 0) {
    await Message.updateMany(
      {
        conversationId: { $in: readReceiptConvIds },
        senderId: { $ne: userObjectId },
        readBy: { $ne: userObjectId },
      },
      {
        $addToSet: { readBy: userObjectId, deliveredTo: userObjectId },
        $set: { deliveryStatus: 'read' },
      }
    );
  }

  res.json({ success: true, message: 'All conversations marked as read.' });
}

export async function deleteConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const conv = await Conversation.findOne({
    _id: req.params.id,
    'participants.userId': new Types.ObjectId(userId),
  });
  if (!conv) {
    throw new AppError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  await Conversation.updateOne(
    { _id: conv._id, 'participants.userId': new Types.ObjectId(userId) },
    { $set: { 'participants.$.deletedAt': new Date() } }
  );

  res.json({ success: true, message: 'Conversation removed from your chat list.' });
}

function getFileExtension(fileName: string, mimeType: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx !== -1 && dotIdx < fileName.length - 1) {
    return fileName.slice(dotIdx + 1).toUpperCase().slice(0, 6);
  }
  const slashIdx = mimeType.lastIndexOf('/');
  if (slashIdx !== -1) {
    return mimeType.slice(slashIdx + 1).toUpperCase().slice(0, 6);
  }
  return 'FILE';
}

export async function getSharedMedia(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const tab = String(req.query.tab || 'media').toLowerCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  const subType = String(req.query.subType || 'all').toLowerCase();
  const limit = Math.min(Number(req.query.limit || 80), 150);

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid conversation identifier.', 400, 'INVALID_CONVERSATION_ID');
  }

  const conv = await Conversation.findOne({
    _id: id,
    'participants.userId': new Types.ObjectId(userId),
  }).select('_id');

  if (!conv) {
    throw new AppError('Conversation not found or access denied.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const msgs = await Message.find({
    conversationId: conv._id,
    deletedAt: null,
    deletedFor: { $ne: new Types.ObjectId(userId) },
    $or: [
      { messageType: { $ne: 'voice' }, 'attachments.0': { $exists: true } },
      { 'links.0': { $exists: true } },
      { content: /(?:https?:\/\/|www\.)/i },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(400)
    .populate('senderId', 'fullName username avatar');

  type MediaEntry = {
    id: string;
    messageId: string;
    attachmentIndex: number;
    kind: 'image' | 'video';
    url: string;
    downloadUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    caption: string;
    sender: { id: string; fullName: string; username: string; avatar: string } | null;
    createdAt: Date;
  };

  type FileEntry = {
    id: string;
    messageId: string;
    attachmentIndex: number;
    url: string;
    downloadUrl: string;
    fileName: string;
    fileExtension: string;
    fileSize: number;
    mimeType: string;
    caption: string;
    sender: { id: string; fullName: string; username: string; avatar: string } | null;
    createdAt: Date;
  };

  type LinkEntry = {
    id: string;
    messageId: string;
    url: string;
    domain: string;
    title: string;
    description: string;
    image: string;
    siteName: string;
    messageContent: string;
    sender: { id: string; fullName: string; username: string; avatar: string } | null;
    createdAt: Date;
  };

  const mediaItems: MediaEntry[] = [];
  const fileItems: FileEntry[] = [];
  const linkItems: LinkEntry[] = [];

  for (const m of msgs) {
    const rawSender = m.senderId as unknown as {
      _id?: { toString(): string };
      fullName?: string;
      username?: string;
      avatar?: string;
    } | null;

    const sender =
      rawSender && rawSender._id
        ? {
            id: rawSender._id.toString(),
            fullName: rawSender.fullName || 'User',
            username: rawSender.username || '',
            avatar: rawSender.avatar || '',
          }
        : null;

    // Attachments -> Media (photos/videos) or Files (documents)
    (m.attachments || []).forEach((att, idx) => {
      const mime = (att.mimeType || '').toLowerCase();
      const ext = getFileExtension(att.fileName || '', att.mimeType || '');
      const isImage =
        mime.startsWith('image/') ||
        ['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'].includes(ext) ||
        (m.messageType === 'image' && !mime.startsWith('video/'));
      const isVideo =
        mime.startsWith('video/') ||
        ['MP4', 'WEBM', 'MOV', '3GP', 'MKV', 'AVI', 'M4V'].includes(ext) ||
        m.messageType === 'video';
      const isVoice = m.messageType === 'voice' || mime.startsWith('audio/');
      const downloadUrl = `/api/media/download/${m._id.toString()}/${idx}`;

      if (isImage || isVideo) {
        mediaItems.push({
          id: `${m._id.toString()}-${idx}`,
          messageId: m._id.toString(),
          attachmentIndex: idx,
          kind: isVideo ? 'video' : 'image',
          url: att.url,
          downloadUrl,
          fileName: att.fileName || (isVideo ? 'video' : 'photo'),
          fileSize: att.fileSize || 0,
          mimeType: att.mimeType || '',
          caption: m.content || '',
          sender,
          createdAt: m.createdAt,
        });
      } else if (!isVoice) {
        fileItems.push({
          id: `${m._id.toString()}-${idx}`,
          messageId: m._id.toString(),
          attachmentIndex: idx,
          url: att.url,
          downloadUrl,
          fileName: att.fileName || 'Document',
          fileExtension: getFileExtension(att.fileName || '', att.mimeType || ''),
          fileSize: att.fileSize || 0,
          mimeType: att.mimeType || '',
          caption: m.content || '',
          sender,
          createdAt: m.createdAt,
        });
      }
    });

    // Links -> stored previews or extracted URLs from message content
    const storedLinks = m.links && m.links.length > 0 ? m.links : [];
    if (storedLinks.length > 0) {
      storedLinks.forEach((lnk, idx) => {
        linkItems.push({
          id: `${m._id.toString()}-link-${idx}`,
          messageId: m._id.toString(),
          url: lnk.url,
          domain: lnk.domain || '',
          title: lnk.title || lnk.domain || lnk.url,
          description: lnk.description || '',
          image: lnk.image || '',
          siteName: lnk.siteName || lnk.domain || '',
          messageContent: m.content || '',
          sender,
          createdAt: m.createdAt,
        });
      });
    } else if (m.content) {
      const urls = extractUrlsFromText(m.content);
      urls.forEach((u, idx) => {
        let domain = u;
        try {
          domain = new URL(u).hostname.replace(/^www\./i, '');
        } catch {
          // ignore
        }
        linkItems.push({
          id: `${m._id.toString()}-link-${idx}`,
          messageId: m._id.toString(),
          url: u,
          domain,
          title: domain,
          description: '',
          image: '',
          siteName: domain,
          messageContent: m.content || '',
          sender,
          createdAt: m.createdAt,
        });
      });
    }
  }

  const counts = {
    media: mediaItems.length,
    files: fileItems.length,
    links: linkItems.length,
  };

  const docExtensions = new Set([
    'DOC',
    'DOCX',
    'TXT',
    'CSV',
    'RTF',
    'MD',
    'LOG',
    'XLS',
    'XLSX',
    'PPT',
    'PPTX',
    'ODT',
    'ODS',
    'ODP',
  ]);

  if (tab === 'files') {
    let filtered = fileItems;
    if (subType === 'pdf') {
      filtered = filtered.filter(
        (f) => f.mimeType === 'application/pdf' || f.fileExtension === 'PDF'
      );
    } else if (subType === 'doc') {
      filtered = filtered.filter((f) => docExtensions.has(f.fileExtension));
    } else if (subType === 'other') {
      filtered = filtered.filter(
        (f) =>
          f.mimeType !== 'application/pdf' &&
          f.fileExtension !== 'PDF' &&
          !docExtensions.has(f.fileExtension)
      );
    }
    if (q) {
      filtered = filtered.filter(
        (f) =>
          f.fileName.toLowerCase().includes(q) ||
          f.fileExtension.toLowerCase().includes(q) ||
          f.caption.toLowerCase().includes(q) ||
          (f.sender?.fullName.toLowerCase().includes(q) ?? false)
      );
    }
    return res.json({
      success: true,
      data: { tab: 'files', counts, items: filtered.slice(0, limit) },
    });
  }

  if (tab === 'links') {
    let filtered = linkItems;
    if (q) {
      filtered = filtered.filter(
        (l) =>
          l.url.toLowerCase().includes(q) ||
          l.title.toLowerCase().includes(q) ||
          l.domain.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          l.messageContent.toLowerCase().includes(q) ||
          (l.sender?.fullName.toLowerCase().includes(q) ?? false)
      );
    }
    return res.json({
      success: true,
      data: { tab: 'links', counts, items: filtered.slice(0, limit) },
    });
  }

  // Default tab: media
  let filteredMedia = mediaItems;
  if (subType === 'image') {
    filteredMedia = filteredMedia.filter((item) => item.kind === 'image');
  } else if (subType === 'video') {
    filteredMedia = filteredMedia.filter((item) => item.kind === 'video');
  }
  if (q) {
    filteredMedia = filteredMedia.filter(
      (item) =>
        item.fileName.toLowerCase().includes(q) ||
        item.caption.toLowerCase().includes(q) ||
        (item.sender?.fullName.toLowerCase().includes(q) ?? false)
    );
  }

  return res.json({
    success: true,
    data: { tab: 'media', counts, items: filteredMedia.slice(0, limit) },
  });
}
