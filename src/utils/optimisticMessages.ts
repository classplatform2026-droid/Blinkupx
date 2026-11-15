import type { Socket } from 'socket.io-client';
import { extractApiError, messageApi } from '../services/api';
import type {
  MediaUploadProgressItem,
  Message,
  MessageAttachment,
  MessageDeliveryStatus,
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
    replyTo: replyTo
      ? {
          id: replyTo.id,
          content: replyTo.content,
          messageType: replyTo.messageType,
          senderName: replyTo.sender?.fullName || 'User',
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
    const existing = prev[matchIdx];
    const resolvedStatus =
      STATUS_RANK[existing.deliveryStatus] >= 2
        ? pickHigherStatus(existing.deliveryStatus, incoming.deliveryStatus)
        : incoming.deliveryStatus;

    const merged: Message = {
      ...incoming,
      deliveryStatus: resolvedStatus,
      deliveredTo: mergeUniqueIds(existing.deliveredTo, incoming.deliveredTo),
      readBy: mergeUniqueIds(existing.readBy, incoming.readBy),
      mediaProgress: undefined,
      localError: null,
      retryPayload: null,
    };

    const next = [...prev];
    next[matchIdx] = merged;
    return next;
  }

  return [...prev, incoming];
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
