import crypto from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { Types } from 'mongoose';
import type { Server } from 'socket.io';
import { env, isLiveKitConfigured } from '../config/env.ts';
import { CallHistory, type CallHistoryStatus } from '../models/CallHistory.ts';
import { Conversation } from '../models/Conversation.ts';
import { User, type IUser } from '../models/User.ts';
import { AppError } from '../utils/errors.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import { canViewPrivacyField, getBlockRelationship } from './privacyService.ts';

export type CallType = 'voice' | 'video';

export type CallState =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'failed';

export interface CallPeerInfo {
  id: string;
  fullName: string;
  username: string;
  avatar: string;
}

export interface CallSession {
  callId: string;
  roomName: string;
  conversationId: string | null;
  callType: CallType;
  callerId: string;
  receiverId: string;
  caller: CallPeerInfo;
  receiver: CallPeerInfo;
  state: CallState;
  acceptedSocketId: string | null;
  connectedUserIds: Set<string>;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string;
  historyPersisted: boolean;
}

export interface SerializedCallSessionForUser {
  callId: string;
  roomName: string;
  conversationId: string | null;
  callType: CallType;
  role: 'caller' | 'receiver';
  state: CallState;
  peer: CallPeerInfo;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string;
  recipientOnline?: boolean;
}

const RING_TIMEOUT_ONLINE_MS = 45_000;
const RING_TIMEOUT_OFFLINE_MS = 20_000;
const DISCONNECT_GRACE_ACTIVE_MS = 15_000;
const DISCONNECT_GRACE_RINGING_MS = 5_000;
const CALL_INIT_RATE_WINDOW_MS = 60_000;
const CALL_INIT_RATE_MAX = 8;

const activeCalls = new Map<string, CallSession>();
const userActiveCallId = new Map<string, string>();
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const callInitRateMap = new Map<string, number[]>();

let ioRef: Server | null = null;
let isUserConnectedFn: ((userId: string) => boolean) | null = null;

export function configureCallSignalingRuntime(params: {
  io: Server;
  isUserConnected: (userId: string) => boolean;
}): void {
  ioRef = params.io;
  isUserConnectedFn = params.isUserConnected;
}

function getIsUserOnline(userId: string): boolean {
  return Boolean(isUserConnectedFn?.(userId));
}

function clearRingTimer(callId: string): void {
  const timer = ringTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(callId);
  }
}

function clearDisconnectTimer(userId: string): void {
  const timer = disconnectTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(userId);
  }
}

function serializeSessionFor(
  session: CallSession,
  viewerUserId: string
): SerializedCallSessionForUser {
  const isCaller = session.callerId === viewerUserId;
  return {
    callId: session.callId,
    roomName: session.roomName,
    conversationId: session.conversationId,
    callType: session.callType,
    role: isCaller ? 'caller' : 'receiver',
    state: session.state,
    peer: isCaller ? session.receiver : session.caller,
    startedAt: session.startedAt.toISOString(),
    answeredAt: session.answeredAt ? session.answeredAt.toISOString() : null,
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    endReason: session.endReason,
    recipientOnline: isCaller ? getIsUserOnline(session.receiverId) : true,
  };
}

function emitToUser(userId: string, event: string, payload: unknown): void {
  ioRef?.to(`user:${userId}`).emit(event, payload);
}

function enforceCallInitiationRateLimit(userId: string): void {
  const now = Date.now();
  const prev = callInitRateMap.get(userId) || [];
  const recent = prev.filter((ts) => now - ts < CALL_INIT_RATE_WINDOW_MS);
  if (recent.length >= CALL_INIT_RATE_MAX) {
    throw new AppError(
      'Too many call attempts. Please wait a moment before calling again.',
      429,
      'CALL_RATE_LIMITED'
    );
  }
  recent.push(now);
  callInitRateMap.set(userId, recent);
}

