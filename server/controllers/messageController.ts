import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { Community } from '../models/Community.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message, type IMessage } from '../models/Message.ts';
import { User } from '../models/User.ts';
import {
  getBlockRelationship,
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
  type PrivacyTargetUserLike,
  type ViewerRelationshipContext,
} from '../services/privacyService.ts';
import { getIO, isUserConnected } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { extractAndFetchLinkPreviews } from '../utils/linkPreview.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import {
  editMessageSchema,
  reactionSchema,
  sendMessageSchema,
} from '../validators/schemas.ts';

function serializeMessage(msg: IMessage, viewerContext?: ViewerRelationshipContext) {
  const rawSender = msg.senderId as unknown;
  const senderObj =
    typeof rawSender === 'object' && rawSender !== null && 'fullName' in rawSender
      ? (rawSender as PrivacyTargetUserLike)
      : null;

  const senderSerialized = senderObj
    ? viewerContext
      ? serializeUserWithPrivacy(senderObj, viewerContext)
      : {
          id: senderObj._id.toString(),
          fullName: senderObj.fullName,
          username: senderObj.username,
          avatar: senderObj.avatar || '',
        }
    : null;

  const rawReply = msg.replyTo as unknown;
  const replyObj =
    typeof rawReply === 'object' && rawReply !== null && 'content' in rawReply
      ? (rawReply as {
          _id: { toString(): string };
          content: string;
          messageType: string;
          deletedAt?: Date | null;
          senderId?: { _id?: { toString(): string }; fullName?: string; username?: string };
        })
      : null;

  const isDeleted = Boolean(msg.deletedAt);

  return {
    id: msg._id.toString(),
    conversationId: msg.conversationId.toString(),
    senderId: senderObj ? senderObj._id.toString() : String(msg.senderId),
    sender: senderSerialized
      ? {
          id: senderSerialized.id,
          fullName: senderSerialized.fullName,
          username: senderSerialized.username,
          avatar: senderSerialized.avatar || '',
        }
      : null,
    content: isDeleted ? 'This message was deleted' : msg.content,
    messageType: msg.messageType,
    attachments: isDeleted ? [] : msg.attachments,
    links: isDeleted ? [] : msg.links || [],
    replyTo: replyObj
      ? {
          id: replyObj._id.toString(),
          content: replyObj.deletedAt ? 'This message was deleted' : replyObj.content,
          messageType: replyObj.messageType,
          senderName: replyObj.senderId?.fullName || 'User',
        }
      : null,
    forwardedFrom: isDeleted ? null : msg.forwardedFrom,
    reactions: isDeleted
      ? []
      : msg.reactions.map((r) => ({
          emoji: r.emoji,
          userIds: r.userIds.map((id) => id.toString()),
        })),
    editedAt: msg.editedAt,
    deletedAt: msg.deletedAt,
    deliveredTo: msg.deliveredTo.map((id) => id.toString()),
    readBy: msg.readBy.map((id) => id.toString()),
    deliveryStatus: msg.deliveryStatus,
    createdAt: msg.createdAt,
  };
}

