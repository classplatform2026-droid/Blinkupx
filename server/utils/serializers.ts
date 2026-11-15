import type { IUser } from '../models/User.ts';

export function serializeUser(user: IUser) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    username: user.username,
    phone: user.phone,
    email: user.email || '',
    avatar: user.avatar,
    bio: user.bio,
    isVerified: user.isVerified,
    onlineStatus: user.onlineStatus,
    lastSeen: user.lastSeen,
    settings: user.settings,
    createdAt: user.createdAt,
  };
}

export function serializePublicUser(user: {
  _id: { toString(): string };
  fullName: string;
  username: string;
  avatar?: string;
  bio?: string;
  onlineStatus?: boolean;
  lastSeen?: Date;
}) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    username: user.username,
    avatar: user.avatar || '',
    bio: user.bio || '',
    onlineStatus: Boolean(user.onlineStatus),
    lastSeen: user.lastSeen || null,
  };
}
