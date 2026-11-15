import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { Socket } from 'socket.io-client';
import { extractApiError, mediaApi, messageApi } from '../services/api';
import type {
  MediaUploadProgressItem,
  Message,
  MessageAttachment,
  User,
} from '../types';
import {
  generateClientItemId,
  resolveBatchMessageType,
  type StagedMediaItem,
} from '../utils/mediaConfig';
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
  user: User | null;
  socket: Socket | null;
  hasNewerMessages: boolean;
  setHasNewerMessages: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  onScrollToBottom?: () => void;
}

const UPLOAD_CONCURRENCY = 3;

export function useOptimisticChatSender({
  conversationId,
  user,
  socket,
  hasNewerMessages,
  setHasNewerMessages,
  setMessages,
  setHasMore,
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

      // Delay revocation slightly so browser finishes rendering permanent server URL smoothly
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

  const performSendAttempt = useCallback(
    async (params: {
      clientMessageId: string;
      content?: string;
      messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
      attachments?: MessageAttachment[];
      replyTo?: string | null;
    }) => {
      if (!conversationId) return;
      const { clientMessageId, content, messageType, replyTo } = params;
      if (inFlightSendRef.current.has(clientMessageId)) return;
      inFlightSendRef.current.add(clientMessageId);

      try {
        const localItems = localItemsRef.current[clientMessageId];
        let resolvedAttachments: MessageAttachment[] = params.attachments || [];

        if (localItems && localItems.length > 0) {
          if (!uploadedMapRef.current[clientMessageId]) {
            uploadedMapRef.current[clientMessageId] = {};
          }
          const cache = uploadedMapRef.current[clientMessageId];

          // Mark non-cached items as preparing before queuing upload workers
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
          const itemErrors: Array<{ itemId: string; message: string }> = [];

          let cursor = 0;
          const worker = async () => {
            while (cursor < pendingItems.length) {
              const idx = cursor++;
              const item = pendingItems[idx];
              if (!item) continue;

              const folder = item.kind === 'voice' ? 'voice' : 'messages';
              const fileNameOverride =
                item.kind === 'voice' ? `voice-${Date.now()}.webm` : undefined;

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
                      updateOptimisticMediaProgress(prev, clientMessageId, item.clientItemId, {
                        stage: clamped >= 100 ? 'processing' : 'uploading',
                        progress: clamped,
                      })
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
                itemErrors.push({ itemId: item.clientItemId, message: errMsg });
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
            throw new Error(
              itemErrors.length === 1
                ? itemErrors[0].message
                : `${itemErrors.length} media files failed to upload. Tap Retry.`
            );
          }

          // Preserve exact selected order
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

        scheduleCleanupLocalResources(clientMessageId, false);

        if (hasNewerMessages) {
          const latest = await messageApi.list(conversationId);
          setMessages(latest.messages);
          setHasMore(latest.hasMore);
          setHasNewerMessages(false);
        } else {
          setMessages((prev) => reconcileIncomingMessage(prev, created));
        }

        window.dispatchEvent(
          new CustomEvent('blinkupz:shared-media-refresh', { detail: { conversationId } })
        );
      } catch (err) {
        const errorMsg = formatSendErrorMessage(err);
        setMessages((prev) => markOptimisticFailed(prev, clientMessageId, errorMsg));
      } finally {
        inFlightSendRef.current.delete(clientMessageId);
      }
    },
    [
      conversationId,
      socket,
      hasNewerMessages,
      setMessages,
      setHasMore,
      setHasNewerMessages,
      scheduleCleanupLocalResources,
    ]
  );

  const sendOutgoingMessage = useCallback(
    (payload: OutgoingMessagePayload, replySnapshot: Message | null) => {
      if (!user || !conversationId) return;
      const clientMessageId = generateClientMessageId();

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
        initialProgress = stagedItems.map((item) => ({
          clientItemId: item.clientItemId,
          stage: 'preparing',
          progress: 0,
          error: null,
        }));
      }

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
      });

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
      });
    },
    [
      user,
      conversationId,
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
          (msg.messageType === 'system' ? 'text' : msg.messageType),
        attachments: localItemsRef.current[cid]
          ? undefined
          : msg.retryPayload?.attachments ?? msg.attachments,
        replyTo: msg.retryPayload?.replyTo ?? msg.replyTo?.id ?? null,
      });
    },
    [performSendAttempt, setMessages]
  );

  const dismissFailedMessage = useCallback(
    (msg: Message) => {
      const cid = msg.clientMessageId || msg.id;
      scheduleCleanupLocalResources(cid, true);
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
