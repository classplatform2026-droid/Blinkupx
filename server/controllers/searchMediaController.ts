import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import {
  extractTokenFromRequest,
  type AuthenticatedRequest,
  type JwtPayload,
} from '../middleware/auth.ts';
import { Community } from '../models/Community.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import { User } from '../models/User.ts';
import {
  getLocalUploadPaths,
  uploadMediaBuffer,
  verifyLocalMediaSignature,
} from '../services/mediaService.ts';
import {
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
} from '../services/privacyService.ts';
import { BLINK_AI_DISPLAY_NAME } from '../services/ai/blinkIdentity.ts';
import { AppError } from '../utils/errors.ts';
import type { SerializedPublicUser } from '../utils/serializers.ts';

export async function globalSearch(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || 'all');

  if (!q) {
    return res.json({
      success: true,
      data: { messages: [], people: [], groups: [] },
    });
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  const myConvs = await Conversation.find({
    participants: {
      $elemMatch: {
        userId: new Types.ObjectId(userId),
        deletedAt: null,
      },
    },
  }).select('_id type name avatar participants');

  const convIds = myConvs.map((c) => c._id);
  const convMap = new Map(myConvs.map((c) => [c._id.toString(), c]));

  let messages: Array<{
    id: string;
    conversationId: string;
    conversationName: string;
    conversationType: string;
    content: string;
    senderName: string;
    createdAt: Date;
  }> = [];

  if (filter === 'all' || filter === 'messages') {
    const matchedMsgs = await Message.find({
      conversationId: { $in: convIds },
      deletedAt: null,
      deletedFor: { $ne: new Types.ObjectId(userId) },
      content: regex,
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .populate('senderId', 'fullName username');

    // Resolve direct conversation peer names
    const peerIds = new Set<string>();
    for (const conv of myConvs) {
      if (conv.type === 'direct') {
        const peer = conv.participants.find((p) => p.userId.toString() !== userId);
        if (peer) peerIds.add(peer.userId.toString());
      }
    }
    const peerUsers = await User.find({ _id: { $in: Array.from(peerIds) } }).select(
      'fullName username'
    );
    const peerNameMap = new Map(peerUsers.map((u) => [u._id.toString(), u.fullName]));

    messages = matchedMsgs.map((m) => {
      const conv = convMap.get(m.conversationId.toString());
      let convName = conv?.name || 'Conversation';
      if (conv?.type === 'direct') {
        const peer = conv.participants.find((p) => p.userId.toString() !== userId);
        convName = (peer && peerNameMap.get(peer.userId.toString())) || 'Direct Chat';
      }
      const sender = m.senderId as unknown as { fullName?: string };
      return {
        id: m._id.toString(),
        conversationId: m.conversationId.toString(),
        conversationName: convName,
        conversationType: conv?.type || 'direct',
        content: m.content,
        senderName:
          m.senderType === 'ai'
            ? BLINK_AI_DISPLAY_NAME
            : sender?.fullName || 'User',
        createdAt: m.createdAt,
      };
    });
  }

  let people: SerializedPublicUser[] = [];
  if (filter === 'all' || filter === 'people') {
    const users = await User.find({
      _id: { $ne: new Types.ObjectId(userId) },
      isVerified: true,
      $or: [{ fullName: regex }, { username: regex }],
    })
      .select(PUBLIC_USER_SELECT)
      .limit(20);
    const viewerContext = await getViewerRelationshipContext(
      userId,
      users.map((u) => u._id.toString())
    );
    people = users.map((u) => serializeUserWithPrivacy(u, viewerContext));
  }

  let groups: Array<{
    id: string;
    conversationId: string;
    communityId: string | null;
    name: string;
    avatar: string;
    memberCount: number;
    kind: 'group' | 'community';
  }> = [];
  if (filter === 'all' || filter === 'groups') {
    const matchedGroups = await Conversation.find({
      _id: { $in: convIds },
      type: { $in: ['group', 'community'] },
      name: regex,
    }).limit(20);

    const matchedCommunities = await Community.find({
      $or: [{ privacy: 'public' }, { 'members.userId': new Types.ObjectId(userId) }],
      name: regex,
    }).limit(20);

    const seenConvIds = new Set<string>();
    for (const g of matchedGroups) {
      seenConvIds.add(g._id.toString());
      groups.push({
        id: g._id.toString(),
        conversationId: g._id.toString(),
        communityId: g.communityId ? g.communityId.toString() : null,
        name: g.name,
        avatar: g.avatar,
        memberCount: g.participants.length,
        kind: g.communityId ? 'community' : 'group',
      });
    }
    for (const c of matchedCommunities) {
      if (!seenConvIds.has(c.conversationId.toString())) {
        groups.push({
          id: c._id.toString(),
          conversationId: c.conversationId.toString(),
          communityId: c._id.toString(),
          name: c.name,
          avatar: c.image,
          memberCount: c.members.length,
          kind: 'community',
        });
      }
    }
  }

  res.json({
    success: true,
    data: { messages, people, groups },
  });
}

export async function uploadMedia(req: AuthenticatedRequest, res: Response) {
  const file = req.file;
  if (!file) {
    throw new AppError('No file provided for upload.', 400, 'NO_FILE');
  }
  const folder = String(req.body.folder || 'attachments').replace(/[^a-z0-9_-]/gi, '');
  const result = await uploadMediaBuffer(file.buffer, {
    folder: folder || 'attachments',
    mimeType: file.mimetype,
    originalName: file.originalname,
  });

  res.status(201).json({
    success: true,
    data: {
      url: result.url,
      publicId: result.publicId,
      fileName: file.originalname,
      fileSize: result.bytes || file.size,
      mimeType: result.mimeType,
    },
  });
}

function sanitizeDownloadFilename(name: string): string {
  const cleaned = name.replace(/["\\\r\n/]/g, '_').trim();
  return cleaned || 'download';
}

export async function accessLocalMedia(req: Request, res: Response) {
  const { fileId } = req.params;
  const sig = String(req.query.sig || '');

  let authorized = verifyLocalMediaSignature(fileId, sig);
  if (!authorized) {
    const token = extractTokenFromRequest(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
        const user = await User.findById(decoded.sub).select('isVerified');
        authorized = Boolean(user && user.isVerified);
      } catch {
        authorized = false;
      }
    }
  }

  if (!authorized) {
    throw new AppError('Unauthorized media access.', 401, 'UNAUTHORIZED');
  }

  const { filePath, metaPath } = getLocalUploadPaths(fileId);
  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found.', 404, 'FILE_NOT_FOUND');
  }

  let mimeType = 'application/octet-stream';
  let originalName = fileId;
  try {
    const rawMeta = await fs.promises.readFile(metaPath, 'utf8');
    const meta = JSON.parse(rawMeta) as { mimeType?: string; originalName?: string };
    if (meta.mimeType) mimeType = meta.mimeType;
    if (meta.originalName) originalName = meta.originalName;
  } catch {
    // Use defaults
  }

  const stat = await fs.promises.stat(filePath);
  const total = stat.size;
  const range = req.headers.range;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.query.download === '1') {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeDownloadFilename(originalName)}"`
    );
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
      return res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(total));
  fs.createReadStream(filePath).pipe(res);
}

