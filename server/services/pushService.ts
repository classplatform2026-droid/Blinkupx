import { Types } from 'mongoose';
import * as webpush from 'web-push';
import { env, isWebPushConfigured } from '../config/env.ts';
import { PushSubscription, type IPushSubscription } from '../models/PushSubscription.ts';
import type { IUser } from '../models/User.ts';
import { isUserActivelyViewingConversation } from '../sockets/index.ts';
import { resolveUserSettings } from '../utils/serializers.ts';
import { canViewPrivacyField } from './privacyService.ts';

let vapidInitialized = false;

function ensureVapidConfigured(): boolean {
  if (!isWebPushConfigured()) return false;
  if (!vapidInitialized) {
    webpush.setVapidDetails(
      env.webPush.subject,
      env.webPush.publicKey,
      env.webPush.privateKey
    );
    vapidInitialized = true;
  }
  return true;
}

// Bounded deduplication cache to avoid sending duplicate push payloads per (eventKey, endpoint)
const recentPushKeys = new Set<string>();

function claimPushDeliveryKey(eventKey: string, endpoint: string): boolean {
  const composite = `${eventKey}::${endpoint}`;
  if (recentPushKeys.has(composite)) {
    return false;
  }
  recentPushKeys.add(composite);
  if (recentPushKeys.size > 4000) {
    const oldest = recentPushKeys.values().next().value;
    if (oldest) recentPushKeys.delete(oldest);
  }
  return true;
}

export function deriveDeviceLabel(userAgent: string, provided?: string): string {
  if (provided && provided.trim()) {
    return provided.trim().slice(0, 100);
  }
  const ua = userAgent || '';
  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  let os = 'Device';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return `${browser} on ${os}`;
}

export function getPublicVapidKey(): string {
  return env.webPush.publicKey;
}

export async function upsertPushSubscription(params: {
  userId: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  };
  deviceId?: string;
  deviceLabel?: string;
  userAgent?: string;
}): Promise<IPushSubscription> {
  const userObjectId = new Types.ObjectId(params.userId);
  const label = deriveDeviceLabel(params.userAgent || '', params.deviceLabel);

  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint: params.subscription.endpoint },
    {
      $set: {
        userId: userObjectId,
        endpoint: params.subscription.endpoint,
        expirationTime: params.subscription.expirationTime ?? null,
        keys: {
          p256dh: params.subscription.keys.p256dh,
          auth: params.subscription.keys.auth,
        },
        deviceId: (params.deviceId || '').trim(),
        deviceLabel: label,
        userAgent: (params.userAgent || '').slice(0, 512),
        enabled: true,
        failureCount: 0,
        lastUsedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return doc;
}

export async function removePushSubscription(params: {
  userId: string;
  endpoint?: string;
  deviceId?: string;
}): Promise<number> {
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(params.userId),
  };

  if (params.endpoint) {
    filter.endpoint = params.endpoint;
  } else if (params.deviceId) {
    filter.deviceId = params.deviceId;
  } else {
    return 0;
  }

  const res = await PushSubscription.deleteMany(filter);
  return res.deletedCount || 0;
}

export async function listUserPushSubscriptions(userId: string) {
  const subs = await PushSubscription.find({
    userId: new Types.ObjectId(userId),
    enabled: true,
  })
    .select('_id deviceId deviceLabel lastUsedAt createdAt')
    .sort({ lastUsedAt: -1 })
    .lean();

  return subs.map((sub) => ({
    id: sub._id.toString(),
    deviceId: sub.deviceId || '',
    deviceLabel: sub.deviceLabel || 'Web Browser',
    lastUsedAt: sub.lastUsedAt,
    createdAt: sub.createdAt,
  }));
}

export async function deleteUserPushSubscriptionById(
  userId: string,
  subscriptionId: string
): Promise<boolean> {
  if (!Types.ObjectId.isValid(subscriptionId)) {
    return false;
  }
  const res = await PushSubscription.deleteOne({
    _id: new Types.ObjectId(subscriptionId),
    userId: new Types.ObjectId(userId),
  });
  return (res.deletedCount || 0) > 0;
}

