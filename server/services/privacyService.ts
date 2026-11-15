import { Types } from 'mongoose';
import { Conversation } from '../models/Conversation.ts';
import { User, type IUser, type PrivacyVisibility } from '../models/User.ts';
import { resolveUserSettings, type SerializedPublicUser } from '../utils/serializers.ts';

export const PUBLIC_USER_SELECT =
  'fullName username avatar bio onlineStatus lastSeen blockedUsers settings';

export interface ViewerRelationshipContext {
  viewerId: string | null;
  contactIds: Set<string>;
  blockedByViewerIds: Set<string>;
}

export interface PrivacyTargetUserLike {
  _id: { toString(): string };
  fullName: string;
  username: string;
  avatar?: string;
  bio?: string;
  onlineStatus?: boolean;
  lastSeen?: Date | null;
  blockedUsers?: Array<{ toString(): string }>;
  settings?: Partial<IUser['settings']> | null;
}

export function canViewPrivacyField(
  visibility: PrivacyVisibility,
  isSelf: boolean,
  isContact: boolean,
  isBlockedPair: boolean
): boolean {
  if (isSelf) return true;
  if (isBlockedPair) return false;
  if (visibility === 'everyone') return true;
  if (visibility === 'contacts') return isContact;
  return false;
}

export async function getViewerRelationshipContext(
  viewerId: string | null | undefined,
  candidateIds?: string[]
): Promise<ViewerRelationshipContext> {
  if (!viewerId || !Types.ObjectId.isValid(viewerId)) {
    return {
      viewerId: null,
      contactIds: new Set<string>(),
      blockedByViewerIds: new Set<string>(),
    };
  }

  const viewerObjectId = new Types.ObjectId(viewerId);
  const viewer = await User.findById(viewerObjectId).select('blockedUsers').lean();
  const blockedByViewerIds = new Set<string>(
    (viewer?.blockedUsers || []).map((id) => id.toString())
  );

  const convFilter: Record<string, unknown> = {
    type: 'direct',
    'participants.userId': viewerObjectId,
  };

  if (candidateIds && candidateIds.length > 0) {
    const validCandidates = candidateIds
      .filter((id) => Types.ObjectId.isValid(id) && id !== viewerId)
      .map((id) => new Types.ObjectId(id));

    if (validCandidates.length === 0) {
      return {
        viewerId,
        contactIds: new Set<string>(),
        blockedByViewerIds,
      };
    }

    convFilter.$and = [
      { 'participants.userId': viewerObjectId },
      { 'participants.userId': { $in: validCandidates } },
    ];
    delete convFilter['participants.userId'];
  }

  const directConvs = await Conversation.find(convFilter)
    .select('participants.userId')
    .lean();

  const contactIds = new Set<string>();
  for (const conv of directConvs) {
    for (const part of conv.participants) {
      const pid = part.userId.toString();
      if (pid !== viewerId) {
        contactIds.add(pid);
      }
    }
  }

  return {
    viewerId,
    contactIds,
    blockedByViewerIds,
  };
}

export function serializeUserWithPrivacy(
  target: PrivacyTargetUserLike,
  context: ViewerRelationshipContext
): SerializedPublicUser {
  const targetId = target._id.toString();
  const isSelf = Boolean(context.viewerId && context.viewerId === targetId);
  const isBlockedByViewer = !isSelf && context.blockedByViewerIds.has(targetId);
  const hasBlockedViewer = Boolean(
    !isSelf &&
      context.viewerId &&
      (target.blockedUsers || []).some((id) => id.toString() === context.viewerId)
  );
  const isBlockedPair = isBlockedByViewer || hasBlockedViewer;
  const isContact = !isSelf && !isBlockedPair && context.contactIds.has(targetId);

  const settings = resolveUserSettings(target.settings);
  const privacy = settings.privacy;

  const canViewOnline = canViewPrivacyField(
    privacy.onlineStatus,
    isSelf,
    isContact,
    isBlockedPair
  );
  const canViewLastSeen = canViewPrivacyField(
    privacy.lastSeen,
    isSelf,
    isContact,
    isBlockedPair
  );
  const canViewAvatar = canViewPrivacyField(
    privacy.profilePhoto,
    isSelf,
    isContact,
    isBlockedPair
  );
  const canViewAbout = canViewPrivacyField(
    privacy.about,
    isSelf,
    isContact,
    isBlockedPair
  );

  return {
    id: targetId,
    fullName: target.fullName,
    username: target.username,
    avatar: canViewAvatar ? target.avatar || '' : '',
    bio: canViewAbout ? target.bio || '' : '',
    onlineStatus: canViewOnline ? Boolean(target.onlineStatus) : false,
    lastSeen: canViewLastSeen ? target.lastSeen || null : null,
    isBlockedByMe: isBlockedByViewer,
    hasBlockedMe: hasBlockedViewer,
    privacyStatus: {
      lastSeenHidden: !canViewLastSeen,
      onlineHidden: !canViewOnline,
      avatarHidden: !canViewAvatar,
      aboutHidden: !canViewAbout,
    },
  };
}

export async function getBlockRelationship(
  userAId: string,
  userBId: string
): Promise<{
  blocked: boolean;
  blockedByA: boolean;
  blockedByB: boolean;
}> {
  if (
    !Types.ObjectId.isValid(userAId) ||
    !Types.ObjectId.isValid(userBId) ||
    userAId === userBId
  ) {
    return { blocked: false, blockedByA: false, blockedByB: false };
  }

  const [userA, userB] = await Promise.all([
    User.findById(userAId).select('blockedUsers').lean(),
    User.findById(userBId).select('blockedUsers').lean(),
  ]);

  const blockedByA = Boolean(
    userA?.blockedUsers?.some((id) => id.toString() === userBId)
  );
  const blockedByB = Boolean(
    userB?.blockedUsers?.some((id) => id.toString() === userAId)
  );

  return {
    blocked: blockedByA || blockedByB,
    blockedByA,
    blockedByB,
  };
}
