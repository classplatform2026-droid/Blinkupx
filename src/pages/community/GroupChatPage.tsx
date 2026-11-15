import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Images,
  LogOut,
  MoreVertical,
  Pin,
  Search,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
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
  communityApi,
  conversationApi,
  extractApiError,
  messageApi,
} from '../../services/api';
import type {
  CommunityDetail,
  Conversation,
  Message,
  MessageAttachment,
} from '../../types';
import { formatDateSeparator } from '../../utils/formatters';

export function GroupChatPage() {
  const { communityId } = useParams<{ communityId: string }>();
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [jumpedMessageId, setJumpedMessageId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadGroupChat = useCallback(async () => {
    if (!communityId) return;
    setError(null);
    setLoading(true);
    try {
      const commData = await communityApi.getById(communityId);
      setCommunity(commData);

      if (commData.isMember && commData.conversationId) {
        const [convData, msgData] = await Promise.all([
          conversationApi.getById(commData.conversationId),
          messageApi.list(commData.conversationId),
        ]);
        setConversation(convData);
        setMessages(msgData.messages);
        setHasMore(msgData.hasMore);

        socket?.emit('group:join', { conversationId: commData.conversationId });
        socket?.emit('message:read', { conversationId: commData.conversationId });
      }
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [communityId, socket]);

  useEffect(() => {
    loadGroupChat();
  }, [loadGroupChat]);

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [loading]);

  const convId = community?.conversationId || '';

  useEffect(() => {
    if (!socket || !convId) return;

    const onNewMessage = (msg: Message) => {
      if (msg.conversationId !== convId) return;
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
      );
      if (msg.senderId !== user?.id) {
        socket.emit('message:read', { conversationId: convId });
      }
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
    };

    const onEditMessage = (updated: Message) => {
      if (updated.conversationId !== convId) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
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

    socket.on('message:new', onNewMessage);
    socket.on('message:edit', onEditMessage);
    socket.on('message:delete', onDeleteMessage);
    socket.on('reaction:add', onReaction);
    socket.on('reaction:remove', onReaction);
    socket.on('conversation:updated', onConvUpdated);
    socket.on('group:join', onMemberChange);
    socket.on('group:leave', onMemberChange);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:edit', onEditMessage);
      socket.off('message:delete', onDeleteMessage);
      socket.off('reaction:add', onReaction);
      socket.off('reaction:remove', onReaction);
      socket.off('conversation:updated', onConvUpdated);
      socket.off('group:join', onMemberChange);
      socket.off('group:leave', onMemberChange);
    };
  }, [socket, convId, user?.id, loadGroupChat]);

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

    const scrollToTarget = () => {
      setJumpedMessageId(messageId);
      requestAnimationFrame(() => {
        const el = document.getElementById(`msg-${messageId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => {
        setJumpedMessageId((curr) => (curr === messageId ? null : curr));
      }, 2600);
    };

    if (messages.some((m) => m.id === messageId)) {
      scrollToTarget();
      return;
    }

    try {
      const around = await messageApi.getAround(convId, messageId);
      setMessages(around.messages);
      setHasMore(around.hasMore);
      setTimeout(scrollToTarget, 60);
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
          actionLabel={community.isPending ? 'Request Pending' : 'Back to Communities'}
          onAction={() => navigate('/community')}
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
      <header className="h-16 px-3 sm:px-5 flex items-center justify-between gap-3 border-b border-[#303030] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/community')}
            aria-label="Back to communities"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <UserAvatar src={community.image} name={community.name} size="sm" />
          <div className="min-w-0">
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
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setSharedMediaOpen((p) => !p)}
            aria-label="Shared Media"
            title="Shared Media"
            className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
              sharedMediaOpen
                ? 'bg-[#242424] text-[#FFFFFF]'
                : 'text-[#999999] hover:text-white hover:bg-[#242424]'
            }`}
          >
            <Images className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen((p) => !p)}
            aria-label="Search group messages"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMembersModalOpen(true)}
            aria-label="Community members"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
          >
            <Users className="w-4 h-4" />
          </button>
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
                label: 'Shared media',
                icon: <Images className="w-4 h-4" />,
                onClick: () => setSharedMediaOpen(true),
              },
              {
                label: 'Members & Roles',
                icon: <Shield className="w-4 h-4" />,
                onClick: () => setMembersModalOpen(true),
              },
              ...(!isOwner
                ? [
                    {
                      label: 'Leave community',
                      icon: <LogOut className="w-4 h-4" />,
                      danger: true,
                      onClick: handleLeaveCommunity,
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
          {canModerate && (
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
                  canModerate
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
                onPreviewImage={(url) => setPreviewImage(url)}
              />
            </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        enterToSend={user?.settings?.enterToSend ?? true}
        replyingTo={replyingTo}
        editingMessage={editingMessage}
        onCancelReply={() => setReplyingTo(null)}
        onCancelEdit={() => setEditingMessage(null)}
        onTypingStart={() => socket?.emit('typing:start', { conversationId: convId })}
        onTypingStop={() => socket?.emit('typing:stop', { conversationId: convId })}
        onSendMessage={async (payload: {
          content?: string;
          messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
          attachments?: MessageAttachment[];
        }) => {
          const created = await messageApi.send({
            conversationId: convId,
            content: payload.content,
            messageType: payload.messageType,
            attachments: payload.attachments,
            replyTo: replyingTo?.id || null,
          });
          setReplyingTo(null);
          setMessages((prev) =>
            prev.some((m) => m.id === created.id) ? prev : [...prev, created]
          );
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
        }}
        onSaveEdit={async (id, content) => {
          const updated = await messageApi.edit(id, content);
          setEditingMessage(null);
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        }}
      />

      {/* Members & Roles Modal */}
      <Modal
        open={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
        title={`${community.name} Members (${community.memberCount})`}
      >
        <div className="space-y-5">
          {community.pendingRequests.length > 0 && (
            <div className="space-y-2 pb-4 border-b border-[#303030]">
              <h3 className="text-xs font-semibold text-[#999999]">
                Pending Join Requests ({community.pendingRequests.length})
              </h3>
              {community.pendingRequests.map((reqUser) => (
                <div
                  key={reqUser.id}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar src={reqUser.avatar} name={reqUser.fullName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm text-[#FFFFFF] truncate">{reqUser.fullName}</p>
                      <p className="text-xs text-[#999999] truncate">@{reqUser.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await communityApi.handleRequest(community.id, reqUser.id, 'approve');
                        loadGroupChat();
                      }}
                      className="w-8 h-8 rounded-lg bg-[#22C55E] text-[#181818] flex items-center justify-center cursor-pointer"
                      aria-label="Approve"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await communityApi.handleRequest(community.id, reqUser.id, 'reject');
                        loadGroupChat();
                      }}
                      className="w-8 h-8 rounded-lg bg-[#242424] border border-[#303030] text-[#E5484D] flex items-center justify-center cursor-pointer"
                      aria-label="Decline"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {community.members.map((m) => (
              <div
                key={m.user.id}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <UserAvatar
                    src={m.user.avatar}
                    name={m.user.fullName}
                    size="sm"
                    online={m.user.onlineStatus}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#FFFFFF] truncate">
                      {m.user.fullName}
                    </p>
                    <p className="text-xs text-[#999999] truncate">
                      @{m.user.username} · <span className="capitalize">{m.role}</span>
                    </p>
                  </div>
                </div>

                {isOwner && m.role !== 'owner' && (
                  <select
                    aria-label={`Role for ${m.user.fullName}`}
                    value={m.role}
                    onChange={async (e) => {
                      await communityApi.updateRole(
                        community.id,
                        m.user.id,
                        e.target.value as 'admin' | 'moderator' | 'member'
                      );
                      showToast('Member role updated.', 'success');
                      loadGroupChat();
                    }}
                    className="h-8 rounded-lg bg-[#242424] border border-[#303030] px-2 text-xs text-[#FFFFFF]"
                  >
                    <option value="member">Member</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </div>
            ))}
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

      <Modal
        open={previewImage !== null}
        onClose={() => setPreviewImage(null)}
        title="Image Preview"
        maxWidth="max-w-3xl"
      >
        {previewImage && (
          <img
            src={previewImage}
            alt="Shared community image"
            referrerPolicy="no-referrer"
            className="w-full max-h-[72vh] object-contain rounded-xl bg-black"
          />
        )}
      </Modal>
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
