import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type CallHistoryStatus =
  | 'completed'
  | 'missed'
  | 'declined'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'busy';

export interface ICallHistory extends Document {
  userId: Types.ObjectId;
  contactId: Types.ObjectId;
  callId?: string | null;
  roomName?: string;
  conversationId?: Types.ObjectId | null;
  callerId?: Types.ObjectId | null;
  receiverId?: Types.ObjectId | null;
  callType: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  status: CallHistoryStatus;
  duration: number;
  startedAt?: Date | null;
  answeredAt?: Date | null;
  endedAt?: Date | null;
  endReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const callHistorySchema = new Schema<ICallHistory>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    callId: {
      type: String,
      default: null,
      trim: true,
    },
    roomName: {
      type: String,
      default: '',
      trim: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    callerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    callType: {
      type: String,
      enum: ['voice', 'video'],
      required: true,
    },
    direction: {
      type: String,
      enum: ['incoming', 'outgoing', 'missed'],
      required: true,
    },
    status: {
      type: String,
      enum: ['completed', 'missed', 'declined', 'rejected', 'cancelled', 'failed', 'busy'],
      required: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    answeredAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    endReason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

callHistorySchema.index({ userId: 1, createdAt: -1 });
callHistorySchema.index(
  { callId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { callId: { $type: 'string' } },
  }
);

export const CallHistory = mongoose.model<ICallHistory>('CallHistory', callHistorySchema);