async function persistCallHistoryRecords(params: {
  session: CallSession;
  callerStatus: CallHistoryStatus;
  receiverStatus: CallHistoryStatus;
  callerDirection?: 'outgoing' | 'missed';
  receiverDirection?: 'incoming' | 'missed';
}): Promise<void> {
  const { session } = params;
  if (session.historyPersisted) return;
  session.historyPersisted = true;

  const endedAt = session.endedAt || new Date();
  const duration =
    session.answeredAt && endedAt.getTime() > session.answeredAt.getTime()
      ? Math.max(1, Math.round((endedAt.getTime() - session.answeredAt.getTime()) / 1000))
      : 0;

  const convObjId =
    session.conversationId && Types.ObjectId.isValid(session.conversationId)
      ? new Types.ObjectId(session.conversationId)
      : null;
  const callerObjId = new Types.ObjectId(session.callerId);
  const receiverObjId = new Types.ObjectId(session.receiverId);

  const callerEntry = {
    userId: callerObjId,
    contactId: receiverObjId,
    callId: session.callId,
    roomName: session.roomName,
    conversationId: convObjId,
    callerId: callerObjId,
    receiverId: receiverObjId,
    callType: session.callType,
    direction: params.callerDirection || 'outgoing',
    status: params.callerStatus,
    duration,
    startedAt: session.startedAt,
    answeredAt: session.answeredAt,
    endedAt,
    endReason: session.endReason || '',
  };

  const receiverEntry = {
    userId: receiverObjId,
    contactId: callerObjId,
    callId: session.callId,
    roomName: session.roomName,
    conversationId: convObjId,
    callerId: callerObjId,
    receiverId: receiverObjId,
    callType: session.callType,
    direction: params.receiverDirection || 'incoming',
    status: params.receiverStatus,
    duration,
    startedAt: session.startedAt,
    answeredAt: session.answeredAt,
    endedAt,
    endReason: session.endReason || '',
  };

  try {
    await Promise.all([
      CallHistory.findOneAndUpdate(
        { callId: session.callId, userId: callerObjId },
        { $setOnInsert: callerEntry },
        { upsert: true, returnDocument: 'after' }
      ),
      CallHistory.findOneAndUpdate(
        { callId: session.callId, userId: receiverObjId },
        { $setOnInsert: receiverEntry },
        { upsert: true, returnDocument: 'after' }
      ),
    ]);

    emitToUser(session.callerId, 'call:history_updated', { callId: session.callId });
    emitToUser(session.receiverId, 'call:history_updated', { callId: session.callId });
  } catch (err) {
    console.error('[CallService] Failed to persist CallHistory:', err);
  }
}

function cleanupSession(session: CallSession): void {
  clearRingTimer(session.callId);
  clearDisconnectTimer(session.callerId);
  clearDisconnectTimer(session.receiverId);

  if (userActiveCallId.get(session.callerId) === session.callId) {
    userActiveCallId.delete(session.callerId);
  }
  if (userActiveCallId.get(session.receiverId) === session.callId) {
    userActiveCallId.delete(session.receiverId);
  }
  activeCalls.delete(session.callId);
}

async function finalizeSession(params: {
  session: CallSession;
  terminalState: 'ended' | 'rejected' | 'missed' | 'failed';
  callerStatus: CallHistoryStatus;
  receiverStatus: CallHistoryStatus;
  callerDirection?: 'outgoing' | 'missed';
  receiverDirection?: 'incoming' | 'missed';
  reason?: string;
  eventNames?: string[];
}): Promise<void> {
  const { session, terminalState, reason = '' } = params;
  if (['ended', 'rejected', 'missed', 'failed'].includes(session.state)) {
    return;
  }

  session.state = terminalState;
  session.endedAt = new Date();
  session.endReason = reason;

  cleanupSession(session);

  await persistCallHistoryRecords({
    session,
    callerStatus: params.callerStatus,
    receiverStatus: params.receiverStatus,
    callerDirection: params.callerDirection,
    receiverDirection: params.receiverDirection,
  });

  const eventsToEmit = params.eventNames || ['call:ended'];
  for (const evt of eventsToEmit) {
    emitToUser(session.callerId, evt, serializeSessionFor(session, session.callerId));
    emitToUser(session.receiverId, evt, serializeSessionFor(session, session.receiverId));
  }
}

