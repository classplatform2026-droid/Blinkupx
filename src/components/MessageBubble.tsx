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
  Film,
  Forward,
  Loader2,
  MoreHorizontal,
  Pin,
  Reply,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import type { MediaUploadProgressItem, Message, MessageAttachment } from '../types';
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

function UploadProgressOverlay({
  progressItem,
  onRetry,
}: {
  progressItem?: MediaUploadProgressItem;
  onRetry?: () => void;
}) {
  if (!progressItem || progressItem.stage === 'sent') return null;

  const isFailed = progressItem.stage === 'failed';
  const label =
    progressItem.stage === 'preparing'
      ? 'Preparing...'
      : progressItem.stage === 'uploading'
        ? `Uploading · ${progressItem.progress}%`
        : progressItem.stage === 'processing'
          ? 'Processing...'
          : 'Failed';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-0 bg-black/65 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 p-2 text-center"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#FFFFFF]">
        {isFailed ? (
          <AlertCircle className="w-3.5 h-3.5 text-[#E5484D] shrink-0" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        )}
        <span className="font-mono tabular-nums">{label}</span>
      </div>

      {!isFailed && (
        <div className="w-4/5 max-w-[140px] h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-150"
            style={{
              width: `${
                progressItem.stage === 'preparing'
                  ? 8
                  : Math.max(8, progressItem.progress)
              }%`,
            }}
          />
        </div>
      )}

      {isFailed && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FFFFFF] text-[#181818] text-[11px] font-medium hover:bg-[#E8E8E8] cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
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
  onPreviewMedia?: (message: Message, attachmentIndex: number) => void;
  onPreviewImage?: (url: string) => void;
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
  onPreviewMedia,
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

  // Classify attachments into visual media (images & videos) vs audio/documents while preserving original index
  const indexedAttachments = (message.attachments || []).map((att, index) => ({
    att,
    index,
  }));

  const isVisualAttachment = (att: MessageAttachment) => {
    const mime = (att.mimeType || '').toLowerCase();
    if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
    if (mime.startsWith('audio/')) return false;
    return (
      (message.messageType === 'image' || message.messageType === 'video') &&
      !/\.(pdf|docx?|xlsx?|pptx?|txt|csv|md|json|rtf|zip)$/i.test(att.fileName || '')
    );
  };

  const visualMedia = !isDeleted
    ? indexedAttachments.filter(({ att }) => isVisualAttachment(att))
    : [];
  const nonVisualAttachments = !isDeleted
    ? indexedAttachments.filter(({ att }) => !isVisualAttachment(att))
    : [];

  const canEditMessageOrCaption =
    isOwn &&
    ['text', 'image', 'video', 'document'].includes(message.messageType);

  const triggerMediaPreview = (originalIndex: number, resolvedUrl: string) => {
    if (onPreviewMedia) {
      onPreviewMedia(message, originalIndex);
    } else if (onPreviewImage) {
      onPreviewImage(resolvedUrl);
    }
  };

  const renderVisualTile = (
    att: MessageAttachment,
    originalIndex: number,
    extraClass = '',
    overflowRemaining = 0
  ) => {
    const resolvedUrl =
      fallbackUrls[originalIndex] && fallbackUrls[originalIndex].length > 0
        ? fallbackUrls[originalIndex]
        : att.url;
    const isVideo =
      att.mimeType.startsWith('video/') ||
      (message.messageType === 'video' && !att.mimeType.startsWith('image/'));
    const progressItem = message.mediaProgress?.[originalIndex];

    return (
      <div
        key={`${att.url}-${originalIndex}`}
        className={`relative overflow-hidden rounded-xl bg-black ${extraClass}`}
      >
        {fallbackUrls[originalIndex] === '' ? (
          <div className="w-full h-full min-h-[110px] px-3 py-4 bg-[#181818]/40 text-xs text-[#999999] flex flex-col items-center justify-center gap-1">
            {isVideo ? <Film className="w-5 h-5" /> : null}
            <span>Media unavailable</span>
          </div>
        ) : isVideo ? (
          <div className="relative w-full h-full">
            <video
              src={resolvedUrl}
              controls={visualMedia.length === 1 && !progressItem}
              muted={visualMedia.length > 1}
              preload="metadata"
              onClick={
                visualMedia.length > 1
                  ? () => triggerMediaPreview(originalIndex, resolvedUrl)
                  : undefined
              }
              onError={() => tryAuthenticatedMediaFallback(originalIndex)}
              className={`w-full object-cover ${
                visualMedia.length === 1 ? 'max-h-72' : 'h-full cursor-pointer'
              }`}
            />
            {visualMedia.length > 1 && (
              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-[#FFFFFF] inline-flex items-center gap-1 pointer-events-none">
                <Film className="w-2.5 h-2.5" />
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => triggerMediaPreview(originalIndex, resolvedUrl)}
            className="block w-full h-full cursor-pointer"
          >
            <img
              src={resolvedUrl}
              alt={att.fileName || 'Shared image'}
              referrerPolicy="no-referrer"
              onError={() => tryAuthenticatedMediaFallback(originalIndex)}
              className={`w-full object-cover ${
                visualMedia.length === 1 ? 'max-h-72' : 'h-full'
              }`}
            />
          </button>
        )}

        {overflowRemaining > 0 && (
          <button
            type="button"
            onClick={() => triggerMediaPreview(originalIndex, resolvedUrl)}
            className="absolute inset-0 bg-black/65 flex items-center justify-center text-lg font-semibold text-[#FFFFFF] font-mono tabular-nums cursor-pointer"
          >
            +{overflowRemaining}
          </button>
        )}

        <UploadProgressOverlay
          progressItem={progressItem}
          onRetry={onRetry ? () => onRetry(message) : undefined}
        />
      </div>
    );
  };

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
                      ? 'bg-[#FFFFFF]/95 text-[#181818]'
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

            {/* Visual Media Grid (1 item full, 2 items 2-col, 3 items 1+2, 4+ items 2x2 with +N) */}
            {visualMedia.length === 1 && (
              <div className="mb-1.5 space-y-1">
                {renderVisualTile(visualMedia[0].att, visualMedia[0].index)}
                {visualMedia[0].att.caption && (
                  <p className="text-xs whitespace-pre-wrap opacity-90">
                    {visualMedia[0].att.caption}
                  </p>
                )}
              </div>
            )}

            {visualMedia.length === 2 && (
              <div className="grid grid-cols-2 gap-1 mb-1.5 min-w-[210px] sm:min-w-[260px]">
                {visualMedia.map(({ att, index }) =>
                  renderVisualTile(att, index, 'aspect-square')
                )}
              </div>
            )}

            {visualMedia.length === 3 && (
              <div className="grid grid-cols-2 gap-1 mb-1.5 min-w-[210px] sm:min-w-[260px]">
                {renderVisualTile(
                  visualMedia[0].att,
                  visualMedia[0].index,
                  'col-span-2 aspect-[16/10]'
                )}
                {visualMedia.slice(1).map(({ att, index }) =>
                  renderVisualTile(att, index, 'aspect-square')
                )}
              </div>
            )}

            {visualMedia.length >= 4 && (
              <div className="grid grid-cols-2 gap-1 mb-1.5 min-w-[210px] sm:min-w-[260px]">
                {visualMedia.slice(0, 4).map(({ att, index }, tileIdx) =>
                  renderVisualTile(
                    att,
                    index,
                    'aspect-square',
                    tileIdx === 3 && visualMedia.length > 4
                      ? visualMedia.length - 4
                      : 0
                  )
                )}
              </div>
            )}

            {/* Show individual captions summary under multi-media grid if any item has an individual caption */}
            {visualMedia.length > 1 &&
              visualMedia.some(({ att }) => Boolean(att.caption?.trim())) && (
                <div
                  className={`mb-1.5 space-y-0.5 text-xs ${
                    isOwn ? 'text-[#333333]' : 'text-[#CCCCCC]'
                  }`}
                >
                  {visualMedia.map(({ att }, pos) =>
                    att.caption?.trim() ? (
                      <p key={pos} className="truncate">
                        <span className="font-mono text-[10px] opacity-70 mr-1.5">
                          #{pos + 1}
                        </span>
                        {att.caption}
                      </p>
                    ) : null
                  )}
                </div>
              )}

            {/* Voice notes and Documents */}
            {nonVisualAttachments.map(({ att, index }) => {
              const resolvedUrl =
                fallbackUrls[index] && fallbackUrls[index].length > 0
                  ? fallbackUrls[index]
                  : att.url;
              const progressItem = message.mediaProgress?.[index];

              if (message.messageType === 'voice' || att.mimeType.startsWith('audio/')) {
                return (
                  <div
                    key={`${att.url}-${index}`}
                    className="flex flex-col gap-1 min-w-[210px] py-1"
                  >
                    <audio
                      src={resolvedUrl}
                      controls
                      onError={() => tryAuthenticatedMediaFallback(index)}
                      className="w-full h-9"
                    />
                    {progressItem && progressItem.stage !== 'sent' ? (
                      <span
                        className={`text-[11px] font-mono tabular-nums ${
                          isOwn ? 'text-[#555555]' : 'text-[#999999]'
                        }`}
                      >
                        {progressItem.stage === 'uploading'
                          ? `Uploading · ${progressItem.progress}%`
                          : progressItem.stage === 'processing'
                            ? 'Processing...'
                            : progressItem.stage === 'failed'
                              ? 'Upload failed'
                              : 'Preparing...'}
                      </span>
                    ) : att.duration ? (
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
                <div key={`${att.url}-${index}`} className="mb-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (isPendingOrFailed || att.url.startsWith('blob:')) return;
                      mediaApi
                        .downloadAttachment(message.id, index, att.fileName || 'attachment')
                        .catch((err) => showToast(extractApiError(err).message, 'error'));
                    }}
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                      isOwn
                        ? 'bg-[#181818]/10 text-[#181818] hover:bg-[#181818]/15'
                        : 'bg-[#181818] text-[#FFFFFF] border border-[#303030] hover:bg-[#202020]'
                    }`}
                  >
                    <FileText className="w-5 h-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{att.fileName}</p>
                      <p className="text-[11px] opacity-70 font-mono tabular-nums">
                        {progressItem && progressItem.stage !== 'sent'
                          ? progressItem.stage === 'uploading'
                            ? `Uploading · ${progressItem.progress}%`
                            : progressItem.stage === 'processing'
                              ? 'Processing...'
                              : progressItem.stage === 'failed'
                                ? 'Failed'
                                : 'Preparing...'
                          : formatFileSize(att.fileSize)}
                      </p>
                    </div>
                    {progressItem &&
                    progressItem.stage !== 'sent' &&
                    progressItem.stage !== 'failed' ? (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 shrink-0" />
                    )}
                  </button>
                  {att.caption && (
                    <p className="text-xs mt-1 whitespace-pre-wrap opacity-90">
                      {att.caption}
                    </p>
                  )}
                </div>
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
                  {canEditMessageOrCaption && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEdit(message);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-white hover:bg-[#303030] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4 text-[#999999]" />
                      <span>
                        {message.messageType === 'text' ? 'Edit' : 'Edit caption'}
                      </span>
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
