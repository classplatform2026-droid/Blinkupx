import { useCallback, useEffect, useState } from 'react';
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
import { MessageScreen } from './MessageScreen';

type FilterTab = 'all' | 'unread' | 'groups' | 'archived';

export function ChatsPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, presenceMap, typingMap } = useSocket();
  const { showToast } = useToast();

  const [filter, setFilter] = useState<FilterTab>('all');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setError(null);
    try {
      const data = await conversationApi.list(filter);
      setConversations(data);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      loadConversations();
    };
    socket.on('message:new', refresh);
    socket.on('message:edit', refresh);
    socket.on('message:delete', refresh);
    socket.on('message:read', refresh);
    socket.on('conversation:activity', refresh);
    socket.on('conversation:new', refresh);
    window.addEventListener('blinkupz:relationship-updated', refresh);

    return () => {
      socket.off('message:new', refresh);
      socket.off('message:edit', refresh);
      socket.off('message:delete', refresh);
      socket.off('message:read', refresh);
      socket.off('conversation:activity', refresh);
      socket.off('conversation:new', refresh);
      window.removeEventListener('blinkupz:relationship-updated', refresh);
    };
  }, [socket, loadConversations]);

  const handleConversationAction = async (
    convId: string,
    action: 'pin' | 'unpin' | 'mute' | 'unmute' | 'archive' | 'delete'
  ) => {
    try {
      if (action === 'delete') {
        await conversationApi.delete(convId);
        showToast('Conversation removed.', 'info');
        if (conversationId === convId) {
          navigate('/chats', { replace: true });
        }
      } else {
        await conversationApi.updateMeta(convId, action);
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
      loadConversations();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await conversationApi.markAllRead();
      showToast('All chats marked as read.', 'success');
      loadConversations();
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
          {loading ? (
            <LoadingState rows={6} />
          ) : error ? (
            <ErrorState message={error} onRetry={loadConversations} />
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
              const typingText =
                typingList.length > 0
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
