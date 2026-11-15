import mongoose, { type Document, Schema } from 'mongoose';

export type OtpPurpose = 'register' | 'reset_password';

export interface IOtpVerification extends Document {
  phone: string;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  lastSentAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const otpVerificationSchema = new Schema<IOtpVerification>(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['register', 'reset_password'],
      required: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    lastSentAt: {
      type: Date,
      required: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

otpVerificationSchema.index({ phone: 1, purpose: 1 });

export const OtpVerification = mongoose.model<IOtpVerification>(
  'OtpVerification',
  otpVerificationSchema
);