async function buildPeerInfoWithPrivacy(
  targetUser: IUser,
  viewerId: string,
  hasDirectConversation: boolean
): Promise<CallPeerInfo> {
  const settings = resolveUserSettings(targetUser.settings);
  const canViewAvatar = canViewPrivacyField(
    settings.privacy.profilePhoto,
    targetUser._id.toString() === viewerId,
    hasDirectConversation,
    false
  );
  return {
    id: targetUser._id.toString(),
    fullName: targetUser.fullName,
    username: targetUser.username,
    avatar: canViewAvatar ? targetUser.avatar || '' : '',
  };
}

export function getActiveCallForUser(userId: string): SerializedCallSessionForUser | null {
  const callId = userActiveCallId.get(userId);
  if (!callId) return null;
  const session = activeCalls.get(callId);
  if (!session) {
    userActiveCallId.delete(userId);
    return null;
  }
  return serializeSessionFor(session, userId);
}

export async function initiateCall(params: {
  callerId: string;
  recipientId: string;
  callType: CallType;
  conversationId?: string | null;
}): Promise<SerializedCallSessionForUser> {
  const { callerId, recipientId, callType, conversationId } = params;

  if (!isLiveKitConfigured()) {
    throw new AppError(
      'Voice and video calling requires LiveKit configuration on the server.',
      503,
      'LIVEKIT_NOT_CONFIGURED'
    );
  }

  if (!Types.ObjectId.isValid(callerId) || !Types.ObjectId.isValid(recipientId)) {
    throw new AppError('Invalid participant identifier.', 400, 'INVALID_PARTICIPANT');
  }
  if (callerId === recipientId) {
    throw new AppError('You cannot call yourself.', 400, 'SELF_CALL_NOT_ALLOWED');
  }

  enforceCallInitiationRateLimit(callerId);

  if (userActiveCallId.has(callerId)) {
    throw new AppError(
      'You already have an active call in progress.',
      409,
      'CALLER_ALREADY_IN_CALL'
    );
  }

  const [callerUser, recipientUser] = await Promise.all([
    User.findById(callerId),
    User.findById(recipientId),
  ]);

  if (!callerUser || !callerUser.isVerified) {
    throw new AppError('Your account is not authorized to place calls.', 401, 'UNAUTHORIZED');
  }
  if (!recipientUser || !recipientUser.isVerified) {
    throw new AppError('Recipient user was not found.', 404, 'USER_NOT_FOUND');
  }

  const rel = await getBlockRelationship(callerId, recipientId);
  if (rel.blocked) {
    throw new AppError(
      rel.blockedByA
        ? 'Unblock this contact before starting a call.'
        : 'Calling is unavailable for this contact.',
      403,
      'USER_BLOCKED'
    );
  }

  // Validate conversation if provided, or find existing direct conversation
  let resolvedConversationId: string | null = null;
  let hasDirectConversation = false;

  if (conversationId) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new AppError('Invalid conversation ID.', 400, 'INVALID_CONVERSATION_ID');
    }
    const conv = await Conversation.findOne({
      _id: conversationId,
      type: 'direct',
      'participants.userId': { $all: [new Types.ObjectId(callerId), new Types.ObjectId(recipientId)] },
    }).select('_id');
    if (!conv) {
      throw new AppError(
        'You do not have permission to start a call in this conversation.',
        403,
        'FORBIDDEN'
      );
    }
    resolvedConversationId = conv._id.toString();
    hasDirectConversation = true;
  } else {
    const existingConv = await Conversation.findOne({
      type: 'direct',
      'participants.userId': { $all: [new Types.ObjectId(callerId), new Types.ObjectId(recipientId)] },
    }).select('_id');
    if (existingConv) {
      resolvedConversationId = existingConv._id.toString();
      hasDirectConversation = true;
    }
  }

  // Re-check locks after async database calls to prevent simultaneous race conditions
  if (userActiveCallId.has(callerId)) {
    throw new AppError(
      'You already have an active call in progress.',
      409,
      'CALLER_ALREADY_IN_CALL'
    );
  }

  const [callerInfo, receiverInfo] = await Promise.all([
    buildPeerInfoWithPrivacy(callerUser, recipientId, hasDirectConversation),
    buildPeerInfoWithPrivacy(recipientUser, callerId, hasDirectConversation),
  ]);

  const callId = `call_${crypto.randomUUID().replace(/-/g, '')}`;
  const roomName = `blinkupz_${callId}`;

  // Handle busy recipient without disrupting their existing call
  if (userActiveCallId.has(recipientId)) {
    const now = new Date();
    const busySession: CallSession = {
      callId,
      roomName,
      conversationId: resolvedConversationId,
      callType,
      callerId,
      receiverId: recipientId,
      caller: callerInfo,
      receiver: receiverInfo,
      state: 'ended',
      acceptedSocketId: null,
      connectedUserIds: new Set(),
      startedAt: now,
      answeredAt: null,
      endedAt: now,
      endReason: 'Recipient is on another call',
      historyPersisted: false,
    };

    await persistCallHistoryRecords({
      session: busySession,
      callerStatus: 'busy',
      receiverStatus: 'missed',
      callerDirection: 'outgoing',
      receiverDirection: 'missed',
    });

    emitToUser(callerId, 'call:busy', serializeSessionFor(busySession, callerId));
    throw new AppError('Recipient is currently on another call.', 409, 'RECIPIENT_BUSY');
  }

  const recipientOnline = getIsUserOnline(recipientId);
  const session: CallSession = {
    callId,
    roomName,
    conversationId: resolvedConversationId,
    callType,
    callerId,
    receiverId: recipientId,
    caller: callerInfo,
    receiver: receiverInfo,
    state: 'initiating',
    acceptedSocketId: null,
    connectedUserIds: new Set(),
    startedAt: new Date(),
    answeredAt: null,
    endedAt: null,
    endReason: '',
    historyPersisted: false,
  };

  activeCalls.set(callId, session);
  userActiveCallId.set(callerId, callId);
  userActiveCallId.set(recipientId, callId);

  const timeoutMs = recipientOnline ? RING_TIMEOUT_ONLINE_MS : RING_TIMEOUT_OFFLINE_MS;
  const timer = setTimeout(() => {
    const current = activeCalls.get(callId);
    if (!current) return;
    if (current.state === 'initiating' || current.state === 'ringing') {
      void finalizeSession({
        session: current,
        terminalState: 'missed',
        callerStatus: 'missed',
        receiverStatus: 'missed',
        callerDirection: 'outgoing',
        receiverDirection: 'missed',
        reason: recipientOnline ? 'No answer' : 'Recipient unavailable',
        eventNames: ['call:missed', 'call:ended'],
      });
    }
  }, timeoutMs);
  ringTimers.set(callId, timer);

  // Notify all connected sockets of the recipient immediately
  emitToUser(recipientId, 'call:incoming', serializeSessionFor(session, recipientId));

  return serializeSessionFor(session, callerId);
}

