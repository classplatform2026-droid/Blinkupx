import { Types } from 'mongoose';
import type { Server } from 'socket.io';
import type { IConversation } from '../models/Conversation.ts';
import type { IMessageMention } from '../models/Message.ts';
import { User } from '../models/User.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import { dispatchMessagePushNotifications } from './pushService.ts';

export interface SerializedMention {
  type: 'user' | 'everyone' | 'ai';
  userId: string | null;
  username: string;
  fullName: string;
}

const LEFT_DISALLOWED_RE = /[a-zA-Z0-9_.]/;
const HANDLE_CHAR_RE = /[a-zA-Z0-9_]/;

function maskCodeSegments(raw: string): string {
  if (!raw) return '';
  const chars = raw.split('');
  let i = 0;

  while (i < chars.length) {
    if (chars[i] === '`' && chars[i + 1] === '`' && chars[i + 2] === '`') {
      const closeIdx = raw.indexOf('```', i + 3);
      if (closeIdx !== -1) {
        for (let k = i; k < closeIdx + 3; k++) {
          if (chars[k] !== '\n') chars[k] = ' ';
        }
        i = closeIdx + 3;
        continue;
      }
    }

    if (chars[i] === '`') {
      let closeIdx = -1;
      for (let k = i + 1; k < raw.length; k++) {
        if (raw[k] === '\n') break;
        if (raw[k] === '`') {
          closeIdx = k;
          break;
        }
      }
      if (closeIdx > i + 1) {
        for (let k = i; k <= closeIdx; k++) {
          chars[k] = ' ';
        }
        i = closeIdx + 1;
        continue;
      }
    }

    i += 1;
  }

  return chars.join('');
}

export function extractMentionHandles(rawText: string | null | undefined): string[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const masked = maskCodeSegments(rawText);
  const handles: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '@') continue;
    const prev = i > 0 ? masked[i - 1] : '';
    if (prev && LEFT_DISALLOWED_RE.test(prev)) {
      continue;
    }

    let j = i + 1;
    while (j < masked.length && HANDLE_CHAR_RE.test(masked[j])) {
      j += 1;
    }

    const len = j - (i + 1);
    if (len < 3 || len > 24) {
      continue;
    }

    // Reject email-like domains such as @domain.com
    const next = j < masked.length ? masked[j] : '';
    const afterNext = j + 1 < masked.length ? masked[j + 1] : '';
    if (next === '.' && afterNext && HANDLE_CHAR_RE.test(afterNext)) {
      continue;
    }

    const handle = masked.slice(i + 1, j).toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      handles.push(handle);
    }
    i = j - 1;
  }

  return handles;
}

export function extractMessageMentionHandles(
  content: string,
  attachments?: Array<{ caption?: string }>
): string[] {
  const combined: string[] = [];
  const seen = new Set<string>();

  const pushAll = (handles: string[]) => {
    for (const h of handles) {
      if (!seen.has(h)) {
        seen.add(h);
        combined.push(h);
      }
    }
  };

  pushAll(extractMentionHandles(content));
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.caption) {
        pushAll(extractMentionHandles(att.caption));
      }
    }
  }

  return combined;
}

export function serializeMessageMentions(
  mentions: IMessageMention[] | null | undefined
): SerializedMention[] {
  if (!mentions || mentions.length === 0) return [];
  return mentions.map((m) => ({
    type: m.type,
    userId: m.userId ? m.userId.toString() : null,
    username: m.username,
    fullName: m.fullName || '',
  }));
}

