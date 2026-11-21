import crypto from 'node:crypto';
import { Types } from 'mongoose';
import type { Server } from 'socket.io';
import { env } from '../../config/env.ts';
import { Conversation, type IConversation } from '../../models/Conversation.ts';
import { Message, type IMessage, type IMessageMention } from '../../models/Message.ts';
import { User } from '../../models/User.ts';
import { extractUrlStubs } from '../../utils/linkPreview.ts';
import { resolveUserSettings } from '../../utils/serializers.ts';
import {
  resolveConversationMentions,
  serializeMessageMentions,
} from '../mentionService.ts';
import { PUBLIC_USER_SELECT } from '../privacyService.ts';
import { dispatchMessagePushNotifications } from '../pushService.ts';
import {
  BLINK_AI_DISPLAY_NAME,
  BLINK_AI_SENDER_ID,
  BLINK_AI_SENDER_OBJECT_ID,
  BLINK_AI_SERIALIZED_SENDER,
  isAiMessageLike,
} from './blinkIdentity.ts';
import { collectChatContext } from './contextManager.ts';
import {
  classifyGeminiError,
  generateWithGemini,
  type GeminiErrorCategory,
  type GeminiGenerateRequest,
  type GeminiGenerateResult,
} from './geminiProvider.ts';
import {
  recordCandidateFailure,
  recordCandidateSuccess,
  selectOrderedCandidates,
  type ExecutionCandidate,
  type SelectorConfigOverride,
} from './modelSelector.ts';
import {
  BLINK_SYSTEM_PROMPT,
  buildStructuredPrompt,
  parseBlinkMention,
} from './promptManager.ts';
import {
  checkAndConsumeAiRateLimit,
  claimTriggerDeduplication,
  logAiUsageEvent,
} from './usageTracker.ts';

export type GeminiExecutorFn = (req: GeminiGenerateRequest) => Promise<GeminiGenerateResult>;

let geminiExecutor: GeminiExecutorFn = generateWithGemini;

export function setGeminiExecutorForTest(fn: GeminiExecutorFn | null): void {
  geminiExecutor = fn || generateWithGemini;
}

export function serializeAiAwareSender(msg: {
  senderType?: string | null;
  senderId?: unknown;
}) {
  if (isAiMessageLike(msg)) {
    return BLINK_AI_SERIALIZED_SENDER;
  }
  return null;
}

