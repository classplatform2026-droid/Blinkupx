import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Server, type Socket } from 'socket.io';
import { ZodError } from 'zod';
import { env } from '../config/env.ts';
import { AUTH_COOKIE_NAME, type JwtPayload } from '../middleware/auth.ts';
import { Conversation } from '../models/Conversation.ts';
import { Message } from '../models/Message.ts';
import { User } from '../models/User.ts';
import {
  acceptCall,
  acknowledgeRinging,
  cancelCall,
  configureCallSignalingRuntime,
  endCall,
  handleUserCallDisconnect,
  handleUserCallReconnect,
  initiateCall,
  rejectCall,
  reportClientCallState,
} from '../services/callService.ts';
import { createAndDispatchMessage } from '../services/messageService.ts';
import { canViewPrivacyField, getBlockRelationship } from '../services/privacyService.ts';
import { AppError } from '../utils/errors.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import {
  callActionSchema,
  callInitiateSchema,
  callStateReportSchema,
} from '../validators/schemas.ts';

let ioInstance: Server | null = null;
const userSockets = new Map<string, Set<string>>();
const socketFocusState = new Map<
  string,
  {
    userId: string;
    conversationId: string | null;
    communityId: string | null;
    pageVisible: boolean;
    updatedAt: number;
  }
>();

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

export function isUserActivelyViewingConversation(
  userId: string,
  conversationId: string,
  communityId?: string | null
): boolean {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) return false;
  for (const sid of set) {
    const state = socketFocusState.get(sid);
    if (!state || !state.pageVisible) continue;
    if (state.conversationId && state.conversationId === conversationId) {
      return true;
    }
    if (communityId && state.communityId && state.communityId === communityId) {
      return true;
    }
  }
  return false;
}