export async function listMessages(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const { conversationId } = req.params;
  const limit = Math.min(Number(req.query.limit || 40), 100);
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  if (!Types.ObjectId.isValid(conversationId)) {
    throw new AppError('Invalid conversation identifier.', 400, 'INVALID_CONVERSATION_ID');
  }

  const conv = await Conversation.findOne({
    _id: conversationId,
    'participants.userId': new Types.ObjectId(userId),
  });
  if (!conv) {
    throw new AppError('Conversation not found or access denied.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const query: Record<string, unknown> = {
    conversationId: conv._id,
    deletedFor: { $ne: new Types.ObjectId(userId) },
  };
  if (before && !Number.isNaN(before.getTime())) {
    query.createdAt = { $lt: before };
  }

  const docs = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('senderId', PUBLIC_USER_SELECT)
    .populate({
      path: 'replyTo',
      select: 'content messageType deletedAt senderId',
      populate: { path: 'senderId', select: 'fullName username' },
    });

  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;
  pageDocs.reverse();

  const senderIds = Array.from(
    new Set(
      pageDocs
        .map((d) => {
          const s = d.senderId as unknown as { _id?: { toString(): string } };
          return s?._id ? s._id.toString() : String(d.senderId);
        })
        .filter(Boolean)
    )
  );
  const viewerContext = await getViewerRelationshipContext(userId, senderIds);

  res.json({
    success: true,
    data: {
      messages: pageDocs.map((m) => serializeMessage(m, viewerContext)),
      hasMore,
    },
  });
}

export async function sendMessage(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const parsed = sendMessageSchema.parse(req.body);

  const conv = await Conversation.findOne({
    _id: parsed.conversationId,
    'participants.userId': new Types.ObjectId(userId),
  });
  if (!conv) {
    throw new AppError('Conversation not found or access denied.', 404, 'CONVERSATION_NOT_FOUND');
  }

  if (conv.type === 'direct') {
    const peer = conv.participants.find((p) => p.userId.toString() !== userId);
    if (peer) {
      const blockRel = await getBlockRelationship(userId, peer.userId.toString());
      if (blockRel.blocked) {
        throw new AppError(
          blockRel.blockedByA
            ? 'You blocked this contact. Unblock them to send messages.'
            : 'You cannot send messages to this user.',
          403,
          'USER_BLOCKED'
        );
      }
    }
  }

  if (conv.communityId) {
    const community = await Community.findById(conv.communityId).select('members settings');
    if (community?.settings?.whoCanPost === 'moderators_only') {
      const member = community.members.find((m) => m.userId.toString() === userId);
      if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) {
        throw new AppError(
          'Only moderators, admins, and the owner can send messages in this community.',
          403,
          'POSTING_RESTRICTED'
        );
      }
    }
  }

  const hasText = parsed.content.trim().length > 0;
  const hasAttachments = parsed.attachments.length > 0;
  if (!hasText && !hasAttachments) {
    throw new AppError('Message content or attachment is required.', 400, 'EMPTY_MESSAGE');
  }

  const otherParticipantIds = conv.participants
    .map((p) => p.userId.toString())
    .filter((id) => id !== userId);

  const onlineRecipientIds = otherParticipantIds
    .filter((id) => isUserConnected(id))
    .map((id) => new Types.ObjectId(id));

  const initialStatus = onlineRecipientIds.length > 0 ? 'delivered' : 'sent';
  const links = hasText
    ? await extractAndFetchLinkPreviews(parsed.content.trim())
    : [];

  const msg = await Message.create({
    conversationId: conv._id,
    senderId: new Types.ObjectId(userId),
    content: parsed.content.trim(),
    messageType: parsed.messageType,
    attachments: parsed.attachments,
    links,
    replyTo: parsed.replyTo ? new Types.ObjectId(parsed.replyTo) : null,
    forwardedFrom: parsed.forwardedFrom
      ? {
          messageId: new Types.ObjectId(parsed.forwardedFrom.messageId),
          senderName: parsed.forwardedFrom.senderName,
        }
      : null,
    deliveredTo: onlineRecipientIds,
    readBy: [new Types.ObjectId(userId)],
    deliveryStatus: initialStatus,
  });

  const previewText =
    parsed.content.trim() ||
    (parsed.messageType === 'voice'
      ? 'Voice message'
      : parsed.messageType === 'image'
        ? 'Photo'
        : parsed.messageType === 'video'
          ? 'Video'
          : 'Document');

  conv.lastMessage = {
    messageId: msg._id as Types.ObjectId,
    senderId: new Types.ObjectId(userId),
    content: previewText.slice(0, 140),
    messageType: parsed.messageType,
    createdAt: msg.createdAt,
  };

  // Reopen conversation for any participant who previously deleted it, and mark sender as read
  for (const part of conv.participants) {
    part.deletedAt = null;
    if (part.userId.toString() === userId) {
      part.lastReadAt = new Date();
    }
  }
  await conv.save();

  const populated = await Message.findById(msg._id)
    .populate('senderId', PUBLIC_USER_SELECT)
    .populate({
      path: 'replyTo',
      select: 'content messageType deletedAt senderId',
      populate: { path: 'senderId', select: 'fullName username' },
    });

  const serialized = serializeMessage(populated!);

  const io = getIO();
  if (io) {
    io.to(`conversation:${conv._id.toString()}`).emit('message:new', serialized);

    const recipients = await User.find({ _id: { $in: otherParticipantIds } })
      .select('settings blockedUsers')
      .lean();
    const recipientMap = new Map(recipients.map((r) => [r._id.toString(), r]));
    const now = new Date();
    const senderName = req.user?.fullName || serialized.sender?.fullName || 'New message';

    for (const pid of otherParticipantIds) {
      const recipient = recipientMap.get(pid);
      const isBlockedRecipient = Boolean(
        recipient?.blockedUsers?.some((id) => id.toString() === userId)
      );
      if (isBlockedRecipient) continue;

      io.to(`user:${pid}`).emit('conversation:activity', {
        conversationId: conv._id.toString(),
        message: serialized,
      });

      const part = conv.participants.find((p) => p.userId.toString() === pid);
      const isMuted = Boolean(part?.mutedUntil && part.mutedUntil > now);
      if (isMuted) continue;

      const notif = resolveUserSettings(recipient?.settings).notifications;
      const categoryEnabled =
        conv.type === 'direct'
          ? notif.privateMessages
          : conv.type === 'group'
            ? notif.groupMessages
            : notif.communityMessages;

      if (!categoryEnabled) continue;

      const showPreview = notif.messagePreview;
      io.to(`user:${pid}`).emit('notification:message', {
        id: serialized.id,
        conversationId: conv._id.toString(),
        conversationType: conv.type,
        communityId: conv.communityId ? conv.communityId.toString() : null,
        title: conv.type === 'direct' ? senderName : `${senderName} • ${conv.name}`,
        body: showPreview ? previewText.slice(0, 120) : 'New message',
        previewHidden: !showPreview,
        soundEnabled: notif.soundEnabled,
        soundTone: notif.soundTone,
        vibrationEnabled: notif.vibrationEnabled,
        createdAt: serialized.createdAt,
      });
    }
  }

  res.status(201).json({ success: true, data: serialized });
}

