import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Images,
  Info,
  LogOut,
  MoreVertical,
  Pin,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useOptimisticChatSender } from '../../hooks/useOptimisticChatSender';
import {
  communityApi,
  conversationApi,
  extractApiError,
  messageApi,
} from '../../services/api';
import type {
  CommunityDetail,
  Conversation,
  Message,
  MessageLinkPreview,
} from '../../types';
import { formatDateSeparator } from '../../utils/formatters';
import { reconcileIncomingMessage } from '../../utils/optimisticMessages';

export function GroupChatPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, typingMap } = useSocket();
  const { showToast } = useToast();

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
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

  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [jumpedMessageId, setJumpedMessageId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const convIdForHook = community?.conversationId || '';

  const {
    sendOutgoingMessage,
    retryFailedMessage,
    dismissFailedMessage,
    scheduleCleanupLocalResources,
  } = useOptimisticChatSender({
    conversationId: convIdForHook,
    user,
    socket,
    hasNewerMessages,
    setHasNewerMessages,
    setMessages,
    setHasMore,
    onScrollToBottom: () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
  });

  const loadGroupChat = useCallback(async () => {
    if (!communityId) return;
    setError(null);
    setLoading(true);
    try {
      const commData = await communityApi.getById(communityId);
      setCommunity(commData);

      if (commData.isMember && commData.conversationId) {
        const convData = await conversationApi.getById(commData.conversationId);
        const msgData = highlightId
          ? await messageApi
              .getAround(commData.conversationId, highlightId)
              .catch(() => messageApi.list(commData.conversationId!))
          : await messageApi.list(commData.conversationId);
        setConversation(convData);
        setMessages(msgData.messages);
        setHasMore(msgData.hasMore);
        setHasNewerMessages(Boolean('hasNewer' in msgData && msgData.hasNewer));
        if (highlightId) {
          setPendingScrollId(highlightId);
          setJumpedMessageId(highlightId);
        }

        socket?.emit('group:join', { conversationId: commData.conversationId });
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          socket?.emit('message:read', { conversationId: commData.conversationId });
        }
      }
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [communityId, highlightId, socket]);

  useEffect(() => {
    loadGroupChat();
  }, [loadGroupChat]);

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
    if (!loading && !highlightId && !hasNewerMessages) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [loading, highlightId, hasNewerMessages]);

  const convId = community?.conversationId || '';

  const emitReadIfVisible = useCallback(() => {
    if (!socket || !convId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    socket.emit('message:read', { conversationId: convId });
  }, [socket, convId]);

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
    if (!socket || !convId) return;

    const onNewMessage = (msg: Message) => {
      if (msg.conversationId !== convId) return;
      scheduleCleanupLocalResources(msg.clientMessageId, false);
      if (!hasNewerMessages) {
        setMessages((prev) => reconcileIncomingMessage(prev, msg));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
      }
      if (msg.senderId !== user?.id) {
        emitReadIfVisible();
      }
    };

    const onEditMessage = (updated: Message) => {
      if (updated.conversationId !== convId) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    };

    const onMessageLinks = (payload: {
      id: string;
      conversationId: string;
      links: MessageLinkPreview[];
    }) => {
      if (payload.conversationId !== convId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.id ? { ...m, links: payload.links } : m))
      );
    };

    const onDeleteMessage = (payload: {
      id: string;
      conversationId: string;
      deletedAt: string;
    }) => {
      if (payload.conversationId !== convId) return;
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
      if (payload.conversationId !== convId) return;
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
      if (payload.conversationId !== convId) return;
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
      if (payload.conversationId !== convId) return;
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
      if (payload.conversationId !== convId) return;
      setConversation((prev) =>
        prev ? { ...prev, pinnedMessage: payload.pinnedMessage || null } : prev
      );
    };

    const onMemberChange = () => {
      loadGroupChat();
    };

    const onCommunityUpdated = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        loadGroupChat();
      }
    };

    const onCommunityDeleted = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        navigate('/community', { replace: true });
      }
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
    socket.on('group:join', onMemberChange);
    socket.on('group:leave', onMemberChange);
    socket.on('community:updated', onCommunityUpdated);
    socket.on('community:deleted', onCommunityDeleted);
    socket.on('community:removed', onCommunityDeleted);

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
      socket.off('group:join', onMemberChange);
      socket.off('group:leave', onMemberChange);
      socket.off('community:updated', onCommunityUpdated);
      socket.off('community:deleted', onCommunityDeleted);
      socket.off('community:removed', onCommunityDeleted);
    };
  }, [
    socket,
    convId,
    user?.id,
    loadGroupChat,
    communityId,
    navigate,
    hasNewerMessages,
    scheduleCleanupLocalResources,
    emitReadIfVisible,
  ]);

  const handleLeaveCommunity = async () => {
    if (!community) return;
    try {
      await communityApi.leave(community.id);
      socket?.emit('group:leave', { conversationId: convId });
      showToast(`Left ${community.name}.`, 'info');
      navigate('/community', { replace: true });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleJumpToMessage = async (messageId: string) => {
    if (!convId) return;
    if (window.innerWidth < 1024) {
      setSharedMediaOpen(false);
    }
    setSearchOpen(false);
    setSearchQuery('');

    setJumpedMessageId(messageId);
    setTimeout(() => {
      setJumpedMessageId((curr) => (curr === messageId ? null : curr));
    }, 2600);

    if (messages.some((m) => m.id === messageId)) {
      setPendingScrollId(messageId);
      return;
    }

    try {
      const around = await messageApi.getAround(convId, messageId);
      setMessages(around.messages);
      setHasMore(around.hasMore);
      setHasNewerMessages(Boolean(around.hasNewer));
      setPendingScrollId(messageId);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleSendMessage = (payload: OutgoingMessagePayload) => {
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    sendOutgoingMessage(payload, replySnapshot);
  };

  const handleBackToLatest = async () => {
    if (!convId) return;
    try {
      const latest = await messageApi.list(convId);
      setMessages(latest.messages);
      setHasMore(latest.hasMore);
      setHasNewerMessages(false);
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 40);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-[#181818]">
        <LoadingState rows={6} />
      </div>
    );
  }

  if (error || !community) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#181818]">
        <ErrorState
          message={error || 'Community not found.'}
          onRetry={loadGroupChat}
        />
      </div>
    );
  }

  if (!community.isMember) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#181818] p-6">
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title={community.name}
          description={
            community.description ||
            'Join this community to participate in real-time group discussions.'
          }
          actionLabel="View Community Details"
          onAction={() => navigate(`/community/${community.id}/details`)}
        />
      </div>
    );
  }

  const roleMap: Record<string, string> = {};
  community.members.forEach((m) => {
    roleMap[m.user.id] = m.role;
  });

  const canModerate = Boolean(
    community.myRole && ['owner', 'admin', 'moderator'].includes(community.myRole)
  );
  const canPin = Boolean(
    community.myRole &&
      (community.settings?.whoCanPinMessages === 'admins'
        ? ['owner', 'admin'].includes(community.myRole)
        : ['owner', 'admin', 'moderator'].includes(community.myRole))
  );
  const canSend =
    community.settings?.whoCanPost !== 'moderators_only' || canModerate;
  const isOwner = community.myRole === 'owner';

  const typingList = typingMap[convId] || [];
  const filteredMessages = searchQuery.trim()
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : messages;

  return (
    <div className="flex-1 flex h-full bg-[#181818] overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 h-full bg-[#181818] overflow-hidden">
      <header className="h-16 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-3 border-b border-[#303030] shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate('/community')}
            aria-label="Back to communities"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => navigate(`/community/${community.id}/details`)}
            className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 text-left cursor-pointer hover:opacity-90 transition-opacity"
          >
            <UserAvatar src={community.image} name={community.name} size="sm" />
            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-base font-semibold text-[#FFFFFF] truncate">
                {community.name}
              </h1>
              <p className="text-xs text-[#999999] font-mono tabular-nums truncate">
                {typingList.length > 0 ? (
                  <span className="text-[#22C55E] font-sans">
                    {typingList[0].username} is typing...
                  </span>
                ) : (
                  `${community.memberCount} members · ${community.privacy}`
                )}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label="More options"
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            }
            options={[
              {
                label: 'Community details',
                icon: <Info className="w-4 h-4" />,
                onClick: () => navigate(`/community/${community.id}/details`),
              },
              {
                label: 'Members & Roles',
                icon: <Shield className="w-4 h-4" />,
                onClick: () => navigate(`/community/${community.id}/members`),
              },
              ...(community.permissions?.canManageSettings
                ? [
                    {
                      label: 'Community settings',
                      icon: <Settings className="w-4 h-4" />,
                      onClick: () => navigate(`/community/${community.id}/settings`),
                    },
                  ]
                : []),
              {
                label: searchOpen ? 'Close search' : 'Search messages',
                icon: <Search className="w-4 h-4" />,
                onClick: () => {
                  setSearchOpen((p) => !p);
                  setSearchQuery('');
                },
              },
              {
                label: sharedMediaOpen ? 'Close shared media' : 'Shared media',
                icon: <Images className="w-4 h-4" />,
                onClick: () => setSharedMediaOpen((p) => !p),
              },
              ...(!isOwner
                ? [
                    {
                      label: 'Leave community',
                      icon: <LogOut className="w-4 h-4" />,
                      danger: true,
                      onClick: () => setLeaveConfirmOpen(true),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </header>

      {searchOpen && (
        <div className="px-4 py-2 border-b border-[#303030] bg-[#202020] flex items-center gap-2 shrink-0">
          <Search className="w-4 h-4 text-[#999999]" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter messages in this community..."
            className="flex-1 bg-transparent text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery('');
            }}
            className="text-[#999999] hover:text-white p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {conversation?.pinnedMessage && (
        <div className="px-4 py-2 border-b border-[#303030] bg-[#202020] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Pin className="w-3.5 h-3.5 text-[#999999] shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-[#999999]">Pinned message</p>
              <p className="text-xs text-[#FFFFFF] truncate">
                {conversation.pinnedMessage.content || conversation.pinnedMessage.messageType}
              </p>
            </div>
          </div>
          {canPin && (
            <button
              type="button"
              onClick={async () => {
                const next = await conversationApi.updateMeta(convId, 'unpinMessage');
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

      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {hasMore && (
          <div className="flex justify-center pb-3">
            <PrimaryButton
              variant="secondary"
              onClick={async () => {
                if (messages.length === 0) return;
                const data = await messageApi.list(convId, messages[0].createdAt);
                setMessages((prev) => [...data.messages, ...prev]);
                setHasMore(data.hasMore);
              }}
              className="text-xs min-h-[36px] py-1.5 px-3.5"
            >
              Load older messages
            </PrimaryButton>
          </div>
        )}

        {filteredMessages.map((msg, idx) => {
          const prev = idx > 0 ? filteredMessages[idx - 1] : null;
          const showDate =
            !prev ||
            new Date(prev.createdAt).toDateString() !==
              new Date(msg.createdAt).toDateString();

          return (
            <React.Fragment key={msg.id}>
              {showDate && (
                <div className="flex justify-center py-3">
                  <span className="text-[11px] font-mono text-[#999999] px-3 py-1 rounded-lg bg-[#202020] border border-[#303030]">
                    {formatDateSeparator(msg.createdAt)}
                  </span>
                </div>
              )}
              <MessageBubble
                message={msg}
                isOwn={msg.senderId === user?.id}
                isGroup
                senderRole={roleMap[msg.senderId]}
                canModerate={canModerate}
                highlighted={jumpedMessageId === msg.id}
                compact={user?.settings?.density === 'compact'}
                onReply={(m) => {
                  setEditingMessage(null);
                  setReplyingTo(m);
                }}
                onForward={async (m) => {
                  setForwardingMessage(m);
                  const convs = await conversationApi.list('all');
                  setForwardTargets(convs.filter((c) => c.id !== convId));
                }}
                onEdit={(m) => {
                  setReplyingTo(null);
                  setEditingMessage(m);
                }}
                onDelete={async (m, scope) => {
                  await messageApi.delete(m.id, scope);
                  if (scope === 'me') {
                    setMessages((prev) => prev.filter((item) => item.id !== m.id));
                  }
                  window.dispatchEvent(
                    new CustomEvent('blinkupz:shared-media-refresh', {
                      detail: { conversationId: convId },
                    })
                  );
                }}
                onReact={async (m, emoji) => {
                  const res = await messageApi.toggleReaction(m.id, emoji);
                  setMessages((prev) =>
                    prev.map((item) =>
                      item.id === m.id ? { ...item, reactions: res.reactions } : item
                    )
                  );
                }}
                onPin={
                  canPin
                    ? async (m) => {
                        const next = await conversationApi.updateMeta(
                          convId,
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
        })}
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

      {canSend ? (
        <MessageInput
          enterToSend={user?.settings?.enterToSend ?? true}
          replyingTo={replyingTo}
          editingMessage={editingMessage}
          onCancelReply={() => setReplyingTo(null)}
          onCancelEdit={() => setEditingMessage(null)}
          onTypingStart={() => socket?.emit('typing:start', { conversationId: convId })}
          onTypingStop={() => socket?.emit('typing:stop', { conversationId: convId })}
          onSendMessage={handleSendMessage}
          onSaveEdit={async (id, content, attachmentCaptions) => {
            const updated = await messageApi.edit(id, content, attachmentCaptions);
            setEditingMessage(null);
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
            window.dispatchEvent(
              new CustomEvent('blinkupz:shared-media-refresh', {
                detail: { conversationId: convId },
              })
            );
          }}
        />
      ) : (
        <div className="px-4 py-3.5 border-t border-[#303030] bg-[#202020] text-center text-xs text-[#999999] shrink-0">
          Only moderators, admins, and the owner can send messages in this community.
        </div>
      )}

      {/* Leave Community Confirmation Modal */}
      <Modal
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        title="Leave Community"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#999999] leading-relaxed">
            Are you sure you want to leave <strong className="text-[#FFFFFF]">{community.name}</strong>?
            {community.privacy === 'private'
              ? ' Because this is a private community, you will need admin approval to rejoin.'
              : ' You can rejoin anytime from Discover Communities.'}
          </p>
          <div className="flex justify-end gap-2">
            <PrimaryButton
              variant="secondary"
              onClick={() => setLeaveConfirmOpen(false)}
            >
              Cancel
            </PrimaryButton>
            <PrimaryButton
              variant="danger"
              onClick={async () => {
                setLeaveConfirmOpen(false);
                await handleLeaveCommunity();
              }}
            >
              Leave Community
            </PrimaryButton>
          </div>
        </div>
      </Modal>

      <Modal
        open={forwardingMessage !== null}
        onClose={() => setForwardingMessage(null)}
        title="Forward message"
      >
        <div className="space-y-1">
          {forwardTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={async () => {
                if (!forwardingMessage) return;
                await messageApi.send({
                  conversationId: target.id,
                  content: forwardingMessage.content,
                  messageType:
                    forwardingMessage.messageType === 'system'
                      ? 'text'
                      : forwardingMessage.messageType,
                  attachments: forwardingMessage.attachments,
                  forwardedFrom: {
                    messageId: forwardingMessage.id,
                    senderName: forwardingMessage.sender?.fullName || 'Community Member',
                  },
                });
                setForwardingMessage(null);
                showToast('Message forwarded.', 'success');
              }}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#242424] text-left cursor-pointer"
            >
              <UserAvatar src={target.avatar} name={target.name} size="sm" />
              <span className="text-sm font-medium text-[#FFFFFF] truncate">
                {target.name}
              </span>
            </button>
          ))}
        </div>
      </Modal>

      <MediaGalleryModal
        message={galleryPreview?.message || null}
        initialIndex={galleryPreview?.index || 0}
        onClose={() => setGalleryPreview(null)}
      />
      </div>

      {convId && (
        <SharedMediaPanel
          conversationId={convId}
          open={sharedMediaOpen}
          onClose={() => setSharedMediaOpen(false)}
          onJumpToMessage={handleJumpToMessage}
        />
      )}
    </div>
  );
}
