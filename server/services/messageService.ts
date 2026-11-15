import { Types } from 'mongoose';
import type { Server } from 'socket.io';
import { Community } from '../models/Community.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message, type IMessage } from '../models/Message.ts';
import { User } from '../models/User.ts';
import {
  getBlockRelationship,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
  type PrivacyTargetUserLike,
  type ViewerRelationshipContext,
} from './privacyService.ts';
import { AppError } from '../utils/errors.ts';
import { extractAndFetchLinkPreviews, extractUrlStubs } from '../utils/linkPreview.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import { sendMessageSchema } from '../validators/schemas.ts';

export function serializeMessage(msg: IMessage, viewerContext?: ViewerRelationshipContext) {
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
    clientMessageId: msg.clientMessageId || null,
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

async function enrichMessageLinksInBackground(
  messageId: Types.ObjectId,
  conversationId: string,
  text: string,
  io: Server | null
): Promise<void> {
  try {
    const richLinks = await extractAndFetchLinkPreviews(text);
    if (richLinks.length === 0) return;

    const updated = await Message.findOneAndUpdate(
      { _id: messageId, deletedAt: null },
      { $set: { links: richLinks } },
      { new: true }
    ).select('links');

    if (updated && io) {
      io.to(`conversation:${conversationId}`).emit('message:links', {
        id: messageId.toString(),
        conversationId,
        links: updated.links || [],
      });
    }
  } catch {
    // Best-effort link metadata enrichment
  }
}

export async function createAndDispatchMessage(params: {
  userId: string;
  senderFullName?: string;
  body: unknown;
  io: Server | null;
}) {
  const { userId, senderFullName, body, io } = params;
  const parsed = sendMessageSchema.parse(body);

  if (!Types.ObjectId.isValid(parsed.conversationId)) {
    throw new AppError('Invalid conversation identifier.', 400, 'INVALID_CONVERSATION_ID');
  }

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

  const clientMessageId = parsed.clientMessageId?.trim() || null;

  if (clientMessageId) {
    const existing = await Message.findOne({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      clientMessageId,
    })
      .populate('senderId', PUBLIC_USER_SELECT)
      .populate({
        path: 'replyTo',
        select: 'content messageType deletedAt senderId',
        populate: { path: 'senderId', select: 'fullName username' },
      });

    if (existing) {
      return {
        message: serializeMessage(existing),
        duplicate: true,
      };
    }
  }

  const otherParticipantIds = conv.participants
    .map((p) => p.userId.toString())
    .filter((id) => id !== userId);

  const initialLinks = hasText ? extractUrlStubs(parsed.content.trim()) : [];

  let msg: IMessage;
  try {
    msg = await Message.create({
      conversationId: conv._id,
      senderId: new Types.ObjectId(userId),
      clientMessageId,
      content: parsed.content.trim(),
      messageType: parsed.messageType,
      attachments: parsed.attachments,
      links: initialLinks,
      replyTo: parsed.replyTo ? new Types.ObjectId(parsed.replyTo) : null,
      forwardedFrom: parsed.forwardedFrom
        ? {
            messageId: new Types.ObjectId(parsed.forwardedFrom.messageId),
            senderName: parsed.forwardedFrom.senderName,
          }
        : null,
      deliveredTo: [],
      readBy: [new Types.ObjectId(userId)],
      deliveryStatus: 'sent',
    });
  } catch (err: unknown) {
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000 && clientMessageId) {
      const existing = await Message.findOne({
        conversationId: conv._id,
        senderId: new Types.ObjectId(userId),
        clientMessageId,
      })
        .populate('senderId', PUBLIC_USER_SELECT)
        .populate({
          path: 'replyTo',
          select: 'content messageType deletedAt senderId',
          populate: { path: 'senderId', select: 'fullName username' },
        });
      if (existing) {
        return {
          message: serializeMessage(existing),
          duplicate: true,
        };
      }
    }
    throw err;
  }

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

  if (initialLinks.length > 0) {
    void enrichMessageLinksInBackground(
      msg._id as Types.ObjectId,
      conv._id.toString(),
      parsed.content.trim(),
      io
    );
  }

  if (io) {
    io.to(`conversation:${conv._id.toString()}`).emit('message:new', serialized);

    const recipients = await User.find({ _id: { $in: otherParticipantIds } })
      .select('settings blockedUsers')
      .lean();
    const recipientMap = new Map(recipients.map((r) => [r._id.toString(), r]));
    const now = new Date();
    const resolvedSenderName =
      senderFullName || serialized.sender?.fullName || 'New message';

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
        title:
          conv.type === 'direct'
            ? resolvedSenderName
            : `${resolvedSenderName} • ${conv.name}`,
        body: showPreview ? previewText.slice(0, 120) : 'New message',
        previewHidden: !showPreview,
        soundEnabled: notif.soundEnabled,
        soundTone: notif.soundTone,
        vibrationEnabled: notif.vibrationEnabled,
        createdAt: serialized.createdAt,
      });
    }
  }

  return {
    message: serialized,
    duplicate: false,
  };
}
