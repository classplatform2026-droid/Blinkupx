import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Play,
  Search,
  X,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { conversationApi, extractApiError, mediaApi } from '../services/api';
import type {
  SharedFileItem,
  SharedLinkItem,
  SharedMediaCounts,
  SharedMediaItem,
} from '../types';
import { formatConversationTime, formatFileSize } from '../utils/formatters';
import { Modal } from './Modal';
import { PrimaryButton } from './PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from './States';

type SharedTab = 'media' | 'files' | 'links';

interface SharedMediaPanelProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

export function SharedMediaPanel({
  conversationId,
  open,
  onClose,
  onJumpToMessage,
}: SharedMediaPanelProps) {
  const { showToast } = useToast();

  const [tab, setTab] = useState<SharedTab>('media');
  const [subType, setSubType] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [counts, setCounts] = useState<SharedMediaCounts>({
    media: 0,
    files: 0,
    links: 0,
  });
  const [items, setItems] = useState<
    Array<SharedMediaItem | SharedFileItem | SharedLinkItem>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [previewMedia, setPreviewMedia] = useState<SharedMediaItem | null>(null);
  const [previewFile, setPreviewFile] = useState<SharedFileItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const loadShared = useCallback(async () => {
    if (!open || !conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await conversationApi.getSharedMedia(conversationId, {
        tab,
        q: debouncedQuery || undefined,
        subType,
      });
      setCounts(res.counts);
      setItems(res.items);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [open, conversationId, tab, debouncedQuery, subType]);

  useEffect(() => {
    loadShared();
  }, [loadShared]);

  const handleTabChange = (nextTab: SharedTab) => {
    setTab(nextTab);
    setSubType('all');
  };

  const handleDownload = async (
    id: string,
    messageId: string,
    attachmentIndex: number,
    fileName: string
  ) => {
    setDownloadingId(id);
    try {
      await mediaApi.downloadAttachment(messageId, attachmentIndex, fileName);
      showToast(`Downloading ${fileName}`, 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleJump = (messageId: string) => {
    setPreviewMedia(null);
    setPreviewFile(null);
    onJumpToMessage(messageId);
  };

  if (!open) return null;

  return (
    <>
      <aside
        aria-label="Shared Media"
        className="fixed inset-0 z-40 lg:static lg:z-auto w-full lg:w-[350px] xl:w-[380px] shrink-0 h-full border-l border-[#303030] bg-[#181818] flex flex-col overflow-hidden"
      >
        <header className="h-16 px-4 flex items-center justify-between gap-2 border-b border-[#303030] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#FFFFFF] tracking-tight">
              Shared Media
            </h2>
            <p className="text-xs text-[#999999] font-mono tabular-nums">
              {counts.media + counts.files + counts.links} total items
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Shared Media"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Three tabs: Media, Files, Links */}
        <div className="px-4 pt-3 pb-2 border-b border-[#303030] space-y-2.5 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 bg-[#202020] p-1 rounded-xl border border-[#303030]">
            {(
              [
                { id: 'media', label: 'Media', count: counts.media },
                { id: 'files', label: 'Files', count: counts.files },
                { id: 'links', label: 'Links', count: counts.links },
              ] as const
            ).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTabChange(t.id)}
                  className={`py-2 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#FFFFFF] text-[#181818]'
                      : 'text-[#999999] hover:text-[#FFFFFF]'
                  }`}
                >
                  <span>{t.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      active ? 'text-[#181818]/70' : 'text-[#999999]'
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search input */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#999999] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search shared ${tab}...`}
              className="w-full h-9 rounded-xl bg-[#242424] border border-[#303030] pl-9 pr-8 text-xs text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999999] hover:text-[#FFFFFF] p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sub-type filters for Media & Files */}
          {tab === 'media' && (
            <div className="flex items-center gap-1.5">
              {[
                { id: 'all', label: 'All' },
                { id: 'image', label: 'Photos' },
                { id: 'video', label: 'Videos' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setSubType(chip.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    subType === chip.id
                      ? 'bg-[#242424] text-[#FFFFFF] border border-[#FFFFFF]/30'
                      : 'bg-[#202020] text-[#999999] border border-[#303030] hover:text-[#FFFFFF]'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {tab === 'files' && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[
                { id: 'all', label: 'All' },
                { id: 'pdf', label: 'PDF' },
                { id: 'doc', label: 'Docs & Text' },
                { id: 'other', label: 'Other' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setSubType(chip.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    subType === chip.id
                      ? 'bg-[#242424] text-[#FFFFFF] border border-[#FFFFFF]/30'
                      : 'bg-[#202020] text-[#999999] border border-[#303030] hover:text-[#FFFFFF]'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <LoadingState rows={5} />
          ) : error ? (
            <ErrorState message={error} onRetry={loadShared} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={
                tab === 'media' ? (
                  <ImageIcon className="w-5 h-5" />
                ) : tab === 'files' ? (
                  <FileText className="w-5 h-5" />
                ) : (
                  <Link2 className="w-5 h-5" />
                )
              }
              title={`No shared ${tab}`}
              description={
                debouncedQuery || subType !== 'all'
                  ? `No shared ${tab} matched your current filter.`
                  : tab === 'media'
                    ? 'Photos and videos sent in this conversation will appear here.'
                    : tab === 'files'
                      ? 'Shared documents and attachments will appear here.'
                      : 'Web links shared in this conversation will appear here.'
              }
            />
          ) : tab === 'media' ? (
            <div className="grid grid-cols-3 gap-1.5">
              {(items as SharedMediaItem[]).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreviewMedia(item)}
                  className="group relative aspect-square rounded-xl overflow-hidden bg-[#202020] border border-[#303030] hover:border-[#FFFFFF]/40 transition-colors cursor-pointer"
                >
                  {item.kind === 'video' ? (
                    <>
                      <video
                        src={item.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover:bg-black/20 transition-colors">
                        <span className="w-8 h-8 rounded-full bg-[#181818]/85 border border-[#FFFFFF]/30 flex items-center justify-center text-[#FFFFFF]">
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </span>
                      </span>
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-[#FFFFFF] flex items-center gap-1">
                        <Film className="w-2.5 h-2.5" />
                      </span>
                    </>
                  ) : (
                    <img
                      src={item.url}
                      alt={item.fileName}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                    />
                  )}
                </button>
              ))}
            </div>
          ) : tab === 'files' ? (
            <div className="space-y-2">
              {(items as SharedFileItem[]).map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[#202020] border border-[#303030] hover:bg-[#242424] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#242424] border border-[#303030] flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono font-bold text-[#FFFFFF]">
                        {file.fileExtension}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#FFFFFF] truncate">
                        {file.fileName}
                      </p>
                      <p className="text-xs text-[#999999] font-mono tabular-nums truncate">
                        {formatFileSize(file.fileSize)} · {file.sender?.fullName || 'User'} ·{' '}
                        {formatConversationTime(file.createdAt)}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownload(
                        file.id,
                        file.messageId,
                        file.attachmentIndex,
                        file.fileName
                      )
                    }
                    disabled={downloadingId === file.id}
                    aria-label={`Download ${file.fileName}`}
                    className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#303030] transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {(items as SharedLinkItem[]).map((link) => (
                <div
                  key={link.id}
                  className="rounded-xl bg-[#202020] border border-[#303030] overflow-hidden hover:border-[#FFFFFF]/25 transition-colors"
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                  >
                    {link.image && (
                      <div className="h-32 w-full bg-[#242424] overflow-hidden border-b border-[#303030]">
                        <img
                          src={link.image}
                          alt={link.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <div className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-[#999999] truncate">
                          {link.siteName || link.domain}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-[#999999] group-hover:text-[#FFFFFF] shrink-0" />
                      </div>
                      <p className="text-sm font-semibold text-[#FFFFFF] line-clamp-2 group-hover:underline">
                        {link.title}
                      </p>
                      {link.description && (
                        <p className="text-xs text-[#999999] line-clamp-2 leading-relaxed">
                          {link.description}
                        </p>
                      )}
                      <p className="text-[11px] font-mono text-[#999999]/80 truncate pt-0.5">
                        {link.url}
                      </p>
                    </div>
                  </a>
                  <div className="px-3 py-2 border-t border-[#303030] flex items-center justify-between gap-2 bg-[#181818]/40">
                    <span className="text-[11px] text-[#999999] truncate">
                      {link.sender?.fullName || 'User'} · {formatConversationTime(link.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleJump(link.messageId)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#FFFFFF] hover:underline cursor-pointer shrink-0"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>Original message</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Media Preview Modal */}
      <Modal
        open={previewMedia !== null}
        onClose={() => setPreviewMedia(null)}
        title={previewMedia?.fileName || 'Shared Media'}
        maxWidth="max-w-3xl"
      >
        {previewMedia && (
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center">
              {previewMedia.kind === 'video' ? (
                <video
                  src={previewMedia.url}
                  controls
                  autoPlay
                  className="w-full max-h-[65vh] rounded-xl"
                />
              ) : (
                <img
                  src={previewMedia.url}
                  alt={previewMedia.fileName}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-[65vh] object-contain"
                />
              )}
            </div>

            {previewMedia.caption && (
              <p className="text-sm text-[#FFFFFF] bg-[#242424] border border-[#303030] rounded-xl px-3.5 py-2.5">
                {previewMedia.caption}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-xs text-[#999999]">
                Shared by{' '}
                <span className="text-[#FFFFFF] font-medium">
                  {previewMedia.sender?.fullName || 'User'}
                </span>{' '}
                · {formatFileSize(previewMedia.fileSize)}
              </div>
              <div className="flex items-center gap-2">
                <PrimaryButton
                  variant="secondary"
                  onClick={() => handleJump(previewMedia.messageId)}
                  className="text-xs min-h-[38px] px-3.5 py-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>View in Chat</span>
                </PrimaryButton>
                <PrimaryButton
                  loading={downloadingId === previewMedia.id}
                  onClick={() =>
                    handleDownload(
                      previewMedia.id,
                      previewMedia.messageId,
                      previewMedia.attachmentIndex,
                      previewMedia.fileName
                    )
                  }
                  className="text-xs min-h-[38px] px-3.5 py-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* File Preview / Details Modal */}
      <Modal
        open={previewFile !== null}
        onClose={() => setPreviewFile(null)}
        title={previewFile?.fileName || 'Shared File'}
        maxWidth="max-w-lg"
      >
        {previewFile && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#242424] border border-[#303030] p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#181818] border border-[#303030] flex items-center justify-center shrink-0">
                <span className="text-xs font-mono font-bold text-[#FFFFFF]">
                  {previewFile.fileExtension}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#FFFFFF] break-all">
                  {previewFile.fileName}
                </p>
                <p className="text-xs text-[#999999] font-mono mt-0.5">
                  {formatFileSize(previewFile.fileSize)} · {previewFile.mimeType || 'Document'}
                </p>
              </div>
            </div>

            {previewFile.mimeType === 'application/pdf' && (
              <div className="rounded-xl overflow-hidden border border-[#303030] bg-[#181818] h-64">
                <iframe
                  src={previewFile.url}
                  title={previewFile.fileName}
                  className="w-full h-full"
                />
              </div>
            )}

            {previewFile.caption && (
              <p className="text-sm text-[#FFFFFF] bg-[#242424] border border-[#303030] rounded-xl px-3.5 py-2.5">
                {previewFile.caption}
              </p>
            )}

            <div className="text-xs text-[#999999]">
              Shared by{' '}
              <span className="text-[#FFFFFF] font-medium">
                {previewFile.sender?.fullName || 'User'}
              </span>{' '}
              on {new Date(previewFile.createdAt).toLocaleString()}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <PrimaryButton
                variant="secondary"
                onClick={() => handleJump(previewFile.messageId)}
                className="text-xs min-h-[40px]"
              >
                <MessageSquare className="w-4 h-4" />
                <span>View in Chat</span>
              </PrimaryButton>
              <PrimaryButton
                loading={downloadingId === previewFile.id}
                onClick={() =>
                  handleDownload(
                    previewFile.id,
                    previewFile.messageId,
                    previewFile.attachmentIndex,
                    previewFile.fileName
                  )
                }
                className="text-xs min-h-[40px]"
              >
                <Download className="w-4 h-4" />
                <span>Secure Download</span>
              </PrimaryButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