export async function editMessage(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const parsed = editMessageSchema.parse(req.body);

  const msg = await Message.findById(req.params.id);
  if (!msg) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }
  if (msg.senderId.toString() !== userId) {
    throw new AppError('You can only edit your own messages.', 403, 'FORBIDDEN');
  }
  if (msg.deletedAt) {
    throw new AppError('Deleted messages cannot be edited.', 400, 'BAD_REQUEST');
  }
  if (msg.messageType !== 'text') {
    throw new AppError('Only text messages can be edited.', 400, 'BAD_REQUEST');
  }

  msg.content = parsed.content;
  msg.links = await extractAndFetchLinkPreviews(parsed.content);
  msg.editedAt = new Date();
  await msg.save();

  const conv = await Conversation.findById(msg.conversationId);
  if (conv?.lastMessage?.messageId?.toString() === msg._id.toString()) {
    conv.lastMessage.content = parsed.content.slice(0, 140);
    await conv.save();
  }

  const populated = await Message.findById(msg._id)
    .populate('senderId', 'fullName username avatar')
    .populate({
      path: 'replyTo',
      select: 'content messageType deletedAt senderId',
      populate: { path: 'senderId', select: 'fullName username' },
    });

  const serialized = serializeMessage(populated!);

  const io = getIO();
  io?.to(`conversation:${msg.conversationId.toString()}`).emit('message:edit', serialized);

  res.json({ success: true, data: serialized });
}

export async function deleteMessage(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const scope = req.query.scope === 'me' ? 'me' : 'everyone';

  const msg = await Message.findById(req.params.id);
  if (!msg) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  const conv = await Conversation.findOne({
    _id: msg.conversationId,
    'participants.userId': new Types.ObjectId(userId),
  });
  if (!conv) {
    throw new AppError('Access denied.', 403, 'FORBIDDEN');
  }

  if (scope === 'me') {
    await Message.updateOne(
      { _id: msg._id },
      { $addToSet: { deletedFor: new Types.ObjectId(userId) } }
    );
    return res.json({
      success: true,
      data: { id: msg._id.toString(), scope: 'me' },
    });
  }

  let canModerate = msg.senderId.toString() === userId;
  if (!canModerate && conv.communityId) {
    const community = await Community.findById(conv.communityId).select('members');
    const member = community?.members.find((m) => m.userId.toString() === userId);
    if (member && ['owner', 'admin', 'moderator'].includes(member.role)) {
      canModerate = true;
    }
  }

  if (!canModerate) {
    throw new AppError('You can only delete your own messages for everyone.', 403, 'FORBIDDEN');
  }

  msg.deletedAt = new Date();
  msg.content = '';
  msg.attachments = [];
  msg.links = [];
  msg.reactions = [];
  await msg.save();

  if (conv.lastMessage?.messageId?.toString() === msg._id.toString()) {
    conv.lastMessage.content = 'This message was deleted';
    await conv.save();
  }

  const io = getIO();
  io?.to(`conversation:${msg.conversationId.toString()}`).emit('message:delete', {
    id: msg._id.toString(),
    conversationId: msg.conversationId.toString(),
    deletedAt: msg.deletedAt,
  });

  res.json({
    success: true,
    data: {
      id: msg._id.toString(),
      conversationId: msg.conversationId.toString(),
      deletedAt: msg.deletedAt,
      scope: 'everyone',
    },
  });
}

