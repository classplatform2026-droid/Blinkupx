import type { Socket } from 'socket.io-client';
import { extractApiError, messageApi } from '../services/api';
import type {
  MediaUploadProgressItem,
  Message,
  MessageAttachment,
  MessageDeliveryStatus,
  MessageMention,
  User,
} from '../types';

const STATUS_RANK: Record<MessageDeliveryStatus, number> = {
  failed: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function generateClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cmsg_${crypto.randomUUID()}`;
  }
  return `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function mergeUniqueIds(a: string[] = [], b: string[] = []): string[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return Array.from(new Set([...a, ...b]));
}

function pickHigherStatus(
  a: MessageDeliveryStatus,
  b: MessageDeliveryStatus
): MessageDeliveryStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function createOptimisticMessage(params: {
  clientMessageId: string;
  conversationId: string;
  sender: User;
  content?: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
  attachments?: MessageAttachment[];
  mediaProgress?: MediaUploadProgressItem[];
  replyTo?: Message | null;
  duration?: number;
  mentions?: MessageMention[];
}): Message {
  const {
    clientMessageId,
    conversationId,
    sender,
    content = '',
    messageType,
    attachments = [],
    mediaProgress,
    replyTo,
    duration,
    mentions = [],
  } = params;

  return {
    id: clientMessageId,
    clientMessageId,
    conversationId,
    senderId: sender.id,
    sender: {
      id: sender.id,
      fullName: sender.fullName,
      username: sender.username,
      avatar: sender.avatar || '',
    },
    content,
    messageType,
    attachments,
    mediaProgress,
    links: [],
    mentions,
    replyTo: replyTo
      ? {
          id: replyTo.id,
          content: replyTo.content,
          messageType: replyTo.messageType,
          senderName: replyTo.sender?.fullName || 'User',
          mentions: replyTo.mentions,
        }
      : null,
    forwardedFrom: null,
    reactions: [],
    editedAt: null,
    deletedAt: null,
    deliveredTo: [],
    readBy: [sender.id],
    deliveryStatus: 'sending',
    localError: null,
    retryPayload: {
      content,
      messageType,
      attachments,
      replyTo: replyTo?.id || null,
      duration,
    },
    createdAt: new Date().toISOString(),
  };
}

export function compareMessageOrder(a: Message, b: Message): number {
  const timeDiff =
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (timeDiff !== 0) return timeDiff;
  return a.id.localeCompare(b.id);
}

function mergeTwoMessages(existing: Message, incoming: Message): Message {
  const existingRank = STATUS_RANK[existing.deliveryStatus] ?? 1;
  const incomingRank = STATUS_RANK[incoming.deliveryStatus] ?? 1;
  const resolvedStatus =
    existingRank >= 2
      ? pickHigherStatus(existing.deliveryStatus, incoming.deliveryStatus)
      : incoming.deliveryStatus;

  const existingEditedMs = existing.editedAt
    ? new Date(existing.editedAt).getTime()
    : 0;
  const incomingEditedMs = incoming.editedAt
    ? new Date(incoming.editedAt).getTime()
    : 0;

  const preferExistingContent =
    Boolean(existing.deletedAt && !incoming.deletedAt) ||
    (existingEditedMs > incomingEditedMs && incomingRank <= existingRank);

  const primary = preferExistingContent ? existing : incoming;

  return {
    ...primary,
    deliveryStatus: resolvedStatus,
    deliveredTo: mergeUniqueIds(existing.deliveredTo, incoming.deliveredTo),
    readBy: mergeUniqueIds(existing.readBy, incoming.readBy),
    mediaProgress:
      STATUS_RANK[resolvedStatus] >= 2 ? undefined : primary.mediaProgress,
    localError: STATUS_RANK[resolvedStatus] >= 2 ? null : primary.localError,
    retryPayload: STATUS_RANK[resolvedStatus] >= 2 ? null : primary.retryPayload,
  };
}

export function reconcileIncomingMessage(
  prev: Message[],
  incoming: Message
): Message[] {
  const matchIdx = prev.findIndex(
    (m) =>
      m.id === incoming.id ||
      (Boolean(incoming.clientMessageId) &&
        (m.clientMessageId === incoming.clientMessageId ||
          m.id === incoming.clientMessageId))
  );

  if (matchIdx >= 0) {
    const merged = mergeTwoMessages(prev[matchIdx], incoming);
    const next = [...prev];
    next[matchIdx] = merged;
    return next;
  }

  return [...prev, incoming];
}

export function mergeMessageCollections(
  base: Message[],
  additions: Message[]
): Message[] {
  if (base.length === 0 && additions.length === 0) return [];
  const byId = new Map<string, Message>();
  const clientKeyToId = new Map<string, string>();

  const upsert = (msg: Message) => {
    const matchedClientKey = msg.clientMessageId
      ? clientKeyToId.get(msg.clientMessageId)
      : undefined;
    const key =
      (byId.has(msg.id) ? msg.id : undefined) ||
      matchedClientKey ||
      (clientKeyToId.has(msg.id) ? clientKeyToId.get(msg.id) : undefined) ||
      msg.id;

    const existing = byId.get(key);
    const merged = existing ? mergeTwoMessages(existing, msg) : msg;

    if (key !== merged.id) {
      byId.delete(key);
    }
    byId.set(merged.id, merged);
    if (merged.clientMessageId) {
      clientKeyToId.set(merged.clientMessageId, merged.id);
    }
  };

  for (const m of base) upsert(m);
  for (const m of additions) upsert(m);

  return Array.from(byId.values()).sort(compareMessageOrder);
}

export function prependOlderMessages(
  current: Message[],
  olderBatch: Message[]
): Message[] {
  if (olderBatch.length === 0) return current;
  return mergeMessageCollections(olderBatch, current);
}

export function updateOptimisticMediaProgress(
  prev: Message[],
  clientMessageId: string,
  clientItemId: string,
  patch: Partial<MediaUploadProgressItem>
): Message[] {
  return prev.map((m) => {
    if (m.clientMessageId !== clientMessageId && m.id !== clientMessageId) {
      return m;
    }
    if (!m.mediaProgress) return m;
    return {
      ...m,
      mediaProgress: m.mediaProgress.map((item) =>
        item.clientItemId === clientItemId ? { ...item, ...patch } : item
      ),
    };
  });
}

export function markOptimisticSending(
  prev: Message[],
  clientMessageId: string
): Message[] {
  return prev.map((m) =>
    m.clientMessageId === clientMessageId || m.id === clientMessageId
      ? { ...m, deliveryStatus: 'sending', localError: null }
      : m
  );
}

export function markOptimisticFailed(
  prev: Message[],
  clientMessageId: string,
  errorMessage: string
): Message[] {
  return prev.map((m) => {
    if (m.clientMessageId !== clientMessageId && m.id !== clientMessageId) {
      return m;
    }
    // Never downgrade an already server-confirmed message
    if (STATUS_RANK[m.deliveryStatus] >= 2) {
      return m;
    }
    return {
      ...m,
      deliveryStatus: 'failed',
      localError: errorMessage,
    };
  });
}

export function removeOptimisticMessage(
  prev: Message[],
  messageId: string
): Message[] {
  return prev.filter(
    (m) => m.id !== messageId && m.clientMessageId !== messageId
  );
}

export async function dispatchMessageToServer(params: {
  socket: Socket | null;
  payload: {
    conversationId: string;
    clientMessageId: string;
    content?: string;
    messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
    attachments?: MessageAttachment[];
    replyTo?: string | null;
  };
}): Promise<Message> {
  const { socket, payload } = params;

  if (socket?.connected) {
    try {
      const ackRes = await new Promise<{
        ok: boolean;
        data?: Message;
        code?: string;
        message?: string;
      }>((resolve, reject) => {
        socket
          .timeout(7000)
          .emit(
            'message:send',
            payload,
            (
              err: Error | null,
              res?: {
                ok: boolean;
                data?: Message;
                code?: string;
                message?: string;
              }
            ) => {
              if (err) {
                reject(err);
                return;
              }
              if (!res) {
                reject(new Error('No acknowledgement from server.'));
                return;
              }
              resolve(res);
            }
          );
      });

      if (ackRes.ok && ackRes.data) {
        return ackRes.data;
      }

      const appErr = new Error(ackRes.message || 'Failed to send message.') as Error & {
        code?: string;
      };
      appErr.code = ackRes.code;
      throw appErr;
    } catch (err) {
      // Only fall back to HTTP if it wasn't a semantic rejection (block/permission/validation)
      const code = (err as { code?: string })?.code;
      if (
        code &&
        ['USER_BLOCKED', 'POSTING_RESTRICTED', 'VALIDATION_ERROR', 'CONVERSATION_NOT_FOUND', 'EMPTY_MESSAGE'].includes(
          code
        )
      ) {
        throw err;
      }
      // Fallback to HTTP POST (idempotent with same clientMessageId)
      return messageApi.send(payload);
    }
  }

  return messageApi.send(payload);
}

export function formatSendErrorMessage(err: unknown): string {
  const info = extractApiError(err);
  if (info.message && info.message !== 'Network Error') {
    return info.message;
  }
  return 'Could not send. Tap Retry.';
}
