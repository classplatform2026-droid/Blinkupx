import type {
  IUser,
  IUserNotificationSettings,
  IUserPrivacySettings,
  IUserSettings,
} from '../models/User.ts';

export function resolveUserSettings(raw?: Partial<IUserSettings> | null): IUserSettings {
  const readReceipts =
    raw?.privacy?.readReceipts ?? raw?.readReceipts ?? true;

  const privacy: IUserPrivacySettings = {
    lastSeen: raw?.privacy?.lastSeen || 'everyone',
    onlineStatus: raw?.privacy?.onlineStatus || 'everyone',
    profilePhoto: raw?.privacy?.profilePhoto || 'everyone',
    about: raw?.privacy?.about || 'everyone',
    readReceipts,
  };

  const notifications: IUserNotificationSettings = {
    pushEnabled: raw?.notifications?.pushEnabled ?? true,
    privateMessages: raw?.notifications?.privateMessages ?? true,
    groupMessages: raw?.notifications?.groupMessages ?? true,
    communityMessages: raw?.notifications?.communityMessages ?? true,
    communityActivity: raw?.notifications?.communityActivity ?? true,
    incomingCalls: raw?.notifications?.incomingCalls ?? true,
    voiceCallRingtone: raw?.notifications?.voiceCallRingtone ?? true,
    videoCallRingtone: raw?.notifications?.videoCallRingtone ?? true,
    soundEnabled: raw?.notifications?.soundEnabled ?? true,
    soundTone: raw?.notifications?.soundTone || 'chime',
    messagePreview: raw?.notifications?.messagePreview ?? true,
    vibrationEnabled: raw?.notifications?.vibrationEnabled ?? true,
  };

  return {
    density: raw?.density || 'comfortable',
    enterToSend: raw?.enterToSend ?? true,
    readReceipts,
    typingIndicators: raw?.typingIndicators ?? true,
    autoDownloadMedia: raw?.autoDownloadMedia ?? true,
    language: raw?.language || 'en',
    privacy,
    notifications,
  };
}

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
    blockedUsers: (user.blockedUsers || []).map((id) => id.toString()),
    settings: resolveUserSettings(user.settings),
    createdAt: user.createdAt,
  };
}

export interface SerializedPublicUser {
  id: string;
  fullName: string;
  username: string;
  avatar: string;
  bio: string;
  onlineStatus: boolean;
  lastSeen: Date | null;
  isBlockedByMe?: boolean;
  hasBlockedMe?: boolean;
  privacyStatus?: {
    lastSeenHidden: boolean;
    onlineHidden: boolean;
    avatarHidden: boolean;
    aboutHidden: boolean;
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
}): SerializedPublicUser {
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