export async function resolveConversationMentions(params: {
  conversation: IConversation;
  content: string;
  attachments?: Array<{ caption?: string }>;
  senderId: string;
  senderType?: 'user' | 'ai';
  forwardedSourceMentions?: IMessageMention[];
}): Promise<{
  mentions: IMessageMention[];
  directlyMentionedIds: Set<string>;
  mentionsEveryone: boolean;
}> {
  const {
    conversation,
    content,
    attachments,
    senderId,
    forwardedSourceMentions,
  } = params;

  const handles = extractMessageMentionHandles(content, attachments);
  if (handles.length === 0) {
    return {
      mentions: [],
      directlyMentionedIds: new Set<string>(),
      mentionsEveryone: false,
    };
  }

  const participantIds = conversation.participants.map((p) => p.userId);
  const participantUsers =
    participantIds.length > 0
      ? await User.find({ _id: { $in: participantIds } })
          .select('_id username fullName')
          .lean()
      : [];

  const memberByUsername = new Map<
    string,
    { _id: Types.ObjectId; username: string; fullName: string }
  >();
  for (const u of participantUsers) {
    if (u.username) {
      memberByUsername.set(u.username.toLowerCase(), {
        _id: u._id as Types.ObjectId,
        username: u.username.toLowerCase(),
        fullName: u.fullName || u.username,
      });
    }
  }

  const forwardedMap = new Map<string, IMessageMention>();
  if (forwardedSourceMentions && forwardedSourceMentions.length > 0) {
    for (const src of forwardedSourceMentions) {
      if (src.username) {
        forwardedMap.set(src.username.toLowerCase(), src);
      }
    }
  }

  const isGroupLike =
    conversation.type === 'group' || conversation.type === 'community';
  const resolved: IMessageMention[] = [];
  const directlyMentionedIds = new Set<string>();
  let mentionsEveryone = false;

  for (const handle of handles) {
    if (handle === 'blink') {
      resolved.push({
        type: 'ai',
        userId: null,
        username: 'blink',
        fullName: 'Blink',
      });
      continue;
    }

    if (handle === 'everyone') {
      if (isGroupLike) {
        mentionsEveryone = true;
        resolved.push({
          type: 'everyone',
          userId: null,
          username: 'everyone',
          fullName: 'Everyone',
        });
      } else {
        const forwardedEveryone = forwardedMap.get('everyone');
        if (forwardedEveryone) {
          resolved.push({
            type: 'everyone',
            userId: null,
            username: 'everyone',
            fullName: 'Everyone',
          });
        }
      }
      continue;
    }

    const activeMember = memberByUsername.get(handle);
    if (activeMember) {
      resolved.push({
        type: 'user',
        userId: activeMember._id,
        username: activeMember.username,
        fullName: activeMember.fullName,
      });
      const memberIdStr = activeMember._id.toString();
      if (memberIdStr !== senderId) {
        directlyMentionedIds.add(memberIdStr);
      }
      continue;
    }

    // Preserve verified mention metadata when forwarding messages across chats
    // without adding non-members to directlyMentionedIds (no non-member notifications).
    const forwardedMatch = forwardedMap.get(handle);
    if (forwardedMatch) {
      resolved.push({
        type: forwardedMatch.type,
        userId: forwardedMatch.userId || null,
        username: forwardedMatch.username.toLowerCase(),
        fullName: forwardedMatch.fullName || '',
      });
    }
  }

  return {
    mentions: resolved,
    directlyMentionedIds,
    mentionsEveryone,
  };
}