export function isUserForegroundVisible(userId: string): boolean {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) return false;
  for (const sid of set) {
    const state = socketFocusState.get(sid);
    if (state && state.pageVisible) {
      return true;
    }
  }
  return false;
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
      socket.data.fullName = user.fullName;
      next();
    } catch {
      next(new Error('Invalid session token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;

    // Register socket connection synchronously so early client emits are never dropped
    let set = userSockets.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(socket.id);

    // Join personal room for direct notifications & sync
    socket.join(`user:${userId}`);

    const activeCallOnConnect = handleUserCallReconnect(userId);
    if (activeCallOnConnect) {
      socket.emit('call:sync', activeCallOnConnect);
    }

    void (async () => {
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
    })().catch(() => {
      // Ignore background connection setup failure if socket closed early
    });

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

    socket.on(
      'conversation:focus',
      (payload: {
        conversationId?: string | null;
        communityId?: string | null;
        pageVisible?: boolean;
      }) => {
        socketFocusState.set(socket.id, {
          userId,
          conversationId:
            typeof payload?.conversationId === 'string' && payload.conversationId
              ? payload.conversationId
              : null,
          communityId:
            typeof payload?.communityId === 'string' && payload.communityId
              ? payload.communityId
              : null,
          pageVisible: Boolean(payload?.pageVisible),
          updatedAt: Date.now(),
        });
      }
    );

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
      'message:send',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
      ) => {
        try {
          const result = await createAndDispatchMessage({
            userId,
            senderFullName: socket.data.fullName as string | undefined,
            body: payload,
            io,
          });
          ack?.({ ok: true, data: result.message });
        } catch (err) {
          if (err instanceof AppError) {
            ack?.({ ok: false, code: err.code, message: err.message });
          } else if (err instanceof ZodError) {
            ack?.({
              ok: false,
              code: 'VALIDATION_ERROR',
              message: err.issues[0]?.message || 'Invalid message payload.',
            });
          } else {
            ack?.({
              ok: false,
              code: 'SEND_FAILED',
              message: 'Failed to send message.',
            });
          }
        }
      }
    );

    socket.on(
      'message:sync_delivered',
      async (
        payloadOrAck?: unknown,
        maybeAck?: (res: { ok: boolean; count?: number }) => void
      ) => {
        const ack =
          typeof payloadOrAck === 'function'
            ? (payloadOrAck as (res: { ok: boolean; count?: number }) => void)
            : maybeAck;
        try {
          const userObjectId = new Types.ObjectId(userId);
          const convs = await Conversation.find({
            participants: {
              $elemMatch: {
                userId: userObjectId,
                deletedAt: null,
              },
            },
          }).select('_id type participants.userId');

          if (convs.length === 0) {
            ack?.({ ok: true, count: 0 });
            return;
          }

          const currentUser = await User.findById(userObjectId)
            .select('blockedUsers')
            .lean();
          const myBlocked = new Set(
            (currentUser?.blockedUsers || []).map((id) => id.toString())
          );

          const allowedConvIds: Types.ObjectId[] = [];
          const directPeersToCheck: Array<{ convId: Types.ObjectId; peerId: string }> = [];

          for (const conv of convs) {
            if (conv.type === 'direct') {
              const peer = conv.participants.find(
                (p) => p.userId.toString() !== userId
              );
              if (peer) {
                const peerId = peer.userId.toString();
                if (myBlocked.has(peerId)) continue;
                directPeersToCheck.push({ convId: conv._id as Types.ObjectId, peerId });
                continue;
              }
            }
            allowedConvIds.push(conv._id as Types.ObjectId);
          }

          if (directPeersToCheck.length > 0) {
            const peerDocs = await User.find({
              _id: { $in: directPeersToCheck.map((d) => d.peerId) },
            })
              .select('blockedUsers')
              .lean();
            const peerBlockedMap = new Map(
              peerDocs.map((p) => [
                p._id.toString(),
                new Set((p.blockedUsers || []).map((id) => id.toString())),
              ])
            );
            for (const item of directPeersToCheck) {
              if (!peerBlockedMap.get(item.peerId)?.has(userId)) {
                allowedConvIds.push(item.convId);
              }
            }
          }

          if (allowedConvIds.length === 0) {
            ack?.({ ok: true, count: 0 });
            return;
          }

          const undelivered = await Message.find({
            conversationId: { $in: allowedConvIds },
            senderId: { $ne: userObjectId },
            deliveredTo: { $ne: userObjectId },
            deletedAt: null,
          }).select('_id conversationId senderId');

          if (undelivered.length === 0) {
            ack?.({ ok: true, count: 0 });
            return;
          }

          const msgIds = undelivered.map((m) => m._id);
          await Promise.all([
            Message.updateMany(
              { _id: { $in: msgIds } },
              { $addToSet: { deliveredTo: userObjectId } }
            ),
            Message.updateMany(
              { _id: { $in: msgIds }, deliveryStatus: 'sent' },
              { $set: { deliveryStatus: 'delivered' } }
            ),
          ]);

          const byConv = new Map<
            string,
            { messageIds: string[]; senderIds: Set<string> }
          >();
          for (const m of undelivered) {
            const cid = m.conversationId.toString();
            const entry = byConv.get(cid) || {
              messageIds: [],
              senderIds: new Set<string>(),
            };
            entry.messageIds.push(m._id.toString());
            entry.senderIds.add(m.senderId.toString());
            byConv.set(cid, entry);
          }

          for (const [cid, entry] of byConv.entries()) {
            const eventPayload = {
              conversationId: cid,
              messageIds: entry.messageIds,
              userId,
            };
            io.to(`conversation:${cid}`).emit('message:delivered', eventPayload);
            for (const sid of entry.senderIds) {
              io.to(`user:${sid}`).emit('message:delivered', eventPayload);
            }
          }

          ack?.({ ok: true, count: undelivered.length });
        } catch {
          ack?.({ ok: false, count: 0 });
        }
      }
    );

    socket.on(
      'message:delivered',
      async (
        payload: { conversationId?: string; messageIds?: string[]; messageId?: string },
        ack?: (res: { ok: boolean; messageIds?: string[] }) => void
      ) => {
        try {
          const rawIds = Array.isArray(payload?.messageIds)
            ? payload.messageIds
            : payload?.messageId
              ? [payload.messageId]
              : [];
          if (!payload?.conversationId || rawIds.length === 0) {
            ack?.({ ok: false });
            return;
          }

          const validMessageIds = rawIds.filter((id) => Types.ObjectId.isValid(id));
          if (validMessageIds.length === 0 || !Types.ObjectId.isValid(payload.conversationId)) {
            ack?.({ ok: false });
            return;
          }

          const conv = await Conversation.findOne({
            _id: payload.conversationId,
            'participants.userId': userId,
          }).select('_id type participants.userId');
          if (!conv) {
            ack?.({ ok: false });
            return;
          }

          if (conv.type === 'direct') {
            const peer = conv.participants.find((p) => p.userId.toString() !== userId);
            if (peer) {
              const rel = await getBlockRelationship(userId, peer.userId.toString());
              if (rel.blocked) {
                ack?.({ ok: false });
                return;
              }
            }
          }

          const matching = await Message.find({
            _id: { $in: validMessageIds },
            conversationId: payload.conversationId,
            senderId: { $ne: userId },
            deletedAt: null,
          }).select('_id senderId');

          if (matching.length === 0) {
            ack?.({ ok: true, messageIds: [] });
            return;
          }

          const matchedIds = matching.map((m) => m._id.toString());
          const senderIds = Array.from(new Set(matching.map((m) => m.senderId.toString())));

          await Promise.all([
            Message.updateMany(
              { _id: { $in: matchedIds } },
              { $addToSet: { deliveredTo: userId } }
            ),
            Message.updateMany(
              { _id: { $in: matchedIds }, deliveryStatus: 'sent' },
              { $set: { deliveryStatus: 'delivered' } }
            ),
          ]);

          const eventPayload = {
            conversationId: payload.conversationId,
            messageIds: matchedIds,
            userId,
          };
          io.to(`conversation:${payload.conversationId}`).emit(
            'message:delivered',
            eventPayload
          );
          for (const sid of senderIds) {
            io.to(`user:${sid}`).emit('message:delivered', eventPayload);
          }
          ack?.({ ok: true, messageIds: matchedIds });
        } catch {
          ack?.({ ok: false });
        }
      }
    );

    socket.on(
      'message:read',
      async (
        payload: { conversationId?: string },
        ack?: (res: { ok: boolean; suppressed?: boolean }) => void
      ) => {
        if (!payload?.conversationId || !Types.ObjectId.isValid(payload.conversationId)) {
          ack?.({ ok: false });
          return;
        }
        const conv = await Conversation.findOne({
          _id: payload.conversationId,
          'participants.userId': userId,
        });
        if (!conv) {
          ack?.({ ok: false });
          return;
        }

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
          deletedAt: null,
        }).select('_id senderId');

        if (undelivered.length > 0) {
          const deliveredIds = undelivered.map((m) => m._id.toString());
          const deliveredSenders = Array.from(
            new Set(undelivered.map((m) => m.senderId.toString()))
          );
          await Promise.all([
            Message.updateMany(
              { _id: { $in: deliveredIds } },
              { $addToSet: { deliveredTo: userId } }
            ),
            Message.updateMany(
              { _id: { $in: deliveredIds }, deliveryStatus: 'sent' },
              { $set: { deliveryStatus: 'delivered' } }
            ),
          ]);
          const deliveredPayload = {
            conversationId: payload.conversationId,
            messageIds: deliveredIds,
            userId,
          };
          io.to(`conversation:${payload.conversationId}`).emit(
            'message:delivered',
            deliveredPayload
          );
          for (const sid of deliveredSenders) {
            io.to(`user:${sid}`).emit('message:delivered', deliveredPayload);
          }
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
            deletedAt: null,
          }).select('_id senderId');

          if (unread.length > 0) {
            const messageIds = unread.map((m) => m._id.toString());
            const readSenders = Array.from(
              new Set(unread.map((m) => m.senderId.toString()))
            );
            await Message.updateMany(
              { _id: { $in: messageIds } },
              {
                $addToSet: { readBy: userId, deliveredTo: userId },
                $set: { deliveryStatus: 'read' },
              }
            );

            const readPayload = {
              conversationId: payload.conversationId,
              messageIds,
              userId,
              readAt: now,
            };
            io.to(`conversation:${payload.conversationId}`).emit(
              'message:read',
              readPayload
            );
            for (const sid of readSenders) {
              io.to(`user:${sid}`).emit('message:read', readPayload);
            }
          }
        }

        ack?.({ ok: true, suppressed: !shouldSendReadReceipt });
      }
    );

    const formatSocketErr = (err: unknown) => {
      if (err instanceof AppError) {
        return { ok: false, code: err.code, message: err.message };
      }
      if (err instanceof ZodError) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: err.issues[0]?.message || 'Invalid call payload.',
        };
      }
      return { ok: false, code: 'CALL_ERROR', message: 'Call action failed.' };
    };

    socket.on(
      'call:initiate',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
      ) => {
        try {
          const parsed = callInitiateSchema.parse(payload);
          const session = await initiateCall({
            callerId: userId,
            recipientId: parsed.recipientId,
            callType: parsed.callType,
            conversationId: parsed.conversationId,
          });
          ack?.({ ok: true, data: session });
        } catch (err) {
          ack?.(formatSocketErr(err));
        }
      }
    );

    socket.on('call:ringing', (payload: unknown) => {
      try {
        const parsed = callActionSchema.parse(payload);
        acknowledgeRinging({ userId, callId: parsed.callId });
      } catch {
        // Ignore invalid ringing ack
      }
    });

    socket.on(
      'call:accept',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
      ) => {
        try {
          const parsed = callActionSchema.parse(payload);
          const session = await acceptCall({
            userId,
            callId: parsed.callId,
            socketId: socket.id,
          });
          ack?.({ ok: true, data: session });
        } catch (err) {
          ack?.(formatSocketErr(err));
        }
      }
    );

    const handleRejectOrDecline = async (
      payload: unknown,
      ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
    ) => {
      try {
        const parsed = callActionSchema.parse(payload);
        const session = await rejectCall({
          userId,
          callId: parsed.callId,
          reason: parsed.reason,
        });
        ack?.({ ok: true, data: session });
      } catch (err) {
        ack?.(formatSocketErr(err));
      }
    };
    socket.on('call:reject', handleRejectOrDecline);
    socket.on('call:decline', handleRejectOrDecline);

    socket.on(
      'call:cancel',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
      ) => {
        try {
          const parsed = callActionSchema.parse(payload);
          const session = await cancelCall({
            userId,
            callId: parsed.callId,
            reason: parsed.reason,
          });
          ack?.({ ok: true, data: session });
        } catch (err) {
          ack?.(formatSocketErr(err));
        }
      }
    );

    socket.on(
      'call:end',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
      ) => {
        try {
          const parsed = callActionSchema.parse(payload);
          const session = await endCall({
            userId,
            callId: parsed.callId,
            reason: parsed.reason,
          });
          ack?.({ ok: true, data: session });
        } catch (err) {
          ack?.(formatSocketErr(err));
        }
      }
    );

    socket.on(
      'call:state',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; data?: unknown; code?: string; message?: string }) => void
      ) => {
        try {
          const parsed = callStateReportSchema.parse(payload);
          const session = await reportClientCallState({
            userId,
            callId: parsed.callId,
            state: parsed.state,
            reason: parsed.reason,
          });
          ack?.({ ok: true, data: session });
        } catch (err) {
          ack?.(formatSocketErr(err));
        }
      }
    );

    socket.on('disconnect', async () => {
      socketFocusState.delete(socket.id);
      const existing = userSockets.get(userId);
      if (existing) {
        existing.delete(socket.id);
        if (existing.size === 0) {
          userSockets.delete(userId);
          handleUserCallDisconnect(userId);
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
  configureCallSignalingRuntime({
    io,
    isUserConnected,
    isUserForegroundVisible,
  });
  return io;
}
