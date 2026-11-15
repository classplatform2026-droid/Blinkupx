import { formatFileSize } from './formatters';

export const MAX_MEDIA_FILES_PER_MESSAGE = 10;
export const MAX_MEDIA_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export type MediaKind = 'image' | 'video' | 'document' | 'voice';

export interface StagedMediaItem {
  clientItemId: string;
  file: File | Blob;
  previewUrl: string;
  kind: MediaKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  caption: string;
  duration?: number;
}

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'bmp',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  '3gp',
  'mkv',
  'avi',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'ogg',
  'oga',
  'm4a',
  'wav',
  'aac',
  'flac',
]);

const DOC_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'log',
  'csv',
  'md',
  'json',
  'rtf',
  'zip',
]);

export function generateClientItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `item_${crypto.randomUUID()}`;
  }
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function classifyFileKind(
  file: File | Blob,
  fallbackKind: 'image' | 'video' | 'document' = 'document'
): MediaKind {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';

  const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
  const dot = name.lastIndexOf('.');
  const ext = dot !== -1 ? name.slice(dot + 1).toLowerCase() : '';

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'voice';
  if (DOC_EXTENSIONS.has(ext)) return 'document';
  return fallbackKind;
}

export function isSupportedMediaFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    mime === 'application/json' ||
    mime === 'application/rtf' ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/msword' ||
    mime.includes('officedocument') ||
    mime.includes('opendocument') ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint'
  ) {
    return true;
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot !== -1 ? file.name.slice(dot + 1).toLowerCase() : '';
  return (
    IMAGE_EXTENSIONS.has(ext) ||
    VIDEO_EXTENSIONS.has(ext) ||
    AUDIO_EXTENSIONS.has(ext) ||
    DOC_EXTENSIONS.has(ext)
  );
}

export function createStagedMediaItems(params: {
  files: File[];
  currentCount: number;
  fallbackKind?: 'image' | 'video' | 'document';
  maxFiles?: number;
  maxBytes?: number;
}): {
  accepted: StagedMediaItem[];
  errors: string[];
} {
  const {
    files,
    currentCount,
    fallbackKind = 'image',
    maxFiles = MAX_MEDIA_FILES_PER_MESSAGE,
    maxBytes = MAX_MEDIA_FILE_SIZE_BYTES,
  } = params;

  const remaining = Math.max(0, maxFiles - currentCount);
  const accepted: StagedMediaItem[] = [];
  const errors: string[] = [];

  if (remaining === 0 && files.length > 0) {
    errors.push(`Maximum ${maxFiles} files allowed per message.`);
    return { accepted, errors };
  }

  let truncatedForLimit = false;
  for (const file of files) {
    if (accepted.length >= remaining) {
      truncatedForLimit = true;
      break;
    }
    if (!isSupportedMediaFile(file)) {
      errors.push(`"${file.name}" is not a supported file type.`);
      continue;
    }
    if (file.size > maxBytes) {
      errors.push(
        `"${file.name}" exceeds the ${formatFileSize(maxBytes)} limit.`
      );
      continue;
    }

    const kind = classifyFileKind(file, fallbackKind);
    const previewUrl =
      kind === 'image' || kind === 'video' || kind === 'voice'
        ? URL.createObjectURL(file)
        : '';

    accepted.push({
      clientItemId: generateClientItemId(),
      file,
      previewUrl,
      kind,
      fileName: file.name || 'attachment',
      fileSize: file.size || 0,
      mimeType: file.type || '',
      caption: '',
    });
  }

  if (truncatedForLimit) {
    errors.push(`Only ${maxFiles} files can be attached per message.`);
  }

  return { accepted, errors };
}

export function resolveBatchMessageType(
  items: Array<Pick<StagedMediaItem, 'kind'>>
): 'image' | 'video' | 'document' | 'voice' {
  if (items.length === 0) return 'document';
  if (items.every((i) => i.kind === 'voice')) return 'voice';
  if (items.every((i) => i.kind === 'video')) return 'video';
  if (items.some((i) => i.kind === 'image' || i.kind === 'video')) {
    return items.every((i) => i.kind === 'video') ? 'video' : 'image';
  }
  return 'document';
}
