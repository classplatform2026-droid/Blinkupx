import mongoose, { type Document, Schema, type Types } from 'mongoose';

export interface IPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface IPushSubscription extends Document {
  userId: Types.ObjectId;
  endpoint: string;
  expirationTime: number | null;
  keys: IPushSubscriptionKeys;
  deviceId: string;
  deviceLabel: string;
  userAgent: string;
  enabled: boolean;
  failureCount: number;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    keys: {
      p256dh: { type: String, required: true, trim: true },
      auth: { type: String, required: true, trim: true },
    },
    deviceId: {
      type: String,
      default: '',
      trim: true,
      maxlength: 128,
    },
    deviceLabel: {
      type: String,
      default: 'Web Browser',
      trim: true,
      maxlength: 100,
    },
    userAgent: {
      type: String,
      default: '',
      trim: true,
      maxlength: 512,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ userId: 1, deviceId: 1 });
pushSubscriptionSchema.index({ userId: 1, enabled: 1 });

export const PushSubscription = mongoose.model<IPushSubscription>(
  'PushSubscription',
  pushSubscriptionSchema
);
