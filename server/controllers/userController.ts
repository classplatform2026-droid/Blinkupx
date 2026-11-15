import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import { env, getServiceStatus } from '../config/env.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { User } from '../models/User.ts';
import { AppError } from '../utils/errors.ts';
import { serializePublicUser, serializeUser } from '../utils/serializers.ts';
import { updateProfileSchema } from '../validators/schemas.ts';

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
  const q = String(req.query.q || '').trim();
  const filter: Record<string, unknown> = {
    _id: { $ne: req.userId },
    isVerified: true,
  };

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ fullName: regex }, { username: regex }];
  }

  const users = await User.find(filter)
    .select('fullName username avatar bio onlineStatus lastSeen')
    .sort({ onlineStatus: -1, fullName: 1 })
    .limit(40);

  res.json({
    success: true,
    data: users.map(serializePublicUser),
  });
}

export async function getUserById(req: AuthenticatedRequest, res: Response) {
  const user = await User.findOne({ _id: req.params.id, isVerified: true }).select(
    'fullName username avatar bio onlineStatus lastSeen'
  );
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }
  res.json({
    success: true,
    data: serializePublicUser(user),
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

  if (parsed.settings) {
    user.settings = {
      ...user.settings,
      ...parsed.settings,
    };
  }

  await user.save();

  res.json({
    success: true,
    message: 'Profile updated.',
    data: serializeUser(user),
  });
}

export async function getPublicUserByUsername(req: Request, res: Response) {
  const raw = String(req.params.username || '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{3,24}$/.test(raw)) {
    throw new AppError('Invalid BlinkUpZ username.', 400, 'INVALID_USERNAME');
  }

  const user = await User.findOne({ username: raw, isVerified: true }).select(
    'fullName username avatar bio onlineStatus lastSeen'
  );
  if (!user) {
    throw new AppError('User profile not found.', 404, 'USER_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializePublicUser(user),
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
