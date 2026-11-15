export interface UserSettings {
  density: 'comfortable' | 'compact';
  enterToSend: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  autoDownloadMedia: boolean;
  language: string;
}

export interface User {
  id: string;
  fullName: string;
  username: string;
  phone?: string;
  email?: string;
  avatar: string;
  bio: string;
  isVerified?: boolean;
  onlineStatus: boolean;
  lastSeen: string | null;
  settings?: UserSettings;
  createdAt?: string;
}

export interface ServiceStatus {
  database: string;
  cloudinary: boolean;
  otpProvider: boolean;
  otpProviderType: string;
  missingOtpVars: string[];
  missingCloudinaryVars: string[];
}

export interface ConversationParticipant {
  userId: string;
  role: 'owner' | 'admin' | 'moderator' | 'member';
  user: User | null;
  lastReadAt: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group' | 'community';
  name: string;
  username: string;
  avatar: string;
  onlineStatus: boolean;
  lastSeen: string | null;
  communityId: string | null;
  participants: ConversationParticipant[];
  lastMessage: {
    messageId: string | null;
    senderId: string | null;
    content: string;
    messageType: string;
    createdAt: string | null;
  } | null;
  pinnedMessage: {
    id: string;
    content: string;
    messageType: string;
    sender?: { fullName?: string };
  } | null;
  unreadCount: number;
  isPinned: boolean;
  pinnedAt: string | null;
  isMuted: boolean;
  mutedUntil: string | null;
  isArchived: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface MessageAttachment {
  url: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
}

export interface MessageReaction {
  emoji: string;
  userIds: string[];
}

export interface MessageLinkPreview {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  sender: {
    id: string;
    fullName: string;
    username: string;
    avatar: string;
  } | null;
  content: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'voice' | 'system';
  attachments: MessageAttachment[];
  links?: MessageLinkPreview[];
  replyTo: {
    id: string;
    content: string;
    messageType: string;
    senderName: string;
  } | null;
  forwardedFrom: {
    messageId: string;
    senderName: string;
  } | null;
  reactions: MessageReaction[];
  editedAt: string | null;
  deletedAt: string | null;
  deliveredTo: string[];
  readBy: string[];
  deliveryStatus: 'sent' | 'delivered' | 'read';
  createdAt: string;
}

export interface CommunitySummary {
  id: string;
  name: string;
  description: string;
  image: string;
  privacy: 'public' | 'private';
  ownerId: string;
  conversationId: string;
  memberCount: number;
  isMember: boolean;
  myRole: 'owner' | 'admin' | 'moderator' | 'member' | null;
  isPending: boolean;
  createdAt: string;
}

export interface CommunityDetail extends CommunitySummary {
  members: Array<{
    role: 'owner' | 'admin' | 'moderator' | 'member';
    joinedAt: string;
    user: User;
  }>;
  pendingRequests: User[];
}

export interface CallHistoryItem {
  id: string;
  callType: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  status: 'completed' | 'missed' | 'declined' | 'cancelled';
  duration: number;
  createdAt: string;
  contact: User | null;
}

export interface SearchResults {
  messages: Array<{
    id: string;
    conversationId: string;
    conversationName: string;
    conversationType: string;
    content: string;
    senderName: string;
    createdAt: string;
  }>;
  people: User[];
  groups: Array<{
    id: string;
    conversationId: string;
    communityId: string | null;
    name: string;
    avatar: string;
    memberCount: number;
    kind: 'group' | 'community';
  }>;
}

export interface SharedMediaSender {
  id: string;
  fullName: string;
  username: string;
  avatar: string;
}

export interface SharedMediaItem {
  id: string;
  messageId: string;
  attachmentIndex: number;
  kind: 'image' | 'video';
  url: string;
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  caption: string;
  sender: SharedMediaSender | null;
  createdAt: string;
}

export interface SharedFileItem {
  id: string;
  messageId: string;
  attachmentIndex: number;
  url: string;
  downloadUrl: string;
  fileName: string;
  fileExtension: string;
  fileSize: number;
  mimeType: string;
  caption: string;
  sender: SharedMediaSender | null;
  createdAt: string;
}

export interface SharedLinkItem {
  id: string;
  messageId: string;
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
  messageContent: string;
  sender: SharedMediaSender | null;
  createdAt: string;
}

export interface SharedMediaCounts {
  media: number;
  files: number;
  links: number;
}

export interface SharedMediaResponse {
  tab: 'media' | 'files' | 'links';
  counts: SharedMediaCounts;
  items: SharedMediaItem[] | SharedFileItem[] | SharedLinkItem[];
}

export interface MyQrCodeData {
  username: string;
  fullName: string;
  profileUrl: string;
  qrSvg: string;
  qrDataUrl: string;
}
