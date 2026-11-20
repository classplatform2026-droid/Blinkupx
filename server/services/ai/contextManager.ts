import { Types } from 'mongoose';
import { env } from '../../config/env.ts';
import { Message } from '../../models/Message.ts';
import { isAiMessageLike } from './blinkIdentity.ts';
import type { ContextTurn } from './promptManager.ts';

const MAX_SINGLE_CONTEXT_ITEM_CHARS = 650;

function formatHistoryMessageText(doc: {
  messageType?: string;
  content?: string;
  attachments?: Array<{ fileName?: string; caption?: string }>;
}): string {
  const text = (doc.content || '').trim();
  if (text) {
    return text;
  }

  if (doc.messageType === 'image' || doc.messageType === 'video' || doc.messageType === 'document') {
    const caption = doc.attachments?.find((a) => a.caption?.trim())?.caption?.trim();
    if (caption) return `[${doc.messageType} caption] ${caption}`;
    const firstFile = doc.attachments?.[0]?.fileName?.trim();
    return firstFile ? `[Shared ${doc.messageType}: ${firstFile}]` : `[Shared ${doc.messageType}]`;
  }

  if (doc.messageType === 'voice') {
    return '[Voice message]';
  }

  return '';
}

function truncateHistoryLine(text: string, maxLen = MAX_SINGLE_CONTEXT_ITEM_CHARS): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3).trimEnd()}...`;
}

function resolveTurnSpeaker(doc: {
  senderType?: string | null;
  senderId?: unknown;
}): { speakerLabel: string; isAi: boolean } {
  if (isAiMessageLike(doc)) {
    return { speakerLabel: 'Blink [AI]', isAi: true };
  }
  const sender = doc.senderId as { fullName?: string; username?: string } | null | undefined;
  const label = sender?.fullName?.trim() || sender?.username?.trim() || 'Participant';
  return { speakerLabel: label, isAi: false };
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
}> {
  const convObjectId = new Types.ObjectId(params.conversationId);
  const triggerObjectId = new Types.ObjectId(params.triggerMessageId);
  const viewerObjectId = new Types.ObjectId(params.triggerUserId);

  const messageLimit = params.messageLimit ?? env.gemini.contextMessageLimit;
  const charBudget = params.charBudget ?? env.gemini.contextCharBudget;

  const recentDocs = await Message.find({
    conversationId: convObjectId,
    _id: { $ne: triggerObjectId },
    deletedAt: null,
    deletedFor: { $ne: viewerObjectId },
    messageType: { $in: ['text', 'image', 'video', 'document', 'voice'] },
    $or: [
      { createdAt: { $lt: params.triggerCreatedAt } },
      { createdAt: params.triggerCreatedAt, _id: { $lt: triggerObjectId } },
    ],
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(messageLimit)
    .populate('senderId', 'fullName username')
    .select('senderId senderType content messageType attachments createdAt')
    .lean();

  let replyTarget: ContextTurn | null = null;
  if (params.replyToId && Types.ObjectId.isValid(params.replyToId)) {
    const replyDoc = await Message.findOne({
      _id: new Types.ObjectId(params.replyToId),
      conversationId: convObjectId,
      deletedAt: null,
      deletedFor: { $ne: viewerObjectId },
    })
      .populate('senderId', 'fullName username')
      .select('senderId senderType content messageType attachments')
      .lean();

    if (replyDoc) {
      const replyText = formatHistoryMessageText(replyDoc);
      if (replyText) {
        const speaker = resolveTurnSpeaker(replyDoc);
        replyTarget = {
          speakerLabel: speaker.speakerLabel,
          isAi: speaker.isAi,
          text: truncateHistoryLine(replyText, 1000),
        };
      }
    }
  }

  // Keep the most recent turns within budget (drop oldest messages first)
  const selectedNewestFirst: ContextTurn[] = [];
  let usedChars = replyTarget ? replyTarget.text.length + replyTarget.speakerLabel.length : 0;

  for (const doc of recentDocs) {
    const rawText = formatHistoryMessageText(doc);
    if (!rawText) continue;

    const speaker = resolveTurnSpeaker(doc);
    const trimmedText = truncateHistoryLine(rawText);
    const lineCost = speaker.speakerLabel.length + trimmedText.length + 4;

    if (usedChars + lineCost > charBudget) {
      // Allow partial fit only if we have zero context turns yet
      if (selectedNewestFirst.length === 0) {
        const remaining = Math.max(120, charBudget - usedChars - speaker.speakerLabel.length - 4);
        selectedNewestFirst.push({
          speakerLabel: speaker.speakerLabel,
          isAi: speaker.isAi,
          text: truncateHistoryLine(rawText, remaining),
        });
      }
      break;
    }

    selectedNewestFirst.push({
      speakerLabel: speaker.speakerLabel,
      isAi: speaker.isAi,
      text: trimmedText,
    });
    usedChars += lineCost;
  }

  selectedNewestFirst.reverse();

  return {
    contextTurns: selectedNewestFirst,
    replyTarget,
  };
}
