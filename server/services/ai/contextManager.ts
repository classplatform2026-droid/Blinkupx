import { Types } from 'mongoose';
import { env } from '../../config/env.ts';
import { Conversation } from '../../models/Conversation.ts';
import { Message, type CallEventStatus } from '../../models/Message.ts';
import { User } from '../../models/User.ts';
import { isAiMessageLike } from './blinkIdentity.ts';
import {
  formatConversationMetaBlock,
  type ContextTurn,
  type ConversationMetaContext,
  type ConversationParticipantInfo,
} from './promptManager.ts';

const MAX_SINGLE_CONTEXT_ITEM_CHARS = 650;
const MAX_PARTICIPANTS_IN_META = 12;

export function formatRelativeTime(
  dateInput: Date | string | null | undefined,
  referenceDate: Date = new Date()
): string | undefined {
  if (!dateInput) return undefined;
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return undefined;

  const diffMs = Math.max(0, referenceDate.getTime() - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDurationShort(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (mins < 60) {
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function formatCallEventSummary(
  callEvent: {
    callType?: 'voice' | 'video' | string;
    callStatus?: CallEventStatus | string;
    duration?: number;
    callerId?: { toString(): string } | string | null;
    receiverId?: { toString(): string } | string | null;
  },
  participantNameMap: Map<string, string>
): string {
  const kind = callEvent.callType === 'video' ? 'video' : 'voice';
  const callerIdStr = callEvent.callerId ? callEvent.callerId.toString() : '';
  const receiverIdStr = callEvent.receiverId ? callEvent.receiverId.toString() : '';
  const caller = (callerIdStr && participantNameMap.get(callerIdStr)) || 'Participant';
  const receiver = (receiverIdStr && participantNameMap.get(receiverIdStr)) || 'Participant';

  switch (callEvent.callStatus) {
    case 'completed': {
      const dur = formatDurationShort(callEvent.duration || 0);
      return `${caller} -> ${receiver}: Completed ${kind} call (duration: ${dur})`;
    }
    case 'missed':
      return `${caller} -> ${receiver}: Missed ${kind} call (unanswered by ${receiver})`;
    case 'no_answer':
      return `${caller} -> ${receiver}: Unanswered ${kind} call (no answer from ${receiver})`;
    case 'rejected':
      return `${caller} -> ${receiver}: Declined ${kind} call (rejected by ${receiver})`;
    case 'cancelled':
      return `${caller} -> ${receiver}: Cancelled ${kind} call (ended by ${caller} before answer)`;
    case 'failed':
      return `${caller} -> ${receiver}: Failed ${kind} call`;
    default:
      return `${caller} -> ${receiver}: ${kind} call (${callEvent.callStatus || 'event'})`;
  }
}

function formatHistoryMessageText(
  doc: {
    messageType?: string;
    content?: string;
    attachments?: Array<{ fileName?: string; caption?: string }>;
    forwardedFrom?: { senderName?: string } | null;
    callEvent?: {
      callType?: string;
      callStatus?: string;
      duration?: number;
      callerId?: { toString(): string } | string | null;
      receiverId?: { toString(): string } | string | null;
    } | null;
  },
  participantNameMap: Map<string, string>
): string {
  if (doc.messageType === 'call_event') {
    if (doc.callEvent && (doc.callEvent.callStatus || doc.callEvent.callType)) {
      return formatCallEventSummary(doc.callEvent, participantNameMap);
    }
    return (doc.content || '').trim() || '[Call event]';
  }

  if (doc.messageType === 'system') {
    return (doc.content || '').trim() || '[System event]';
  }

  const parts: string[] = [];
  if (doc.forwardedFrom?.senderName?.trim()) {
    parts.push(`[Forwarded from ${doc.forwardedFrom.senderName.trim()}]`);
  }

  const text = (doc.content || '').trim();
  if (text) {
    parts.push(text);
  }

  if (doc.messageType === 'image' || doc.messageType === 'video' || doc.messageType === 'document') {
    const caption = doc.attachments?.find((a) => a.caption?.trim())?.caption?.trim();
    const firstFile = doc.attachments?.[0]?.fileName?.trim();
    if (!text) {
      if (caption) {
        parts.push(`[${doc.messageType} caption] ${caption}`);
      } else {
        parts.push(firstFile ? `[Shared ${doc.messageType}: ${firstFile}]` : `[Shared ${doc.messageType}]`);
      }
    } else if (firstFile) {
      parts.push(`[Attached ${doc.messageType}: ${firstFile}]`);
    } else {
      parts.push(`[Attached ${doc.messageType}]`);
    }
  } else if (doc.messageType === 'voice' && !text) {
    parts.push('[Voice message]');
  }

  return parts.join(' ').trim();
}

function truncateHistoryLine(text: string, maxLen = MAX_SINGLE_CONTEXT_ITEM_CHARS): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3).trimEnd()}...`;
}

function resolveTurnSpeaker(doc: {
  messageType?: string;
  senderType?: string | null;
  senderId?: unknown;
}): { speakerLabel: string; isAi: boolean; isSystem: boolean } {
  if (doc.messageType === 'call_event') {
    return { speakerLabel: 'System [Call]', isAi: false, isSystem: true };
  }
  if (doc.messageType === 'system') {
    return { speakerLabel: 'System', isAi: false, isSystem: true };
  }
  if (isAiMessageLike(doc)) {
    return { speakerLabel: 'Blink [AI]', isAi: true, isSystem: false };
  }
  const sender = doc.senderId as { fullName?: string; username?: string } | null | undefined;
  const label = sender?.fullName?.trim() || sender?.username?.trim() || 'Participant';
  return { speakerLabel: label, isAi: false, isSystem: false };
}

function extractPopulatedId(userRef: unknown): string {
  if (!userRef) return '';
  if (typeof userRef === 'string') return userRef;
  if (typeof userRef === 'object' && '_id' in userRef) {
    return String((userRef as { _id: unknown })._id);
  }
  if (typeof (userRef as { toString?: () => string }).toString === 'function') {
    return (userRef as { toString(): string }).toString();
  }
  return '';
}

export async function collectChatContext(params: {
  conversationId: string;
  triggerMessageId: string;
  triggerCreatedAt: Date;
  triggerUserId: string;
  replyToId?: string | null;
  messageLimit?: number;
  charBudget?: number;
}): Promise<{
  contextTurns: ContextTurn[];
  replyTarget: ContextTurn | null;
  conversationMeta: ConversationMetaContext | null;
}> {
  const convObjectId = new Types.ObjectId(params.conversationId);
  const triggerObjectId = new Types.ObjectId(params.triggerMessageId);
  const viewerObjectId = new Types.ObjectId(params.triggerUserId);

  const messageLimit = params.messageLimit ?? env.gemini.contextMessageLimit;
  const charBudget = params.charBudget ?? env.gemini.contextCharBudget;

  const recentQuery = Message.find({
    conversationId: convObjectId,
    _id: { $ne: triggerObjectId },
    deletedAt: null,
    deletedFor: { $ne: viewerObjectId },
    messageType: {
      $in: ['text', 'image', 'video', 'document', 'voice', 'system', 'call_event'],
    },
    $or: [
      { createdAt: { $lt: params.triggerCreatedAt } },
      { createdAt: params.triggerCreatedAt, _id: { $lt: triggerObjectId } },
    ],
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(messageLimit)
    .populate('senderId', 'fullName username')
    .select('senderId senderType content messageType attachments callEvent forwardedFrom createdAt')
    .lean();

  const convQuery = Conversation.findById(convObjectId)
    .select('type name participants.userId participants.role')
    .populate('participants.userId', 'fullName username')
    .lean();

  const replyQuery =
    params.replyToId && Types.ObjectId.isValid(params.replyToId)
      ? Message.findOne({
          _id: new Types.ObjectId(params.replyToId),
          conversationId: convObjectId,
          deletedAt: null,
          deletedFor: { $ne: viewerObjectId },
        })
          .populate('senderId', 'fullName username')
          .select('senderId senderType content messageType attachments callEvent forwardedFrom createdAt')
          .lean()
      : Promise.resolve(null);

  const [recentDocs, convDoc, replyDoc] = await Promise.all([recentQuery, convQuery, replyQuery]);

  // Build participant name lookup safely from populated conversation & message docs
  const participantNameMap = new Map<string, string>();
  const participantRecords: Array<{
    userId: string;
    name: string;
    username?: string;
    role: string;
  }> = [];

  if (convDoc?.participants) {
    for (const part of convDoc.participants) {
      const uid = extractPopulatedId(part.userId);
      const userObj =
        typeof part.userId === 'object' && part.userId !== null && 'fullName' in part.userId
          ? (part.userId as { fullName?: string; username?: string })
          : null;
      const displayName = userObj?.fullName?.trim() || userObj?.username?.trim() || 'Participant';
      if (uid) {
        participantNameMap.set(uid, displayName);
        participantRecords.push({
          userId: uid,
          name: displayName,
          username: userObj?.username?.trim() || undefined,
          role: part.role || 'member',
        });
      }
    }
  }

  const missingUserIds = new Set<string>();
  const registerMessageUsers = (doc: {
    senderType?: string | null;
    senderId?: unknown;
    callEvent?: {
      callerId?: { toString(): string } | string | null;
      receiverId?: { toString(): string } | string | null;
    } | null;
  }) => {
    if (!isAiMessageLike(doc) && doc.senderId) {
      const sid = extractPopulatedId(doc.senderId);
      const sObj =
        typeof doc.senderId === 'object' && doc.senderId !== null && 'fullName' in doc.senderId
          ? (doc.senderId as { fullName?: string; username?: string })
          : null;
      if (sid && !participantNameMap.has(sid)) {
        const sName = sObj?.fullName?.trim() || sObj?.username?.trim();
        if (sName) participantNameMap.set(sid, sName);
      }
    }
    if (doc.callEvent) {
      const callerId = doc.callEvent.callerId?.toString();
      const receiverId = doc.callEvent.receiverId?.toString();
      if (callerId && !participantNameMap.has(callerId) && Types.ObjectId.isValid(callerId)) {
        missingUserIds.add(callerId);
      }
      if (receiverId && !participantNameMap.has(receiverId) && Types.ObjectId.isValid(receiverId)) {
        missingUserIds.add(receiverId);
      }
    }
  };

  for (const doc of recentDocs) registerMessageUsers(doc);
  if (replyDoc) registerMessageUsers(replyDoc);

  if (missingUserIds.size > 0) {
    const extraUsers = await User.find({
      _id: { $in: Array.from(missingUserIds).map((id) => new Types.ObjectId(id)) },
    })
      .select('fullName username')
      .lean();
    for (const u of extraUsers) {
      const name = u.fullName?.trim() || u.username?.trim() || 'Participant';
      participantNameMap.set(u._id.toString(), name);
    }
  }

  // Prioritize active speakers and call participants in conversationMeta (capped for token safety)
  let conversationMeta: ConversationMetaContext | null = null;
  if (convDoc) {
    const priorityIds = new Set<string>([params.triggerUserId]);
    if (replyDoc) {
      const rSid = extractPopulatedId(replyDoc.senderId);
      if (rSid) priorityIds.add(rSid);
    }
    for (const doc of recentDocs) {
      if (!isAiMessageLike(doc)) {
        const sid = extractPopulatedId(doc.senderId);
        if (sid) priorityIds.add(sid);
      }
      if (doc.callEvent?.callerId) priorityIds.add(doc.callEvent.callerId.toString());
      if (doc.callEvent?.receiverId) priorityIds.add(doc.callEvent.receiverId.toString());
    }

    const prioritized: ConversationParticipantInfo[] = [];
    const seen = new Set<string>();

    const pushParticipant = (rec: (typeof participantRecords)[number]) => {
      if (seen.has(rec.userId) || prioritized.length >= MAX_PARTICIPANTS_IN_META) return;
      seen.add(rec.userId);
      prioritized.push({
        name: rec.name,
        username: rec.username,
        role: rec.role,
        isCurrentSpeaker: rec.userId === params.triggerUserId,
      });
    };

    for (const pid of priorityIds) {
      const rec = participantRecords.find((r) => r.userId === pid);
      if (rec) pushParticipant(rec);
    }
    for (const rec of participantRecords) {
      pushParticipant(rec);
    }

    const chatName =
      convDoc.name?.trim() ||
      (convDoc.type === 'direct'
        ? participantRecords.find((r) => r.userId !== params.triggerUserId)?.name || 'Direct Chat'
        : 'Group Chat');

    conversationMeta = {
      type: convDoc.type,
      name: chatName,
      totalParticipants: participantRecords.length,
      participants: prioritized,
    };
  }

  let replyTarget: ContextTurn | null = null;
  if (replyDoc) {
    const replyText = formatHistoryMessageText(replyDoc, participantNameMap);
    if (replyText) {
      const speaker = resolveTurnSpeaker(replyDoc);
      replyTarget = {
        speakerLabel: speaker.speakerLabel,
        isAi: speaker.isAi,
        isSystem: speaker.isSystem,
        relativeTime: formatRelativeTime(replyDoc.createdAt, params.triggerCreatedAt),
        text: truncateHistoryLine(replyText, 1000),
      };
    }
  }

  const metaChars = conversationMeta ? formatConversationMetaBlock(conversationMeta).length : 0;
  const replyChars = replyTarget
    ? replyTarget.text.length + replyTarget.speakerLabel.length + 24
    : 0;

  // Keep the most recent turns within budget (drop oldest messages first)
  const selectedNewestFirst: ContextTurn[] = [];
  let usedChars = metaChars + replyChars;

  for (const doc of recentDocs) {
    const rawText = formatHistoryMessageText(doc, participantNameMap);
    if (!rawText) continue;

    const speaker = resolveTurnSpeaker(doc);
    const relativeTime = formatRelativeTime(doc.createdAt, params.triggerCreatedAt);
    const trimmedText = truncateHistoryLine(rawText);
    const timeOverhead = relativeTime ? relativeTime.length + 3 : 0;
    const lineCost = speaker.speakerLabel.length + trimmedText.length + timeOverhead + 4;

    if (usedChars + lineCost > charBudget) {
      // Allow partial fit only if we have zero context turns yet
      if (selectedNewestFirst.length === 0) {
        const remaining = Math.max(
          120,
          charBudget - usedChars - speaker.speakerLabel.length - timeOverhead - 4
        );
        selectedNewestFirst.push({
          speakerLabel: speaker.speakerLabel,
          isAi: speaker.isAi,
          isSystem: speaker.isSystem,
          relativeTime,
          text: truncateHistoryLine(rawText, remaining),
        });
      }
      break;
    }

    selectedNewestFirst.push({
      speakerLabel: speaker.speakerLabel,
      isAi: speaker.isAi,
      isSystem: speaker.isSystem,
      relativeTime,
      text: trimmedText,
    });
    usedChars += lineCost;
  }

  selectedNewestFirst.reverse();

  return {
    contextTurns: selectedNewestFirst,
    replyTarget,
    conversationMeta,
  };
}