export async function notifyNewlyMentionedOnEdit(params: {
  conversation: IConversation;
  messageId: string;
  editorUserId: string;
  previewText: string;
  previousMentions: IMessageMention[];
  nextMentions: IMessageMention[];
  directlyMentionedIds: Set<string>;
  mentionsEveryone: boolean;
  createdAt: Date;
  io: Server | null;
}): Promise<void> {
  const {
    conversation,
    messageId,
    editorUserId,
    previewText,
    previousMentions,
    directlyMentionedIds,
    mentionsEveryone,
    createdAt,
    io,
  } = params;

  const prevUserIds = new Set<string>(
    previousMentions
      .filter((m) => m.type === 'user' && m.userId)
      .map((m) => m.userId!.toString())
  );
  const prevEveryone = previousMentions.some((m) => m.type === 'everyone');

  const newlyDirectIds = new Set<string>();
  for (const uid of directlyMentionedIds) {
    if (!prevUserIds.has(uid)) {
      newlyDirectIds.add(uid);
    }
  }
  const newlyEveryone = mentionsEveryone && !prevEveryone;

  if (newlyDirectIds.size === 0 && !newlyEveryone) return;

  const otherParticipantIds = conversation.participants
    .map((p) => p.userId.toString())
    .filter((id) => id !== editorUserId);

  if (otherParticipantIds.length === 0) return;

  const targetIds = newlyEveryone
    ? otherParticipantIds
    : otherParticipantIds.filter((pid) => newlyDirectIds.has(pid));

  if (targetIds.length === 0) return;

  const [recipients, senderDoc] = await Promise.all([
    User.find({ _id: { $in: targetIds } })
      .select('settings blockedUsers')
      .lean(),
    User.findById(editorUserId)
      .select('fullName avatar blockedUsers settings.privacy.profilePhoto')
      .lean(),
  ]);

  const recipientMap = new Map(recipients.map((r) => [r._id.toString(), r]));
  const senderBlockedSet = new Set(
    (senderDoc?.blockedUsers || []).map((id) => id.toString())
  );
  const now = new Date();
  const resolvedSenderName = senderDoc?.fullName || 'New mention';

  const participantMuteMap = new Map<string, Date | null>();
  for (const part of conversation.participants) {
    participantMuteMap.set(part.userId.toString(), part.mutedUntil || null);
  }

  if (io) {
    for (const pid of targetIds) {
      const recipient = recipientMap.get(pid);
      const isBlockedRecipient =
        senderBlockedSet.has(pid) ||
        Boolean(recipient?.blockedUsers?.some((id) => id.toString() === editorUserId));
      if (isBlockedRecipient) continue;

      const part = conversation.participants.find((p) => p.userId.toString() === pid);
      const isMuted = Boolean(part?.mutedUntil && part.mutedUntil > now);
      if (isMuted) continue;

      const notif = resolveUserSettings(recipient?.settings).notifications;
      const categoryEnabled =
        conversation.type === 'direct'
          ? notif.privateMessages
          : conversation.type === 'group'
            ? notif.groupMessages
            : notif.communityMessages;
      if (!categoryEnabled) continue;

      const isDirectMention = newlyDirectIds.has(pid);
      const showPreview = notif.messagePreview;
      const title = isDirectMention
        ? conversation.type === 'direct'
          ? `${resolvedSenderName} mentioned you`
          : `${resolvedSenderName} mentioned you • ${conversation.name}`
        : `${resolvedSenderName} mentioned @everyone • ${conversation.name}`;
      const body = showPreview
        ? previewText.slice(0, 120)
        : isDirectMention
          ? 'You were mentioned in a message'
          : 'Everyone was mentioned in a message';

      io.to(`user:${pid}`).emit('notification:message', {
        id: messageId,
        conversationId: conversation._id.toString(),
        conversationType: conversation.type,
        communityId: conversation.communityId ? conversation.communityId.toString() : null,
        title,
        body,
        previewHidden: !showPreview,
        mentioned: true,
        mentionType: isDirectMention ? 'direct' : 'everyone',
        soundEnabled: notif.soundEnabled,
        soundTone: notif.soundTone,
        vibrationEnabled: notif.vibrationEnabled,
        createdAt,
      });
    }
  }

  const senderPrivacy = resolveUserSettings(senderDoc?.settings).privacy;
  void dispatchMessagePushNotifications({
    messageId,
    conversationId: conversation._id.toString(),
    conversationType: conversation.type,
    conversationName: conversation.name || 'Chat',
    communityId: conversation.communityId ? conversation.communityId.toString() : null,
    senderId: editorUserId,
    senderName: resolvedSenderName,
    senderAvatar: senderDoc?.avatar || '',
    senderProfilePhotoPrivacy: senderPrivacy.profilePhoto,
    senderBlockedUsers: senderBlockedSet,
    previewText,
    recipientDocs: recipients,
    participantMuteMap,
    directlyMentionedIds: newlyDirectIds,
    mentionsEveryone: newlyEveryone,
  }).catch(() => {
    // Best-effort push notification for newly added mention on edit
  });
}
