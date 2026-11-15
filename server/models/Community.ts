import mongoose, { type Document, Schema, type Types } from 'mongoose';

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityPrivacy = 'public' | 'private';

export interface ICommunityMember {
  userId: Types.ObjectId;
  role: CommunityRole;
  joinedAt: Date;
}

export interface ICommunity extends Document {
  name: string;
  description: string;
  image: string;
  privacy: CommunityPrivacy;
  ownerId: Types.ObjectId;
  conversationId: Types.ObjectId;
  members: ICommunityMember[];
  pendingRequests: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const communityMemberSchema = new Schema<ICommunityMember>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      enum: ['owner', 'admin', 'moderator', 'member'],
      default: 'member',
    },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const communitySchema = new Schema<ICommunity>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 60,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 400,
    },
    image: {
      type: String,
      default: '',
    },
    privacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    members: {
      type: [communityMemberSchema],
      default: [],
    },
    pendingRequests: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

communitySchema.index({ name: 'text', description: 'text' });
communitySchema.index({ 'members.userId': 1 });

export const Community = mongoose.model<ICommunity>('Community', communitySchema);