function serializeAiReplyDoc(msg: IMessage) {
  const rawReply = msg.replyTo as unknown;
  const replyObj =
    typeof rawReply === 'object' && rawReply !== null && 'content' in rawReply
      ? (rawReply as {
          _id: { toString(): string };
          content: string;
          messageType: string;
          senderType?: string;
          deletedAt?: Date | null;
          mentions?: IMessageMention[];
          senderId?: { _id?: { toString(): string }; fullName?: string; username?: string };
        })
      : null;

  const isDeleted = Boolean(msg.deletedAt);

  return {
    id: msg._id.toString(),
    conversationId: msg.conversationId.toString(),
    senderId: BLINK_AI_SENDER_ID,
    senderType: 'ai' as const,
    clientMessageId: msg.clientMessageId || null,
    sender: BLINK_AI_SERIALIZED_SENDER,
    content: isDeleted ? 'This message was deleted' : msg.content,
    messageType: msg.messageType,
    attachments: [],
    links: isDeleted ? [] : msg.links || [],
    replyTo: replyObj
      ? {
          id: replyObj._id.toString(),
          content: replyObj.deletedAt ? 'This message was deleted' : replyObj.content,
          messageType: replyObj.messageType,
          senderName:
            replyObj.senderType === 'ai'
              ? BLINK_AI_DISPLAY_NAME
              : replyObj.senderId?.fullName || 'User',
          mentions: replyObj.deletedAt
            ? []
            : serializeMessageMentions(replyObj.mentions),
        }
      : null,
    forwardedFrom: null,
    mentions: isDeleted ? [] : serializeMessageMentions(msg.mentions),
    callEvent: null,
    aiMeta: msg.aiMeta
      ? {
          status: msg.aiMeta.status,
          isError: msg.aiMeta.status === 'failed',
        }
      : undefined,
    reactions: msg.reactions.map((r) => ({
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

async function persistAndDispatchAiMessage(params: {
  conversation: IConversation;
  triggerMessageId: string;
  triggerUserId: string;
  requestId: string;
  content: string;
  io: Server | null;
}) {
  const { conversation, triggerMessageId, triggerUserId, requestId, content, io } = params;
  const convId = conversation._id.toString();
  const cleanContent = content.trim().slice(0, 4800);
  const initialLinks = extractUrlStubs(cleanContent);

  const {
    mentions: resolvedMentions,
    directlyMentionedIds,
    mentionsEveryone,
  } = await resolveConversationMentions({
    conversation,
    content: cleanContent,
    senderId: BLINK_AI_SENDER_ID,
    senderType: 'ai',
  });

  let aiMsg: IMessage;
  try {
    aiMsg = await Message.create({
      conversationId: conversation._id,
      senderId: BLINK_AI_SENDER_OBJECT_ID,
      senderType: 'ai',
      clientMessageId: `ai:${triggerMessageId}`,
      content: cleanContent,
      messageType: 'text',
      attachments: [],
      links: initialLinks,
      replyTo: Types.ObjectId.isValid(triggerMessageId)
        ? new Types.ObjectId(triggerMessageId)
        : null,
      forwardedFrom: null,
      mentions: resolvedMentions,
      aiMeta: {
        requestId,
        triggerMessageId,
        triggerUserId: Types.ObjectId.isValid(triggerUserId)
          ? new Types.ObjectId(triggerUserId)
          : null,
        status: 'completed',
      },
      deliveredTo: [],
      readBy: [],
      deliveryStatus: 'sent',
    });
  } catch (err: unknown) {
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000) {
      return null;
    }
    throw err;
  }

  conversation.lastMessage = {
    messageId: aiMsg._id as Types.ObjectId,
    senderId: BLINK_AI_SENDER_OBJECT_ID,
    content: cleanContent.slice(0, 140),
    messageType: 'text',
    createdAt: aiMsg.createdAt,
  };
  for (const part of conversation.participants) {
    part.deletedAt = null;
  }
  await conversation.save();

  const populated = await Message.findById(aiMsg._id)
    .populate('senderId', PUBLIC_USER_SELECT)
    .populate({
      path: 'replyTo',
      select: 'content messageType senderType deletedAt senderId mentions',
      populate: { path: 'senderId', select: 'fullName username' },
    });

  const serialized = serializeAiReplyDoc(populated || aiMsg);

  if (io) {
    io.to(`conversation:${convId}`).emit('message:new', serialized);
  }

  const participantIds = conversation.participants
    .map((p) => p.userId.toString())
    .filter((id) => id !== BLINK_AI_SENDER_ID);

  if (participantIds.length > 0) {
    const recipients = await User.find({ _id: { $in: participantIds } })
      .select('settings blockedUsers')
      .lean();

    const recipientMap = new Map(recipients.map((r) => [r._id.toString(), r]));
    const now = new Date();
    const participantMuteMap = new Map<string, Date | null>();
    for (const part of conversation.participants) {
      participantMuteMap.set(part.userId.toString(), part.mutedUntil || null);
    }

    if (io) {
      for (const pid of participantIds) {
        io.to(`user:${pid}`).emit('conversation:activity', {
          conversationId: convId,
          message: serialized,
        });

        // Do not chime/toast the user who triggered Blink on their own active chat,
        // while notifying other participants respecting mute & category preferences.
        if (pid === triggerUserId) continue;

        const part = conversation.participants.find((p) => p.userId.toString() === pid);
        const isMuted = Boolean(part?.mutedUntil && part.mutedUntil > now);
        if (isMuted) continue;

        const recipient = recipientMap.get(pid);
        const notif = resolveUserSettings(recipient?.settings).notifications;
        const categoryEnabled =
          conversation.type === 'direct'
            ? notif.privateMessages
            : conversation.type === 'group'
              ? notif.groupMessages
              : notif.communityMessages;
        if (!categoryEnabled) continue;

        const isDirectMention = directlyMentionedIds.has(pid);
        const isEveryoneMention = !isDirectMention && mentionsEveryone;
        const showPreview = notif.messagePreview;
        const defaultTitle =
          conversation.type === 'direct'
            ? BLINK_AI_DISPLAY_NAME
            : `${BLINK_AI_DISPLAY_NAME} • ${conversation.name}`;
        const mentionTitle = isDirectMention
          ? conversation.type === 'direct'
            ? `${BLINK_AI_DISPLAY_NAME} mentioned you`
            : `${BLINK_AI_DISPLAY_NAME} mentioned you • ${conversation.name}`
          : isEveryoneMention
            ? `${BLINK_AI_DISPLAY_NAME} mentioned @everyone • ${conversation.name}`
            : defaultTitle;
        const mentionBody = showPreview
          ? cleanContent.slice(0, 120)
          : isDirectMention
            ? 'Blink mentioned you in a message'
            : isEveryoneMention
              ? 'Blink mentioned @everyone'
              : 'New message from Blink';

        io.to(`user:${pid}`).emit('notification:message', {
          id: serialized.id,
          conversationId: convId,
          conversationType: conversation.type,
          communityId: conversation.communityId ? conversation.communityId.toString() : null,
          title: mentionTitle,
          body: mentionBody,
          previewHidden: !showPreview,
          mentioned: isDirectMention || isEveryoneMention,
          mentionType: isDirectMention ? 'direct' : isEveryoneMention ? 'everyone' : null,
          soundEnabled: notif.soundEnabled,
          soundTone: notif.soundTone,
          vibrationEnabled: notif.vibrationEnabled,
          createdAt: serialized.createdAt,
        });
      }
    }

    const pushRecipients = recipients.filter((r) => r._id.toString() !== triggerUserId);
    if (pushRecipients.length > 0) {
      void dispatchMessagePushNotifications({
        messageId: serialized.id,
        conversationId: convId,
        conversationType: conversation.type,
        conversationName: conversation.name || 'Chat',
        communityId: conversation.communityId ? conversation.communityId.toString() : null,
        senderId: BLINK_AI_SENDER_ID,
        senderName: BLINK_AI_DISPLAY_NAME,
        senderAvatar: '',
        senderProfilePhotoPrivacy: 'everyone',
        senderBlockedUsers: new Set<string>(),
        previewText: cleanContent,
        recipientDocs: pushRecipients,
        participantMuteMap,
        directlyMentionedIds,
        mentionsEveryone,
      }).catch(() => {
        // Best-effort push notification for AI response
      });
    }
  }

  return serialized;
}

export async function runWithFailover(params: {
  requestId: string;
  userId: string;
  chatId: string;
  userPrompt: string;
  selectorOverride?: SelectorConfigOverride;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  text?: string;
  candidate?: ExecutionCandidate;
  result?: GeminiGenerateResult;
  attempts: number;
  failureCategory: GeminiErrorCategory | 'unconfigured' | null;
}> {
  const candidates = selectOrderedCandidates(params.selectorOverride);
  if (candidates.length === 0) {
    return {
      ok: false,
      attempts: 0,
      failureCategory: 'unconfigured',
    };
  }

  const timeoutMs = params.timeoutMs ?? env.gemini.requestTimeoutMs;
  const maxAttempts = candidates.length;
  let lastCategory: GeminiErrorCategory = 'unknown';

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = candidates[i];
    try {
      const result = await geminiExecutor({
        apiKey: candidate.apiKey,
        model: candidate.model,
        systemInstruction: BLINK_SYSTEM_PROMPT,
        userPrompt: params.userPrompt,
        timeoutMs,
      });

      recordCandidateSuccess(candidate, result.latencyMs);
      return {
        ok: true,
        text: result.text,
        candidate,
        result,
        attempts: i + 1,
        failureCategory: null,
      };
    } catch (err) {
      const classified = classifyGeminiError(err);
      lastCategory = classified.category;
      recordCandidateFailure(
        candidate,
        classified.category,
        params.selectorOverride?.cooldownMs
      );

      // Invalid request payload cannot be rescued by switching keys or models
      if (!classified.retryable) {
        return {
          ok: false,
          attempts: i + 1,
          failureCategory: classified.category,
        };
      }
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    failureCategory: lastCategory,
  };
}

export async function maybeTriggerBlinkReply(params: {
  conversation: IConversation;
  triggerMessage: IMessage;
  triggerUserId: string;
  triggerUserName?: string;
  io: Server | null;
  selectorOverride?: SelectorConfigOverride;
}): Promise<{
  triggered: boolean;
  status: 'ignored' | 'completed' | 'failed' | 'rate_limited' | 'deduplicated' | 'unavailable';
  message?: ReturnType<typeof serializeAiReplyDoc> | null;
}> {
  const { conversation, triggerMessage, triggerUserId, io } = params;
  const chatId = conversation._id.toString();
  const triggerMessageId = triggerMessage._id.toString();

  // Loop & message-type guards
  if (isAiMessageLike(triggerMessage)) {
    return { triggered: false, status: 'ignored' };
  }
  if (triggerMessage.messageType !== 'text' || triggerMessage.deletedAt) {
    return { triggered: false, status: 'ignored' };
  }

  const mention = parseBlinkMention(triggerMessage.content);
  if (!mention.triggered) {
    return { triggered: false, status: 'ignored' };
  }

  // Re-verify conversation access (user must be active participant)
  const isParticipant = conversation.participants.some(
    (p) => p.userId.toString() === triggerUserId
  );
  if (!isParticipant) {
    return { triggered: false, status: 'ignored' };
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  // Prevent duplicate execution for same trigger message ID
  if (!claimTriggerDeduplication(chatId, triggerMessageId)) {
    logAiUsageEvent({
      requestId,
      userId: triggerUserId,
      chatId,
      providerSlot: 'none',
      model: 'none',
      latencyMs: Date.now() - startedAt,
      failoverAttempts: 0,
      failureCategory: 'duplicate_trigger',
      status: 'deduplicated',
    });
    return { triggered: true, status: 'deduplicated' };
  }

  // DB-level deduplication guard (e.g. after server restart)
  const existingReply = await Message.findOne({
    conversationId: conversation._id,
    'aiMeta.triggerMessageId': triggerMessageId,
  })
    .select('_id')
    .lean();
  if (existingReply) {
    return { triggered: true, status: 'deduplicated' };
  }

  // Check per-user and per-chat rate limits before consuming model quota
  const rateCheck = checkAndConsumeAiRateLimit(triggerUserId, chatId);
  if (!rateCheck.allowed) {
    io?.to(`conversation:${chatId}`).emit('ai:status', {
      conversationId: chatId,
      requestId,
      triggerMessageId,
      status: 'failed',
      message: "Blink is receiving too many requests right now. Please wait a moment and try again.",
    });
    logAiUsageEvent({
      requestId,
      userId: triggerUserId,
      chatId,
      providerSlot: 'none',
      model: 'none',
      latencyMs: Date.now() - startedAt,
      failoverAttempts: 0,
      failureCategory: `rate_limit_${rateCheck.scope}`,
      status: 'rate_limited',
    });
    return { triggered: true, status: 'rate_limited' };
  }

  // Check configuration before emitting thinking state
  const candidates = selectOrderedCandidates(params.selectorOverride);
  if (candidates.length === 0) {
    io?.to(`conversation:${chatId}`).emit('ai:status', {
      conversationId: chatId,
      requestId,
      triggerMessageId,
      status: 'failed',
      message: "Blink couldn't respond. Please try again.",
    });
    logAiUsageEvent({
      requestId,
      userId: triggerUserId,
      chatId,
      providerSlot: 'none',
      model: 'none',
      latencyMs: Date.now() - startedAt,
      failoverAttempts: 0,
      failureCategory: 'unconfigured',
      status: 'unavailable',
    });
    return { triggered: true, status: 'unavailable' };
  }

  // Emit real-time thinking indicator to active chat participants
  io?.to(`conversation:${chatId}`).emit('ai:status', {
    conversationId: chatId,
    requestId,
    triggerMessageId,
    status: 'thinking',
  });

  try {
    let speakerName = params.triggerUserName?.trim() || '';
    if (!speakerName) {
      const speakerDoc = await User.findById(triggerUserId)
        .select('fullName username')
        .lean();
      speakerName = speakerDoc?.fullName || speakerDoc?.username || 'User';
    }

    const { contextTurns, replyTarget, conversationMeta } = await collectChatContext({
      conversationId: chatId,
      triggerMessageId,
      triggerCreatedAt: triggerMessage.createdAt,
      triggerUserId,
      replyToId: triggerMessage.replyTo ? triggerMessage.replyTo.toString() : null,
    });

    const structuredPrompt = buildStructuredPrompt({
      speakerName,
      query: mention.query,
      contextTurns,
      replyTarget,
      conversationMeta,
    });

    const execOutcome = await runWithFailover({
      requestId,
      userId: triggerUserId,
      chatId,
      userPrompt: structuredPrompt,
      selectorOverride: params.selectorOverride,
    });

    if (!execOutcome.ok || !execOutcome.text || !execOutcome.candidate || !execOutcome.result) {
      io?.to(`conversation:${chatId}`).emit('ai:status', {
        conversationId: chatId,
        requestId,
        triggerMessageId,
        status: 'failed',
        message: "Blink couldn't respond. Please try again.",
      });
      logAiUsageEvent({
        requestId,
        userId: triggerUserId,
        chatId,
        providerSlot: 'none',
        model: 'none',
        latencyMs: Date.now() - startedAt,
        failoverAttempts: execOutcome.attempts,
        failureCategory: execOutcome.failureCategory || 'generation_failed',
        status: 'failed',
      });
      return { triggered: true, status: 'failed' };
    }

    // Re-fetch conversation right before saving reply so lastMessage/participants are fresh
    const freshConv = (await Conversation.findById(conversation._id)) || conversation;
    const saved = await persistAndDispatchAiMessage({
      conversation: freshConv,
      triggerMessageId,
      triggerUserId,
      requestId,
      content: execOutcome.text,
      io,
    });

    io?.to(`conversation:${chatId}`).emit('ai:status', {
      conversationId: chatId,
      requestId,
      triggerMessageId,
      status: 'completed',
    });

    logAiUsageEvent({
      requestId,
      userId: triggerUserId,
      chatId,
      providerSlot: execOutcome.candidate.keySlot,
      model: execOutcome.candidate.model,
      latencyMs: execOutcome.result.latencyMs,
      inputTokens: execOutcome.result.inputTokens,
      outputTokens: execOutcome.result.outputTokens,
      failoverAttempts: execOutcome.attempts,
      failureCategory: null,
      status: 'completed',
    });

    return { triggered: true, status: 'completed', message: saved };
  } catch {
    io?.to(`conversation:${chatId}`).emit('ai:status', {
      conversationId: chatId,
      requestId,
      triggerMessageId,
      status: 'failed',
      message: "Blink couldn't respond. Please try again.",
    });
    logAiUsageEvent({
      requestId,
      userId: triggerUserId,
      chatId,
      providerSlot: 'none',
      model: 'none',
      latencyMs: Date.now() - startedAt,
      failoverAttempts: 0,
      failureCategory: 'unexpected_router_error',
      status: 'failed',
    });
    return { triggered: true, status: 'failed' };
  }
}
