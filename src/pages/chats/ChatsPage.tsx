import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CheckCheck,
  MessageSquarePlus,
  MoreVertical,
  Search,
  Settings,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { ChatListItem } from '../../components/ChatListItem';
import { DropdownMenu } from '../../components/DropdownMenu';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { conversationApi, extractApiError } from '../../services/api';
import type { Conversation } from '../../types';
import {
  getCachedConversations,
  saveCachedConversation,
  saveCachedConversations,
} from '../../utils/indexedDb';
import {
  CACHE_TIMES,
  queryKeys,
  removeConversationFromCaches,
} from '../../utils/queryClient';
import { MessageScreen } from './MessageScreen';

type FilterTab = 'all' | 'unread' | 'groups' | 'archived';

export function ChatsPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, presenceMap, typingMap, aiStatusMap } = useSocket();
  const { showToast } = useToast();
  const qc = useQueryClient();

  const userId = user?.id || '';
  const [filter, setFilter] = useState<FilterTab>('all');
  const [idbSeed, setIdbSeed] = useState<Conversation[] | null>(null);

  // Instant IndexedDB hydration on mount/filter switch so cached conversations appear immediately
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getCachedConversations(userId, filter).then((cached) => {
      if (!active) return;
      setIdbSeed(cached);
      if (cached.length > 0) {
        const key = queryKeys.conversations(userId, filter);
        if (!qc.getQueryData(key)) {
          qc.setQueryData(key, cached);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [userId, filter, qc]);

  const {
    data: queryConversations,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.conversations(userId, filter),
    enabled: Boolean(userId),
    staleTime: CACHE_TIMES.conversations.staleTime,
    gcTime: CACHE_TIMES.conversations.gcTime,
    queryFn: async () => {
      try {
        const fresh = await conversationApi.list(filter);
        void saveCachedConversations(userId, fresh);
        return fresh;
      } catch (err) {
        // Offline or network drop: return IndexedDB cached list if available
        const cached = await getCachedConversations(userId, filter);
        if (cached.length > 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          return cached;
        }
        throw err;
      }
    },
  });

  const conversations = queryConversations ?? idbSeed ?? [];
  const showLoading = isLoading && conversations.length === 0 && idbSeed === null;
  const errorMsg =
    queryError && conversations.length === 0
      ? extractApiError(queryError).message
      : null;

  useEffect(() => {
    if (!userId) return;
    const handleRefresh = () => {
      void qc.invalidateQueries({ queryKey: queryKeys.conversationsPrefix(userId) });
    };
    window.addEventListener('blinkupz:relationship-updated', handleRefresh);
    return () => {
      window.removeEventListener('blinkupz:relationship-updated', handleRefresh);
    };
  }, [userId, qc]);

  // Also trigger refetch cleanly if socket reconnects
  useEffect(() => {
    if (!socket || !userId) return;
    const onReconnect = () => {
      void qc.invalidateQueries({ queryKey: queryKeys.conversationsPrefix(userId) });
    };
    socket.on('connect', onReconnect);
    return () => {
      socket.off('connect', onReconnect);
    };
  }, [socket, userId, qc]);

  const handleConversationAction = async (
    convId: string,
    action: 'pin' | 'unpin' | 'mute' | 'unmute' | 'archive' | 'delete'
  ) => {
    try {
      if (action === 'delete') {
        await conversationApi.delete(convId);
        removeConversationFromCaches(userId, convId);
        showToast('Conversation removed.', 'info');
        if (conversationId === convId) {
          navigate('/chats', { replace: true });
        }
      } else {
        const updated = await conversationApi.updateMeta(convId, action);
        void saveCachedConversation(userId, updated);
        showToast(
          action === 'pin'
            ? 'Chat pinned'
            : action === 'unpin'
              ? 'Chat unpinned'
              : action === 'mute'
                ? 'Notifications muted'
                : action === 'unmute'
                  ? 'Notifications unmuted'
                  : 'Chat archived',
          'success'
        );
      }
      void qc.invalidateQueries({ queryKey: queryKeys.conversationsPrefix(userId) });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await conversationApi.markAllRead();
      showToast('All chats marked as read.', 'success');
      void qc.invalidateQueries({ queryKey: queryKeys.conversationsPrefix(userId) });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const getOnlineStatus = (conv: Conversation): boolean => {
    if (conv.type !== 'direct') return false;
    if (conv.isBlockedByMe || conv.hasBlockedMe) return false;
    const peer = conv.participants.find((p) => p.userId !== user?.id);
    if (peer && presenceMap[peer.userId] !== undefined) {
      return presenceMap[peer.userId].onlineStatus;
    }
    return conv.onlineStatus;
  };

  const showListOnMobile = !conversationId;

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-[#181818]">
      {/* Conversation List Pane */}
      <section
        aria-label="Conversations"
        className={`${
          showListOnMobile ? 'flex' : 'hidden md:flex'
        } flex-col w-full md:w-[340px] lg:w-[370px] shrink-0 h-full border-r border-[#303030] bg-[#181818]`}
      >
        <header className="h-16 px-4 flex items-center justify-between gap-2 border-b border-[#303030] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="md:hidden">
              <BrandMark size={26} />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[#FFFFFF]">
              {filter === 'archived' ? 'Archived' : 'Chats'}
            </h1>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate('/chats/search')}
              aria-label="Search messages, people, and groups"
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/chats/new')}
              aria-label="New chat"
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
            <DropdownMenu
              trigger={
                <button
                  type="button"
                  aria-label="More options"
                  className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              }
              options={[
                {
                  label: 'Mark all as read',
                  icon: <CheckCheck className="w-4 h-4" />,
                  onClick: handleMarkAllRead,
                },
                {
                  label: filter === 'archived' ? 'Back to active chats' : 'Archived chats',
                  icon: <Archive className="w-4 h-4" />,
                  onClick: () =>
                    setFilter((prev) => (prev === 'archived' ? 'all' : 'archived')),
                },
                {
                  label: 'Settings',
                  icon: <Settings className="w-4 h-4" />,
                  onClick: () => navigate('/profile/settings'),
                },
              ]}
            />
          </div>
        </header>

        <div className="px-4 py-2.5 border-b border-[#303030] flex items-center gap-1.5 shrink-0">
          {(['all', 'unread', 'groups'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                filter === tab
                  ? 'bg-[#FFFFFF] text-[#181818]'
                  : 'bg-[#202020] text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {showLoading ? (
            <LoadingState rows={6} />
          ) : errorMsg ? (
            <ErrorState message={errorMsg} onRetry={() => void refetch()} />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MessageSquarePlus className="w-5 h-5" />}
              title={
                filter === 'unread'
                  ? 'No unread messages'
                  : filter === 'groups'
                    ? 'No group chats yet'
                    : filter === 'archived'
                      ? 'No archived chats'
                      : 'No conversations yet'
              }
              description={
                filter === 'all'
                  ? 'Start a 1:1 conversation or create a group to start messaging in real time.'
                  : 'Switch filters or start a new conversation.'
              }
              actionLabel="New Chat"
              onAction={() => navigate('/chats/new')}
            />
          ) : (
            conversations.map((conv) => {
              const typingList = typingMap[conv.id] || [];
              const aiStatus = aiStatusMap[conv.id];
              const typingText =
                aiStatus?.status === 'thinking'
                  ? 'Blink is thinking...'
                  : typingList.length > 0
                    ? `${typingList[0].username} is typing...`
                    : undefined;

              return (
                <ChatListItem
                  key={conv.id}
                  conversation={conv}
                  active={conversationId === conv.id}
                  online={getOnlineStatus(conv)}
                  typingText={typingText}
                  onSelect={() => navigate(`/chats/${conv.id}`)}
                  onAction={(action) => handleConversationAction(conv.id, action)}
                />
              );
            })
          )}
        </div>
      </section>

      {/* Active Message Pane */}
      <section
        aria-label="Active conversation"
        className={`${
          conversationId ? 'flex' : 'hidden md:flex'
        } flex-1 min-w-0 h-full flex-col bg-[#181818]`}
      >
        {conversationId ? (
          <MessageScreen key={conversationId} conversationId={conversationId} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <EmptyState
              icon={<MessageSquarePlus className="w-6 h-6" />}
              title="Select a conversation"
              description="Choose a chat from the list or start a new conversation to message in real time."
              actionLabel="Start New Chat"
              onAction={() => navigate('/chats/new')}
            />
          </div>
        )}
      </section>
    </div>
  );
}