export interface PushNotificationPayload {
  type: 'direct_message' | 'group_message' | 'community_message' | 'community_activity';
  messageId?: string;
  conversationId?: string;
  communityId?: string | null;
  title: string;
  body: string;
  icon?: string;
  tag: string;
  url: string;
  previewHidden?: boolean;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
  timestamp: number;
}

async function sendPayloadToSubscriptions(
  subscriptions: IPushSubscription[],
  eventDedupeKey: string,
  buildPayloadForSub: (sub: IPushSubscription) => PushNotificationPayload | null
): Promise<void> {
  if (!ensureVapidConfigured() || subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      if (!claimPushDeliveryKey(eventDedupeKey, sub.endpoint)) {
        return;
      }

      const payload = buildPayloadForSub(sub);
      if (!payload) return;

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          JSON.stringify(payload),
          {
            TTL: 86400,
            urgency: 'high',
          }
        );

        await PushSubscription.updateOne(
          { _id: sub._id },
          { $set: { lastUsedAt: new Date(), failureCount: 0 } }
        );
      } catch (err: unknown) {
        const pushErr = err as { statusCode?: number; message?: string };
        const statusCode = pushErr?.statusCode;

        // Remove permanently expired, unsubscribed, or VAPID-mismatched subscriptions
        if (
          statusCode === 404 ||
          statusCode === 410 ||
          statusCode === 401 ||
          statusCode === 403
        ) {
          await PushSubscription.deleteOne({ _id: sub._id });
          return;
        }

        const updated = await PushSubscription.findByIdAndUpdate(
          sub._id,
          { $inc: { failureCount: 1 } },
          { new: true }
        ).select('failureCount');

        if (updated && updated.failureCount >= 5) {
          await PushSubscription.deleteOne({ _id: sub._id });
        }
      }
    })
  );
}