export function acknowledgeRinging(params: {
  userId: string;
  callId: string;
}): SerializedCallSessionForUser | null {
  const session = activeCalls.get(params.callId);
  if (!session || session.receiverId !== params.userId) {
    return null;
  }
  if (session.state === 'initiating') {
    session.state = 'ringing';
    const payloadForCaller = serializeSessionFor(session, session.callerId);
    emitToUser(session.callerId, 'call:ringing', payloadForCaller);
  }
  return serializeSessionFor(session, params.userId);
}

export async function acceptCall(params: {
  userId: string;
  callId: string;
  socketId?: string;
}): Promise<SerializedCallSessionForUser> {
  const session = activeCalls.get(params.callId);
  if (!session) {
    throw new AppError('Call is no longer active.', 404, 'CALL_NOT_FOUND');
  }
  if (session.receiverId !== params.userId) {
    throw new AppError('Only the intended recipient can accept this call.', 403, 'FORBIDDEN');
  }
  if (session.state !== 'initiating' && session.state !== 'ringing') {
    throw new AppError('Call cannot be accepted in its current state.', 409, 'INVALID_CALL_STATE');
  }

  const rel = await getBlockRelationship(session.callerId, session.receiverId);
  if (rel.blocked) {
    await finalizeSession({
      session,
      terminalState: 'failed',
      callerStatus: 'failed',
      receiverStatus: 'failed',
      callerDirection: 'outgoing',
      receiverDirection: 'incoming',
      reason: 'Call blocked',
      eventNames: ['call:failed', 'call:ended'],
    });
    throw new AppError('Call blocked between users.', 403, 'USER_BLOCKED');
  }

  clearRingTimer(session.callId);
  session.state = 'connecting';
  session.answeredAt = new Date();
  session.acceptedSocketId = params.socketId || null;

  const callerPayload = serializeSessionFor(session, session.callerId);
  const receiverPayload = serializeSessionFor(session, session.receiverId);

  emitToUser(session.callerId, 'call:accept', callerPayload);
  // Sync across recipient's other open tabs so secondary tabs dismiss the incoming ring overlay
  if (ioRef && params.socketId) {
    ioRef.to(`user:${session.receiverId}`).except(params.socketId).emit('call:answered_elsewhere', {
      callId: session.callId,
    });
  }

  return receiverPayload;
}

