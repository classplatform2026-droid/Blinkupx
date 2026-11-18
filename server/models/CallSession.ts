import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type PersistentCallState =
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'failed';

export interface ICallSessionPeerSnapshot {
  id: string;
  fullName: string;
  username: string;
  avatar: string;
}

export interface ICallSession extends Document {
  callId: string;
  roomName: string;
  conversationId: Types.ObjectId | null;
  callType: 'voice' | 'video';
  callerId: Types.ObjectId;
  receiverId: Types.ObjectId;
  callerInfo: ICallSessionPeerSnapshot;
  receiverInfo: ICallSessionPeerSnapshot;
  state: PersistentCallState;
  startedAt: Date;
  expiresAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string;
  ttlCleanupAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const peerSnapshotSchema = new Schema<ICallSessionPeerSnapshot>(
  {
    id: { type: String, required: true },
    fullName: { type: String, required: true },
    username: { type: String, default: '' },
    avatar: { type: String, default: '' },
  },
  { _id: false }
);

const callSessionSchema = new Schema<ICallSession>(
  {
    callId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    roomName: {
      type: String,
      required: true,
      trim: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    callType: {
      type: String,
      enum: ['voice', 'video'],
      required: true,
    },
    callerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    callerInfo: {
      type: peerSnapshotSchema,
      required: true,
    },
    receiverInfo: {
      type: peerSnapshotSchema,
      required: true,
    },
    state: {
      type: String,
      enum: [
        'initiating',
        'ringing',
        'connecting',
        'connected',
        'reconnecting',
        'ended',
        'rejected',
        'missed',
        'failed',
      ],
      default: 'initiating',
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
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
    ttlCleanupAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true }
);

callSessionSchema.index({ callerId: 1, state: 1 });
callSessionSchema.index({ receiverId: 1, state: 1 });

export const CallSession = mongoose.model<ICallSession>('CallSession', callSessionSchema);
