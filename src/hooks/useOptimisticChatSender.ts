import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { Socket } from 'socket.io-client';
import { extractApiError, mediaApi, messageApi } from '../services/api';
import type {
  Conversation,
  MediaUploadProgressItem,
  Message,
  MessageAttachment,
  User,
} from '../types';
import { removePendingOutgoingMessage } from '../utils/indexedDb';
import {
  generateClientItemId,
  resolveBatchMessageType,
  type StagedMediaItem,
} from '../utils/mediaConfig';
import { resolveOptimisticMentions } from '../utils/mentions';
import { getAudioExtensionFromMime } from '../utils/voiceRecorder';
import {
  enqueueOfflineOutgoingMessage,
  isLikelyNetworkDisconnectError,
} from '../utils/offlineQueue';
import {
  createOptimisticMessage,
  dispatchMessageToServer,
  formatSendErrorMessage,
  generateClientMessageId,
  markOptimisticFailed,
  markOptimisticSending,
  reconcileIncomingMessage,
  removeOptimisticMessage,
  updateOptimisticMediaProgress,
} from '../utils/optimisticMessages';
import { syncIncomingMessageCaches } from '../utils/queryClient';

export interface OutgoingMessagePayload {
  content?: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
  attachments?: MessageAttachment[];
  localFile?: Blob | File;
  mediaItems?: StagedMediaItem[];
  duration?: number;
}

interface UseOptimisticChatSenderOptions {
  conversationId: string;
  conversation?: Conversation | null;
  user: User | null;
  socket: Socket | null;
  hasNewerMessages: boolean;
  setHasNewerMessages: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setNextCursor?: React.Dispatch<React.SetStateAction<string | null>>;
  onScrollToBottom?: () => void;
}

const UPLOAD_CONCURRENCY = 3;