export async function rejectCall(params: {
  userId: string;
  callId: string;
  reason?: string;
}): Promise<SerializedCallSessionForUser> {
  const session = activeCalls.get(params.callId);
  if (!session) {
    throw new AppError('Call is no longer active.', 404, 'CALL_NOT_FOUND');
  }
  if (session.receiverId !== params.userId) {
    throw new AppError('Only the intended recipient can reject this call.', 403, 'FORBIDDEN');
  }
  if (session.state !== 'initiating' && session.state !== 'ringing') {
    throw new AppError('Call cannot be rejected in its current state.', 409, 'INVALID_CALL_STATE');
  }

  const reason = params.reason || 'Call declined';
  await finalizeSession({
    session,
    terminalState: 'rejected',
    callerStatus: 'declined',
    receiverStatus: 'declined',
    callerDirection: 'outgoing',
    receiverDirection: 'incoming',
    reason,
    eventNames: ['call:reject', 'call:decline', 'call:ended'],
  });

  return serializeSessionFor(session, params.userId);
}

export async function cancelCall(params: {
  userId: string;
  callId: string;
  reason?: string;
}): Promise<SerializedCallSessionForUser> {
  const session = activeCalls.get(params.callId);
  if (!session) {
    throw new AppError('Call is no longer active.', 404, 'CALL_NOT_FOUND');
  }
  if (session.callerId !== params.userId) {
    throw new AppError('Only the caller can cancel an outgoing call.', 403, 'FORBIDDEN');
  }
  if (session.state !== 'initiating' && session.state !== 'ringing') {
    throw new AppError('Call has already been answered or ended.', 409, 'INVALID_CALL_STATE');
  }

  await finalizeSession({
    session,
    terminalState: 'ended',
    callerStatus: 'cancelled',
    receiverStatus: 'missed',
    callerDirection: 'outgoing',
    receiverDirection: 'missed',
    reason: params.reason || 'Call cancelled',
    eventNames: ['call:cancel', 'call:ended'],
  });

  return serializeSessionFor(session, params.userId);
}

