import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { CallHistory } from '../models/CallHistory.ts';
import { AppError } from '../utils/errors.ts';
import { serializePublicUser } from '../utils/serializers.ts';

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
    .populate('contactId', 'fullName username avatar bio onlineStatus lastSeen')
    .sort({ createdAt: -1 })
    .limit(100);

  let serialized = logs.map((entry) => ({
    id: entry._id.toString(),
    callType: entry.callType,
    direction: entry.direction,
    status: entry.status,
    duration: entry.duration,
    createdAt: entry.createdAt,
    contact: entry.contactId
      ? serializePublicUser(
          entry.contactId as unknown as Parameters<typeof serializePublicUser>[0]
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
  const deleted = await CallHistory.findOneAndDelete({
    _id: req.params.id,
    userId: new Types.ObjectId(userId),
  });
  if (!deleted) {
    throw new AppError('Call history entry not found.', 404, 'NOT_FOUND');
  }
  res.json({ success: true, message: 'Call history entry removed.' });
}
