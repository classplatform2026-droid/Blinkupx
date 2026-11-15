import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Film,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { formatFileSize } from '../utils/formatters';
import { MAX_MEDIA_FILES_PER_MESSAGE, type StagedMediaItem } from '../utils/mediaConfig';

interface MediaComposerStripProps {
  items: StagedMediaItem[];
  selectedItemId: string | null;
  maxFiles?: number;
  onSelectItem: (clientItemId: string | null) => void;
  onUpdateItemCaption: (clientItemId: string, caption: string) => void;
  onRemoveItem: (clientItemId: string) => void;
  onReplaceItem: (clientItemId: string) => void;
  onMoveItem: (clientItemId: string, direction: -1 | 1) => void;
  onAddMore: () => void;
  onClearAll: () => void;
}

export function MediaComposerStrip({
  items,
  selectedItemId,
  maxFiles = MAX_MEDIA_FILES_PER_MESSAGE,
  onSelectItem,
  onUpdateItemCaption,
  onRemoveItem,
  onReplaceItem,
  onMoveItem,
  onAddMore,
  onClearAll,
}: MediaComposerStripProps) {
  if (items.length === 0) return null;

  const selectedItem =
    items.find((i) => i.clientItemId === selectedItemId) || null;
  const totalBytes = items.reduce((sum, item) => sum + (item.fileSize || 0), 0);
  const canAddMore = items.length < maxFiles;

  return (
    <div className="mb-2.5 rounded-2xl bg-[#202020] border border-[#303030] p-3 space-y-2.5">
      {/* Summary & Batch Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[#999999] min-w-0">
          <span className="font-medium text-[#FFFFFF] whitespace-nowrap">
            {items.length} {items.length === 1 ? 'item' : 'items'} ready
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums whitespace-nowrap">
            {items.length}/{maxFiles}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums truncate">
            {formatFileSize(totalBytes)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canAddMore && (
            <button
              type="button"
              onClick={onAddMore}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#242424] border border-[#303030] text-xs font-medium text-[#FFFFFF] hover:bg-[#303030] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add more</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClearAll}
            className="px-2 py-1 rounded-lg text-xs text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer whitespace-nowrap"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Preview Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-56 overflow-y-auto pr-0.5">
        {items.map((item, idx) => {
          const isSelected = selectedItem?.clientItemId === item.clientItemId;
          return (
            <div
              key={item.clientItemId}
              className={`group relative aspect-square rounded-xl overflow-hidden bg-[#181818] border transition-colors ${
                isSelected
                  ? 'border-[#FFFFFF] ring-1 ring-[#FFFFFF]/40'
                  : 'border-[#303030] hover:border-[#999999]/60'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  onSelectItem(isSelected ? null : item.clientItemId)
                }
                aria-label={`Select ${item.fileName} for caption`}
                className="w-full h-full block text-left cursor-pointer"
              >
                {item.kind === 'image' && item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.fileName}
                    className="w-full h-full object-cover"
                  />
                ) : item.kind === 'video' && item.previewUrl ? (
                  <div className="relative w-full h-full bg-black">
                    <video
                      src={item.previewUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-[#FFFFFF] inline-flex items-center gap-1">
                      <Film className="w-2.5 h-2.5" />
                      <span>Video</span>
                    </span>
                  </div>
                ) : (
                  <div className="w-full h-full p-2 flex flex-col items-center justify-center gap-1 text-center">
                    <FileText className="w-5 h-5 text-[#999999]" />
                    <span className="text-[11px] text-[#FFFFFF] font-medium line-clamp-2 break-all">
                      {item.fileName}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#999999]">
                      {formatFileSize(item.fileSize)}
                    </span>
                  </div>
                )}
              </button>

              {/* Order index indicator */}
              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono tabular-nums text-[#FFFFFF] pointer-events-none">
                {idx + 1}
              </span>

              {/* Remove button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveItem(item.clientItemId);
                }}
                aria-label={`Remove ${item.fileName}`}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/75 text-[#FFFFFF] hover:bg-[#E5484D] flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Bottom action strip: reorder & replace */}
              <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <div className="flex items-center gap-0.5">
                  {items.length > 1 && idx > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveItem(item.clientItemId, -1);
                      }}
                      aria-label={`Move ${item.fileName} earlier`}
                      className="w-6 h-6 rounded-md bg-black/75 text-[#FFFFFF] hover:bg-black flex items-center justify-center cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {items.length > 1 && idx < items.length - 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveItem(item.clientItemId, 1);
                      }}
                      aria-label={`Move ${item.fileName} later`}
                      className="w-6 h-6 rounded-md bg-black/75 text-[#FFFFFF] hover:bg-black flex items-center justify-center cursor-pointer"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReplaceItem(item.clientItemId);
                  }}
                  aria-label={`Replace ${item.fileName}`}
                  title="Replace"
                  className="w-6 h-6 rounded-md bg-black/75 text-[#FFFFFF] hover:bg-black flex items-center justify-center cursor-pointer ml-auto"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>

              {/* Per-item caption badge */}
              {item.caption.trim() && (
                <span className="absolute bottom-8 left-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-[#FFFFFF] truncate pointer-events-none">
                  {item.caption}
                </span>
              )}
            </div>
          );
        })}

        {canAddMore && (
          <button
            type="button"
            onClick={onAddMore}
            aria-label="Add more media"
            className="aspect-square rounded-xl border border-dashed border-[#303030] bg-[#181818] hover:border-[#999999] hover:bg-[#242424] flex flex-col items-center justify-center gap-1 text-[#999999] hover:text-[#FFFFFF] transition-colors cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            <span className="text-[11px] font-medium">Add</span>
          </button>
        )}
      </div>

      {/* Individual item caption editor when an item is selected */}
      {selectedItem ? (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[11px] font-mono tabular-nums text-[#999999] shrink-0">
            #{items.findIndex((i) => i.clientItemId === selectedItem.clientItemId) + 1}
          </span>
          <input
            type="text"
            value={selectedItem.caption}
            onChange={(e) =>
              onUpdateItemCaption(selectedItem.clientItemId, e.target.value)
            }
            placeholder={`Individual caption for ${selectedItem.fileName} (optional)...`}
            maxLength={1000}
            className="flex-1 h-9 rounded-lg bg-[#181818] border border-[#303030] px-3 text-xs text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onSelectItem(null)}
            className="px-2.5 h-9 rounded-lg text-xs text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] cursor-pointer shrink-0"
          >
            Done
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-[#999999]">
          Add a shared caption below, or tap any item above to give it an individual caption.
        </p>
      )}
    </div>
  );
}