export async function toggleReaction(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const parsed = reactionSchema.parse(req.body);

  const msg = await Message.findById(req.params.id);
  if (!msg || msg.deletedAt) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  const conv = await Conversation.findOne({
    _id: msg.conversationId,
    'participants.userId': new Types.ObjectId(userId),
  }).select('_id');
  if (!conv) {
    throw new AppError('Access denied.', 403, 'FORBIDDEN');
  }

  const existingIdx = msg.reactions.findIndex((r) => r.emoji === parsed.emoji);
  let action: 'add' | 'remove' = 'add';

  if (existingIdx >= 0) {
    const hasReacted = msg.reactions[existingIdx].userIds.some(
      (id) => id.toString() === userId
    );
    if (hasReacted) {
      action = 'remove';
      msg.reactions[existingIdx].userIds = msg.reactions[existingIdx].userIds.filter(
        (id) => id.toString() !== userId
      );
      if (msg.reactions[existingIdx].userIds.length === 0) {
        msg.reactions.splice(existingIdx, 1);
      }
    } else {
      msg.reactions[existingIdx].userIds.push(new Types.ObjectId(userId));
    }
  } else {
    msg.reactions.push({
      emoji: parsed.emoji,
      userIds: [new Types.ObjectId(userId)],
    });
  }

  await msg.save();

  const serializedReactions = msg.reactions.map((r) => ({
    emoji: r.emoji,
    userIds: r.userIds.map((id) => id.toString()),
  }));

  const io = getIO();
  io?.to(`conversation:${msg.conversationId.toString()}`).emit(
    action === 'add' ? 'reaction:add' : 'reaction:remove',
    {
      messageId: msg._id.toString(),
      conversationId: msg.conversationId.toString(),
      emoji: parsed.emoji,
      userId,
      reactions: serializedReactions,
    }
  );

  res.json({
    success: true,
    data: {
      messageId: msg._id.toString(),
      reactions: serializedReactions,
    },
  });
}

export async function getMessagesAround(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const { conversationId, messageId } = req.params;

  if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(messageId)) {
    throw new AppError('Invalid conversation or message identifier.', 400, 'INVALID_ID');
  }

  const conv = await Conversation.findOne({
    _id: conversationId,
    'participants.userId': new Types.ObjectId(userId),
  });
  if (!conv) {
    throw new AppError('Conversation not found or access denied.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const target = await Message.findOne({
    _id: messageId,
    conversationId: conv._id,
    deletedFor: { $ne: new Types.ObjectId(userId) },
  });
  if (!target) {
    throw new AppError('Target message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  const baseFilter = {
    conversationId: conv._id,
    deletedFor: { $ne: new Types.ObjectId(userId) },
  };

  const [beforeDocs, afterDocs] = await Promise.all([
    Message.find({ ...baseFilter, createdAt: { $lte: target.createdAt } })
      .sort({ createdAt: -1 })
      .limit(26)
      .populate('senderId', PUBLIC_USER_SELECT)
      .populate({
        path: 'replyTo',
        select: 'content messageType deletedAt senderId',
        populate: { path: 'senderId', select: 'fullName username' },
      }),
    Message.find({ ...baseFilter, createdAt: { $gt: target.createdAt } })
      .sort({ createdAt: 1 })
      .limit(26)
      .populate('senderId', PUBLIC_USER_SELECT)
      .populate({
        path: 'replyTo',
        select: 'content messageType deletedAt senderId',
        populate: { path: 'senderId', select: 'fullName username' },
      }),
  ]);

  const hasMore = beforeDocs.length > 25;
  const olderSlice = hasMore ? beforeDocs.slice(0, 25) : beforeDocs;
  olderSlice.reverse();

  const hasNewer = afterDocs.length > 25;
  const newerSlice = hasNewer ? afterDocs.slice(0, 25) : afterDocs;

  const combined = [...olderSlice, ...newerSlice];
  const senderIds = Array.from(
    new Set(
      combined
        .map((d) => {
          const s = d.senderId as unknown as { _id?: { toString(): string } };
          return s?._id ? s._id.toString() : String(d.senderId);
        })
        .filter(Boolean)
    )
  );
  const viewerContext = await getViewerRelationshipContext(userId, senderIds);

  res.json({
    success: true,
    data: {
      messages: combined.map((m) => serializeMessage(m, viewerContext)),
      hasMore,
      hasNewer,
    },
  });
}
