import type { Socket } from 'socket.io-client';
import { extractApiError, mediaApi } from '../services/api';
import type { Message, MessageAttachment } from '../types';
import { broadcastCacheSync } from './cacheSync';
import {
  getPendingOutgoingMessages,
  removePendingOutgoingMessage,
  savePendingOutgoingMessage,
  type PendingOutgoingRecord,
  type StoredStagedMediaItem,
} from './indexedDb';
import type { StagedMediaItem } from './mediaConfig';
import {
  createOptimisticMessage,
  dispatchMessageToServer,
} from './optimisticMessages';
import { syncIncomingMessageCaches } from './queryClient';

let activeFlushPromise: Promise<number> | null = null;

export function isLikelyNetworkDisconnectError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  const info = extractApiError(err);
  if (info.status && info.status >= 400 && info.status < 500) {
    return false;
  }
  const msg = (info.message || '').toLowerCase();
  if (
    msg.includes('network error') ||
    msg.includes('failed to fetch') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('operation timed out') ||
    msg.includes('no acknowledgement') ||
    msg.includes('timeout')
  ) {
    return true;
  }
  return !info.status && !info.code;
}

export function hydratePendingMessagesForUi(
  records: PendingOutgoingRecord[]
): Message[] {
  return records.map((rec) => {
    const base = { ...rec.message };
    // Recreate temporary preview blob URLs if stored media Blobs exist
    if (
      rec.stagedItems &&
      rec.stagedItems.length > 0 &&
      base.attachments &&
      base.attachments.length === rec.stagedItems.length
    ) {
      base.attachments = base.attachments.map((att, idx) => {
        const stored = rec.stagedItems?.[idx];
        if (stored?.file instanceof Blob) {
          return {
            ...att,
            url: URL.createObjectURL(stored.file),
          };
        }
        return att;
      });
    }
    return {
      ...base,
      deliveryStatus: 'sending',
      localQueued: true,
      localError: null,
    };
  });
}

export async function enqueueOfflineOutgoingMessage(params: {
  ownerUserId: string;
  conversationId: string;
  message: Message;
  content?: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
  replyTo?: string | null;
  duration?: number;
  stagedItems?: StagedMediaItem[];
}): Promise<void> {
  const {
    ownerUserId,
    conversationId,
    message,
    content = '',
    messageType,
    replyTo = null,
    duration,
    stagedItems,
  } = params;

  const storedItems: StoredStagedMediaItem[] | undefined =
    stagedItems && stagedItems.length > 0
      ? stagedItems.map((item) => ({
          clientItemId: item.clientItemId,
          file: item.file,
          fileName: item.fileName,
          fileSize: item.fileSize,
          mimeType: item.mimeType,
          kind: item.kind,
          caption: item.caption,
          duration: item.duration,
        }))
      : undefined;

  // Store sanitized attachment descriptors (no stale revoked blob URLs inside IDB)
  const sanitizedMsg: Message = {
    ...message,
    deliveryStatus: 'sending',
    localQueued: true,
    localError: null,
    attachments: (message.attachments || []).map((att) => ({
      ...att,
      url: att.url.startsWith('blob:') ? '' : att.url,
    })),
  };

  await savePendingOutgoingMessage({
    clientMessageId: message.clientMessageId || message.id,
    ownerUserId,
    conversationId,
    content,
    messageType,
    replyTo,
    duration,
    message: sanitizedMsg,
    stagedItems: storedItems,
    retryCount: 0,
    lastError: null,
    createdAt: message.createdAt,
  });

  broadcastCacheSync({ type: 'QUEUE_UPDATED', conversationId });
  window.dispatchEvent(
    new CustomEvent('blinkupz:offline-queue-updated', {
      detail: { conversationId },
    })
  );
}

export async function flushOfflineOutgoingQueue(
  socket: Socket | null,
  ownerUserId?: string | null
): Promise<number> {
  if (!ownerUserId) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  if (activeFlushPromise) return activeFlushPromise;

  activeFlushPromise = (async () => {
    let flushedCount = 0;
    try {
      const pendingList = await getPendingOutgoingMessages(ownerUserId);
      if (pendingList.length === 0) return 0;

      for (const rec of pendingList) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          break;
        }

        try {
          let resolvedAttachments: MessageAttachment[] =
            (rec.message.attachments || []).filter((att) => Boolean(att.url)) || [];

          if (rec.stagedItems && rec.stagedItems.length > 0) {
            const uploadedList: MessageAttachment[] = [];
            for (const item of rec.stagedItems) {
              const folder = item.kind === 'voice' ? 'voice' : 'messages';
              const uploaded = await mediaApi.upload(
                item.file,
                folder,
                undefined,
                item.kind === 'voice' ? `voice-${Date.now()}.webm` : item.fileName
              );
              if (item.duration) uploaded.duration = item.duration;
              if (item.caption.trim()) uploaded.caption = item.caption.trim();
              uploadedList.push(uploaded);
            }
            resolvedAttachments = uploadedList;
          }

          const confirmed = await dispatchMessageToServer({
            socket,
            payload: {
              conversationId: rec.conversationId,
              clientMessageId: rec.clientMessageId,
              content: rec.content,
              messageType: rec.messageType,
              attachments: resolvedAttachments,
              replyTo: rec.replyTo || null,
            },
          });

          await removePendingOutgoingMessage(rec.clientMessageId);
          syncIncomingMessageCaches(ownerUserId, confirmed);

          window.dispatchEvent(
            new CustomEvent('blinkupz:offline-message-synced', {
              detail: {
                conversationId: rec.conversationId,
                message: confirmed,
              },
            })
          );
          window.dispatchEvent(
            new CustomEvent('blinkupz:shared-media-refresh', {
              detail: { conversationId: rec.conversationId },
            })
          );
          broadcastCacheSync({
            type: 'MESSAGES_UPDATED',
            conversationId: rec.conversationId,
          });
          flushedCount++;
        } catch (err) {
          if (isLikelyNetworkDisconnectError(err)) {
            // Stop flushing on lost network so we preserve order
            break;
          }
          // Semantic rejection (blocked user / forbidden / invalid): remove from queue and emit failure
          const errMessage = extractApiError(err).message || 'Message could not be sent.';
          await removePendingOutgoingMessage(rec.clientMessageId);
          window.dispatchEvent(
            new CustomEvent('blinkupz:offline-message-failed', {
              detail: {
                conversationId: rec.conversationId,
                clientMessageId: rec.clientMessageId,
                error: errMessage,
              },
            })
          );
        }
      }
    } finally {
      window.dispatchEvent(new CustomEvent('blinkupz:offline-queue-updated'));
      broadcastCacheSync({ type: 'QUEUE_UPDATED' });
      activeFlushPromise = null;
    }

    return flushedCount;
  })();

  return activeFlushPromise;
}

export { createOptimisticMessage };
