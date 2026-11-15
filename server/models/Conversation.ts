import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type ConversationType = 'direct' | 'group' | 'community';

export interface IConversationParticipant {
  userId: Types.ObjectId;
  role: 'owner' | 'admin' | 'moderator' | 'member';
  joinedAt: Date;
  pinnedAt: Date | null;
  mutedUntil: Date | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  lastReadAt: Date;
}

export interface ILastMessageSummary {
  messageId: Types.ObjectId | null;
  senderId: Types.ObjectId | null;
  content: string;
  messageType: string;
  createdAt: Date | null;
}

export interface IConversation extends Document {
  type: ConversationType;
  name: string;
  avatar: string;
  communityId: Types.ObjectId | null;
  participants: IConversationParticipant[];
  lastMessage: ILastMessageSummary | null;
  pinnedMessageId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<IConversationParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      enum: ['owner', 'admin', 'moderator', 'member'],
      default: 'member',
    },
    joinedAt: { type: Date, default: Date.now },
    pinnedAt: { type: Date, default: null },
    mutedUntil: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    lastReadAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new Schema<IConversation>(
  {
    type: {
      type: String,
      enum: ['direct', 'group', 'community'],
      required: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    avatar: {
      type: String,
      default: '',
    },
    communityId: {
      type: Schema.Types.ObjectId,
      ref: 'Community',
      default: null,
    },
    participants: {
      type: [participantSchema],
      required: true,
    },
    lastMessage: {
      messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
      senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      content: { type: String, default: '' },
      messageType: { type: String, default: 'text' },
      createdAt: { type: Date, default: null },
    },
    pinnedMessageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ 'participants.userId': 1, updatedAt: -1 });
conversationSchema.index({ communityId: 1 });

export const Conversation = mongoose.model<IConversation>('Conversation', conversationSchema);