export async function downloadAttachment(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const { messageId, attachmentIndex } = req.params;
  const idx = Number(attachmentIndex);
  const inline = req.query.inline === '1';

  if (!Types.ObjectId.isValid(messageId)) {
    throw new AppError('Invalid message identifier.', 400, 'INVALID_MESSAGE_ID');
  }

  if (!Number.isInteger(idx) || idx < 0) {
    throw new AppError('Invalid attachment index.', 400, 'INVALID_ATTACHMENT');
  }

  const msg = await Message.findOne({
    _id: messageId,
    deletedAt: null,
    deletedFor: { $ne: new Types.ObjectId(userId) },
  });
  if (!msg) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  const conv = await Conversation.findOne({
    _id: msg.conversationId,
    'participants.userId': new Types.ObjectId(userId),
  }).select('_id');
  if (!conv) {
    throw new AppError('Access denied to this conversation file.', 403, 'FORBIDDEN');
  }

  const att = msg.attachments?.[idx];
  if (!att) {
    throw new AppError('Attachment not found.', 404, 'ATTACHMENT_NOT_FOUND');
  }

  const safeName = sanitizeDownloadFilename(att.fileName || 'attachment');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`
  );
  if (att.mimeType) {
    res.setHeader('Content-Type', att.mimeType);
  }

  let localFileId: string | null = null;
  if (att.publicId?.startsWith('local:')) {
    localFileId = att.publicId.slice('local:'.length);
  } else if (att.url?.startsWith('/api/media/access/')) {
    const rawPath = att.url.slice('/api/media/access/'.length).split('?')[0];
    if (rawPath) localFileId = rawPath;
  }

  if (localFileId) {
    const { filePath, metaPath } = getLocalUploadPaths(localFileId);
    if (!fs.existsSync(filePath)) {
      throw new AppError('Stored file not found.', 404, 'FILE_NOT_FOUND');
    }
    if (!att.mimeType) {
      try {
        const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8')) as {
          mimeType?: string;
        };
        if (meta.mimeType) res.setHeader('Content-Type', meta.mimeType);
      } catch {
        // Ignore missing metadata
      }
    }
    const stat = await fs.promises.stat(filePath);
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (/^https?:\/\//i.test(att.url)) {
    const upstream = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok || !upstream.body) {
      throw new AppError('Unable to retrieve remote file.', 424, 'MEDIA_FETCH_FAILED');
    }
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    if (!att.mimeType && upstream.headers.get('content-type')) {
      res.setHeader('Content-Type', upstream.headers.get('content-type')!);
    }
    Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream).pipe(res);
    return;
  }

  throw new AppError('Unsupported attachment location.', 400, 'INVALID_ATTACHMENT');
}