export async function endCall(params: {
  userId: string;
  callId: string;
  reason?: string;
}): Promise<SerializedCallSessionForUser | null> {
  const session = activeCalls.get(params.callId);
  if (!session) {
    return null;
  }
  if (session.callerId !== params.userId && session.receiverId !== params.userId) {
    throw new AppError('You are not a participant in this call.', 403, 'FORBIDDEN');
  }

  // If ended before acceptance, delegate appropriately
  if (session.state === 'initiating' || session.state === 'ringing') {
    if (session.callerId === params.userId) {
      return cancelCall(params);
    }
    return rejectCall(params);
  }

  const wasAnswered = Boolean(session.answeredAt);
  await finalizeSession({
    session,
    terminalState: 'ended',
    callerStatus: wasAnswered ? 'completed' : 'cancelled',
    receiverStatus: wasAnswered ? 'completed' : 'missed',
    callerDirection: 'outgoing',
    receiverDirection: wasAnswered ? 'incoming' : 'missed',
    reason: params.reason || 'Call ended',
    eventNames: ['call:ended'],
  });

  return serializeSessionFor(session, params.userId);
}

export async function reportClientCallState(params: {
  userId: string;
  callId: string;
  state: 'connecting' | 'connected' | 'reconnecting' | 'failed';
  reason?: string;
}): Promise<SerializedCallSessionForUser | null> {
  const session = activeCalls.get(params.callId);
  if (!session) return null;
  if (session.callerId !== params.userId && session.receiverId !== params.userId) {
    throw new AppError('Unauthorized call state update.', 403, 'FORBIDDEN');
  }
  if (['ended', 'rejected', 'missed', 'failed'].includes(session.state)) {
    return serializeSessionFor(session, params.userId);
  }

  if (params.state === 'failed') {
    const hadConnected = session.connectedUserIds.size > 0;
    await finalizeSession({
      session,
      terminalState: 'failed',
      callerStatus: hadConnected ? 'completed' : 'failed',
      receiverStatus: hadConnected ? 'completed' : 'failed',
      callerDirection: 'outgoing',
      receiverDirection: 'incoming',
      reason: params.reason || 'Connection failed',
      eventNames: ['call:failed', 'call:ended'],
    });
    return serializeSessionFor(session, params.userId);
  }

  if (params.state === 'connected') {
    session.connectedUserIds.add(params.userId);
    if (session.state === 'connecting' || session.state === 'reconnecting') {
      session.state = 'connected';
      if (!session.answeredAt) {
        session.answeredAt = new Date();
      }
      session.endReason = '';
      emitToUser(session.callerId, 'call:state', serializeSessionFor(session, session.callerId));
      emitToUser(session.receiverId, 'call:state', serializeSessionFor(session, session.receiverId));
    }
  } else if (params.state === 'reconnecting') {
    session.state = 'reconnecting';
    session.endReason = params.reason || 'Reconnecting...';
    const peerId = session.callerId === params.userId ? session.receiverId : session.callerId;
    emitToUser(peerId, 'call:state', serializeSessionFor(session, peerId));
  }

  return serializeSessionFor(session, params.userId);
}

export async function issueCallToken(params: {
  user: IUser;
  callId: string;
}): Promise<{
  url: string;
  token: string;
  roomName: string;
  callId: string;
  callType: CallType;
}> {
  if (!isLiveKitConfigured()) {
    throw new AppError(
      'Voice and video calling requires LiveKit configuration on the server.',
      503,
      'LIVEKIT_NOT_CONFIGURED'
    );
  }

  const userId = params.user._id.toString();
  const session = activeCalls.get(params.callId);

  if (!session) {
    throw new AppError(
      'Call session not found or has already ended.',
      404,
      'CALL_NOT_FOUND'
    );
  }

  if (session.callerId !== userId && session.receiverId !== userId) {
    throw new AppError(
      'You are not authorized to join this private call room.',
      403,
      'FORBIDDEN'
    );
  }

  if (['ended', 'rejected', 'missed', 'failed'].includes(session.state)) {
    throw new AppError('This call has already ended.', 409, 'CALL_ENDED');
  }

  if (!['connecting', 'connected', 'reconnecting'].includes(session.state)) {
    throw new AppError(
      'Call must be accepted before connecting to the media room.',
      409,
      'CALL_NOT_ACCEPTED'
    );
  }

  const rel = await getBlockRelationship(session.callerId, session.receiverId);
  if (rel.blocked) {
    await finalizeSession({
      session,
      terminalState: 'failed',
      callerStatus: 'failed',
      receiverStatus: 'failed',
      reason: 'Call blocked',
      eventNames: ['call:failed', 'call:ended'],
    });
    throw new AppError('Calling is blocked between these users.', 403, 'USER_BLOCKED');
  }

  const at = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
    identity: userId,
    name: params.user.fullName,
    ttl: '1h',
    metadata: JSON.stringify({
      username: params.user.username,
      callId: session.callId,
    }),
  });

  at.addGrant({
    room: session.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomCreate: false,
    roomAdmin: false,
    roomRecord: false,
  });

  const token = await at.toJwt();

  return {
    url: env.livekit.url,
    token,
    roomName: session.roomName,
    callId: session.callId,
    callType: session.callType,
  };
}

