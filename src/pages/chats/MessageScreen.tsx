import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BellOff,
  Images,
  MoreVertical,
  Phone,
  Pin,
  Search,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenu } from '../../components/DropdownMenu';
import { MessageBubble } from '../../components/MessageBubble';
import { MessageInput } from '../../components/MessageInput';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SharedMediaPanel } from '../../components/SharedMediaPanel';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import {
  conversationApi,
  extractApiError,
  messageApi,
} from '../../services/api';
import type { Conversation, Message, MessageAttachment } from '../../types';
import { formatDateSeparator, formatLastSeen } from '../../utils/formatters';

export function MessageScreen({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const { user } = useAuth();
  const { socket, presenceMap, typingMap } = useSocket();
  const { showToast } = useToast();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Conversation[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [callUnavailableModal, setCallUnavailableModal] = useState<'voice' | 'video' | null>(null);

  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatQuery, setInChatQuery] = useState('');
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [jumpedMessageId, setJumpedMessageId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const convData = await conversationApi.getById(conversationId);
      const msgData = highlightId
        ? await messageApi.getAround(conversationId, highlightId).catch(() => messageApi.list(conversationId))
        : await messageApi.list(conversationId);

      setConversation(convData);
      setMessages(msgData.messages);
      setHasMore(msgData.hasMore);
      setHasNewerMessages(Boolean('hasNewer' in msgData && msgData.hasNewer));
      if (highlightId) {
        setPendingScrollId(highlightId);
        setJumpedMessageId(highlightId);
      }

      socket?.emit('group:join', { conversationId });
      socket?.emit('message:read', { conversationId });
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [conversationId, highlightId, socket]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Deterministic scroll when pendingScrollId or messages commit
  useEffect(() => {
    if (loading) return;
    if (pendingScrollId) {
      const el = document.getElementById(`msg-${pendingScrollId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPendingScrollId(null);
        return;
      }
    }
  }, [loading, messages, pendingScrollId]);

  useEffect(() => {
    if (!loading && !highlightId && !hasNewerMessages) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [loading, highlightId, hasNewerMessages]);

  useEffect(() => {
    if (!socket) return;

    const onNewMessage = (msg: Message) => {
      if (msg.conversationId !== conversationId) return;
      if (!hasNewerMessages) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 40);
      }
      if (msg.senderId !== user?.id) {
        socket.emit('message:read', { conversationId });
      }
    };

    const onEditMessage = (updated: Message) => {
      if (updated.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
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
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          payload.messageIds.includes(m.id) && m.deliveryStatus === 'sent'
            ? { ...m, deliveryStatus: 'delivered' }
            : m
        )
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
    socket.on('message:delete', onDeleteMessage);
    socket.on('message:delivered', onDelivered);
    socket.on('message:read', onRead);
    socket.on('reaction:add', onReaction);
    socket.on('reaction:remove', onReaction);
    socket.on('conversation:updated', onConvUpdated);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:edit', onEditMessage);
      socket.off('message:delete', onDeleteMessage);
      socket.off('message:delivered', onDelivered);
      socket.off('message:read', onRead);
      socket.off('reaction:add', onReaction);
      socket.off('reaction:remove', onReaction);
      socket.off('conversation:updated', onConvUpdated);
    };
  }, [socket, conversationId, user?.id, hasNewerMessages]);

  const loadOlder = async () => {
    if (!hasMore || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const container = scrollContainerRef.current;
    const prevHeight = container?.scrollHeight || 0;
    try {
      const oldest = messages[0].createdAt;
      const data = await messageApi.list(conversationId, oldest);
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevHeight;
        }
      });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSendMessage = async (payload: {
    content?: string;
    messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
    attachments?: MessageAttachment[];
  }) => {
    const created = await messageApi.send({
      conversationId,
      content: payload.content,
      messageType: payload.messageType,
      attachments: payload.attachments,
      replyTo: replyingTo?.id || null,
    });
    setReplyingTo(null);
    if (hasNewerMessages) {
      const latest = await messageApi.list(conversationId);
      setMessages(latest.messages);
      setHasMore(latest.hasMore);
      setHasNewerMessages(false);
    } else {
      setMessages((prev) =>
        prev.some((m) => m.id === created.id) ? prev : [...prev, created]
      );
    }
    window.dispatchEvent(
      new CustomEvent('blinkupz:shared-media-refresh', { detail: { conversationId } })
    );
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 30);
  };

  const handleSaveEdit = async (messageId: string, content: string) => {
    const updated = await messageApi.edit(messageId, content);
    setEditingMessage(null);
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    window.dispatchEvent(
      new CustomEvent('blinkupz:shared-media-refresh', { detail: { conversationId } })
    );
  };

  const handleDeleteMessage = async (msg: Message, scope: 'everyone' | 'me') => {
    try {
      await messageApi.delete(msg.id, scope);
      if (scope === 'me') {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? {
                  ...m,
                  deletedAt: new Date().toISOString(),
                  content: 'This message was deleted',
                  attachments: [],
                  reactions: [],
                }
              : m
          )
        );
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
          forwardingMessage.messageType === 'system'
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
      setHasNewerMessages(Boolean(around.hasNewer));
      setPendingScrollId(messageId);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const handleBackToLatest = async () => {
    try {
      const latest = await messageApi.list(conversationId);
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
  const peerLive = peer ? presenceMap[peer.userId] : undefined;
  const peerOnline = peerLive ? peerLive.onlineStatus : conversation.onlineStatus;
  const peerLastSeen = peerLive ? peerLive.lastSeen : conversation.lastSeen;

  const typingList = typingMap[conversationId] || [];
  let subtitle = '';
  if (typingList.length > 0) {
    subtitle =
      conversation.type === 'direct'
        ? 'typing...'
        : `${typingList.map((t) => t.username).join(', ')} typing...`;
  } else if (conversation.type === 'direct') {
    subtitle = peerOnline ? 'Online' : formatLastSeen(peerLastSeen);
  } else {
    subtitle = `${conversation.participants.length} members`;
  }

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
      <header className="h-16 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-3 border-b border-[#303030] bg-[#181818] shrink-0">
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
          {conversation.type === 'direct' && (
            <>
              <button
                type="button"
                onClick={() => setCallUnavailableModal('voice')}
                aria-label="Voice call"
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setCallUnavailableModal('video')}
                aria-label="Video call"
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
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
              {
                label: 'Delete chat',
                icon: <Trash2 className="w-4 h-4" />,
                danger: true,
                onClick: async () => {
                  await conversationApi.delete(conversation.id);
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
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto py-4 space-y-1"
      >
        {hasMore && (
          <div className="flex justify-center pb-3">
            <PrimaryButton
              variant="secondary"
              loading={loadingOlder}
              onClick={loadOlder}
              className="text-xs min-h-[36px] py-1.5 px-3.5"
            >
              Load older messages
            </PrimaryButton>
          </div>
        )}

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
                  onPreviewImage={(url) => setPreviewImage(url)}
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

      {/* Composer */}
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

      {/* Image Preview Modal */}
      <Modal
        open={previewImage !== null}
        onClose={() => setPreviewImage(null)}
        title="Image Preview"
        maxWidth="max-w-3xl"
      >
        {previewImage && (
          <img
            src={previewImage}
            alt="Full preview"
            referrerPolicy="no-referrer"
            className="w-full max-h-[72vh] object-contain rounded-xl bg-black"
          />
        )}
      </Modal>

      {/* V1.0 Calling Info Modal */}
      <Modal
        open={callUnavailableModal !== null}
        onClose={() => setCallUnavailableModal(null)}
        title={
          callUnavailableModal === 'video'
            ? 'Video Calling — V1.0 Notice'
            : 'Voice Calling — V1.0 Notice'
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[#999999] leading-relaxed">
            Live {callUnavailableModal} calling is not included in BlinkUpZ V1.0. You can view and manage your call logs in the Call History tab, or send instant voice messages directly in this chat.
          </p>
          <div className="flex justify-end gap-2">
            <PrimaryButton
              variant="secondary"
              onClick={() => {
                setCallUnavailableModal(null);
                navigate('/calls');
              }}
            >
              Open Call History
            </PrimaryButton>
            <PrimaryButton onClick={() => setCallUnavailableModal(null)}>
              Got it
            </PrimaryButton>
          </div>
        </div>
      </Modal>
      </div>

      <SharedMediaPanel
        conversationId={conversationId}
        open={sharedMediaOpen}
        onClose={() => setSharedMediaOpen(false)}
        onJumpToMessage={handleJumpToMessage}
      />
    </div>
  );
}
