import mongoose, { type Document, Schema, type Types } from 'mongoose';

export interface ICallHistory extends Document {
  userId: Types.ObjectId;
  contactId: Types.ObjectId;
  callType: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  status: 'completed' | 'missed' | 'declined' | 'cancelled';
  duration: number;
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
      enum: ['completed', 'missed', 'declined', 'cancelled'],
      required: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

callHistorySchema.index({ userId: 1, createdAt: -1 });

export const CallHistory = mongoose.model<ICallHistory>('CallHistory', callHistorySchema);
