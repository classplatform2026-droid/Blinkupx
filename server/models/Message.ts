import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'voice'
  | 'system'
  | 'call_event';
export type DeliveryStatus = 'sent' | 'delivered' | 'read';
export type MessageSenderType = 'user' | 'ai';
export type CallEventStatus =
  | 'completed'
  | 'missed'
  | 'no_answer'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface IMessageAiMeta {
  requestId: string;
  triggerMessageId: string;
  triggerUserId?: Types.ObjectId | null;
  status: 'completed' | 'failed';
}

export interface ICallEventMetadata {
  callId: string;
  callType: 'voice' | 'video';
  callStatus: CallEventStatus;
  duration: number;
  callerId: Types.ObjectId;
  receiverId: Types.ObjectId;
  timestamp: Date;
}

export interface IMessageAttachment {
  url: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  caption?: string;
}

export interface IMessageReaction {
  emoji: string;
  userIds: Types.ObjectId[];
}

export interface IMessageLink {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

export interface IMessage extends Document {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  senderType: MessageSenderType;
  clientMessageId?: string | null;
  content: string;
  messageType: MessageType;
  attachments: IMessageAttachment[];
  links: IMessageLink[];
  replyTo: Types.ObjectId | null;
  forwardedFrom: {
    messageId: Types.ObjectId;
    senderName: string;
  } | null;
  callEvent: ICallEventMetadata | null;
  aiMeta: IMessageAiMeta | null;
  reactions: IMessageReaction[];
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedFor: Types.ObjectId[];
  deliveredTo: Types.ObjectId[];
  readBy: Types.ObjectId[];
  deliveryStatus: DeliveryStatus;
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema<IMessageAttachment>(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    fileName: { type: String, default: 'attachment' },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    caption: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false }
);

const linkSchema = new Schema<IMessageLink>(
  {
    url: { type: String, required: true },
    domain: { type: String, default: '' },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    siteName: { type: String, default: '' },
  },
  { _id: false }
);

const reactionSchema = new Schema<IMessageReaction>(
  {
    emoji: { type: String, required: true },
    userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);

const callEventSchema = new Schema<ICallEventMetadata>(
  {
    callId: { type: String, required: true, trim: true, maxlength: 120 },
    callType: { type: String, enum: ['voice', 'video'], required: true },
    callStatus: {
      type: String,
      enum: ['completed', 'missed', 'no_answer', 'rejected', 'cancelled', 'failed'],
      required: true,
    },
    duration: { type: Number, default: 0, min: 0 },
    callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const aiMetaSchema = new Schema<IMessageAiMeta>(
  {
    requestId: { type: String, required: true, trim: true, maxlength: 120 },
    triggerMessageId: { type: String, required: true, trim: true, maxlength: 120 },
    triggerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['completed', 'failed'], default: 'completed' },
  },
  { _id: false }
);

const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderType: {
      type: String,
      enum: ['user', 'ai'],
      default: 'user',
    },
    clientMessageId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 120,
    },
    content: {
      type: String,
      default: '',
      maxlength: 5000,
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'video', 'document', 'voice', 'system', 'call_event'],
      default: 'text',
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    links: {
      type: [linkSchema],
      default: [],
    },
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    forwardedFrom: {
      type: {
        messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
        senderName: { type: String },
      },
      default: null,
    },
    callEvent: {
      type: callEventSchema,
      default: null,
    },
    aiMeta: {
      type: aiMetaSchema,
      default: null,
    },
    reactions: {
      type: [reactionSchema],
      default: [],
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deliveryStatus: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index(
  { conversationId: 1, deletedFor: 1, createdAt: -1, _id: -1 }
);
messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: 'string' } },
  }
);
messageSchema.index(
  { conversationId: 1, 'callEvent.callId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'callEvent.callId': { $type: 'string' } },
  }
);
messageSchema.index(
  { conversationId: 1, 'aiMeta.triggerMessageId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'aiMeta.triggerMessageId': { $type: 'string' } },
  }
);
messageSchema.index({ content: 'text' });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
