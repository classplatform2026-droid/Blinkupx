import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { CallHistory } from '../models/CallHistory.ts';
import {
  acceptCall,
  getActiveCallForUser,
  getCallSessionForUser,
  issueCallToken,
  rejectCall,
} from '../services/callService.ts';
import {
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
  type PrivacyTargetUserLike,
} from '../services/privacyService.ts';
import { AppError } from '../utils/errors.ts';
import { callTokenSchema } from '../validators/schemas.ts';

export async function getCallToken(req: AuthenticatedRequest, res: Response) {
  const parsed = callTokenSchema.parse(req.body);
  const result = await issueCallToken({
    user: req.user!,
    callId: parsed.callId,
  });

  res.json({
    success: true,
    data: result,
  });
}

export async function getActiveCall(req: AuthenticatedRequest, res: Response) {
  const active = getActiveCallForUser(req.userId!);
  res.json({
    success: true,
    data: active,
  });
}

export async function getCallSession(req: AuthenticatedRequest, res: Response) {
  const callId = String(req.params.callId || '').trim();
  if (!callId || callId.length < 6) {
    throw new AppError('Valid callId is required.', 400, 'INVALID_CALL_ID');
  }
  const result = await getCallSessionForUser({
    userId: req.userId!,
    callId,
  });
  res.json({
    success: true,
    data: result,
  });
}

export async function acceptCallHttp(req: AuthenticatedRequest, res: Response) {
  const callId = String(req.params.callId || '').trim();
  if (!callId || callId.length < 6) {
    throw new AppError('Valid callId is required.', 400, 'INVALID_CALL_ID');
  }
  const session = await acceptCall({
    userId: req.userId!,
    callId,
  });
  res.json({
    success: true,
    data: session,
  });
}

export async function declineCallHttp(req: AuthenticatedRequest, res: Response) {
  const callId = String(req.params.callId || '').trim();
  if (!callId || callId.length < 6) {
    throw new AppError('Valid callId is required.', 400, 'INVALID_CALL_ID');
  }
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 200)
      : 'Call declined';
  const session = await rejectCall({
    userId: req.userId!,
    callId,
    reason,
  });
  res.json({
    success: true,
    data: session,
  });
}

export async function listCallHistory(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const filter = String(req.query.filter || 'all');
  const q = String(req.query.q || '').trim().toLowerCase();

  const query: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
  };

  if (filter === 'missed') {
    query.direction = 'missed';
  }

  const logs = await CallHistory.find(query)
    .populate('contactId', PUBLIC_USER_SELECT)
    .sort({ createdAt: -1 })
    .limit(100);

  const contactIds = Array.from(
    new Set(
      logs
        .map((entry) => {
          const c = entry.contactId as unknown as PrivacyTargetUserLike | null;
          return c?._id ? c._id.toString() : '';
        })
        .filter(Boolean)
    )
  );
  const viewerContext = await getViewerRelationshipContext(userId, contactIds);

  let serialized = logs.map((entry) => ({
    id: entry._id.toString(),
    callId: entry.callId || null,
    roomName: entry.roomName || '',
    conversationId: entry.conversationId ? entry.conversationId.toString() : null,
    callType: entry.callType,
    direction: entry.direction,
    status: entry.status,
    duration: entry.duration,
    startedAt: entry.startedAt || entry.createdAt,
    answeredAt: entry.answeredAt || null,
    endedAt: entry.endedAt || null,
    endReason: entry.endReason || '',
    createdAt: entry.createdAt,
    contact: entry.contactId
      ? serializeUserWithPrivacy(
          entry.contactId as unknown as PrivacyTargetUserLike,
          viewerContext
        )
      : null,
  }));

  if (q) {
    serialized = serialized.filter(
      (item) =>
        item.contact?.fullName.toLowerCase().includes(q) ||
        item.contact?.username.toLowerCase().includes(q)
    );
  }

  res.json({ success: true, data: serialized });
}

export async function deleteCallEntry(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  if (!Types.ObjectId.isValid(req.params.id)) {
    throw new AppError('Invalid call history identifier.', 400, 'INVALID_ID');
  }
  const deleted = await CallHistory.findOneAndDelete({
    _id: req.params.id,
    userId: new Types.ObjectId(userId),
  });
  if (!deleted) {
    throw new AppError('Call history entry not found.', 404, 'NOT_FOUND');
  }
  res.json({ success: true, message: 'Call history entry removed.' });
}
