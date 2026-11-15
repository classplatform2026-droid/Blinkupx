import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { Community } from '../models/Community.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import {
  createAndDispatchMessage,
  serializeMessage,
} from '../services/messageService.ts';
import {
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
} from '../services/privacyService.ts';
import { getIO } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { extractAndFetchLinkPreviews } from '../utils/linkPreview.ts';
import {
  editMessageSchema,
  reactionSchema,
} from '../validators/schemas.ts';

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
  const result = await createAndDispatchMessage({
    userId: req.userId!,
    senderFullName: req.user?.fullName,
    body: req.body,
    io: getIO(),
  });

  res.status(result.duplicate ? 200 : 201).json({
    success: true,
    data: result.message,
  });
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
  if (msg.messageType === 'system' || msg.messageType === 'voice') {
    throw new AppError('This message type cannot be edited.', 400, 'BAD_REQUEST');
  }
  if (msg.messageType === 'text' && !parsed.content.trim()) {
    throw new AppError('Message cannot be empty.', 400, 'VALIDATION_ERROR');
  }

  msg.content = parsed.content.trim();
  if (parsed.attachmentCaptions && msg.attachments.length > 0) {
    for (const item of parsed.attachmentCaptions) {
      if (msg.attachments[item.index]) {
        msg.attachments[item.index].caption = item.caption.trim();
      }
    }
  }
  msg.links = msg.content ? await extractAndFetchLinkPreviews(msg.content) : [];
  msg.editedAt = new Date();
  await msg.save();

  const conv = await Conversation.findById(msg.conversationId);
  if (conv?.lastMessage?.messageId?.toString() === msg._id.toString()) {
    const fallbackLabel =
      msg.messageType === 'image'
        ? msg.attachments.length > 1
          ? `${msg.attachments.length} Photos`
          : 'Photo'
        : msg.messageType === 'video'
          ? msg.attachments.length > 1
            ? `${msg.attachments.length} Videos`
            : 'Video'
          : msg.messageType === 'document'
            ? msg.attachments.length > 1
              ? `${msg.attachments.length} Documents`
              : 'Document'
            : 'Message';
    conv.lastMessage.content = (msg.content || fallbackLabel).slice(0, 140);
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
