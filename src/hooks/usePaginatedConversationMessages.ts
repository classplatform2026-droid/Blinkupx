import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { extractApiError, messageApi } from '../services/api';
import type { Message } from '../types';
import {
  getCachedMessages,
  getCachedThreadMeta,
  getOlderCachedMessages,
  getPendingOutgoingMessages,
  saveCachedMessages,
  saveCachedThreadMeta,
} from '../utils/indexedDb';
import {
  hydratePendingMessagesForUi,
  isLikelyNetworkDisconnectError,
} from '../utils/offlineQueue';
import {
  mergeMessageCollections,
  prependOlderMessages,
  reconcileIncomingMessage,
} from '../utils/optimisticMessages';
import {
  CACHE_TIMES,
  queryKeys,
  type ThreadMessagesCacheData,
} from '../utils/queryClient';

export const MESSAGE_PAGE_SIZE = 20;
const TOP_SCROLL_THRESHOLD_PX = 140;
const BOTTOM_STICKY_THRESHOLD_PX = 140;

interface VisualAnchorSnapshot {
  messageId: string;
  hasAnchorEl: boolean;
  prevTopOffset: number;
  prevScrollHeight: number;
  prevScrollTop: number;
}

interface PostPrependCompensation {
  messageId: string;
  expectedOffset: number;
  expiresAt: number;
}

interface UsePaginatedConversationMessagesOptions {
  conversationId: string;
  userId: string;
  highlightId?: string | null;
  onError?: (message: string) => void;
}

