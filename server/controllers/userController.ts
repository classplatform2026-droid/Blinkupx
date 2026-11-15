import type { Response } from 'express';
import { Types } from 'mongoose';
import QRCode from 'qrcode';
import { env, getServiceStatus } from '../config/env.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { User } from '../models/User.ts';
import {
  getViewerRelationshipContext,
  PUBLIC_USER_SELECT,
  serializeUserWithPrivacy,
} from '../services/privacyService.ts';
import { emitPresenceToAuthorizedViewers, getIO } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { resolveUserSettings, serializeUser } from '../utils/serializers.ts';
import {
  notificationSettingsSchema,
  privacySettingsSchema,
  updateProfileSchema,
} from '../validators/schemas.ts';

export async function getMe(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    throw new AppError('Unauthorized.', 401, 'UNAUTHORIZED');
  }
  res.json({
    success: true,
    data: {
      user: serializeUser(req.user),
      services: getServiceStatus(),
    },
  });
}

export async function searchUsers(req: AuthenticatedRequest, res: Response) {
  const viewerId = req.userId!;
  const q = String(req.query.q || '').trim();
  const filter: Record<string, unknown> = {
    _id: { $ne: viewerId },
    isVerified: true,
  };

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ fullName: regex }, { username: regex }];
  }

  const users = await User.find(filter)
    .select(PUBLIC_USER_SELECT)
    .sort({ onlineStatus: -1, fullName: 1 })
    .limit(40);

  const context = await getViewerRelationshipContext(
    viewerId,
    users.map((u) => u._id.toString())
  );

  res.json({
    success: true,
    data: users.map((u) => serializeUserWithPrivacy(u, context)),
  });
}

export async function getUserById(req: AuthenticatedRequest, res: Response) {
  const viewerId = req.userId!;
  if (!Types.ObjectId.isValid(req.params.id)) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const user = await User.findOne({ _id: req.params.id, isVerified: true }).select(
    PUBLIC_USER_SELECT
  );
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const context = await getViewerRelationshipContext(viewerId, [user._id.toString()]);

  res.json({
    success: true,
    data: serializeUserWithPrivacy(user, context),
  });
}

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
  const parsed = updateProfileSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  if (parsed.username && parsed.username !== user.username) {
    const taken = await User.findOne({
      username: parsed.username,
      _id: { $ne: user._id },
      isVerified: true,
    });
    if (taken) {
      throw new AppError('This username is already taken.', 409, 'USERNAME_EXISTS');
    }
    user.username = parsed.username;
  }

  if (parsed.fullName !== undefined) user.fullName = parsed.fullName;
  if (parsed.bio !== undefined) user.bio = parsed.bio;
  if (parsed.avatar !== undefined) user.avatar = parsed.avatar;

  let privacyChanged = false;
  if (parsed.settings) {
    const current = resolveUserSettings(user.settings);
    const nextReadReceipts =
      parsed.settings.privacy?.readReceipts ??
      parsed.settings.readReceipts ??
      current.privacy.readReceipts;

    if (parsed.settings.privacy || parsed.settings.readReceipts !== undefined) {
      privacyChanged = true;
    }

    user.settings = {
      density: parsed.settings.density ?? current.density,
      enterToSend: parsed.settings.enterToSend ?? current.enterToSend,
      readReceipts: nextReadReceipts,
      typingIndicators: parsed.settings.typingIndicators ?? current.typingIndicators,
      autoDownloadMedia: parsed.settings.autoDownloadMedia ?? current.autoDownloadMedia,
      language: parsed.settings.language ?? current.language,
      privacy: {
        ...current.privacy,
        ...(parsed.settings.privacy || {}),
        readReceipts: nextReadReceipts,
      },
      notifications: {
        ...current.notifications,
        ...(parsed.settings.notifications || {}),
      },
    };
    user.markModified('settings');
  }

  await user.save();

  if (privacyChanged || parsed.avatar !== undefined || parsed.bio !== undefined) {
    await emitPresenceToAuthorizedViewers(user._id.toString());
    getIO()?.emit('user:privacy_updated', { userId: user._id.toString() });
  }

  res.json({
    success: true,
    message: 'Profile updated.',
    data: serializeUser(user),
  });
}

export async function updatePrivacySettings(req: AuthenticatedRequest, res: Response) {
  const parsed = privacySettingsSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const current = resolveUserSettings(user.settings);
  const nextReadReceipts = parsed.readReceipts ?? current.privacy.readReceipts;

  user.settings = {
    ...current,
    readReceipts: nextReadReceipts,
    privacy: {
      ...current.privacy,
      ...parsed,
      readReceipts: nextReadReceipts,
    },
  };
  user.markModified('settings');
  await user.save();

  await emitPresenceToAuthorizedViewers(user._id.toString());
  getIO()?.emit('user:privacy_updated', { userId: user._id.toString() });

  res.json({
    success: true,
    message: 'Privacy settings updated.',
    data: serializeUser(user),
  });
}