export function useOptimisticChatSender({
  conversationId,
  conversation,
  user,
  socket,
  hasNewerMessages,
  setHasNewerMessages,
  setMessages,
  setHasMore,
  setNextCursor,
  onScrollToBottom,
}: UseOptimisticChatSenderOptions) {
  const localItemsRef = useRef<Record<string, StagedMediaItem[]>>({});
  const uploadedMapRef = useRef<Record<string, Record<string, MessageAttachment>>>({});
  const inFlightSendRef = useRef<Set<string>>(new Set());
  const revokeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const revokeUrlsForItems = useCallback((items?: StagedMediaItem[]) => {
    if (!items) return;
    for (const item of items) {
      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }, []);

  const scheduleCleanupLocalResources = useCallback(
    (clientMessageId?: string | null, immediate = false) => {
      if (!clientMessageId) return;
      const items = localItemsRef.current[clientMessageId];
      delete uploadedMapRef.current[clientMessageId];

      if (!items || items.length === 0) {
        delete localItemsRef.current[clientMessageId];
        return;
      }

      if (revokeTimersRef.current[clientMessageId]) {
        clearTimeout(revokeTimersRef.current[clientMessageId]);
        delete revokeTimersRef.current[clientMessageId];
      }

      if (immediate) {
        revokeUrlsForItems(items);
        delete localItemsRef.current[clientMessageId];
        return;
      }

      revokeTimersRef.current[clientMessageId] = setTimeout(() => {
        revokeUrlsForItems(localItemsRef.current[clientMessageId]);
        delete localItemsRef.current[clientMessageId];
        delete revokeTimersRef.current[clientMessageId];
      }, 2000);
    },
    [revokeUrlsForItems]
  );

  useEffect(() => {
    return () => {
      Object.values(revokeTimersRef.current).forEach(clearTimeout);
      revokeTimersRef.current = {};
      Object.values(localItemsRef.current).forEach(revokeUrlsForItems);
      localItemsRef.current = {};
      uploadedMapRef.current = {};
    };
  }, [revokeUrlsForItems]);

  // Listen for background offline-queue completion/failure events for this thread
  useEffect(() => {
    if (!conversationId) return;

    const onSynced = (ev: Event) => {
      const detail = (ev as CustomEvent<{ conversationId: string; message: Message }>)
        .detail;
      if (!detail || detail.conversationId !== conversationId) return;
      scheduleCleanupLocalResources(detail.message.clientMessageId, false);
      setMessages((prev) => reconcileIncomingMessage(prev, detail.message));
    };

    const onFailed = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          conversationId: string;
          clientMessageId: string;
          error: string;
        }>
      ).detail;
      if (!detail || detail.conversationId !== conversationId) return;
      setMessages((prev) =>
        markOptimisticFailed(prev, detail.clientMessageId, detail.error).map((m) =>
          m.clientMessageId === detail.clientMessageId ||
          m.id === detail.clientMessageId
            ? { ...m, localQueued: false }
            : m
        )
      );
    };

    window.addEventListener('blinkupz:offline-message-synced', onSynced);
    window.addEventListener('blinkupz:offline-message-failed', onFailed);
    return () => {
      window.removeEventListener('blinkupz:offline-message-synced', onSynced);
      window.removeEventListener('blinkupz:offline-message-failed', onFailed);
    };
  }, [conversationId, scheduleCleanupLocalResources, setMessages]);

  const performSendAttempt = useCallback(
    async (params: {
      clientMessageId: string;
      content?: string;
      messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
      attachments?: MessageAttachment[];
      replyTo?: string | null;
      duration?: number;
      optimisticSnapshot?: Message;
    }) => {
      if (!conversationId || !user) return;
      const { clientMessageId, content, messageType, replyTo, duration } = params;
      if (inFlightSendRef.current.has(clientMessageId)) return;
      inFlightSendRef.current.add(clientMessageId);

      try {
        const localItems = localItemsRef.current[clientMessageId];

        // If browser is clearly offline, enqueue directly in IndexedDB instead of failing
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          if (params.optimisticSnapshot) {
            await enqueueOfflineOutgoingMessage({
              ownerUserId: user.id,
              conversationId,
              message: params.optimisticSnapshot,
              content,
              messageType,
              replyTo,
              duration,
              stagedItems: localItems,
            });
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId || m.id === clientMessageId
                ? { ...m, deliveryStatus: 'sending', localQueued: true, localError: null }
                : m
            )
          );
          return;
        }

        let resolvedAttachments: MessageAttachment[] = params.attachments || [];

        if (localItems && localItems.length > 0) {
          if (!uploadedMapRef.current[clientMessageId]) {
            uploadedMapRef.current[clientMessageId] = {};
          }
          const cache = uploadedMapRef.current[clientMessageId];

          for (const item of localItems) {
            if (cache[item.clientItemId]) {
              setMessages((prev) =>
                updateOptimisticMediaProgress(prev, clientMessageId, item.clientItemId, {
                  stage: 'processing',
                  progress: 100,
                  error: null,
                })
              );
            } else {
              setMessages((prev) =>
                updateOptimisticMediaProgress(prev, clientMessageId, item.clientItemId, {
                  stage: 'preparing',
                  progress: 0,
                  error: null,
                })
              );
            }
          }

          const pendingItems = localItems.filter((item) => !cache[item.clientItemId]);
          const itemErrors: Array<{ itemId: string; message: string; isNetwork: boolean }> =
            [];

          let cursor = 0;
          const worker = async () => {
            while (cursor < pendingItems.length) {
              const idx = cursor++;
              const item = pendingItems[idx];
              if (!item) continue;

              const folder = item.kind === 'voice' ? 'voice' : 'messages';
              const fileNameOverride =
                item.kind === 'voice'
                  ? `voice-${Date.now()}.${getAudioExtensionFromMime(item.mimeType)}`
                  : undefined;

              setMessages((prev) =>
                updateOptimisticMediaProgress(prev, clientMessageId, item.clientItemId, {
                  stage: 'uploading',
                  progress: 0,
                  error: null,
                })
              );

              try {
                const uploaded = await mediaApi.upload(
                  item.file,
                  folder,
                  (pct) => {
                    const clamped = Math.max(0, Math.min(100, pct));
                    setMessages((prev) =>
                      updateOptimisticMediaProgress(
                        prev,
                        clientMessageId,
                        item.clientItemId,
                        {
                          stage: clamped >= 100 ? 'processing' : 'uploading',
                          progress: clamped,
                        }
                      )
                    );
                  },
                  fileNameOverride
                );

                if (item.duration) {
                  uploaded.duration = item.duration;
                }
                if (item.caption.trim()) {
                  uploaded.caption = item.caption.trim();
                }

                cache[item.clientItemId] = uploaded;
                setMessages((prev) =>
                  updateOptimisticMediaProgress(prev, clientMessageId, item.clientItemId, {
                    stage: 'processing',
                    progress: 100,
                    error: null,
                  })
                );
              } catch (err) {
                const errMsg = extractApiError(err).message || 'Upload failed';
                const isNet = isLikelyNetworkDisconnectError(err);
                itemErrors.push({ itemId: item.clientItemId, message: errMsg, isNetwork: isNet });
                setMessages((prev) =>
                  updateOptimisticMediaProgress(prev, clientMessageId, item.clientItemId, {
                    stage: 'failed',
                    error: errMsg,
                  })
                );
              }
            }
          };

          const workerCount = Math.min(UPLOAD_CONCURRENCY, Math.max(1, pendingItems.length));
          await Promise.all(Array.from({ length: workerCount }, () => worker()));

          if (itemErrors.length > 0) {
            if (itemErrors.every((e) => e.isNetwork) && params.optimisticSnapshot) {
              await enqueueOfflineOutgoingMessage({
                ownerUserId: user.id,
                conversationId,
                message: params.optimisticSnapshot,
                content,
                messageType,
                replyTo,
                duration,
                stagedItems: localItems,
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.clientMessageId === clientMessageId || m.id === clientMessageId
                    ? {
                        ...m,
                        deliveryStatus: 'sending',
                        localQueued: true,
                        localError: null,
                      }
                    : m
                )
              );
              return;
            }
            throw new Error(
              itemErrors.length === 1
                ? itemErrors[0].message
                : `${itemErrors.length} media files failed to upload. Tap Retry.`
            );
          }

          resolvedAttachments = localItems.map((item) => cache[item.clientItemId]);
        }

        const created = await dispatchMessageToServer({
          socket,
          payload: {
            conversationId,
            clientMessageId,
            content,
            messageType,
            attachments: resolvedAttachments,
            replyTo,
          },
        });

        await removePendingOutgoingMessage(clientMessageId);
        scheduleCleanupLocalResources(clientMessageId, false);
        syncIncomingMessageCaches(user.id, created);

        if (hasNewerMessages) {
          const latest = await messageApi.list(conversationId, { limit: 20 });
          setMessages(latest.messages);
          setHasMore(latest.hasMore);
          setNextCursor?.(latest.nextCursor);
          setHasNewerMessages(false);
        } else {
          setMessages((prev) => reconcileIncomingMessage(prev, created));
        }

        window.dispatchEvent(
          new CustomEvent('blinkupz:shared-media-refresh', { detail: { conversationId } })
        );
      } catch (err) {
        if (isLikelyNetworkDisconnectError(err) && params.optimisticSnapshot) {
          await enqueueOfflineOutgoingMessage({
            ownerUserId: user.id,
            conversationId,
            message: params.optimisticSnapshot,
            content,
            messageType,
            replyTo,
            duration,
            stagedItems: localItemsRef.current[clientMessageId],
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId || m.id === clientMessageId
                ? {
                    ...m,
                    deliveryStatus: 'sending',
                    localQueued: true,
                    localError: null,
                  }
                : m
            )
          );
          return;
        }
        const errorMsg = formatSendErrorMessage(err);
        setMessages((prev) => markOptimisticFailed(prev, clientMessageId, errorMsg));
      } finally {
        inFlightSendRef.current.delete(clientMessageId);
      }
    },
    [
      conversationId,
      user,
      socket,
      hasNewerMessages,
      setMessages,
      setHasMore,
      setNextCursor,
      setHasNewerMessages,
      scheduleCleanupLocalResources,
    ]
  );

  const sendOutgoingMessage = useCallback(
    (payload: OutgoingMessagePayload, replySnapshot: Message | null) => {
      if (!user || !conversationId) return;
      const clientMessageId = generateClientMessageId();
      const isCurrentlyOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      let stagedItems: StagedMediaItem[] = [];
      if (payload.mediaItems && payload.mediaItems.length > 0) {
        stagedItems = payload.mediaItems;
      } else if (payload.localFile) {
        const blobUrl = URL.createObjectURL(payload.localFile);
        const fileObj = payload.localFile;
        const fileName =
          'name' in fileObj && typeof fileObj.name === 'string'
            ? fileObj.name
            : payload.messageType === 'voice'
              ? 'Voice message'
              : 'attachment';

        stagedItems = [
          {
            clientItemId: generateClientItemId(),
            file: fileObj,
            previewUrl: blobUrl,
            kind: payload.messageType === 'text' ? 'document' : payload.messageType,
            fileName,
            fileSize: fileObj.size || 0,
            mimeType: fileObj.type || '',
            caption: '',
            duration: payload.duration,
          },
        ];
      }

      let initialAttachments: MessageAttachment[] = payload.attachments || [];
      let initialProgress: MediaUploadProgressItem[] | undefined;
      let resolvedType = payload.messageType;

      if (stagedItems.length > 0) {
        localItemsRef.current[clientMessageId] = stagedItems;
        resolvedType = resolveBatchMessageType(stagedItems);
        initialAttachments = stagedItems.map((item) => ({
          url: item.previewUrl,
          publicId: '',
          fileName: item.fileName,
          fileSize: item.fileSize,
          mimeType: item.mimeType,
          duration: item.duration,
          caption: item.caption.trim() || undefined,
        }));
        initialProgress = isCurrentlyOffline
          ? undefined
          : stagedItems.map((item) => ({
              clientItemId: item.clientItemId,
              stage: 'preparing',
              progress: 0,
              error: null,
            }));
      }

      const optimisticMentions = resolveOptimisticMentions(
        payload.content || '',
        conversation,
        initialAttachments
      );

      const optimistic = createOptimisticMessage({
        clientMessageId,
        conversationId,
        sender: user,
        content: payload.content || '',
        messageType: resolvedType,
        attachments: initialAttachments,
        mediaProgress: initialProgress,
        replyTo: replySnapshot,
        duration: payload.duration,
        mentions: optimisticMentions,
      });

      if (isCurrentlyOffline) {
        optimistic.localQueued = true;
      }

      if (hasNewerMessages) {
        setMessages([optimistic]);
        setHasNewerMessages(false);
      } else {
        setMessages((prev) => [...prev, optimistic]);
      }

      if (onScrollToBottom) {
        requestAnimationFrame(onScrollToBottom);
      }

      void performSendAttempt({
        clientMessageId,
        content: payload.content,
        messageType: resolvedType,
        attachments: stagedItems.length > 0 ? undefined : payload.attachments,
        replyTo: replySnapshot?.id || null,
        duration: payload.duration,
        optimisticSnapshot: optimistic,
      });
    },
    [
      user,
      conversationId,
      conversation,
      hasNewerMessages,
      setMessages,
      setHasNewerMessages,
      onScrollToBottom,
      performSendAttempt,
    ]
  );

  const retryFailedMessage = useCallback(
    (msg: Message) => {
      const cid = msg.clientMessageId || msg.id;
      if (!cid || inFlightSendRef.current.has(cid)) return;
      setMessages((prev) => markOptimisticSending(prev, cid));
      void performSendAttempt({
        clientMessageId: cid,
        content: msg.retryPayload?.content ?? msg.content,
        messageType:
          msg.retryPayload?.messageType ??
          (msg.messageType === 'system' || msg.messageType === 'call_event'
            ? 'text'
            : msg.messageType),
        attachments: localItemsRef.current[cid]
          ? undefined
          : msg.retryPayload?.attachments ?? msg.attachments,
        replyTo: msg.retryPayload?.replyTo ?? msg.replyTo?.id ?? null,
        duration: msg.retryPayload?.duration,
        optimisticSnapshot: msg,
      });
    },
    [performSendAttempt, setMessages]
  );

  const dismissFailedMessage = useCallback(
    (msg: Message) => {
      const cid = msg.clientMessageId || msg.id;
      scheduleCleanupLocalResources(cid, true);
      void removePendingOutgoingMessage(cid);
      setMessages((prev) => removeOptimisticMessage(prev, msg.id));
    },
    [scheduleCleanupLocalResources, setMessages]
  );

  return {
    sendOutgoingMessage,
    retryFailedMessage,
    dismissFailedMessage,
    scheduleCleanupLocalResources,
  };
}
