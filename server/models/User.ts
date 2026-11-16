import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type PrivacyVisibility = 'everyone' | 'contacts' | 'nobody';
export type NotificationSoundTone = 'chime' | 'ping' | 'pop' | 'soft';

export interface IUserPrivacySettings {
  lastSeen: PrivacyVisibility;
  onlineStatus: PrivacyVisibility;
  profilePhoto: PrivacyVisibility;
  about: PrivacyVisibility;
  readReceipts: boolean;
}

export interface IUserNotificationSettings {
  pushEnabled: boolean;
  privateMessages: boolean;
  groupMessages: boolean;
  communityMessages: boolean;
  communityActivity: boolean;
  soundEnabled: boolean;
  soundTone: NotificationSoundTone;
  messagePreview: boolean;
  vibrationEnabled: boolean;
}

export interface IUserSettings {
  density: 'comfortable' | 'compact';
  enterToSend: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  autoDownloadMedia: boolean;
  language: string;
  privacy: IUserPrivacySettings;
  notifications: IUserNotificationSettings;
}

export interface IUser extends Document {
  fullName: string;
  username: string;
  phone: string;
  email: string;
  passwordHash: string;
  avatar: string;
  bio: string;
  isVerified: boolean;
  onlineStatus: boolean;
  lastSeen: Date;
  blockedUsers: Types.ObjectId[];
  settings: IUserSettings;
  createdAt: Date;
  updatedAt: Date;
}

const PRIVACY_ENUM: PrivacyVisibility[] = ['everyone', 'contacts', 'nobody'];
const SOUND_TONE_ENUM: NotificationSoundTone[] = ['chime', 'ping', 'pop', 'soft'];

const userSchema = new Schema<IUser>(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_]{3,24}$/,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    avatar: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
      maxlength: 200,
      trim: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    onlineStatus: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    blockedUsers: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    settings: {
      density: {
        type: String,
        enum: ['comfortable', 'compact'],
        default: 'comfortable',
      },
      enterToSend: { type: Boolean, default: true },
      readReceipts: { type: Boolean, default: true },
      typingIndicators: { type: Boolean, default: true },
      autoDownloadMedia: { type: Boolean, default: true },
      language: { type: String, default: 'en' },
      privacy: {
        lastSeen: { type: String, enum: PRIVACY_ENUM, default: 'everyone' },
        onlineStatus: { type: String, enum: PRIVACY_ENUM, default: 'everyone' },
        profilePhoto: { type: String, enum: PRIVACY_ENUM, default: 'everyone' },
        about: { type: String, enum: PRIVACY_ENUM, default: 'everyone' },
        readReceipts: { type: Boolean, default: true },
      },
      notifications: {
        pushEnabled: { type: Boolean, default: true },
        privateMessages: { type: Boolean, default: true },
        groupMessages: { type: Boolean, default: true },
        communityMessages: { type: Boolean, default: true },
        communityActivity: { type: Boolean, default: true },
        soundEnabled: { type: Boolean, default: true },
        soundTone: { type: String, enum: SOUND_TONE_ENUM, default: 'chime' },
        messagePreview: { type: Boolean, default: true },
        vibrationEnabled: { type: Boolean, default: true },
      },
    },
  },
  { timestamps: true }
);

userSchema.index({ fullName: 'text', username: 'text' });

export const User = mongoose.model<IUser>('User', userSchema);