export function usePaginatedConversationMessages({
  conversationId,
  userId,
  highlightId = null,
  onError,
}: UsePaginatedConversationMessagesOptions) {
  const qc = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unseenNewCount, setUnseenNewCount] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadingOlderLockRef = useRef(false);
  const initialScrollSettledRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const pendingAnchorRef = useRef<VisualAnchorSnapshot | null>(null);
  const postPrependCompRef = useRef<PostPrependCompensation | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const nextCursorRef = useRef<string | null>(nextCursor);
  const hasMoreRef = useRef<boolean>(hasMore);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Reset scroll & pagination state cleanly whenever conversation changes
  useEffect(() => {
    initialScrollSettledRef.current = false;
    loadingOlderLockRef.current = false;
    pendingAnchorRef.current = null;
    postPrependCompRef.current = null;
    isNearBottomRef.current = true;
    setMessages([]);
    setUnseenNewCount(0);
    setNextCursor(null);
    setHasMore(false);
    setHasNewerMessages(false);
  }, [conversationId]);

  const checkIsNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_STICKY_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    setUnseenNewCount(0);
    isNearBottomRef.current = true;
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior });
    } else if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
  }, []);

  const captureVisualAnchor = useCallback(
    (currentMsgs: Message[]): VisualAnchorSnapshot | null => {
      const container = scrollContainerRef.current;
      if (!container || currentMsgs.length === 0) return null;

      const containerRect = container.getBoundingClientRect();
      let anchorEl: HTMLElement | null = null;
      let anchorId = currentMsgs[0].id;

      for (const m of currentMsgs) {
        const el = document.getElementById(`msg-${m.id}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= containerRect.top) {
          anchorEl = el;
          anchorId = m.id;
          break;
        }
      }

      const prevTopOffset = anchorEl
        ? anchorEl.getBoundingClientRect().top - containerRect.top
        : 0;

      return {
        messageId: anchorId,
        hasAnchorEl: Boolean(anchorEl),
        prevTopOffset,
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
    },
    []
  );

  // Restore exact visual position synchronously BEFORE browser paint after prepending older messages
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const anchor = pendingAnchorRef.current;
    if (!container || !anchor) return;

    const el = anchor.hasAnchorEl
      ? document.getElementById(`msg-${anchor.messageId}`)
      : null;

    if (el) {
      const newOffset =
        el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += newOffset - anchor.prevTopOffset;
      postPrependCompRef.current = {
        messageId: anchor.messageId,
        expectedOffset:
          el.getBoundingClientRect().top - container.getBoundingClientRect().top,
        expiresAt: Date.now() + 1500,
      };
    } else {
      const heightDelta = container.scrollHeight - anchor.prevScrollHeight;
      container.scrollTop = anchor.prevScrollTop + heightDelta;
      postPrependCompRef.current = null;
    }

    pendingAnchorRef.current = null;
  }, [messages]);

  // Snap to bottom on initial thread open once messages render
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (
      !container ||
      initialScrollSettledRef.current ||
      highlightId ||
      hasNewerMessages ||
      messages.length === 0
    ) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    isNearBottomRef.current = true;

    const rafId = requestAnimationFrame(() => {
      if (scrollContainerRef.current && !highlightId && !hasNewerMessages) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight;
      }
      initialScrollSettledRef.current = true;
    });

    return () => cancelAnimationFrame(rafId);
  }, [conversationId, messages.length, highlightId, hasNewerMessages]);

  // Compensate async media (image/video/audio) height shifts after prepend OR keep initial open at bottom
  useEffect(() => {
    const wrapper = contentWrapperRef.current;
    const container = scrollContainerRef.current;
    if (!wrapper || !container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      const comp = postPrependCompRef.current;
      if (comp && Date.now() <= comp.expiresAt) {
        const el = document.getElementById(`msg-${comp.messageId}`);
        if (el) {
          const currentOffset =
            el.getBoundingClientRect().top - container.getBoundingClientRect().top;
          const shift = currentOffset - comp.expectedOffset;
          if (Math.abs(shift) > 0.5) {
            container.scrollTop += shift;
          }
          return;
        }
      }

      if (
        initialScrollSettledRef.current &&
        isNearBottomRef.current &&
        !hasNewerMessages &&
        !highlightId &&
        !loadingOlderLockRef.current
      ) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [conversationId, hasNewerMessages, highlightId]);

  const hydrateCachedThread = useCallback(
    async (expectedLastMessageId?: string | null) => {
      if (!userId || !conversationId || highlightId) {
        return {
          hydrated: false,
          skipNetworkFetch: false,
          hydratedIds: new Set<string>(),
        };
      }

      const memMsgs = qc.getQueryData<ThreadMessagesCacheData>(
        queryKeys.messages(userId, conversationId)
      );

      const [idbMsgs, idbMeta, pendingRecs] = await Promise.all([
        memMsgs ? Promise.resolve(null) : getCachedMessages(userId, conversationId, MESSAGE_PAGE_SIZE),
        memMsgs ? Promise.resolve(null) : getCachedThreadMeta(userId, conversationId),
        getPendingOutgoingMessages(userId, conversationId),
      ]);

      const pendingUi = hydratePendingMessagesForUi(pendingRecs);
      const baseMsgs = memMsgs?.messages || idbMsgs || [];

      if (baseMsgs.length === 0 && pendingUi.length === 0) {
        return {
          hydrated: false,
          skipNetworkFetch: false,
          hydratedIds: new Set<string>(),
        };
      }

      let merged = [...baseMsgs];
      for (const p of pendingUi) {
        merged = reconcileIncomingMessage(merged, p);
      }

      setMessages(merged);
      if (memMsgs) {
        setHasMore(memMsgs.hasMore);
        setNextCursor(memMsgs.nextCursor ?? null);
        setHasNewerMessages(Boolean(memMsgs.hasNewer));
      } else if (idbMeta) {
        const latestBaseId = baseMsgs[baseMsgs.length - 1]?.id || null;
        if (latestBaseId && idbMeta.latestMessageId === latestBaseId) {
          setHasMore(idbMeta.hasMore);
          setNextCursor(idbMeta.nextCursor ?? null);
        } else {
          // Newer socket messages shifted the latest-20 window in IDB; anchor cursor to actual oldest visible message
          setHasMore(idbMeta.hasMore || baseMsgs.length >= MESSAGE_PAGE_SIZE);
          setNextCursor(null);
        }
      }

      const hydratedIds = new Set(merged.map((m) => m.id));
      const now = Date.now();
      const cacheFetchedAt = memMsgs?.fetchedAt ?? idbMeta?.fetchedAt ?? 0;
      const withinStaleWindow =
        cacheFetchedAt > 0 && now - cacheFetchedAt < CACHE_TIMES.messages.staleTime;
      const matchesLatestServerMessage =
        !expectedLastMessageId || hydratedIds.has(expectedLastMessageId);
      const isOffline =
        typeof navigator !== 'undefined' && navigator.onLine === false;

      const skipNetworkFetch = Boolean(
        (withinStaleWindow && matchesLatestServerMessage) || isOffline
      );

      return { hydrated: true, skipNetworkFetch, hydratedIds };
    },
    [userId, conversationId, highlightId, qc]
  );

  const applyServerPage = useCallback(
    async (
      msgData: {
        messages: Message[];
        hasMore: boolean;
        nextCursor?: string | null;
        hasNewer?: boolean;
      },
      options?: { isHighlightView?: boolean }
    ) => {
      const pendingRecs = userId
        ? await getPendingOutgoingMessages(userId, conversationId)
        : [];
      const pendingUi = hydratePendingMessagesForUi(pendingRecs);
      const isHighlightView = Boolean(options?.isHighlightView);

      let nextList: Message[];
      let resolvedHasMore = msgData.hasMore;
      let resolvedNextCursor = msgData.nextCursor ?? null;

      if (!isHighlightView && messagesRef.current.length > MESSAGE_PAGE_SIZE) {
        // Preserve already-paginated older pages if latest batch overlaps seamlessly
        const prevOldest = messagesRef.current[0];
        const overlapsExisting = msgData.messages.some((incoming) =>
          messagesRef.current.some((existing) => existing.id === incoming.id)
        );
        if (overlapsExisting && prevOldest) {
          nextList = mergeMessageCollections(messagesRef.current, msgData.messages);
          resolvedHasMore = hasMoreRef.current;
          resolvedNextCursor = nextCursorRef.current ?? msgData.nextCursor ?? null;
        } else {
          nextList = [...msgData.messages];
        }
      } else {
        nextList = [...msgData.messages];
      }

      for (const p of pendingUi) {
        nextList = reconcileIncomingMessage(nextList, p);
      }

      const resolvedHasNewer = Boolean(msgData.hasNewer);
      setMessages(nextList);
      setHasMore(resolvedHasMore);
      setNextCursor(resolvedNextCursor);
      setHasNewerMessages(resolvedHasNewer);

      if (userId && !isHighlightView) {
        const fetchedAt = Date.now();
        const latestMsg = msgData.messages[msgData.messages.length - 1];
        void saveCachedMessages(userId, msgData.messages);
        void saveCachedThreadMeta(userId, conversationId, {
          hasMore: resolvedHasMore,
          nextCursor: resolvedNextCursor,
          latestMessageId: latestMsg?.id || null,
          fetchedAt,
        });
        qc.setQueryData<ThreadMessagesCacheData>(
          queryKeys.messages(userId, conversationId),
          {
            messages: nextList,
            hasMore: resolvedHasMore,
            nextCursor: resolvedNextCursor,
            hasNewer: resolvedHasNewer,
            fetchedAt,
          }
        );
      }
    },
    [userId, conversationId, qc]
  );

  const loadOlder = useCallback(async () => {
    if (
      loadingOlderLockRef.current ||
      !hasMoreRef.current ||
      messagesRef.current.length === 0
    ) {
      return;
    }

    loadingOlderLockRef.current = true;
    setLoadingOlder(true);

    try {
      const currentMsgs = messagesRef.current;
      const oldest = currentMsgs[0];
      const cursorParam = nextCursorRef.current;

      let olderBatch: Message[] = [];
      let nextHasMore = false;
      let newNextCursor: string | null = null;

      if (typeof navigator !== 'undefined' && navigator.onLine === false && userId) {
        const offlineRes = await getOlderCachedMessages(
          userId,
          conversationId,
          oldest.createdAt,
          oldest.id,
          MESSAGE_PAGE_SIZE
        );
        olderBatch = offlineRes.messages;
        nextHasMore = offlineRes.hasMore;
        newNextCursor = null;
      } else {
        try {
          const data = await messageApi.list(conversationId, {
            cursor: cursorParam || undefined,
            before: cursorParam ? undefined : oldest.createdAt,
            limit: MESSAGE_PAGE_SIZE,
          });
          olderBatch = data.messages;
          nextHasMore = data.hasMore;
          newNextCursor = data.nextCursor;
        } catch (err) {
          if (isLikelyNetworkDisconnectError(err) && userId) {
            const offlineRes = await getOlderCachedMessages(
              userId,
              conversationId,
              oldest.createdAt,
              oldest.id,
              MESSAGE_PAGE_SIZE
            );
            olderBatch = offlineRes.messages;
            nextHasMore = offlineRes.hasMore;
            newNextCursor = null;
          } else {
            throw err;
          }
        }
      }

      if (olderBatch.length > 0) {
        // Capture anchor immediately before prepending so visual position locks cleanly
        pendingAnchorRef.current = captureVisualAnchor(messagesRef.current);
      }

      const merged = prependOlderMessages(messagesRef.current, olderBatch);
      setMessages(merged);
      setHasMore(nextHasMore);
      setNextCursor(newNextCursor);

      if (userId) {
        if (olderBatch.length > 0) {
          void saveCachedMessages(userId, olderBatch);
        }
        if (!hasNewerMessages) {
          qc.setQueryData<ThreadMessagesCacheData>(
            queryKeys.messages(userId, conversationId),
            (prev) => ({
              messages: merged,
              hasMore: nextHasMore,
              nextCursor: newNextCursor,
              hasNewer: false,
              fetchedAt: prev?.fetchedAt || Date.now(),
            })
          );
        }
      }
    } catch (err) {
      onError?.(extractApiError(err).message);
    } finally {
      loadingOlderLockRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, userId, hasNewerMessages, captureVisualAnchor, qc, onError]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = checkIsNearBottom();
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setUnseenNewCount(0);
    }

    // Keep post-prepend resize compensation offset synced if user manually scrolls
    if (postPrependCompRef.current) {
      const compEl = document.getElementById(
        `msg-${postPrependCompRef.current.messageId}`
      );
      if (compEl) {
        postPrependCompRef.current.expectedOffset =
          compEl.getBoundingClientRect().top -
          container.getBoundingClientRect().top;
      }
    }

    if (
      initialScrollSettledRef.current &&
      container.scrollTop <= TOP_SCROLL_THRESHOLD_PX &&
      hasMoreRef.current &&
      !loadingOlderLockRef.current
    ) {
      void loadOlder();
    }
  }, [checkIsNearBottom, loadOlder]);

  const appendRealtimeMessage = useCallback(
    (msg: Message) => {
      if (hasNewerMessages) return;
      const wasNearBottom = checkIsNearBottom();
      const isOwnMsg = Boolean(userId && msg.senderId === userId);

      setMessages((prev) => reconcileIncomingMessage(prev, msg));

      if (isOwnMsg || wasNearBottom) {
        requestAnimationFrame(() => {
          scrollToBottom('smooth');
        });
      } else {
        setUnseenNewCount((c) => c + 1);
      }
    },
    [hasNewerMessages, checkIsNearBottom, userId, scrollToBottom]
  );

  return {
    messages,
    setMessages,
    hasMore,
    setHasMore,
    nextCursor,
    setNextCursor,
    hasNewerMessages,
    setHasNewerMessages,
    loadingOlder,
    unseenNewCount,
    scrollContainerRef,
    contentWrapperRef,
    bottomRef,
    scrollToBottom,
    handleScroll,
    loadOlder,
    hydrateCachedThread,
    applyServerPage,
    appendRealtimeMessage,
    markInitialScrollPending: () => {
      initialScrollSettledRef.current = false;
    },
  };
}
