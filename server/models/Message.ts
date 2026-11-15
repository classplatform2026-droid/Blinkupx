import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type MessageType = 'text' | 'image' | 'video' | 'document' | 'voice' | 'system';
export type DeliveryStatus = 'sent' | 'delivered' | 'read';

export interface IMessageAttachment {
  url: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
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
      enum: ['text', 'image', 'video', 'document', 'voice', 'system'],
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

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: 'string' } },
  }
);
messageSchema.index({ content: 'text' });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
