import React, { useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Send, Smile, Square, Trash2, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import type { OutgoingMessagePayload } from '../hooks/useOptimisticChatSender';
import { extractApiError } from '../services/api';
import type { Message } from '../types';
import { formatDuration } from '../utils/formatters';
import {
  createStagedMediaItems,
  MAX_MEDIA_FILES_PER_MESSAGE,
  resolveBatchMessageType,
  type StagedMediaItem,
} from '../utils/mediaConfig';
import { AttachmentMenu } from './AttachmentMenu';
import { EmojiPicker } from './EmojiPicker';
import { MediaComposerStrip } from './MediaComposerStrip';

export type { OutgoingMessagePayload };

interface MessageInputProps {
  enterToSend?: boolean;
  replyingTo: Message | null;
  editingMessage: Message | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onSendMessage: (payload: OutgoingMessagePayload) => void | Promise<void>;
  onSaveEdit: (
    messageId: string,
    content: string,
    attachmentCaptions?: Array<{ index: number; caption: string }>
  ) => Promise<void>;
}

const ACCEPT_MAP: Record<'image' | 'video' | 'document', string> = {
  image: 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp',
  video: 'video/mp4,video/webm,video/quicktime,video/3gpp,video/x-matroska,.mkv,.3gp',
  document:
    '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.md,.json,.rtf,.zip',
};

const MIXED_MEDIA_ACCEPT = `${ACCEPT_MAP.image},${ACCEPT_MAP.video},${ACCEPT_MAP.document}`;

export function MessageInput({
  enterToSend = true,
  replyingTo,
  editingMessage,
  onCancelReply,
  onCancelEdit,
  onTypingStart,
  onTypingStop,
  onSendMessage,
  onSaveEdit,
}: MessageInputProps) {
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Staged multi-media items (ownership transfers to optimistic message on send)
  const [stagedMedia, setStagedMedia] = useState<StagedMediaItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const stagedMediaRef = useRef<StagedMediaItem[]>([]);

  // Editing per-attachment captions when editingMessage is a media message
  const [editingCaptions, setEditingCaptions] = useState<Record<number, string>>({});

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadType, setPendingUploadType] = useState<
    'image' | 'video' | 'document'
  >('image');

  useEffect(() => {
    stagedMediaRef.current = stagedMedia;
  }, [stagedMedia]);

  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content || '');
      if (editingMessage.attachments.length > 0) {
        const map: Record<number, string> = {};
        editingMessage.attachments.forEach((att, idx) => {
          if (att.caption) map[idx] = att.caption;
        });
        setEditingCaptions(map);
      } else {
        setEditingCaptions({});
      }
    } else {
      setEditingCaptions({});
    }
  }, [editingMessage]);

  useEffect(() => {
    return () => {
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
    };
  }, [recordedPreviewUrl]);

  // Revoke any un-sent staged object URLs on unmount
  useEffect(() => {
    return () => {
      stagedMediaRef.current.forEach((item) => {
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const handleTextChange = (val: string) => {
    setText(val);
    onTypingStart();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      onTypingStop();
    }, 1800);
  };

  const addFilesToStage = (
    files: File[],
    fallbackKind: 'image' | 'video' | 'document'
  ) => {
    if (files.length === 0) return;
    const { accepted, errors } = createStagedMediaItems({
      files,
      currentCount: stagedMediaRef.current.length,
      fallbackKind,
    });
    if (errors.length > 0) {
      showToast(errors[0], 'error');
    }
    if (accepted.length > 0) {
      setStagedMedia((prev) => [...prev, ...accepted]);
    }
  };

  const handleRemoveStagedItem = (clientItemId: string) => {
    setStagedMedia((prev) => {
      const target = prev.find((i) => i.clientItemId === clientItemId);
      if (target?.previewUrl && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((i) => i.clientItemId !== clientItemId);
    });
    setSelectedMediaId((curr) => (curr === clientItemId ? null : curr));
  };

  const handleClearStaged = () => {
    stagedMediaRef.current.forEach((item) => {
      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setStagedMedia([]);
    setSelectedMediaId(null);
  };

  const handleMoveStagedItem = (clientItemId: string, direction: -1 | 1) => {
    setStagedMedia((prev) => {
      const idx = prev.findIndex((i) => i.clientItemId === clientItemId);
      if (idx === -1) return prev;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  };

  const handleStartReplace = (clientItemId: string) => {
    setReplaceTargetId(clientItemId);
    if (replaceInputRef.current) {
      replaceInputRef.current.accept = MIXED_MEDIA_ACCEPT;
      replaceInputRef.current.click();
    }
  };

  const handleReplaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = replaceTargetId;
    setReplaceTargetId(null);
    if (!file || !targetId) return;

    const { accepted, errors } = createStagedMediaItems({
      files: [file],
      currentCount: 0,
      fallbackKind: pendingUploadType,
    });
    if (errors.length > 0) {
      showToast(errors[0], 'error');
      return;
    }
    const replacement = accepted[0];
    if (!replacement) return;

    setStagedMedia((prev) =>
      prev.map((item) => {
        if (item.clientItemId !== targetId) return item;
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
        return {
          ...replacement,
          caption: item.caption,
        };
      })
    );
    setSelectedMediaId((curr) => (curr === targetId ? replacement.clientItemId : curr));
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();

    if (editingMessage) {
      const isTextEdit = editingMessage.messageType === 'text';
      if ((isTextEdit && !trimmed) || savingEdit) return;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      onTypingStop();

      setSavingEdit(true);
      try {
        const attachmentCaptions =
          editingMessage.attachments.length > 0
            ? editingMessage.attachments.map((_, idx) => ({
                index: idx,
                caption: (editingCaptions[idx] ?? editingMessage.attachments[idx]?.caption ?? '').trim(),
              }))
            : undefined;
        await onSaveEdit(editingMessage.id, trimmed, attachmentCaptions);
        setText('');
        setEditingCaptions({});
      } catch (err) {
        showToast(extractApiError(err).message, 'error');
      } finally {
        setSavingEdit(false);
      }
      return;
    }

    if (recordedBlob) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      onTypingStop();
      const blobToSend = recordedBlob;
      const durationToSend = recordSeconds;
      cancelRecording();
      void onSendMessage({
        content: '',
        messageType: 'voice',
        localFile: blobToSend,
        duration: durationToSend,
      });
      return;
    }

    if (stagedMedia.length > 0) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      onTypingStop();
      const itemsToSend = [...stagedMedia];
      const batchType = resolveBatchMessageType(itemsToSend);
      // Clear staged list WITHOUT revoking previewUrls (transferred to optimistic message)
      setStagedMedia([]);
      setSelectedMediaId(null);
      setText('');
      setShowEmoji(false);
      setShowAttachments(false);
      void onSendMessage({
        content: trimmed,
        messageType: batchType,
        mediaItems: itemsToSend,
      });
      return;
    }

    if (!trimmed) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    onTypingStop();

    setText('');
    setShowEmoji(false);
    setShowAttachments(false);
    void onSendMessage({
      content: trimmed,
      messageType: 'text',
    });
  };

  const handlePickAttachment = (type: 'image' | 'video' | 'document') => {
    setShowAttachments(false);
    setPendingUploadType(type);
    if (fileInputRef.current) {
      fileInputRef.current.accept = ACCEPT_MAP[type];
      fileInputRef.current.click();
    }
  };

  const handleAddMoreClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = MIXED_MEDIA_ACCEPT;
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;
    addFilesToStage(fileList, pendingUploadType);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(e.clipboardData?.files || []);
    if (clipboardFiles.length === 0) return;
    e.preventDefault();
    addFilesToStage(clipboardFiles, 'image');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (dropped.length > 0) {
      addFilesToStage(dropped, 'image');
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast('Voice recording is not supported in this browser.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setRecordedPreviewUrl(URL.createObjectURL(blob));
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordIntervalRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      showToast('Microphone permission is required to record voice messages.', 'error');
    }
  };

  const stopRecording = () => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const cancelRecording = () => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (recordedPreviewUrl) {
      URL.revokeObjectURL(recordedPreviewUrl);
    }
    setRecording(false);
    setRecordedBlob(null);
    setRecordedPreviewUrl(null);
    setRecordSeconds(0);
  };

  const canSubmit = Boolean(text.trim() || stagedMedia.length > 0 || editingMessage);

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setIsDraggingOver(true);
        }
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`border-t border-[#303030] bg-[#181818] px-3 sm:px-5 py-3 shrink-0 transition-colors ${
        isDraggingOver ? 'bg-[#202020] border-[#FFFFFF]/40' : ''
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        onChange={handleReplaceFileChange}
      />

      {(replyingTo || editingMessage) && (
        <div className="mb-2.5 rounded-xl bg-[#202020] border border-[#303030] px-3.5 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#FFFFFF]">
                {editingMessage
                  ? editingMessage.messageType === 'text'
                    ? 'Editing message'
                    : 'Editing media caption'
                  : `Replying to ${replyingTo?.sender?.fullName || 'User'}`}
              </p>
              <p className="text-xs text-[#999999] truncate">
                {editingMessage?.content ||
                  (editingMessage && editingMessage.attachments.length > 0
                    ? `${editingMessage.attachments.length} ${
                        editingMessage.attachments.length === 1 ? 'attachment' : 'attachments'
                      }`
                    : '') ||
                  replyingTo?.content ||
                  replyingTo?.messageType}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (editingMessage) {
                  setText('');
                  setEditingCaptions({});
                  onCancelEdit();
                } else {
                  onCancelReply();
                }
              }}
              aria-label="Cancel"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#303030] cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {editingMessage &&
            editingMessage.messageType !== 'text' &&
            editingMessage.attachments.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-28 overflow-y-auto pt-1 border-t border-[#303030]">
                {editingMessage.attachments.map((att, idx) => (
                  <div key={`${att.url}-${idx}`} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono tabular-nums text-[#999999] shrink-0">
                      #{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={editingCaptions[idx] ?? ''}
                      onChange={(e) =>
                        setEditingCaptions((prev) => ({
                          ...prev,
                          [idx]: e.target.value,
                        }))
                      }
                      placeholder={`Caption for ${att.fileName || `item #${idx + 1}`}...`}
                      maxLength={1000}
                      className="flex-1 h-7 rounded-lg bg-[#181818] border border-[#303030] px-2 text-xs text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none min-w-0"
                    />
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {!editingMessage && (
        <MediaComposerStrip
          items={stagedMedia}
          selectedItemId={selectedMediaId}
          maxFiles={MAX_MEDIA_FILES_PER_MESSAGE}
          onSelectItem={setSelectedMediaId}
          onUpdateItemCaption={(itemId, caption) =>
            setStagedMedia((prev) =>
              prev.map((i) =>
                i.clientItemId === itemId ? { ...i, caption } : i
              )
            )
          }
          onRemoveItem={handleRemoveStagedItem}
          onReplaceItem={handleStartReplace}
          onMoveItem={handleMoveStagedItem}
          onAddMore={handleAddMoreClick}
          onClearAll={handleClearStaged}
        />
      )}

      {recording ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#242424] border border-[#303030] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E5484D]" />
            <span className="text-sm text-[#FFFFFF]">Recording voice message</span>
            <span className="text-sm font-mono tabular-nums text-[#999999]">
              {formatDuration(recordSeconds)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelRecording}
              aria-label="Cancel recording"
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#E5484D] hover:bg-[#303030] cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Stop recording"
              className="min-w-[40px] min-h-[40px] rounded-xl bg-[#FFFFFF] text-[#181818] flex items-center justify-center hover:bg-[#E8E8E8] cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          </div>
        </div>
      ) : recordedPreviewUrl ? (
        <div className="flex items-center gap-3 rounded-xl bg-[#242424] border border-[#303030] px-3 py-2">
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Discard voice recording"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#E5484D] hover:bg-[#303030] cursor-pointer shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <audio src={recordedPreviewUrl} controls className="flex-1 h-9 min-w-0" />
          <span className="text-xs font-mono tabular-nums text-[#999999] shrink-0">
            {formatDuration(recordSeconds)}
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            aria-label="Send voice message"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#FFFFFF] text-[#181818] flex items-center justify-center hover:bg-[#E8E8E8] cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative flex items-end gap-2">
          {showAttachments && (
            <div className="absolute bottom-14 left-0 z-30">
              <AttachmentMenu onSelectType={handlePickAttachment} />
            </div>
          )}

          {showEmoji && (
            <div className="absolute bottom-14 left-10 z-30">
              <EmojiPicker
                onSelect={(emoji) => {
                  setText((prev) => prev + emoji);
                  setShowEmoji(false);
                }}
              />
            </div>
          )}

          {!editingMessage && (
            <button
              type="button"
              onClick={() => {
                setShowAttachments((p) => !p);
                setShowEmoji(false);
              }}
              aria-label="Attach media"
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] transition-colors cursor-pointer shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setShowEmoji((p) => !p);
              setShowAttachments(false);
            }}
            aria-label="Insert emoji"
            className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] transition-colors cursor-pointer shrink-0"
          >
            <Smile className="w-5 h-5" />
          </button>

          <textarea
            rows={1}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              editingMessage
                ? editingMessage.messageType === 'text'
                  ? 'Edit message...'
                  : 'Edit caption...'
                : stagedMedia.length > 0
                  ? 'Add a caption...'
                  : 'Write a message...'
            }
            className="flex-1 min-h-[44px] max-h-32 resize-none rounded-xl bg-[#242424] border border-[#303030] px-4 py-2.5 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
          />

          {canSubmit ? (
            <button
              type="button"
              disabled={savingEdit}
              onClick={handleSubmit}
              aria-label={stagedMedia.length > 0 ? 'Send media' : 'Send message'}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-[#FFFFFF] text-[#181818] flex items-center justify-center hover:bg-[#E8E8E8] transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              aria-label="Record voice message"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-[#242424] border border-[#303030] text-[#FFFFFF] flex items-center justify-center hover:bg-[#303030] transition-colors cursor-pointer shrink-0"
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
