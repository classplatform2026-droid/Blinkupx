import mongoose, { type Document, Schema } from 'mongoose';

export interface IUserSettings {
  density: 'comfortable' | 'compact';
  enterToSend: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  autoDownloadMedia: boolean;
  language: string;
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
  settings: IUserSettings;
  createdAt: Date;
  updatedAt: Date;
}

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
    },
  },
  { timestamps: true }
);

userSchema.index({ fullName: 'text', username: 'text' });

export const User = mongoose.model<IUser>('User', userSchema);
