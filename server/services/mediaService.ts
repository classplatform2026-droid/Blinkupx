import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { env, isCloudinaryConfigured } from '../config/env.ts';
import { AppError } from '../utils/errors.ts';

let configured = false;
const LOCAL_UPLOADS_DIR = path.resolve(process.cwd(), '.data', 'uploads');

function ensureCloudinary() {
  if (!configured) {
    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
      secure: true,
    });
    configured = true;
  }
}

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/3gpp',
  'video/x-matroska',
  'video/x-msvideo',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/aac',
  'audio/flac',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/rtf',
  'text/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_MEDIA_FILES_PER_MESSAGE = 10;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/json': 'json',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/zip': 'zip',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'video/x-m4v': 'video/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'application/x-zip-compressed': 'application/zip',
  'application/x-zip': 'application/zip',
  'multipart/x-zip': 'application/zip',
  'application/x-pdf': 'application/pdf',
  'text/x-markdown': 'text/markdown',
  'text/x-csv': 'text/csv',
  'application/csv': 'text/csv',
};

export function normalizeMimeType(rawMime: string, originalName = ''): string {
  const base = (rawMime || '').split(';')[0].trim().toLowerCase();
  const ext = path.extname(originalName).replace(/^\./, '').toLowerCase();

  // Windows often uploads .csv as application/vnd.ms-excel
  if (ext === 'csv' && (base === 'application/vnd.ms-excel' || base === 'application/octet-stream' || !base)) {
    return 'text/csv';
  }
  // Recorded voice notes in browsers can be audio/webm;codecs=opus or video/webm
  if (base && MIME_ALIASES[base]) {
    return MIME_ALIASES[base];
  }
  if (base && ALLOWED_MIME_TYPES.has(base)) {
    return base;
  }
  if ((!base || base === 'application/octet-stream' || base === 'binary/octet-stream') && ext && EXT_TO_MIME[ext]) {
    return EXT_TO_MIME[ext];
  }
  return base || 'application/octet-stream';
}

export function isAllowedUpload(rawMime: string, originalName = ''): boolean {
  const normalized = normalizeMimeType(rawMime, originalName);
  return ALLOWED_MIME_TYPES.has(normalized);
}

export function signLocalMediaId(fileId: string): string {
  return crypto
    .createHmac('sha256', env.jwtSecret)
    .update(`media:${fileId}`)
    .digest('hex');
}

export function verifyLocalMediaSignature(fileId: string, sig: string): boolean {
  if (!sig || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = signLocalMediaId(fileId);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

export function isValidLocalFileId(fileId: string): boolean {
  return /^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i.test(fileId);
}

export function getLocalUploadPaths(fileId: string): {
  filePath: string;
  metaPath: string;
} {
  if (!isValidLocalFileId(fileId)) {
    throw new AppError('Invalid file identifier.', 400, 'INVALID_FILE_ID');
  }
  const safeName = path.basename(fileId);
  return {
    filePath: path.join(LOCAL_UPLOADS_DIR, safeName),
    metaPath: path.join(LOCAL_UPLOADS_DIR, `${safeName}.json`),
  };
}

export async function uploadMediaBuffer(
  buffer: Buffer,
  options: {
    folder: string;
    mimeType: string;
    originalName: string;
  }
): Promise<{
  url: string;
  publicId: string;
  bytes: number;
  resourceType: string;
  mimeType: string;
}> {
  const normalizedMime = normalizeMimeType(options.mimeType, options.originalName);
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new AppError(
      `Unsupported file type: ${options.mimeType || normalizedMime}`,
      400,
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  let resourceType: 'image' | 'video' | 'raw' = 'raw';
  if (normalizedMime.startsWith('image/')) {
    resourceType = 'image';
  } else if (normalizedMime.startsWith('video/') || normalizedMime.startsWith('audio/')) {
    resourceType = 'video';
  }

  // Primary: Cloudinary when configured
  if (isCloudinaryConfigured()) {
    ensureCloudinary();
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `blinkupz/${options.folder}`,
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            return reject(
              new AppError(
                error?.message || 'Cloudinary upload failed.',
                424,
                'MEDIA_UPLOAD_FAILED'
              )
            );
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            bytes: result.bytes,
            resourceType: result.resource_type,
            mimeType: normalizedMime,
          });
        }
      );
      stream.end(buffer);
    });
  }

  // Secure authenticated local storage fallback when Cloudinary env vars are absent
  await fs.promises.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
  const ext = MIME_TO_EXT[normalizedMime] || 'bin';
  const fileId = `${crypto.randomUUID()}.${ext}`;
  const { filePath, metaPath } = getLocalUploadPaths(fileId);

  await fs.promises.writeFile(filePath, buffer);
  await fs.promises.writeFile(
    metaPath,
    JSON.stringify({
      fileId,
      originalName: options.originalName,
      mimeType: normalizedMime,
      bytes: buffer.byteLength,
      folder: options.folder,
      createdAt: new Date().toISOString(),
    })
  );

  const sig = signLocalMediaId(fileId);
  return {
    url: `/api/media/access/${fileId}?sig=${sig}`,
    publicId: `local:${fileId}`,
    bytes: buffer.byteLength,
    resourceType,
    mimeType: normalizedMime,
  };
}
