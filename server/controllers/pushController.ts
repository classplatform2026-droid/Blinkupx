import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { User } from '../models/User.ts';
import {
  deleteUserPushSubscriptionById,
  getPublicVapidKey,
  listUserPushSubscriptions,
  removePushSubscription,
  upsertPushSubscription,
} from '../services/pushService.ts';
import { AppError } from '../utils/errors.ts';
import { resolveUserSettings, serializeUser } from '../utils/serializers.ts';
import {
  notificationSettingsSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from '../validators/schemas.ts';

export async function getVapidPublicKey(_req: AuthenticatedRequest, res: Response) {
  const publicKey = getPublicVapidKey();
  if (!publicKey) {
    throw new AppError(
      'Web Push VAPID key is not configured on this server.',
      503,
      'VAPID_NOT_CONFIGURED'
    );
  }
  res.json({
    success: true,
    data: { publicKey },
  });
}

export async function getMyPushSubscriptions(
  req: AuthenticatedRequest,
  res: Response
) {
  const subscriptions = await listUserPushSubscriptions(req.userId!);
  res.json({
    success: true,
    data: subscriptions,
  });
}

export async function subscribePush(req: AuthenticatedRequest, res: Response) {
  const parsed = pushSubscribeSchema.parse(req.body);
  const userId = req.userId!;
  const userAgent = String(req.headers['user-agent'] || '');

  const sub = await upsertPushSubscription({
    userId,
    subscription: parsed.subscription,
    deviceId: parsed.deviceId,
    deviceLabel: parsed.deviceLabel,
    userAgent,
  });

  let updatedUserPayload: ReturnType<typeof serializeUser> | undefined;
  if (parsed.enablePreference) {
    const user = await User.findById(userId);
    if (user) {
      const current = resolveUserSettings(user.settings);
      if (!current.notifications.pushEnabled) {
        user.settings = {
          ...current,
          notifications: {
            ...current.notifications,
            pushEnabled: true,
          },
        };
        user.markModified('settings');
        await user.save();
      }
      updatedUserPayload = serializeUser(user);
    }
  }

  const subscriptions = await listUserPushSubscriptions(userId);

  res.status(201).json({
    success: true,
    message: 'Push notifications enabled for this device.',
    data: {
      subscription: {
        id: sub._id.toString(),
        deviceId: sub.deviceId,
        deviceLabel: sub.deviceLabel,
        lastUsedAt: sub.lastUsedAt,
        createdAt: sub.createdAt,
      },
      subscriptions,
      user: updatedUserPayload,
    },
  });
}

export async function unsubscribePush(req: AuthenticatedRequest, res: Response) {
  const parsed = pushUnsubscribeSchema.parse(req.body || {});
  const userId = req.userId!;

  const removedCount = await removePushSubscription({
    userId,
    endpoint: parsed.endpoint,
    deviceId: parsed.deviceId,
  });

  let updatedUserPayload: ReturnType<typeof serializeUser> | undefined;
  if (parsed.disablePreference) {
    const user = await User.findById(userId);
    if (user) {
      const current = resolveUserSettings(user.settings);
      user.settings = {
        ...current,
        notifications: {
          ...current.notifications,
          pushEnabled: false,
        },
      };
      user.markModified('settings');
      await user.save();
      updatedUserPayload = serializeUser(user);
    }
  }

  const subscriptions = await listUserPushSubscriptions(userId);

  res.json({
    success: true,
    message: 'Push subscription removed.',
    data: {
      removedCount,
      subscriptions,
      user: updatedUserPayload,
    },
  });
}

export async function removePushSubscriptionById(
  req: AuthenticatedRequest,
  res: Response
) {
  const removed = await deleteUserPushSubscriptionById(
    req.userId!,
    req.params.id
  );
  if (!removed) {
    throw new AppError(
      'Push subscription not found.',
      404,
      'SUBSCRIPTION_NOT_FOUND'
    );
  }
  const subscriptions = await listUserPushSubscriptions(req.userId!);
  res.json({
    success: true,
    message: 'Device removed from push notifications.',
    data: subscriptions,
  });
}

export async function updatePushPreferences(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = notificationSettingsSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const current = resolveUserSettings(user.settings);
  user.settings = {
    ...current,
    notifications: {
      ...current.notifications,
      ...parsed,
    },
  };
  user.markModified('settings');
  await user.save();

  res.json({
    success: true,
    message: 'Notification preferences updated.',
    data: serializeUser(user),
  });
}