export function handleUserCallReconnect(userId: string): SerializedCallSessionForUser | null {
  clearDisconnectTimer(userId);
  const session = getActiveCallForUser(userId);
  if (!session) return null;

  const rawSession = activeCalls.get(session.callId);
  if (rawSession && rawSession.state === 'reconnecting') {
    rawSession.state = 'connected';
    rawSession.endReason = '';
    const peerId = rawSession.callerId === userId ? rawSession.receiverId : rawSession.callerId;
    emitToUser(peerId, 'call:state', serializeSessionFor(rawSession, peerId));
  }
  return getActiveCallForUser(userId);
}

export function handleUserCallDisconnect(userId: string): void {
  const callId = userActiveCallId.get(userId);
  if (!callId) return;
  const session = activeCalls.get(callId);
  if (!session) {
    userActiveCallId.delete(userId);
    return;
  }

  clearDisconnectTimer(userId);

  if (session.state === 'initiating' || session.state === 'ringing') {
    if (session.callerId === userId) {
      // Caller disconnected before answer — brief grace for page refresh
      const timer = setTimeout(() => {
        disconnectTimers.delete(userId);
        if (getIsUserOnline(userId)) return;
        const curr = activeCalls.get(callId);
        if (curr && (curr.state === 'initiating' || curr.state === 'ringing')) {
          void finalizeSession({
            session: curr,
            terminalState: 'ended',
            callerStatus: 'cancelled',
            receiverStatus: 'missed',
            callerDirection: 'outgoing',
            receiverDirection: 'missed',
            reason: 'Caller disconnected',
            eventNames: ['call:cancel', 'call:ended'],
          });
        }
      }, DISCONNECT_GRACE_RINGING_MS);
      disconnectTimers.set(userId, timer);
    }
    return;
  }

  if (['connecting', 'connected', 'reconnecting'].includes(session.state)) {
    session.state = 'reconnecting';
    session.endReason = 'Participant connection lost, reconnecting...';
    const peerId = session.callerId === userId ? session.receiverId : session.callerId;
    emitToUser(peerId, 'call:state', serializeSessionFor(session, peerId));

    const timer = setTimeout(() => {
      disconnectTimers.delete(userId);
      if (getIsUserOnline(userId)) return;
      const curr = activeCalls.get(callId);
      if (!curr) return;
      const hadConnected = curr.connectedUserIds.size > 0;
      void finalizeSession({
        session: curr,
        terminalState: hadConnected ? 'ended' : 'failed',
        callerStatus: hadConnected ? 'completed' : 'failed',
        receiverStatus: hadConnected ? 'completed' : 'failed',
        callerDirection: 'outgoing',
        receiverDirection: 'incoming',
        reason: 'Connection lost',
        eventNames: [hadConnected ? 'call:ended' : 'call:failed', 'call:ended'],
      });
    }, DISCONNECT_GRACE_ACTIVE_MS);
    disconnectTimers.set(userId, timer);
  }
}
