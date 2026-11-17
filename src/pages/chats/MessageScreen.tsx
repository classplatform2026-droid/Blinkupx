import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  BellOff,
  Images,
  Loader2,
  MoreVertical,
  Phone,
  Pin,
  Search,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  Video,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenu } from '../../components/DropdownMenu';
import { MediaGalleryModal } from '../../components/MediaGalleryModal';
import { MessageBubble } from '../../components/MessageBubble';
import { MessageInput, type OutgoingMessagePayload } from '../../components/MessageInput';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SharedMediaPanel } from '../../components/SharedMediaPanel';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useOptimisticChatSender } from '../../hooks/useOptimisticChatSender';
import {
  MESSAGE_PAGE_SIZE,
  usePaginatedConversationMessages,
} from '../../hooks/usePaginatedConversationMessages';
import { useQueryClient } from '@tanstack/react-query';
import {
  conversationApi,
  extractApiError,
  messageApi,
  userApi,
} from '../../services/api';
import type { Conversation, Message, MessageLinkPreview } from '../../types';
import { formatDateSeparator, formatLastSeen } from '../../utils/formatters';
import {
  getCachedConversationById,
  saveCachedConversation,
} from '../../utils/indexedDb';
import {
  CACHE_TIMES,
  queryKeys,
  removeConversationFromCaches,
  syncMessageDeleteCaches,
  syncMessageEditCaches,
  syncReactionCaches,
} from '../../utils/queryClient';

