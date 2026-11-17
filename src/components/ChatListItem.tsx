import React, { useRef, useState } from 'react';
import {
  Archive,
  BellOff,
  MoreVertical,
  Phone,
  PhoneMissed,
  Pin,
  Trash2,
  Video,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Conversation } from '../types';
import { formatConversationTime } from '../utils/formatters';
import { DropdownMenu } from './DropdownMenu';
import { UserAvatar } from './UserAvatar';

interface ChatListItemProps {
  conversation: Conversation;
  active: boolean;
  online: boolean;
  typingText?: string;
  onSelect: () => void;
  onAction: (action: 'pin' | 'unpin' | 'mute' | 'unmute' | 'archive' | 'delete') => void;
}

export function ChatListItem({
  conversation,
  active,
  online,
  typingText,
  onSelect,
  onAction,
}: ChatListItemProps) {
  const { user } = useAuth();
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setContextPos({ x: touch.clientX, y: touch.clientY });
    }, 520);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextPos({ x: e.clientX, y: e.clientY });
  };

  const menuOptions = [
    {
      label: conversation.isPinned ? 'Unpin chat' : 'Pin chat',
      icon: <Pin className="w-4 h-4" />,
      onClick: () => onAction(conversation.isPinned ? 'unpin' : 'pin'),
    },
    {
      label: conversation.isMuted ? 'Unmute notifications' : 'Mute notifications',
      icon: <BellOff className="w-4 h-4" />,
      onClick: () => onAction(conversation.isMuted ? 'unmute' : 'mute'),
    },
    {
      label: 'Archive chat',
      icon: <Archive className="w-4 h-4" />,
      onClick: () => onAction('archive'),
    },
    {
      label: 'Delete chat',
      icon: <Trash2 className="w-4 h-4" />,
      danger: true,
      onClick: () => onAction('delete'),
    },
  ];

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={clearLongPress}
        onTouchMove={clearLongPress}
        className={`group relative flex items-center gap-3 px-3 py-3 rounded-xl transition-colors duration-150 cursor-pointer ${
          active ? 'bg-[#242424]' : 'hover:bg-[#202020]'
        }`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <UserAvatar
          src={conversation.avatar}
          name={conversation.name}
          size="md"
          online={conversation.type === 'direct' && online}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-[#FFFFFF] truncate">
                {conversation.name}
              </span>
              {conversation.isPinned && (
                <Pin className="w-3.5 h-3.5 text-[#999999] shrink-0" aria-label="Pinned" />
              )}
              {conversation.isMuted && (
                <BellOff className="w-3.5 h-3.5 text-[#999999] shrink-0" aria-label="Muted" />
              )}
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#999999] shrink-0">
              {formatConversationTime(
                conversation.lastMessage?.createdAt || conversation.updatedAt
              )}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            {(() => {
              const lastMsg = conversation.lastMessage;
              const isCallEvent = lastMsg?.messageType === 'call_event';
              const rawContent = lastMsg?.content || '';
              const isMissedRaw = /^Missed (voice|video) call$/i.test(rawContent);
              const isCaller = Boolean(user?.id && lastMsg?.senderId === user.id);
              const isMissedForViewer = isCallEvent && isMissedRaw && !isCaller;
              const isVideoCall = /video/i.test(rawContent);
              const callPreviewText =
                isCallEvent && isMissedRaw && isCaller ? 'No answer' : rawContent;

              const previewString =
                typingText ||
                (isCallEvent ? callPreviewText : rawContent) ||
                (conversation.type === 'direct' && conversation.username
                  ? `@${conversation.username}`
                  : 'No messages yet');

              return (
                <p
                  className={`flex items-center gap-1.5 text-xs min-w-0 truncate ${
                    typingText
                      ? 'text-[#22C55E] font-medium'
                      : isMissedForViewer
                        ? 'text-[#E5484D] font-medium'
                        : 'text-[#999999]'
                  }`}
                >
                  {!typingText && isCallEvent && (
                    <span className="shrink-0 inline-flex items-center" aria-hidden="true">
                      {isMissedForViewer ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-[#E5484D]" />
                      ) : isVideoCall ? (
                        <Video className="w-3.5 h-3.5 text-[#999999]" />
                      ) : (
                        <Phone className="w-3.5 h-3.5 text-[#999999]" />
                      )}
                    </span>
                  )}
                  <span className="truncate">{previewString}</span>
                </p>
              );
            })()}
            {conversation.unreadCount > 0 && (
              <span className="text-xs font-mono tabular-nums font-semibold text-[#FFFFFF] bg-[#303030] px-1.5 py-0.5 rounded-md shrink-0">
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            )}
          </div>
        </div>

        <div
          className="hidden md:group-hover:block md:group-focus-within:block shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label="Conversation options"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#303030] cursor-pointer"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            }
            options={menuOptions}
          />
        </div>
      </div>

      {contextPos && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextPos(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextPos(null);
          }}
        >
          <div
            style={{
              top: Math.min(contextPos.y, window.innerHeight - 200),
              left: Math.min(contextPos.x, window.innerWidth - 200),
            }}
            className="fixed w-48 rounded-xl bg-[#242424] border border-[#303030] py-1.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {menuOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => {
                  setContextPos(null);
                  opt.onClick();
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm cursor-pointer ${
                  opt.danger
                    ? 'text-[#E5484D] hover:bg-[#2C2C2C]'
                    : 'text-[#FFFFFF] hover:bg-[#2C2C2C]'
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
