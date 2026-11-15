import React, { useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Send, Smile, Square, Trash2, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { extractApiError, mediaApi } from '../services/api';
import type { Message, MessageAttachment } from '../types';
import { formatDuration } from '../utils/formatters';
import { AttachmentMenu } from './AttachmentMenu';
import { EmojiPicker } from './EmojiPicker';

interface MessageInputProps {
  enterToSend?: boolean;
  replyingTo: Message | null;
  editingMessage: Message | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onSendMessage: (payload: {
    content?: string;
    messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
    attachments?: MessageAttachment[];
  }) => Promise<void>;
  onSaveEdit: (messageId: string, content: string) => Promise<void>;
}

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
  const [sending, setSending] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

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
  const [pendingUploadType, setPendingUploadType] = useState<'image' | 'video' | 'document'>('image');

  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content);
    }
  }, [editingMessage]);

  useEffect(() => {
    return () => {
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
    };
  }, [recordedPreviewUrl]);

  const handleTextChange = (val: string) => {
    setText(val);
    onTypingStart();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      onTypingStop();
    }, 1800);
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed && !recordedBlob) return;
    setSending(true);
    onTypingStop();
    try {
      if (editingMessage) {
        if (!trimmed) return;
        await onSaveEdit(editingMessage.id, trimmed);
        setText('');
      } else if (recordedBlob) {
        setUploadProgress(5);
        const uploaded = await mediaApi.upload(
          recordedBlob,
          'voice',
          (p) => setUploadProgress(p),
          `voice-${Date.now()}.webm`
        );
        uploaded.duration = recordSeconds;
        await onSendMessage({
          content: '',
          messageType: 'voice',
          attachments: [uploaded],
        });
        cancelRecording();
      } else {
        await onSendMessage({
          content: trimmed,
          messageType: 'text',
        });
        setText('');
      }
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  const handlePickAttachment = (type: 'image' | 'video' | 'document') => {
    setShowAttachments(false);
    setPendingUploadType(type);
    if (fileInputRef.current) {
      fileInputRef.current.accept =
        type === 'image'
          ? 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp'
          : type === 'video'
            ? 'video/mp4,video/webm,video/quicktime,video/3gpp,video/x-matroska,.mkv,.3gp'
            : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.md,.json,.rtf,.zip';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setSending(true);
    setUploadProgress(5);
    try {
      const uploaded = await mediaApi.upload(file, 'messages', (p) =>
        setUploadProgress(p)
      );
      const mime = (uploaded.mimeType || file.type || '').toLowerCase();
      let resolvedType: 'image' | 'video' | 'document' | 'voice' = pendingUploadType;
      if (mime.startsWith('image/')) resolvedType = 'image';
      else if (mime.startsWith('video/')) resolvedType = 'video';
      else if (mime.startsWith('audio/')) resolvedType = 'voice';
      else if (mime) resolvedType = 'document';

      await onSendMessage({
        content: text.trim(),
        messageType: resolvedType,
        attachments: [uploaded],
      });
      setText('');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSending(false);
      setUploadProgress(null);
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

  return (
    <div className="border-t border-[#303030] bg-[#181818] px-3 sm:px-5 py-3 shrink-0">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {uploadProgress !== null && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between text-xs text-[#999999] mb-1">
            <span>Uploading media</span>
            <span className="font-mono tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-[#242424] overflow-hidden">
            <div
              className="h-full bg-[#FFFFFF] transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {(replyingTo || editingMessage) && (
        <div className="mb-2.5 flex items-center justify-between gap-3 rounded-xl bg-[#202020] border border-[#303030] px-3.5 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#FFFFFF]">
              {editingMessage
                ? 'Editing message'
                : `Replying to ${replyingTo?.sender?.fullName || 'User'}`}
            </p>
            <p className="text-xs text-[#999999] truncate">
              {editingMessage?.content ||
                replyingTo?.content ||
                replyingTo?.messageType}
            </p>
          </div>
          <button
            type="button"
            onClick={editingMessage ? onCancelEdit : onCancelReply}
            aria-label="Cancel"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#303030] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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
            disabled={sending}
            onClick={handleSubmit}
            aria-label="Send voice message"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#FFFFFF] text-[#181818] flex items-center justify-center hover:bg-[#E8E8E8] cursor-pointer shrink-0 disabled:opacity-50"
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
            onKeyDown={(e) => {
              if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={editingMessage ? 'Edit message...' : 'Write a message...'}
            className="flex-1 min-h-[44px] max-h-32 resize-none rounded-xl bg-[#242424] border border-[#303030] px-4 py-2.5 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
          />

          {text.trim() || editingMessage ? (
            <button
              type="button"
              disabled={sending}
              onClick={handleSubmit}
              aria-label="Send message"
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