export async function updateNotificationSettings(req: AuthenticatedRequest, res: Response) {
  const parsed = notificationSettingsSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const current = resolveUserSettings(user.settings);
  user.settings = {
    ...current,
    notifications: {
      ...current.notifications,
      ...parsed,
    },
  };
  user.markModified('settings');
  await user.save();

  res.json({
    success: true,
    message: 'Notification preferences updated.',
    data: serializeUser(user),
  });
}

export async function getBlockedUsers(req: AuthenticatedRequest, res: Response) {
  const user = await User.findById(req.userId).select('blockedUsers');
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const blockedIds = user.blockedUsers || [];
  if (blockedIds.length === 0) {
    return res.json({ success: true, data: [] });
  }

  const blockedDocs = await User.find({
    _id: { $in: blockedIds },
    isVerified: true,
  })
    .select('fullName username avatar')
    .sort({ fullName: 1 });

  res.json({
    success: true,
    data: blockedDocs.map((u) => ({
      id: u._id.toString(),
      fullName: u.fullName,
      username: u.username,
      avatar: u.avatar || '',
      bio: '',
      onlineStatus: false,
      lastSeen: null,
      isBlockedByMe: true,
    })),
  });
}

export async function blockUser(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const targetId = req.params.id;

  if (!Types.ObjectId.isValid(targetId)) {
    throw new AppError('Invalid user identifier.', 400, 'INVALID_USER_ID');
  }
  if (targetId === userId) {
    throw new AppError('You cannot block yourself.', 400, 'CANNOT_BLOCK_SELF');
  }

  const targetUser = await User.findOne({ _id: targetId, isVerified: true }).select(
    'fullName username avatar'
  );
  if (!targetUser) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $addToSet: { blockedUsers: new Types.ObjectId(targetId) } },
    { new: true }
  );

  await Promise.all([
    emitPresenceToAuthorizedViewers(userId),
    emitPresenceToAuthorizedViewers(targetId),
  ]);

  const io = getIO();
  io?.to(`user:${userId}`).emit('user:blocked_updated', {
    targetUserId: targetId,
    blocked: true,
  });
  io?.to(`user:${targetId}`).emit('user:blocked_updated', {
    targetUserId: userId,
    blocked: true,
  });

  res.json({
    success: true,
    message: `${targetUser.fullName} has been blocked.`,
    data: {
      user: updated ? serializeUser(updated) : null,
      blockedUser: {
        id: targetUser._id.toString(),
        fullName: targetUser.fullName,
        username: targetUser.username,
        avatar: targetUser.avatar || '',
      },
    },
  });
}

export async function unblockUser(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const targetId = req.params.id;

  if (!Types.ObjectId.isValid(targetId)) {
    throw new AppError('Invalid user identifier.', 400, 'INVALID_USER_ID');
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $pull: { blockedUsers: new Types.ObjectId(targetId) } },
    { new: true }
  );

  await Promise.all([
    emitPresenceToAuthorizedViewers(userId),
    emitPresenceToAuthorizedViewers(targetId),
  ]);

  const io = getIO();
  io?.to(`user:${userId}`).emit('user:blocked_updated', {
    targetUserId: targetId,
    blocked: false,
  });
  io?.to(`user:${targetId}`).emit('user:blocked_updated', {
    targetUserId: userId,
    blocked: false,
  });

  res.json({
    success: true,
    message: 'Contact unblocked.',
    data: {
      user: updated ? serializeUser(updated) : null,
    },
  });
}

export async function getPublicUserByUsername(req: AuthenticatedRequest, res: Response) {
  const raw = String(req.params.username || '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{3,24}$/.test(raw)) {
    throw new AppError('Invalid BlinkUpZ username.', 400, 'INVALID_USERNAME');
  }

  const user = await User.findOne({ username: raw, isVerified: true }).select(
    PUBLIC_USER_SELECT
  );
  if (!user) {
    throw new AppError('User profile not found.', 404, 'USER_NOT_FOUND');
  }

  const viewerId = req.userId || null;
  const context = await getViewerRelationshipContext(viewerId, [user._id.toString()]);

  res.json({
    success: true,
    data: serializeUserWithPrivacy(user, context),
  });
}

export async function getMyQrCode(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    throw new AppError('Unauthorized.', 401, 'UNAUTHORIZED');
  }

  const requestedOrigin = String(req.query.origin || '').trim();
  const originHeader = req.get('origin') || '';
  const candidateBase =
    requestedOrigin && /^https?:\/\//i.test(requestedOrigin)
      ? requestedOrigin
      : originHeader && /^https?:\/\//i.test(originHeader)
        ? originHeader
        : env.clientUrl;

  const baseUrl = candidateBase.replace(/\/+$/, '');
  const profileUrl = `${baseUrl}/u/${req.user.username}`;

  const [qrSvg, qrDataUrl] = await Promise.all([
    QRCode.toString(profileUrl, {
      type: 'svg',
      margin: 2,
      width: 280,
      color: {
        dark: '#181818',
        light: '#FFFFFF',
      },
    }),
    QRCode.toDataURL(profileUrl, {
      margin: 2,
      width: 512,
      color: {
        dark: '#181818',
        light: '#FFFFFF',
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      username: req.user.username,
      fullName: req.user.fullName,
      profileUrl,
      qrSvg,
      qrDataUrl,
    },
  });
}
