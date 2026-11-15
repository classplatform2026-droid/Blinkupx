import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.ts';
import { AUTH_COOKIE_NAME, type JwtPayload } from '../middleware/auth.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import { User } from '../models/User.ts';
import { canViewPrivacyField, getBlockRelationship } from '../services/privacyService.ts';
import { resolveUserSettings } from '../utils/serializers.ts';

let ioInstance: Server | null = null;
const userSockets = new Map<string, Set<string>>();

function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

export function getIO(): Server | null {
  return ioInstance;
}

export function isUserConnected(userId: string): boolean {
  const set = userSockets.get(userId);
  return Boolean(set && set.size > 0);
}

export async function emitPresenceToAuthorizedViewers(targetUserId: string): Promise<void> {
  const io = ioInstance;
  if (!io) return;

  const connectedViewerIds = Array.from(userSockets.keys());
  if (connectedViewerIds.length === 0) return;

  const targetUser = await User.findById(targetUserId).select(
    'onlineStatus lastSeen settings blockedUsers'
  );
  if (!targetUser) return;

  const targetPrivacy = resolveUserSettings(targetUser.settings).privacy;
  const targetBlockedSet = new Set(
    (targetUser.blockedUsers || []).map((id) => id.toString())
  );

  // Batch load direct contacts of targetUser and blockedUsers of connected viewers
  const [directConvs, viewers] = await Promise.all([
    Conversation.find({
      type: 'direct',
      'participants.userId': targetUser._id,
    })
      .select('participants.userId')
      .lean(),
    User.find({ _id: { $in: connectedViewerIds } })
      .select('blockedUsers')
      .lean(),
  ]);

  const contactSet = new Set<string>();
  for (const conv of directConvs) {
    for (const part of conv.participants) {
      const pid = part.userId.toString();
      if (pid !== targetUserId) contactSet.add(pid);
    }
  }

  const viewerBlockedMap = new Map<string, Set<string>>();
  for (const v of viewers) {
    viewerBlockedMap.set(
      v._id.toString(),
      new Set((v.blockedUsers || []).map((id) => id.toString()))
    );
  }

  for (const viewerId of connectedViewerIds) {
    const isSelf = viewerId === targetUserId;
    const isBlockedPair =
      !isSelf &&
      (targetBlockedSet.has(viewerId) ||
        Boolean(viewerBlockedMap.get(viewerId)?.has(targetUserId)));
    const isContact = !isSelf && !isBlockedPair && contactSet.has(viewerId);

    const canViewOnline = canViewPrivacyField(
      targetPrivacy.onlineStatus,
      isSelf,
      isContact,
      isBlockedPair
    );
    const canViewLastSeen = canViewPrivacyField(
      targetPrivacy.lastSeen,
      isSelf,
      isContact,
      isBlockedPair
    );

    io.to(`user:${viewerId}`).emit('user:status', {
      userId: targetUserId,
      onlineStatus: canViewOnline ? Boolean(targetUser.onlineStatus) : false,
      lastSeen: canViewLastSeen ? targetUser.lastSeen || null : null,
      lastSeenHidden: !canViewLastSeen,
      onlineHidden: !canViewOnline,
    });
  }
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientUrl ? [env.clientUrl, 'http://localhost:3000'] : true,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        cookies[AUTH_COOKIE_NAME];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
      const user = await User.findById(decoded.sub);
      if (!user || !user.isVerified) {
        return next(new Error('Account not authorized'));
      }

      socket.data.userId = user._id.toString();
      socket.data.username = user.username;
      next();
    } catch {
      next(new Error('Invalid session token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId as string;

    // Register socket connection
    let set = userSockets.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(socket.id);

    // Join personal room for direct notifications & sync
    socket.join(`user:${userId}`);

    // Join all active conversation rooms for this user
    const conversations = await Conversation.find({
      'participants.userId': userId,
    }).select('_id participants');

    for (const conv of conversations) {
      const participant = conv.participants.find(
        (p) => p.userId.toString() === userId
      );
      if (participant && !participant.deletedAt) {
        socket.join(`conversation:${conv._id.toString()}`);
      }
    }

    if (wasOffline) {
      await User.findByIdAndUpdate(userId, {
        onlineStatus: true,
        lastSeen: new Date(),
      });
      await emitPresenceToAuthorizedViewers(userId);
    }

    // Join a conversation or group room dynamically after membership verification
    socket.on('group:join', async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      const conv = await Conversation.findOne({
        _id: payload.conversationId,
        'participants.userId': userId,
      }).select('_id');
      if (conv) {
        socket.join(`conversation:${conv._id.toString()}`);
      }
    });

    socket.on('group:leave', (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      socket.leave(`conversation:${payload.conversationId}`);
    });

    socket.on('typing:start', async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      const conv = await Conversation.findOne({
        _id: payload.conversationId,
        'participants.userId': userId,
      }).select('_id type participants.userId');
      if (!conv) return;

      if (conv.type === 'direct') {
        const peer = conv.participants.find((p) => p.userId.toString() !== userId);
        if (peer) {
          const rel = await getBlockRelationship(userId, peer.userId.toString());
          if (rel.blocked) return;
        }
      }

      socket.to(`conversation:${payload.conversationId}`).emit('typing:start', {
        conversationId: payload.conversationId,
        userId,
        username: socket.data.username,
      });
    });

    socket.on('typing:stop', async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      const conv = await Conversation.findOne({
        _id: payload.conversationId,
        'participants.userId': userId,
      }).select('_id type participants.userId');
      if (!conv) return;

      if (conv.type === 'direct') {
        const peer = conv.participants.find((p) => p.userId.toString() !== userId);
        if (peer) {
          const rel = await getBlockRelationship(userId, peer.userId.toString());
          if (rel.blocked) return;
        }
      }

      socket.to(`conversation:${payload.conversationId}`).emit('typing:stop', {
        conversationId: payload.conversationId,
        userId,
      });
    });

    socket.on(
      'message:delivered',
      async (payload: { conversationId?: string; messageIds?: string[] }) => {
        if (!payload?.conversationId || !Array.isArray(payload.messageIds)) return;
        const conv = await Conversation.findOne({
          _id: payload.conversationId,
          'participants.userId': userId,
        }).select('_id type participants.userId');
        if (!conv) return;

        if (conv.type === 'direct') {
          const peer = conv.participants.find((p) => p.userId.toString() !== userId);
          if (peer) {
            const rel = await getBlockRelationship(userId, peer.userId.toString());
            if (rel.blocked) return;
          }
        }

        await Message.updateMany(
          {
            _id: { $in: payload.messageIds },
            conversationId: payload.conversationId,
            senderId: { $ne: userId },
          },
          {
            $addToSet: { deliveredTo: userId },
          }
        );

        await Message.updateMany(
          {
            _id: { $in: payload.messageIds },
            conversationId: payload.conversationId,
            deliveryStatus: 'sent',
            senderId: { $ne: userId },
          },
          { $set: { deliveryStatus: 'delivered' } }
        );

        io.to(`conversation:${payload.conversationId}`).emit('message:delivered', {
          conversationId: payload.conversationId,
          messageIds: payload.messageIds,
          userId,
        });
      }
    );

    socket.on('message:read', async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      const conv = await Conversation.findOne({
        _id: payload.conversationId,
        'participants.userId': userId,
      });
      if (!conv) return;

      const user = await User.findById(userId).select('settings');
      const resolved = resolveUserSettings(user?.settings);
      const now = new Date();

      await Conversation.updateOne(
        { _id: payload.conversationId, 'participants.userId': userId },
        { $set: { 'participants.$.lastReadAt': now } }
      );

      // Keep delivery tracking independent from read receipts
      const undelivered = await Message.find({
        conversationId: payload.conversationId,
        senderId: { $ne: userId },
        deliveredTo: { $ne: userId },
      }).select('_id');

      if (undelivered.length > 0) {
        const deliveredIds = undelivered.map((m) => m._id.toString());
        await Message.updateMany(
          { _id: { $in: deliveredIds } },
          { $addToSet: { deliveredTo: userId } }
        );
        await Message.updateMany(
          { _id: { $in: deliveredIds }, deliveryStatus: 'sent' },
          { $set: { deliveryStatus: 'delivered' } }
        );
        io.to(`conversation:${payload.conversationId}`).emit('message:delivered', {
          conversationId: payload.conversationId,
          messageIds: deliveredIds,
          userId,
        });
      }

      let shouldSendReadReceipt = true;
      if (conv.type === 'direct') {
        if (!resolved.privacy.readReceipts) {
          shouldSendReadReceipt = false;
        } else {
          const peer = conv.participants.find((p) => p.userId.toString() !== userId);
          if (peer) {
            const rel = await getBlockRelationship(userId, peer.userId.toString());
            if (rel.blocked) {
              shouldSendReadReceipt = false;
            }
          }
        }
      }

      if (shouldSendReadReceipt) {
        const unread = await Message.find({
          conversationId: payload.conversationId,
          senderId: { $ne: userId },
          readBy: { $ne: userId },
        }).select('_id');

        if (unread.length > 0) {
          const messageIds = unread.map((m) => m._id.toString());
          await Message.updateMany(
            { _id: { $in: messageIds } },
            {
              $addToSet: { readBy: userId, deliveredTo: userId },
              $set: { deliveryStatus: 'read' },
            }
          );

          io.to(`conversation:${payload.conversationId}`).emit('message:read', {
            conversationId: payload.conversationId,
            messageIds,
            userId,
            readAt: now,
          });
        }
      }
    });

    socket.on('disconnect', async () => {
      const existing = userSockets.get(userId);
      if (existing) {
        existing.delete(socket.id);
        if (existing.size === 0) {
          userSockets.delete(userId);
          const lastSeen = new Date();
          await User.findByIdAndUpdate(userId, {
            onlineStatus: false,
            lastSeen,
          });
          await emitPresenceToAuthorizedViewers(userId);
        }
      }
    });
  });

  ioInstance = io;
  return io;
}