export function MessageScreen({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const { user, setAuthenticatedUser } = useAuth();
  const { startCall } = useCall();
  const { socket, presenceMap, typingMap } = useSocket();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id || '';

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Conversation[]>([]);
  const [galleryPreview, setGalleryPreview] = useState<{
    message: Message;
    index: number;
  } | null>(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatQuery, setInChatQuery] = useState('');
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [jumpedMessageId, setJumpedMessageId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  const {
    messages,
    setMessages,
    hasMore,
    setHasMore,
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
    markInitialScrollPending,
  } = usePaginatedConversationMessages({
    conversationId,
    userId,
    highlightId,
    onError: (msg) => showToast(msg, 'error'),
  });

  const {
    sendOutgoingMessage,
    retryFailedMessage,
    dismissFailedMessage,
    scheduleCleanupLocalResources,
  } = useOptimisticChatSender({
    conversationId,
    user,
    socket,
    hasNewerMessages,
    setHasNewerMessages,
    setMessages,
    setHasMore,
    setNextCursor,
    onScrollToBottom: () => scrollToBottom('smooth'),
  });

  const emitReadIfVisible = useCallback(() => {
    if (!socket) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    socket.emit('message:read', { conversationId });
  }, [socket, conversationId]);

  const loadThread = useCallback(async () => {
    setError(null);
    let hydrated = false;
    let skipMessagesFetch = false;
    let hydratedIds = new Set<string>();

    if (userId && !highlightId) {
      const memConv = qc.getQueryData<Conversation>(
        queryKeys.conversation(userId, conversationId)
      );
      const cachedConv =
        memConv || (await getCachedConversationById(userId, conversationId));
      if (cachedConv) {
        setConversation(cachedConv);
        hydrated = true;
        setLoading(false);
      }

      const cacheRes = await hydrateCachedThread(cachedConv?.lastMessage?.messageId);
      if (cacheRes.hydrated) {
        hydrated = true;
        hydratedIds = cacheRes.hydratedIds;
        setLoading(false);
      }
      skipMessagesFetch = cacheRes.skipNetworkFetch && Boolean(cachedConv);
    }

    if (!hydrated) {
      setLoading(true);
    }

    try {
      const convData = await qc.fetchQuery({
        queryKey: queryKeys.conversation(userId || 'anon', conversationId),
        staleTime: CACHE_TIMES.conversationDetail.staleTime,
        queryFn: () => conversationApi.getById(conversationId),
      });
      setConversation(convData);
      if (userId) {
        void saveCachedConversation(userId, convData);
      }

      const isOffline =
        typeof navigator !== 'undefined' && navigator.onLine === false;
      const convHasNewerLastMsg = Boolean(
        !isOffline &&
          convData.lastMessage?.messageId &&
          !hydratedIds.has(convData.lastMessage.messageId)
      );
      const shouldFetchMessages =
        !skipMessagesFetch || convHasNewerLastMsg || Boolean(highlightId);

      if (shouldFetchMessages) {
        const msgData = highlightId
          ? await messageApi
              .getAround(conversationId, highlightId)
              .catch(() => messageApi.list(conversationId, { limit: MESSAGE_PAGE_SIZE }))
          : await messageApi.list(conversationId, { limit: MESSAGE_PAGE_SIZE });

        await applyServerPage(msgData, { isHighlightView: Boolean(highlightId) });
      }

      if (highlightId) {
        setPendingScrollId(highlightId);
        setJumpedMessageId(highlightId);
      }

      socket?.emit('group:join', { conversationId });
      emitReadIfVisible();
    } catch (err) {
      if (!hydrated) {
        setError(extractApiError(err).message);
      }
    } finally {
      setLoading(false);
    }
  }, [
    conversationId,
    highlightId,
    socket,
    emitReadIfVisible,
    userId,
    qc,
    hydrateCachedThread,
    applyServerPage,
  ]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        emitReadIfVisible();
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [emitReadIfVisible]);

  useEffect(() => {
    const refreshConversationMeta = async () => {
      try {
        const fresh = await conversationApi.getById(conversationId);
        setConversation(fresh);
      } catch {
        // Ignore background refresh error
      }
    };
    window.addEventListener('blinkupz:relationship-updated', refreshConversationMeta);
    return () => {
      window.removeEventListener('blinkupz:relationship-updated', refreshConversationMeta);
    };
  }, [conversationId]);

  // Deterministic scroll when pendingScrollId or messages commit
  useEffect(() => {
    if (loading) return;
    if (pendingScrollId) {
      const el = document.getElementById(`msg-${pendingScrollId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPendingScrollId(null);
      }
    }
  }, [loading, messages, pendingScrollId]);

  useEffect(() => {
    if (!socket) return;

    const onNewMessage = (msg: Message) => {
      if (msg.conversationId !== conversationId) return;
      scheduleCleanupLocalResources(msg.clientMessageId, false);
      appendRealtimeMessage(msg);
      if (msg.senderId !== user?.id) {
        emitReadIfVisible();
      }
    };

    const onEditMessage = (updated: Message) => {
      if (updated.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    };

    const onMessageLinks = (payload: {
      id: string;
      conversationId: string;
      links: MessageLinkPreview[];
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.id ? { ...m, links: payload.links } : m))
      );
    };

    const onDeleteMessage = (payload: {
      id: string;
      conversationId: string;
      deletedAt: string;
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? {
                ...m,
                deletedAt: payload.deletedAt,
                content: 'This message was deleted',
                attachments: [],
                reactions: [],
              }
            : m
        )
      );
    };

    const onDelivered = (payload: {
      conversationId: string;
      messageIds: string[];
      userId?: string;
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (!payload.messageIds.includes(m.id)) return m;
          const nextDeliveredTo =
            payload.userId && !m.deliveredTo.includes(payload.userId)
              ? [...m.deliveredTo, payload.userId]
              : m.deliveredTo;
          return {
            ...m,
            deliveredTo: nextDeliveredTo,
            deliveryStatus: m.deliveryStatus === 'sent' ? 'delivered' : m.deliveryStatus,
          };
        })
      );
    };

    const onRead = (payload: {
      conversationId: string;
      messageIds: string[];
      userId: string;
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          payload.messageIds.includes(m.id)
            ? {
                ...m,
                deliveryStatus: 'read',
                deliveredTo: m.deliveredTo.includes(payload.userId)
                  ? m.deliveredTo
                  : [...m.deliveredTo, payload.userId],
                readBy: m.readBy.includes(payload.userId)
                  ? m.readBy
                  : [...m.readBy, payload.userId],
              }
            : m
        )
      );
    };

    const onReaction = (payload: {
      messageId: string;
      conversationId: string;
      reactions: Array<{ emoji: string; userIds: string[] }>;
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
        )
      );
    };

    const onConvUpdated = (payload: {
      conversationId: string;
      pinnedMessage?: Conversation['pinnedMessage'];
    }) => {
      if (payload.conversationId !== conversationId) return;
      setConversation((prev) =>
        prev ? { ...prev, pinnedMessage: payload.pinnedMessage || null } : prev
      );
    };

    socket.on('message:new', onNewMessage);
    socket.on('message:edit', onEditMessage);
    socket.on('message:links', onMessageLinks);
    socket.on('message:delete', onDeleteMessage);
    socket.on('message:delivered', onDelivered);
    socket.on('message:read', onRead);
    socket.on('reaction:add', onReaction);
    socket.on('reaction:remove', onReaction);
    socket.on('conversation:updated', onConvUpdated);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:edit', onEditMessage);
      socket.off('message:links', onMessageLinks);
      socket.off('message:delete', onDeleteMessage);
      socket.off('message:delivered', onDelivered);
      socket.off('message:read', onRead);
      socket.off('reaction:add', onReaction);
      socket.off('reaction:remove', onReaction);
      socket.off('conversation:updated', onConvUpdated);
    };
  }, [
    socket,
    conversationId,
    user?.id,
    scheduleCleanupLocalResources,
    appendRealtimeMessage,
    emitReadIfVisible,
    setMessages,
  ]);

  const handleSendMessage = (payload: OutgoingMessagePayload) => {
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    sendOutgoingMessage(payload, replySnapshot);
  };

  const handleSaveEdit = async (
    messageId: string,
    content: string,
    attachmentCaptions?: Array<{ index: number; caption: string }>
  ) => {
    const updated = await messageApi.edit(messageId, content, attachmentCaptions);
    setEditingMessage(null);
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    if (userId) {
      syncMessageEditCaches(userId, updated);
    }
    window.dispatchEvent(
      new CustomEvent('blinkupz:shared-media-refresh', { detail: { conversationId } })
    );
  };

  const handleDeleteMessage = async (msg: Message, scope: 'everyone' | 'me') => {
    try {
      await messageApi.delete(msg.id, scope);
      const deletedAt = new Date().toISOString();
      if (scope === 'me') {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? {
                  ...m,
                  deletedAt,
                  content: 'This message was deleted',
                  attachments: [],
                  reactions: [],
                }
              : m
          )
        );
      }
      if (userId) {
        syncMessageDeleteCaches(userId, {
          id: msg.id,
          conversationId,
          deletedAt,
          scope,
        });
      }
      window.dispatchEvent(
        new CustomEvent('blinkupz:shared-media-refresh', { detail: { conversationId } })
      );
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleReaction = async (msg: Message, emoji: string) => {
    try {
      const res = await messageApi.toggleReaction(msg.id, emoji);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, reactions: res.reactions } : m
        )
      );
      if (userId) {
        syncReactionCaches(userId, {
          messageId: msg.id,
          conversationId,
          reactions: res.reactions,
        });
      }
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const openForwardModal = async (msg: Message) => {
    setForwardingMessage(msg);
    try {
      const convs = await conversationApi.list('all');
      setForwardTargets(convs.filter((c) => c.id !== conversationId));
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleConfirmForward = async (targetConvId: string) => {
    if (!forwardingMessage) return;
    try {
      await messageApi.send({
        conversationId: targetConvId,
        content: forwardingMessage.content,
        messageType:
          forwardingMessage.messageType === 'system' ||
          forwardingMessage.messageType === 'call_event'
            ? 'text'
            : forwardingMessage.messageType,
        attachments: forwardingMessage.attachments,
        forwardedFrom: {
          messageId: forwardingMessage.id,
          senderName: forwardingMessage.sender?.fullName || 'BlinkUpZ User',
        },
      });
      setForwardingMessage(null);
      showToast('Message forwarded.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleJumpToMessage = async (messageId: string) => {
    if (window.innerWidth < 1024) {
      setSharedMediaOpen(false);
    }
    setInChatSearchOpen(false);
    setInChatQuery('');

    setJumpedMessageId(messageId);
    setTimeout(() => {
      setJumpedMessageId((curr) => (curr === messageId ? null : curr));
    }, 2600);

    if (messages.some((m) => m.id === messageId)) {
      setPendingScrollId(messageId);
      return;
    }

    try {
      const around = await messageApi.getAround(conversationId, messageId);
      setMessages(around.messages);
      setHasMore(around.hasMore);
      setNextCursor(around.nextCursor ?? null);
      setHasNewerMessages(Boolean(around.hasNewer));
      setPendingScrollId(messageId);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleBackToLatest = async () => {
    try {
      markInitialScrollPending();
      const latest = await messageApi.list(conversationId, { limit: MESSAGE_PAGE_SIZE });
      await applyServerPage(latest, { isHighlightView: false });
      requestAnimationFrame(() => {
        scrollToBottom('smooth');
      });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#181818]">
        <div className="h-16 border-b border-[#303030] px-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#242424] animate-pulse" />
          <div className="h-4 w-32 rounded bg-[#242424] animate-pulse" />
        </div>
        <LoadingState rows={6} />
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#181818]">
        <ErrorState
          message={error || 'Conversation unavailable.'}
          onRetry={loadThread}
        />
      </div>
    );
  }

  const peer =
    conversation.type === 'direct'
      ? conversation.participants.find((p) => p.userId !== user?.id)
      : null;
  const isBlockedPair = Boolean(
    conversation.type === 'direct' &&
      (conversation.isBlockedByMe || conversation.hasBlockedMe)
  );
  const peerLive = peer ? presenceMap[peer.userId] : undefined;
  const peerOnline = isBlockedPair
    ? false
    : peerLive
      ? peerLive.onlineStatus
      : conversation.onlineStatus;
  const peerLastSeen = isBlockedPair
    ? null
    : peerLive
      ? peerLive.lastSeen
      : conversation.lastSeen;
  const peerLastSeenHidden = Boolean(
    isBlockedPair ||
      peerLive?.lastSeenHidden ||
      conversation.peerPrivacy?.lastSeenHidden
  );

  const typingList = isBlockedPair ? [] : typingMap[conversationId] || [];
  let subtitle = '';
  if (isBlockedPair) {
    subtitle = conversation.isBlockedByMe ? 'Blocked' : 'Messaging unavailable';
  } else if (typingList.length > 0) {
    subtitle =
      conversation.type === 'direct'
        ? 'typing...'
        : `${typingList.map((t) => t.username).join(', ')} typing...`;
  } else if (conversation.type === 'direct') {
    subtitle = peerOnline
      ? 'Online'
      : formatLastSeen(peerLastSeen, peerLastSeenHidden);
  } else {
    subtitle = `${conversation.participants.length} members`;
  }

  const handleToggleBlockPeer = async () => {
    if (!peer) return;
    setBlockBusy(true);
    try {
      if (conversation.isBlockedByMe) {
        const res = await userApi.unblockUser(peer.userId);
        if (res.data.user) setAuthenticatedUser(res.data.user);
        showToast(`${conversation.name} unblocked.`, 'success');
      } else {
        const res = await userApi.blockUser(peer.userId);
        if (res.data.user) setAuthenticatedUser(res.data.user);
        showToast(`${conversation.name} blocked.`, 'info');
      }
      setBlockModalOpen(false);
      const fresh = await conversationApi.getById(conversationId);
      setConversation(fresh);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setBlockBusy(false);
    }
  };

  const filteredMessages = inChatQuery.trim()
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(inChatQuery.trim().toLowerCase())
      )
    : messages;

  const roleMap: Record<string, string> = {};
  conversation.participants.forEach((p) => {
    roleMap[p.userId] = p.role;
  });
  const myRole = roleMap[user?.id || ''] || 'member';
  const canModerate =
    conversation.type !== 'direct' &&
    ['owner', 'admin', 'moderator'].includes(myRole);

  const activeHighlightId = jumpedMessageId || highlightId;

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-[#181818]">
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#181818]">
      {/* Header */}
      <header className="min-h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-3 border-b border-[#303030] bg-[#181818] shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate('/chats')}
            aria-label="Back to chats"
            className="md:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <UserAvatar
            src={conversation.avatar}
            name={conversation.name}
            size="sm"
            online={conversation.type === 'direct' && peerOnline}
          />

          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-semibold text-[#FFFFFF] truncate">
              {conversation.name}
            </h2>
            <p
              className={`text-xs truncate ${
                typingList.length > 0 || peerOnline
                  ? 'text-[#22C55E]'
                  : 'text-[#999999]'
              }`}
            >
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {conversation.type === 'direct' && peer && (
            <>
              <button
                type="button"
                disabled={isBlockedPair}
                onClick={() => {
                  if (isBlockedPair) {
                    showToast('Cannot call a blocked contact.', 'error');
                    return;
                  }
                  void startCall({
                    recipientId: peer.userId,
                    callType: 'voice',
                    conversationId,
                    peerHint: {
                      id: peer.userId,
                      fullName: conversation.name,
                      username: conversation.username,
                      avatar: conversation.avatar,
                    },
                  });
                }}
                aria-label="Voice call"
                title={isBlockedPair ? 'Calling unavailable' : 'Start voice call'}
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={isBlockedPair}
                onClick={() => {
                  if (isBlockedPair) {
                    showToast('Cannot call a blocked contact.', 'error');
                    return;
                  }
                  void startCall({
                    recipientId: peer.userId,
                    callType: 'video',
                    conversationId,
                    peerHint: {
                      id: peer.userId,
                      fullName: conversation.name,
                      username: conversation.username,
                      avatar: conversation.avatar,
                    },
                  });
                }}
                aria-label="Video call"
                title={isBlockedPair ? 'Calling unavailable' : 'Start video call'}
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Video className="w-4 h-4" />
              </button>
            </>
          )}

          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label="Conversation menu"
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            }
            options={[
              ...(conversation.type === 'direct' && conversation.username
                ? [
                    {
                      label: 'View profile',
                      icon: <UserIcon className="w-4 h-4" />,
                      onClick: () => navigate(`/u/${conversation.username}`),
                    },
                  ]
                : []),
              {
                label: inChatSearchOpen ? 'Close search' : 'Search messages',
                icon: <Search className="w-4 h-4" />,
                onClick: () => {
                  setInChatSearchOpen((p) => !p);
                  setInChatQuery('');
                },
              },
              {
                label: sharedMediaOpen ? 'Close shared media' : 'Shared media',
                icon: <Images className="w-4 h-4" />,
                onClick: () => setSharedMediaOpen((p) => !p),
              },
              {
                label: conversation.isPinned ? 'Unpin chat' : 'Pin chat',
                icon: <Pin className="w-4 h-4" />,
                onClick: async () => {
                  const next = await conversationApi.updateMeta(
                    conversation.id,
                    conversation.isPinned ? 'unpin' : 'pin'
                  );
                  setConversation(next);
                  showToast(next.isPinned ? 'Chat pinned' : 'Chat unpinned', 'success');
                },
              },
              {
                label: conversation.isMuted ? 'Unmute chat' : 'Mute chat',
                icon: <BellOff className="w-4 h-4" />,
                onClick: async () => {
                  const next = await conversationApi.updateMeta(
                    conversation.id,
                    conversation.isMuted ? 'unmute' : 'mute'
                  );
                  setConversation(next);
                  showToast(next.isMuted ? 'Chat muted' : 'Chat unmuted', 'success');
                },
              },
              ...(conversation.type === 'direct' && peer
                ? [
                    {
                      label: conversation.isBlockedByMe
                        ? 'Unblock contact'
                        : 'Block contact',
                      icon: conversation.isBlockedByMe ? (
                        <ShieldCheck className="w-4 h-4" />
                      ) : (
                        <Ban className="w-4 h-4" />
                      ),
                      danger: !conversation.isBlockedByMe,
                      onClick: () => setBlockModalOpen(true),
                    },
                  ]
                : []),
              {
                label: 'Delete chat',
                icon: <Trash2 className="w-4 h-4" />,
                danger: true,
                onClick: async () => {
                  await conversationApi.delete(conversation.id);
                  if (userId) {
                    removeConversationFromCaches(userId, conversation.id);
                  }
                  showToast('Conversation removed.', 'info');
                  navigate('/chats', { replace: true });
                },
              },
            ]}
          />
        </div>
      </header>

      {inChatSearchOpen && (
        <div className="px-4 py-2 border-b border-[#303030] bg-[#202020] flex items-center gap-2 shrink-0">
          <Search className="w-4 h-4 text-[#999999]" />
          <input
            type="text"
            autoFocus
            value={inChatQuery}
            onChange={(e) => setInChatQuery(e.target.value)}
            placeholder="Filter messages in this conversation..."
            className="flex-1 bg-transparent text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setInChatSearchOpen(false);
              setInChatQuery('');
            }}
            aria-label="Close search"
            className="text-[#999999] hover:text-white p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {conversation.pinnedMessage && (
        <div className="px-4 py-2 border-b border-[#303030] bg-[#202020] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Pin className="w-3.5 h-3.5 text-[#999999] shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#999999]">Pinned message</p>
              <p className="text-xs text-[#FFFFFF] truncate">
                {conversation.pinnedMessage.content || conversation.pinnedMessage.messageType}
              </p>
            </div>
          </div>
          {canModerate && (
            <button
              type="button"
              onClick={async () => {
                const next = await conversationApi.updateMeta(
                  conversation.id,
                  'unpinMessage'
                );
                setConversation(next);
              }}
              aria-label="Unpin message"
              className="text-[#999999] hover:text-white p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Message List */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden py-4 [overflow-anchor:none]"
        >
          <div ref={contentWrapperRef} className="space-y-1">
            {loadingOlder ? (
              <div className="flex items-center justify-center gap-2 py-2.5 text-xs text-[#999999]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading older messages...</span>
              </div>
            ) : hasMore ? (
              <div className="flex justify-center pb-2">
                <PrimaryButton
                  variant="secondary"
                  onClick={() => void loadOlder()}
                  className="text-xs min-h-[32px] py-1 px-3"
                >
                  Load older messages
                </PrimaryButton>
              </div>
            ) : filteredMessages.length > 0 && !inChatQuery.trim() ? (
              <div className="flex justify-center pb-2.5">
                <span className="text-[11px] text-[#999999] px-3 py-1 rounded-lg bg-[#202020] border border-[#303030]">
                  Beginning of conversation
                </span>
              </div>
            ) : null}

            {filteredMessages.length === 0 ? (
              <EmptyState
                title="No messages yet"
                description="Send a message, voice note, or file to start the conversation."
              />
            ) : (
              filteredMessages.map((msg, index) => {
                const prevMsg = index > 0 ? filteredMessages[index - 1] : null;
                const prevDate = prevMsg
                  ? new Date(prevMsg.createdAt).toDateString()
                  : null;
                const currDate = new Date(msg.createdAt).toDateString();
                const showDateSeparator = prevDate !== currDate;

                return (
                  <React.Fragment key={msg.id}>
                    {showDateSeparator && (
                      <div className="flex justify-center py-3">
                        <span className="text-[11px] font-mono text-[#999999] px-3 py-1 rounded-lg bg-[#202020] border border-[#303030]">
                          {formatDateSeparator(msg.createdAt)}
                        </span>
                      </div>
                    )}

                    <MessageBubble
                      message={msg}
                      isOwn={msg.senderId === user?.id}
                      isGroup={conversation.type !== 'direct'}
                      senderRole={roleMap[msg.senderId]}
                      canModerate={canModerate}
                      highlighted={activeHighlightId === msg.id}
                      compact={user?.settings?.density === 'compact'}
                      onReply={(m) => {
                        setEditingMessage(null);
                        setReplyingTo(m);
                      }}
                      onForward={openForwardModal}
                      onEdit={(m) => {
                        setReplyingTo(null);
                        setEditingMessage(m);
                      }}
                      onDelete={handleDeleteMessage}
                      onReact={handleReaction}
                      onPin={
                        canModerate
                          ? async (m) => {
                              const next = await conversationApi.updateMeta(
                                conversation.id,
                                'pinMessage',
                                m.id
                              );
                              setConversation(next);
                              showToast('Message pinned.', 'success');
                            }
                          : undefined
                      }
                      onCopy={(text) => {
                        navigator.clipboard?.writeText(text);
                        showToast('Copied to clipboard.', 'info');
                      }}
                      onPreviewMedia={(m, idx) => setGalleryPreview({ message: m, index: idx })}
                      onRetry={retryFailedMessage}
                      onDismissFailed={dismissFailedMessage}
                    />
                  </React.Fragment>
                );
              })
            )}
            {hasNewerMessages && (
              <div className="flex justify-center pt-3">
                <PrimaryButton
                  variant="secondary"
                  onClick={handleBackToLatest}
                  className="text-xs min-h-[36px] py-1.5 px-3.5"
                >
                  Back to latest messages
                </PrimaryButton>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {unseenNewCount > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-3 right-4 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#242424] border border-[#303030] text-xs font-medium text-[#FFFFFF] shadow-lg hover:bg-[#303030] transition-colors cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>
              {unseenNewCount} new {unseenNewCount === 1 ? 'message' : 'messages'}
            </span>
          </button>
        )}
      </div>

      {/* Composer or Blocked Notice */}
      {isBlockedPair ? (
        <div className="px-4 py-3.5 border-t border-[#303030] bg-[#202020] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Ban className="w-4 h-4 text-[#E5484D] shrink-0" />
            <p className="text-xs sm:text-sm text-[#999999]">
              {conversation.isBlockedByMe
                ? 'You blocked this contact. Unblock them to send messages.'
                : 'You cannot send messages to this contact.'}
            </p>
          </div>
          {conversation.isBlockedByMe && (
            <PrimaryButton
              variant="secondary"
              onClick={() => setBlockModalOpen(true)}
              className="min-h-[34px] py-1 px-3 text-xs shrink-0"
            >
              Unblock
            </PrimaryButton>
          )}
        </div>
      ) : (
        <MessageInput
          enterToSend={user?.settings?.enterToSend ?? true}
          replyingTo={replyingTo}
          editingMessage={editingMessage}
          onCancelReply={() => setReplyingTo(null)}
          onCancelEdit={() => setEditingMessage(null)}
          onTypingStart={() => {
            if (user?.settings?.typingIndicators !== false) {
              socket?.emit('typing:start', { conversationId });
            }
          }}
          onTypingStop={() => {
            socket?.emit('typing:stop', { conversationId });
          }}
          onSendMessage={handleSendMessage}
          onSaveEdit={handleSaveEdit}
        />
      )}

      {/* Forward Modal */}
      <Modal
        open={forwardingMessage !== null}
        onClose={() => setForwardingMessage(null)}
        title="Forward message to..."
      >
        {forwardTargets.length === 0 ? (
          <p className="text-sm text-[#999999] py-4 text-center">
            No other conversations available. Start a new chat first.
          </p>
        ) : (
          <div className="space-y-1">
            {forwardTargets.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => handleConfirmForward(target.id)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#242424] transition-colors text-left cursor-pointer"
              >
                <UserAvatar src={target.avatar} name={target.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#FFFFFF] truncate">
                    {target.name}
                  </p>
                  <p className="text-xs text-[#999999] capitalize">{target.type}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <MediaGalleryModal
        message={galleryPreview?.message || null}
        initialIndex={galleryPreview?.index || 0}
        onClose={() => setGalleryPreview(null)}
      />
      </div>

      <SharedMediaPanel
        conversationId={conversationId}
        open={sharedMediaOpen}
        onClose={() => setSharedMediaOpen(false)}
        onJumpToMessage={handleJumpToMessage}
      />

      {/* Block / Unblock Confirmation Modal */}
      {peer && (
        <Modal
          open={blockModalOpen}
          onClose={() => setBlockModalOpen(false)}
          title={
            conversation.isBlockedByMe
              ? `Unblock ${conversation.name}?`
              : `Block ${conversation.name}?`
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[#999999] leading-relaxed">
              {conversation.isBlockedByMe
                ? `${conversation.name} will be able to message you and see your profile info according to your privacy settings.`
                : `${conversation.name} will no longer be able to send you messages, start conversations, or see your online status and profile details.`}
            </p>
            <div className="flex justify-end gap-2">
              <PrimaryButton
                variant="secondary"
                onClick={() => setBlockModalOpen(false)}
              >
                Cancel
              </PrimaryButton>
              <PrimaryButton
                variant={conversation.isBlockedByMe ? 'primary' : 'danger'}
                loading={blockBusy}
                onClick={handleToggleBlockPeer}
              >
                {conversation.isBlockedByMe ? 'Unblock' : 'Block Contact'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
