import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { User } from '../models/User.ts';
import {
  clearAuthCookie,
  setAuthCookie,
  signAuthToken,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { issueOtp, normalizePhone, verifyOtpCode } from '../services/otpService.ts';
import { emitPresenceToAuthorizedViewers } from '../sockets/index.ts';
import { AppError } from '../utils/errors.ts';
import { serializeUser } from '../utils/serializers.ts';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '../validators/schemas.ts';

export async function checkUsername(req: Request, res: Response) {
  const raw = String(req.query.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(raw)) {
    return res.json({ success: true, available: false, valid: false });
  }
  const existing = await User.findOne({ username: raw, isVerified: true }).select('_id');
  res.json({ success: true, available: !existing, valid: true });
}

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.parse(req.body);
  const phone = normalizePhone(parsed.phone);
  const email = parsed.email.toLowerCase();
  const username = parsed.username.toLowerCase();

  const existingVerifiedByPhone = await User.findOne({ phone, isVerified: true });
  if (existingVerifiedByPhone) {
    throw new AppError('An account with this phone number already exists.', 409, 'PHONE_EXISTS');
  }

  const existingVerifiedByEmail = await User.findOne({ email, isVerified: true });
  if (existingVerifiedByEmail) {
    throw new AppError('An account with this email address already exists.', 409, 'EMAIL_EXISTS');
  }

  const existingVerifiedByUsername = await User.findOne({ username, isVerified: true });
  if (existingVerifiedByUsername) {
    throw new AppError('This username is already taken.', 409, 'USERNAME_EXISTS');
  }

  const passwordHash = await bcrypt.hash(parsed.password, 12);

  // Clean up any stale unverified registration with same phone, email, or username
  await User.deleteMany({
    isVerified: false,
    $or: [{ phone }, { email }, { username }],
  });

  const user = await User.create({
    fullName: parsed.fullName,
    phone,
    email,
    username,
    passwordHash,
    isVerified: false,
  });

  try {
    const otpInfo = await issueOtp(phone, 'register', email);

    res.status(201).json({
      success: true,
      message: 'Verification code sent to your email.',
      data: {
        phone,
        email,
        username: user.username,
        cooldownSeconds: otpInfo.cooldownSeconds,
        expiresAt: otpInfo.expiresAt,
      },
    });
  } catch (err) {
    await User.deleteOne({ _id: user._id, isVerified: false });
    throw err;
  }
}

export async function verifyOtp(req: Request, res: Response) {
  const parsed = verifyOtpSchema.parse(req.body);
  const phone = normalizePhone(parsed.phone);

  await verifyOtpCode(phone, parsed.code, parsed.purpose);

  if (parsed.purpose === 'register') {
    const user = await User.findOneAndUpdate(
      { phone },
      { $set: { isVerified: true, onlineStatus: true, lastSeen: new Date() } },
      { new: true }
    );
    if (!user) {
      throw new AppError('Account record not found for this phone number.', 404, 'USER_NOT_FOUND');
    }

    const token = signAuthToken(user);
    setAuthCookie(req, res, token);

    return res.json({
      success: true,
      message: 'Account verified successfully.',
      data: {
        user: serializeUser(user),
        token,
      },
    });
  }

  res.json({
    success: true,
    message: 'Verification code confirmed.',
  });
}

export async function resendOtp(req: Request, res: Response) {
  const parsed = resendOtpSchema.parse(req.body);
  const phone = normalizePhone(parsed.phone);

  const user = await User.findOne({ phone });
  if (!user) {
    throw new AppError('No account found for this phone number.', 404, 'USER_NOT_FOUND');
  }
  if (parsed.purpose === 'register' && user.isVerified) {
    throw new AppError('This account is already verified. Please log in.', 400, 'ALREADY_VERIFIED');
  }

  const otpInfo = await issueOtp(phone, parsed.purpose, user.email);

  res.json({
    success: true,
    message: 'Verification code resent.',
    data: {
      phone,
      email: user.email,
      cooldownSeconds: otpInfo.cooldownSeconds,
      expiresAt: otpInfo.expiresAt,
    },
  });
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.parse(req.body);
  const identifier = parsed.identifier.trim();
  const maybePhone = normalizePhone(identifier);
  const maybeLower = identifier.toLowerCase().replace(/^@/, '');

  const user = await User.findOne({
    $or: [{ username: maybeLower }, { email: maybeLower }, { phone: maybePhone }],
  }).select('+passwordHash');

  if (!user) {
    throw new AppError('Invalid credentials.', 401, 'INVALID_CREDENTIALS');
  }

  const valid = await bcrypt.compare(parsed.password, user.passwordHash);
  if (!valid) {
    throw new AppError('Invalid credentials.', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.isVerified) {
    throw new AppError(
      'Your account is not yet verified.',
      403,
      'ACCOUNT_NOT_VERIFIED',
      { phone: user.phone, email: user.email }
    );
  }

  user.onlineStatus = true;
  user.lastSeen = new Date();
  await user.save();

  const token = signAuthToken(user);
  setAuthCookie(req, res, token);

  res.json({
    success: true,
    data: {
      user: serializeUser(user),
      token,
    },
  });
}

export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.parse(req.body);
  const raw = parsed.phone.trim();
  const maybePhone = normalizePhone(raw);
  const maybeEmail = raw.toLowerCase();

  const user = await User.findOne({
    isVerified: true,
    $or: [{ phone: maybePhone }, { email: maybeEmail }],
  });
  if (!user) {
    throw new AppError('No verified account found with that phone number or email.', 404, 'USER_NOT_FOUND');
  }

  const otpInfo = await issueOtp(user.phone, 'reset_password', user.email);
  res.json({
    success: true,
    message: 'Password reset code sent.',
    data: {
      phone: user.phone,
      email: user.email,
      cooldownSeconds: otpInfo.cooldownSeconds,
      expiresAt: otpInfo.expiresAt,
    },
  });
}

export async function resetPassword(req: Request, res: Response) {
  const parsed = resetPasswordSchema.parse(req.body);
  const phone = normalizePhone(parsed.phone);

  await verifyOtpCode(phone, parsed.code, 'reset_password');

  const passwordHash = await bcrypt.hash(parsed.newPassword, 12);
  const user = await User.findOneAndUpdate(
    { phone, isVerified: true },
    { $set: { passwordHash } },
    { new: true }
  );

  if (!user) {
    throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');
  }

  res.json({
    success: true,
    message: 'Password updated successfully. You can now log in.',
  });
}

export async function logout(req: AuthenticatedRequest, res: Response) {
  if (req.userId) {
    await User.findByIdAndUpdate(req.userId, {
      onlineStatus: false,
      lastSeen: new Date(),
    });
    await emitPresenceToAuthorizedViewers(req.userId);
  }
  clearAuthCookie(req, res);
  res.json({ success: true, message: 'Logged out.' });
}
