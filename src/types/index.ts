export type PrivacyVisibility = 'everyone' | 'contacts' | 'nobody';
export type NotificationSoundTone = 'chime' | 'ping' | 'pop' | 'soft';

export interface UserPrivacySettings {
  lastSeen: PrivacyVisibility;
  onlineStatus: PrivacyVisibility;
  profilePhoto: PrivacyVisibility;
  about: PrivacyVisibility;
  readReceipts: boolean;
}

export interface UserNotificationSettings {
  privateMessages: boolean;
  groupMessages: boolean;
  communityMessages: boolean;
  communityActivity: boolean;
  soundEnabled: boolean;
  soundTone: NotificationSoundTone;
  messagePreview: boolean;
  vibrationEnabled: boolean;
}

export interface UserSettings {
  density: 'comfortable' | 'compact';
  enterToSend: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  autoDownloadMedia: boolean;
  language: string;
  privacy?: UserPrivacySettings;
  notifications?: UserNotificationSettings;
}

export interface PrivacyStatusFlags {
  lastSeenHidden: boolean;
  onlineHidden: boolean;
  avatarHidden: boolean;
  aboutHidden: boolean;
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
  blockedUsers?: string[];
  isBlockedByMe?: boolean;
  hasBlockedMe?: boolean;
  privacyStatus?: PrivacyStatusFlags;
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
  isBlockedByMe?: boolean;
  hasBlockedMe?: boolean;
  peerPrivacy?: PrivacyStatusFlags | null;
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

export type MessageDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId?: string | null;
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
  deliveryStatus: MessageDeliveryStatus;
  localError?: string | null;
  retryPayload?: {
    content?: string;
    messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
    attachments?: MessageAttachment[];
    replyTo?: string | null;
    duration?: number;
  } | null;
  createdAt: string;
}

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityInvitePermission = 'owner_only' | 'admins' | 'moderators' | 'all_members';
export type CommunityPinPermission = 'admins' | 'moderators';
export type CommunityPostPermission = 'all_members' | 'moderators_only';

export interface CommunitySettings {
  whoCanInvite: CommunityInvitePermission;
  whoCanPinMessages: CommunityPinPermission;
  whoCanPost: CommunityPostPermission;
}

export interface CommunityPermissions {
  canInvite: boolean;
  canManageRoles: boolean;
  canManageSettings: boolean;
  canManageRequests: boolean;
  canChangePrivacy: boolean;
  canTransferOwnership: boolean;
  canDeleteCommunity: boolean;
}

export interface CommunityMemberEntry {
  role: CommunityRole;
  joinedAt: string;
  user: User;
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
  myRole: CommunityRole | null;
  isPending: boolean;
  pendingRequestsCount?: number;
  settings?: CommunitySettings;
  createdAt: string;
}

export interface CommunityDetail extends Omit<CommunitySummary, 'conversationId' | 'settings'> {
  conversationId: string | null;
  settings: CommunitySettings | null;
  permissions?: CommunityPermissions;
  members: CommunityMemberEntry[];
  pendingRequests: User[];
}

export interface CommunityMembersResponse {
  communityId: string;
  communityName: string;
  myRole: CommunityRole;
  counts: {
    all: number;
    admins: number;
    moderators: number;
    members: number;
    requests: number;
  };
  permissions: {
    canInvite: boolean;
    canManageRoles: boolean;
    canManageRequests: boolean;
  };
  members: CommunityMemberEntry[];
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
