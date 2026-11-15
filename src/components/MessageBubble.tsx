import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  Edit3,
  FileText,
  Forward,
  MoreHorizontal,
  Pin,
  Reply,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import type { Message } from '../types';
import { extractApiError, mediaApi } from '../services/api';
import { formatDuration, formatFileSize, formatTime } from '../utils/formatters';
import { EmojiPicker } from './EmojiPicker';
import { UserAvatar } from './UserAvatar';

function renderMessageText(text: string, isOwn: boolean) {
  const regex = /((?:https?:\/\/|www\.)[^\s<>"'`)\]]+)/gi;
  const parts = text.split(regex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (/^(?:https?:\/\/|www\.)/i.test(part)) {
      const cleanUrl = part.replace(/[.,!?;:'")\]}>]+$/, '');
      const trailing = part.slice(cleanUrl.length);
      const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
      return (
        <React.Fragment key={idx}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`underline underline-offset-2 break-all ${
              isOwn ? 'text-[#181818] hover:opacity-80' : 'text-[#FFFFFF] hover:opacity-80'
            }`}
          >
            {cleanUrl}
          </a>
          {trailing}
        </React.Fragment>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  isGroup: boolean;
  senderRole?: string;
  canModerate?: boolean;
  highlighted?: boolean;
  compact?: boolean;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message, scope: 'everyone' | 'me') => void;
  onReact: (message: Message, emoji: string) => void;
  onPin?: (message: Message) => void;
  onCopy: (text: string) => void;
  onPreviewImage: (url: string) => void;
  onRetry?: (message: Message) => void;
  onDismissFailed?: (message: Message) => void;
}

export function MessageBubble({
  message,
  isOwn,
  isGroup,
  senderRole,
  canModerate = false,
  highlighted = false,
  compact = false,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onReact,
  onPin,
  onCopy,
  onPreviewImage,
  onRetry,
  onDismissFailed,
}: MessageBubbleProps) {
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [fallbackUrls, setFallbackUrls] = useState<Record<number, string>>({});
  const pointerStartX = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tryAuthenticatedMediaFallback = async (idx: number) => {
    if (message.deliveryStatus === 'sending' || message.deliveryStatus === 'failed') {
      return;
    }
    if (fallbackUrls[idx] !== undefined) return;
    setFallbackUrls((prev) => ({ ...prev, [idx]: '' }));
    try {
      const blobUrl = await mediaApi.fetchAttachmentBlobUrl(message.id, idx);
      setFallbackUrls((prev) => ({ ...prev, [idx]: blobUrl }));
    } catch {
      // Leave empty to indicate unavailable
    }
  };

  if (message.messageType === 'system') {
    return (
      <div className="flex justify-center my-2 px-4">
        <span className="text-xs text-[#999999] text-center py-1 px-3 rounded-lg bg-[#202020] border border-[#303030]">
          {message.content}
        </span>
      </div>
    );
  }

  const isDeleted = Boolean(message.deletedAt);
  const isSending = message.deliveryStatus === 'sending';
  const isFailed = message.deliveryStatus === 'failed';
  const isPendingOrFailed = isSending || isFailed;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isPendingOrFailed) return;
    pointerStartX.current = e.clientX;
    if (e.pointerType === 'touch') {
      longPressTimer.current = setTimeout(() => {
        setMenuOpen(true);
      }, 500);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointerStartX.current === null || isPendingOrFailed) return;
    const dx = e.clientX - pointerStartX.current;
    if (Math.abs(dx) > 8 && longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (dx > 0 && dx < 72) {
      setSwipeOffset(dx);
    }
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (swipeOffset > 44 && !isDeleted && !isPendingOrFailed) {
      onReply(message);
    }
    pointerStartX.current = null;
    setSwipeOffset(0);
  };

  const roleLabel =
    senderRole && senderRole !== 'member'
      ? senderRole.charAt(0).toUpperCase() + senderRole.slice(1)
      : null;

  return (
    <div
      id={`msg-${message.id}`}
      className={`group flex gap-2.5 px-3 sm:px-5 ${
        compact ? 'py-0.5' : 'py-1.5'
      } ${isOwn ? 'justify-end' : 'justify-start'} ${
        highlighted ? 'bg-[#242424]/70 rounded-xl transition-colors duration-500' : ''
      }`}
    >
      {!isOwn && isGroup && (
        <div className="pt-1 shrink-0">
          <UserAvatar
            src={message.sender?.avatar}
            name={message.sender?.fullName || 'User'}
            size="sm"
          />
        </div>
      )}

      <div
        className={`relative max-w-[82%] sm:max-w-[68%] flex flex-col ${
          isOwn ? 'items-end' : 'items-start'
        }`}
        style={{
          transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined,
          transition: swipeOffset ? 'none' : 'transform 150ms ease',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => {
          if (isPendingOrFailed) return;
          e.preventDefault();
          setMenuOpen((prev) => !prev);
          setReactOpen(false);
        }}
      >
        {!isOwn && isGroup && message.sender && (
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-xs font-medium text-[#FFFFFF]">
              {message.sender.fullName}
            </span>
            {roleLabel && (
              <>
                <span className="text-[#999999] text-xs" aria-hidden="true">
                  ·
                </span>
                <span className="text-[11px] font-medium text-[#999999]">
                  {roleLabel}
                </span>
              </>
            )}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          {isOwn && !isDeleted && !isPendingOrFailed && (
            <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 pb-1">
              <button
                type="button"
                onClick={() => {
                  setReactOpen((prev) => !prev);
                  setMenuOpen(false);
                }}
                aria-label="React to message"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <SmilePlus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((prev) => !prev);
                  setReactOpen(false);
                }}
                aria-label="Message actions"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          )}

          <div
            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words transition-opacity ${
              isDeleted
                ? 'bg-[#202020] border border-[#303030] text-[#999999] italic'
                : isOwn
                  ? isFailed
                    ? 'bg-[#FFFFFF] text-[#181818] ring-1 ring-[#E5484D]'
                    : isSending
                      ? 'bg-[#FFFFFF]/90 text-[#181818]'
                      : 'bg-[#FFFFFF] text-[#181818]'
                  : 'bg-[#242424] text-[#FFFFFF] border border-[#303030]'
            }`}
          >
            {!isDeleted && message.forwardedFrom && (
              <div
                className={`flex items-center gap-1.5 text-[11px] mb-1 ${
                  isOwn ? 'text-[#555555]' : 'text-[#999999]'
                }`}
              >
                <Forward className="w-3 h-3" />
                <span>Forwarded from {message.forwardedFrom.senderName}</span>
              </div>
            )}

            {!isDeleted && message.replyTo && (
              <div
                className={`mb-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  isOwn
                    ? 'bg-[#181818]/10 text-[#181818]'
                    : 'bg-[#181818] text-[#999999] border border-[#303030]'
                }`}
              >
                <p className="font-semibold truncate">{message.replyTo.senderName}</p>
                <p className="truncate opacity-80">
                  {message.replyTo.content || message.replyTo.messageType}
                </p>
              </div>
            )}

            {!isDeleted &&
              message.attachments.map((att, idx) => {
                const resolvedUrl =
                  fallbackUrls[idx] && fallbackUrls[idx].length > 0
                    ? fallbackUrls[idx]
                    : att.url;

                if (message.messageType === 'image' || att.mimeType.startsWith('image/')) {
                  return (
                    <button
                      key={`${att.url}-${idx}`}
                      type="button"
                      onClick={() => onPreviewImage(resolvedUrl)}
                      className="block mb-1.5 overflow-hidden rounded-xl cursor-pointer"
                    >
                      {fallbackUrls[idx] === '' ? (
                        <div className="px-3 py-4 rounded-xl bg-[#181818]/20 text-xs opacity-75">
                          Image unavailable
                        </div>
                      ) : (
                        <img
                          src={resolvedUrl}
                          alt={att.fileName || 'Shared image'}
                          referrerPolicy="no-referrer"
                          onError={() => tryAuthenticatedMediaFallback(idx)}
                          className="max-h-72 w-auto object-cover rounded-xl"
                        />
                      )}
                    </button>
                  );
                }

                if (message.messageType === 'video' || att.mimeType.startsWith('video/')) {
                  return (
                    <video
                      key={`${att.url}-${idx}`}
                      src={resolvedUrl}
                      controls
                      preload="metadata"
                      onError={() => tryAuthenticatedMediaFallback(idx)}
                      className="max-h-72 w-full rounded-xl mb-1.5 bg-black"
                    />
                  );
                }

                if (message.messageType === 'voice' || att.mimeType.startsWith('audio/')) {
                  return (
                    <div key={`${att.url}-${idx}`} className="flex flex-col gap-1 min-w-[210px] py-1">
                      <audio
                        src={resolvedUrl}
                        controls
                        onError={() => tryAuthenticatedMediaFallback(idx)}
                        className="w-full h-9"
                      />
                      {att.duration ? (
                        <span
                          className={`text-[11px] font-mono tabular-nums ${
                            isOwn ? 'text-[#555555]' : 'text-[#999999]'
                          }`}
                        >
                          Voice · {formatDuration(att.duration)}
                        </span>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <button
                    key={`${att.url}-${idx}`}
                    type="button"
                    onClick={() => {
                      if (isPendingOrFailed || att.url.startsWith('blob:')) return;
                      mediaApi
                        .downloadAttachment(message.id, idx, att.fileName || 'attachment')
                        .catch((err) => showToast(extractApiError(err).message, 'error'));
                    }}
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl mb-1.5 cursor-pointer transition-colors ${
                      isOwn
                        ? 'bg-[#181818]/10 text-[#181818] hover:bg-[#181818]/15'
                        : 'bg-[#181818] text-[#FFFFFF] border border-[#303030] hover:bg-[#202020]'
                    }`}
                  >
                    <FileText className="w-5 h-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{att.fileName}</p>
                      <p className="text-[11px] opacity-70 font-mono tabular-nums">
                        {formatFileSize(att.fileSize)}
                      </p>
                    </div>
                    <Download className="w-4 h-4 shrink-0" />
                  </button>
                );
              })}

            {message.content && (
              <p className="whitespace-pre-wrap">
                {isDeleted ? message.content : renderMessageText(message.content, isOwn)}
              </p>
            )}

            <div
              className={`flex items-center justify-end gap-1.5 mt-1 text-[10px] font-mono tabular-nums ${
                isDeleted
                  ? 'text-[#999999]'
                  : isOwn
                    ? 'text-[#555555]'
                    : 'text-[#999999]'
              }`}
            >
              {message.editedAt && !isDeleted && <span>edited</span>}
              <span>{formatTime(message.createdAt)}</span>
              {isOwn && !isDeleted && (
                <span
                  aria-label={message.deliveryStatus}
                  title={
                    message.deliveryStatus === 'sending'
                      ? 'Sending...'
                      : message.deliveryStatus === 'sent'
                        ? 'Sent'
                        : message.deliveryStatus === 'delivered'
                          ? 'Delivered'
                          : message.deliveryStatus === 'read'
                            ? 'Read'
                            : 'Failed to send'
                  }
                  className="inline-flex items-center"
                >
                  {message.deliveryStatus === 'sending' ? (
                    <Clock className="w-3.5 h-3.5 text-[#777777]" />
                  ) : message.deliveryStatus === 'failed' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-[#E5484D]" />
                  ) : message.deliveryStatus === 'read' ? (
                    <CheckCheck className="w-3.5 h-3.5 text-[#2563EB]" />
                  ) : message.deliveryStatus === 'delivered' ? (
                    <CheckCheck className="w-3.5 h-3.5 text-[#777777]" />
                  ) : (
                    <Check className="w-3.5 h-3.5 text-[#777777]" />
                  )}
                </span>
              )}
            </div>
          </div>

          {!isOwn && !isDeleted && !isPendingOrFailed && (
            <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 pb-1">
              <button
                type="button"
                onClick={() => {
                  setReactOpen((prev) => !prev);
                  setMenuOpen(false);
                }}
                aria-label="React to message"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <SmilePlus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((prev) => !prev);
                  setReactOpen(false);
                }}
                aria-label="Message actions"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {isOwn && isFailed && !isDeleted && (
          <div className="flex items-center gap-2.5 mt-1 px-1 text-xs">
            <span className="text-[#E5484D]">
              {message.localError || 'Not sent'}
            </span>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message)}
                className="inline-flex items-center gap-1 font-medium text-[#FFFFFF] hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}
            {onDismissFailed && (
              <button
                type="button"
                onClick={() => onDismissFailed(message)}
                className="text-[#999999] hover:text-[#FFFFFF] cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        )}

        {!isDeleted && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 px-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(message, r.emoji)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#242424] border border-[#303030] text-xs text-[#FFFFFF] hover:bg-[#303030] cursor-pointer"
              >
                <span>{r.emoji}</span>
                <span className="font-mono tabular-nums text-[11px] text-[#999999]">
                  {r.userIds.length}
                </span>
              </button>
            ))}
          </div>
        )}

        {reactOpen && !isDeleted && (
          <div className={`mt-1.5 z-30 ${isOwn ? 'self-end' : 'self-start'}`}>
            <EmojiPicker
              compact
              onSelect={(emoji) => {
                setReactOpen(false);
                onReact(message, emoji);
              }}
            />
          </div>
        )}

        {menuOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          >
            <div
              className={`absolute mt-1 w-48 rounded-xl bg-[#242424] border border-[#303030] py-1.5 shadow-2xl ${
                isOwn ? 'right-6' : 'left-6'
              }`}
              style={{ top: '42%' }}
              onClick={(e) => e.stopPropagation()}
            >
              {!isDeleted && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onReply(message);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                  >
                    <Reply className="w-4 h-4 text-[#999999]" />
                    <span>Reply</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onForward(message);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                  >
                    <Forward className="w-4 h-4 text-[#999999]" />
                    <span>Forward</span>
                  </button>
                  {message.content && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onCopy(message.content);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                    >
                      <Copy className="w-4 h-4 text-[#999999]" />
                      <span>Copy</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setReactOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                  >
                    <SmilePlus className="w-4 h-4 text-[#999999]" />
                    <span>React</span>
                  </button>
                  {isOwn && message.messageType === 'text' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEdit(message);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4 text-[#999999]" />
                      <span>Edit</span>
                    </button>
                  )}
                  {onPin && canModerate && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onPin(message);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                    >
                      <Pin className="w-4 h-4 text-[#999999]" />
                      <span>Pin message</span>
                    </button>
                  )}
                </>
              )}
              {(isOwn || canModerate) && !isDeleted && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(message, 'everyone');
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#E5484D] hover:bg-[#303030] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete for everyone</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(message, 'me');
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#E5484D] hover:bg-[#303030] cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete for me</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
