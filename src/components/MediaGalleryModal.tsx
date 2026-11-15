import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Film, Image as ImageIcon } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { extractApiError, mediaApi } from '../services/api';
import type { Message } from '../types';
import { formatFileSize } from '../utils/formatters';
import { Modal } from './Modal';
import { PrimaryButton } from './PrimaryButton';

interface MediaGalleryModalProps {
  message: Message | null;
  initialIndex: number;
  onClose: () => void;
}

export function MediaGalleryModal({
  message,
  initialIndex,
  onClose,
}: MediaGalleryModalProps) {
  const { showToast } = useToast();
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  const [fallbackUrls, setFallbackUrls] = useState<Record<string, string>>({});
  const fallbackUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    setIndex(initialIndex);
  }, [message?.id, initialIndex]);

  useEffect(() => {
    return () => {
      Object.values(fallbackUrlsRef.current).forEach((u) => {
        if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
      });
      fallbackUrlsRef.current = {};
    };
  }, []);

  const attachments = message?.attachments || [];
  const visualItems = attachments
    .map((att, originalIndex) => ({ att, originalIndex }))
    .filter(
      ({ att }) =>
        att.mimeType.startsWith('image/') ||
        att.mimeType.startsWith('video/') ||
        message?.messageType === 'image' ||
        message?.messageType === 'video'
    );

  const safeIndex =
    index >= 0 && index < visualItems.length ? index : 0;
  const activeEntry = visualItems[safeIndex] || null;

  useEffect(() => {
    if (!message || visualItems.length <= 1) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && safeIndex > 0) {
        setIndex(safeIndex - 1);
      } else if (e.key === 'ArrowRight' && safeIndex < visualItems.length - 1) {
        setIndex(safeIndex + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [message, safeIndex, visualItems.length]);

  const tryAuthenticatedFallback = useCallback(
    async (msgId: string, originalIndex: number, isOptimistic: boolean) => {
      if (isOptimistic) return;
      const key = `${msgId}:${originalIndex}`;
      if (fallbackUrlsRef.current[key] !== undefined) return;
      fallbackUrlsRef.current[key] = '';
      setFallbackUrls((prev) => ({ ...prev, [key]: '' }));
      try {
        const blobUrl = await mediaApi.fetchAttachmentBlobUrl(msgId, originalIndex);
        fallbackUrlsRef.current[key] = blobUrl;
        setFallbackUrls((prev) => ({ ...prev, [key]: blobUrl }));
      } catch {
        // Keep '' to show unavailable state
      }
    },
    []
  );

  if (!message || !activeEntry) return null;

  const { att, originalIndex } = activeEntry;
  const isOptimistic =
    message.deliveryStatus === 'sending' || message.deliveryStatus === 'failed';
  const cacheKey = `${message.id}:${originalIndex}`;
  const resolvedUrl =
    fallbackUrls[cacheKey] && fallbackUrls[cacheKey].length > 0
      ? fallbackUrls[cacheKey]
      : att.url;
  const isUnavailable = fallbackUrls[cacheKey] === '';
  const isVideo =
    att.mimeType.startsWith('video/') ||
    (message.messageType === 'video' && !att.mimeType.startsWith('image/'));
  const displayCaption = att.caption || message.content || '';

  const handleDownload = async () => {
    if (isOptimistic || att.url.startsWith('blob:')) return;
    setDownloading(true);
    try {
      await mediaApi.downloadAttachment(
        message.id,
        originalIndex,
        att.fileName || 'media'
      );
      showToast(`Downloading ${att.fileName || 'media'}`, 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={Boolean(message)}
      onClose={onClose}
      title={att.fileName || 'Media Preview'}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center min-h-[240px]">
          {isUnavailable ? (
            <div className="py-16 px-6 text-center space-y-2 text-[#999999]">
              {isVideo ? (
                <Film className="w-8 h-8 mx-auto" />
              ) : (
                <ImageIcon className="w-8 h-8 mx-auto" />
              )}
              <p className="text-sm text-[#FFFFFF]">Media unavailable</p>
            </div>
          ) : isVideo ? (
            <video
              key={cacheKey}
              src={resolvedUrl}
              controls
              autoPlay
              playsInline
              onError={() =>
                tryAuthenticatedFallback(message.id, originalIndex, isOptimistic)
              }
              className="w-full max-h-[68vh] rounded-xl"
            />
          ) : (
            <img
              key={cacheKey}
              src={resolvedUrl}
              alt={att.fileName || 'Media preview'}
              referrerPolicy="no-referrer"
              onError={() =>
                tryAuthenticatedFallback(message.id, originalIndex, isOptimistic)
              }
              className="w-full max-h-[68vh] object-contain"
            />
          )}

          {visualItems.length > 1 && safeIndex > 0 && (
            <button
              type="button"
              onClick={() => setIndex(safeIndex - 1)}
              aria-label="Previous item"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/75 border border-[#FFFFFF]/20 flex items-center justify-center text-[#FFFFFF] hover:bg-black cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          {visualItems.length > 1 && safeIndex < visualItems.length - 1 && (
            <button
              type="button"
              onClick={() => setIndex(safeIndex + 1)}
              aria-label="Next item"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/75 border border-[#FFFFFF]/20 flex items-center justify-center text-[#FFFFFF] hover:bg-black cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        {(att.caption || message.content) && (
          <div className="space-y-1.5 rounded-xl bg-[#242424] border border-[#303030] px-3.5 py-2.5">
            {displayCaption && (
              <p className="text-sm text-[#FFFFFF] whitespace-pre-wrap">
                {displayCaption}
              </p>
            )}
            {att.caption && message.content && att.caption !== message.content && (
              <p className="text-xs text-[#999999] whitespace-pre-wrap">
                {message.content}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#999999] font-mono tabular-nums">
            <span>{formatFileSize(att.fileSize)}</span>
            {visualItems.length > 1 && (
              <span className="ml-2">
                · {safeIndex + 1} / {visualItems.length}
              </span>
            )}
          </div>
          {!isOptimistic && !att.url.startsWith('blob:') && (
            <PrimaryButton
              loading={downloading}
              onClick={handleDownload}
              className="text-xs min-h-[38px] px-3.5 py-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </PrimaryButton>
          )}
        </div>
      </div>
    </Modal>
  );
}
