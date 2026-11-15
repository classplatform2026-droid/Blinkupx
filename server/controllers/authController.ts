import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { User } from '../models/User.ts';
import {
  clearAuthCookie,
  setAuthCookie,
  signAuthToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
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

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0] || '*'}*@${domain}`;
  }
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(5, local.length - 2))}${local.slice(-1)}@${domain}`;
}

async function findUserByRecoveryIdentifier(rawIdentifier: string, verifiedOnly: boolean) {
  const raw = rawIdentifier.trim();
  const maybePhone = normalizePhone(raw);
  const maybeLower = raw.toLowerCase();
  const maybeUsername = maybeLower.replace(/^@/, '');

  const orConditions: Record<string, unknown>[] = [
    { email: maybeLower },
    { username: maybeUsername },
  ];
  if (maybePhone.length >= 7) {
    orConditions.push({ phone: maybePhone });
  }

  const filter: Record<string, unknown> = { $or: orConditions };
  if (verifiedOnly) {
    filter.isVerified = true;
  }
  return User.findOne(filter);
}

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

  const user = await User.findOne({ phone, isVerified: true });
  if (!user) {
    throw new AppError('Verified account not found for this phone number.', 404, 'USER_NOT_FOUND');
  }

  const resetToken = signPasswordResetToken({
    _id: user._id as { toString(): string },
    phone: user.phone,
  });

  res.json({
    success: true,
    message: 'Verification code confirmed. You can now set a new password.',
    data: {
      phone: user.phone,
      resetToken,
    },
  });
}

export async function resendOtp(req: Request, res: Response) {
  const parsed = resendOtpSchema.parse(req.body);
  const user = await findUserByRecoveryIdentifier(
    parsed.phone,
    parsed.purpose === 'reset_password'
  );
  if (!user) {
    throw new AppError(
      parsed.purpose === 'reset_password'
        ? 'No verified account found for that phone number, email, or username.'
        : 'No account found for this phone number or email.',
      404,
      'USER_NOT_FOUND'
    );
  }
  if (parsed.purpose === 'register' && user.isVerified) {
    throw new AppError('This account is already verified. Please log in.', 400, 'ALREADY_VERIFIED');
  }
  if (!user.email) {
    throw new AppError(
      'This account does not have a recovery email address configured.',
      400,
      'EMAIL_REQUIRED'
    );
  }

  const otpInfo = await issueOtp(user.phone, parsed.purpose, user.email);

  res.json({
    success: true,
    message: 'Verification code resent.',
    data: {
      phone: user.phone,
      email: maskEmail(user.email),
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
  const user = await findUserByRecoveryIdentifier(parsed.phone, true);
  if (!user) {
    throw new AppError(
      'No verified account found with that phone number, email, or username.',
      404,
      'USER_NOT_FOUND'
    );
  }
  if (!user.email) {
    throw new AppError(
      'This account does not have a recovery email address configured.',
      400,
      'EMAIL_REQUIRED'
    );
  }

  const otpInfo = await issueOtp(user.phone, 'reset_password', user.email);
  res.json({
    success: true,
    message: 'Password reset code sent to your registered email.',
    data: {
      phone: user.phone,
      email: maskEmail(user.email),
      cooldownSeconds: otpInfo.cooldownSeconds,
      expiresAt: otpInfo.expiresAt,
    },
  });
}

export async function resetPassword(req: Request, res: Response) {
  const parsed = resetPasswordSchema.parse(req.body);
  const phone = normalizePhone(parsed.phone);

  let verifiedUserId: string | null = null;
  if (parsed.resetToken) {
    try {
      const decoded = verifyPasswordResetToken(parsed.resetToken);
      if (normalizePhone(decoded.phone) !== phone) {
        throw new AppError(
          'Password reset session does not match this account.',
          400,
          'RESET_TOKEN_INVALID'
        );
      }
      verifiedUserId = decoded.sub;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        'Password reset session has expired. Please request a new verification code.',
        400,
        'RESET_TOKEN_INVALID'
      );
    }
  } else if (parsed.code) {
    await verifyOtpCode(phone, parsed.code, 'reset_password');
  }

  const passwordHash = await bcrypt.hash(parsed.newPassword, 12);
  const filter = verifiedUserId
    ? { _id: verifiedUserId, phone, isVerified: true }
    : { phone, isVerified: true };

  const user = await User.findOneAndUpdate(
    filter,
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
