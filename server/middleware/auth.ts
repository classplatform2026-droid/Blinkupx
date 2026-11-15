import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import { User, type IUser } from '../models/User.ts';
import { AppError } from '../utils/errors.ts';

export const AUTH_COOKIE_NAME = 'blinkupz_token';

export interface JwtPayload {
  sub: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  userId?: string;
}

export function signAuthToken(user: { _id: { toString(): string }; username: string }): string {
  return jwt.sign(
    { sub: user._id.toString(), username: user.username },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.secure;
}

export function setAuthCookie(req: Request, res: Response, token: string): void {
  const secure = isHttpsRequest(req);
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
  });
}

export function extractTokenFromRequest(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === 'string') {
    return cookieToken;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
    }

    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
    const user = await User.findById(decoded.sub);

    if (!user || !user.isVerified) {
      throw new AppError('Account not found or not verified.', 401, 'UNAUTHORIZED');
    }

    req.user = user;
    req.userId = user._id.toString();
    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    return next(new AppError('Invalid or expired session.', 401, 'UNAUTHORIZED'));
  }
}

export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      return next();
    }
    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
    const user = await User.findById(decoded.sub);
    if (user && user.isVerified) {
      req.user = user;
      req.userId = user._id.toString();
    }
  } catch {
    // Ignore invalid/expired token for optional auth endpoints
  }
  next();
}