export async function dispatchMessagePushNotifications(params: {
  messageId: string;
  conversationId: string;
  conversationType: 'direct' | 'group' | 'community';
  conversationName: string;
  communityId: string | null;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderProfilePhotoPrivacy: 'everyone' | 'contacts' | 'nobody';
  senderBlockedUsers: Set<string>;
  previewText: string;
  recipientDocs: Array<{
    _id: Types.ObjectId;
    settings?: IUser['settings'];
    blockedUsers?: Types.ObjectId[];
  }>;
  participantMuteMap: Map<string, Date | null>;
}): Promise<void> {
  if (!ensureVapidConfigured()) return;

  const now = new Date();
  const eligibleRecipientIds: string[] = [];
  const recipientSettingsMap = new Map<
    string,
    ReturnType<typeof resolveUserSettings>['notifications']
  >();

  for (const recipient of params.recipientDocs) {
    const pid = recipient._id.toString();
    if (pid === params.senderId) continue;

    // Respect blocked-user rules in both directions
    const recipientBlockedSender = Boolean(
      recipient.blockedUsers?.some((id) => id.toString() === params.senderId)
    );
    if (recipientBlockedSender || params.senderBlockedUsers.has(pid)) {
      continue;
    }

    // Respect per-chat / per-community mute settings
    const mutedUntil = params.participantMuteMap.get(pid);
    if (mutedUntil && mutedUntil > now) {
      continue;
    }

    const notif = resolveUserSettings(recipient.settings).notifications;
    if (!notif.pushEnabled) continue;

    const categoryEnabled =
      params.conversationType === 'direct'
        ? notif.privateMessages
        : params.conversationType === 'group'
          ? notif.groupMessages
          : notif.communityMessages;
    if (!categoryEnabled) continue;

    // Avoid unnecessary push when recipient is actively viewing this conversation
    if (
      isUserActivelyViewingConversation(
        pid,
        params.conversationId,
        params.communityId
      )
    ) {
      continue;
    }

    eligibleRecipientIds.push(pid);
    recipientSettingsMap.set(pid, notif);
  }

  if (eligibleRecipientIds.length === 0) return;

  const subscriptions = await PushSubscription.find({
    userId: { $in: eligibleRecipientIds.map((id) => new Types.ObjectId(id)) },
    enabled: true,
  });
  if (subscriptions.length === 0) return;

  const targetUrl = params.communityId
    ? `/community/${params.communityId}`
    : `/chats/${params.conversationId}`;
  const notifType: PushNotificationPayload['type'] =
    params.conversationType === 'direct'
      ? 'direct_message'
      : params.conversationType === 'group'
        ? 'group_message'
        : 'community_message';
  const title =
    params.conversationType === 'direct'
      ? params.senderName
      : `${params.senderName} • ${params.conversationName}`;

  await sendPayloadToSubscriptions(
    subscriptions,
    `msg:${params.messageId}`,
    (sub) => {
      const pid = sub.userId.toString();
      const notif = recipientSettingsMap.get(pid);
      if (!notif) return null;

      // Respect sender's profilePhoto privacy setting before attaching avatar
      const canSeeSenderPhoto = canViewPrivacyField(
        params.senderProfilePhotoPrivacy,
        false,
        true,
        false
      );
      const avatarIcon =
        canSeeSenderPhoto &&
        params.senderAvatar &&
        params.senderAvatar.startsWith('http')
          ? params.senderAvatar
          : '/blinkupz-icon.png';

      const showPreview = notif.messagePreview;
      return {
        type: notifType,
        messageId: params.messageId,
        conversationId: params.conversationId,
        communityId: params.communityId,
        title,
        body: showPreview ? params.previewText.slice(0, 140) : 'New message',
        icon: avatarIcon,
        tag: `blinkupz-conv-${params.conversationId}`,
        url: targetUrl,
        previewHidden: !showPreview,
        soundEnabled: notif.soundEnabled,
        vibrationEnabled: notif.vibrationEnabled,
        timestamp: Date.now(),
      };
    }
  );
}

export async function dispatchCommunityActivityPushNotifications(params: {
  event: string;
  communityId: string;
  communityName: string;
  title: string;
  body: string;
  recipients: Array<{
    _id: Types.ObjectId;
    settings?: IUser['settings'];
  }>;
}): Promise<void> {
  if (!ensureVapidConfigured() || params.recipients.length === 0) return;

  const eligibleIds: string[] = [];
  const notifMap = new Map<
    string,
    ReturnType<typeof resolveUserSettings>['notifications']
  >();

  for (const u of params.recipients) {
    const uid = u._id.toString();
    const notif = resolveUserSettings(u.settings).notifications;
    if (!notif.pushEnabled || !notif.communityActivity) continue;
    eligibleIds.push(uid);
    notifMap.set(uid, notif);
  }

  if (eligibleIds.length === 0) return;

  const subscriptions = await PushSubscription.find({
    userId: { $in: eligibleIds.map((id) => new Types.ObjectId(id)) },
    enabled: true,
  });
  if (subscriptions.length === 0) return;

  const eventKey = `comm:${params.communityId}:${params.event}:${Math.floor(Date.now() / 2000)}`;
  await sendPayloadToSubscriptions(subscriptions, eventKey, (sub) => {
    const notif = notifMap.get(sub.userId.toString());
    if (!notif) return null;
    return {
      type: 'community_activity',
      communityId: params.communityId,
      title: params.title,
      body: params.body,
      icon: '/blinkupz-icon.png',
      tag: `blinkupz-comm-${params.communityId}-${params.event}`,
      url: `/community/${params.communityId}`,
      soundEnabled: notif.soundEnabled,
      vibrationEnabled: notif.vibrationEnabled,
      timestamp: Date.now(),
    };
  });
}
