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
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
};

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
}> {
  if (!ALLOWED_MIME_TYPES.has(options.mimeType)) {
    throw new AppError(
      `Unsupported file type: ${options.mimeType}`,
      400,
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  let resourceType: 'image' | 'video' | 'raw' = 'raw';
  if (options.mimeType.startsWith('image/')) {
    resourceType = 'image';
  } else if (options.mimeType.startsWith('video/') || options.mimeType.startsWith('audio/')) {
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
          });
        }
      );
      stream.end(buffer);
    });
  }

  // Secure authenticated local storage fallback when Cloudinary env vars are absent
  await fs.promises.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
  const ext = MIME_TO_EXT[options.mimeType] || 'bin';
  const fileId = `${crypto.randomUUID()}.${ext}`;
  const { filePath, metaPath } = getLocalUploadPaths(fileId);

  await fs.promises.writeFile(filePath, buffer);
  await fs.promises.writeFile(
    metaPath,
    JSON.stringify({
      fileId,
      originalName: options.originalName,
      mimeType: options.mimeType,
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
  };
}
