import { pushApi } from '../services/api';
import type { PushDeviceSubscription, User } from '../types';
import { getBrowserNotificationState } from './notifications';

const DEVICE_ID_STORAGE_KEY = 'blinkupz_push_device_id';
const PUSH_OPT_OUT_KEY = 'blinkupz_push_device_opt_out';

export function getOrCreatePushDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && existing.length >= 8) {
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `dev_${Date.now()}`;
  }
}

export function getBrowserDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web Browser';
  const ua = navigator.userAgent || '';
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

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function setDeviceOptOut(optOut: boolean): void {
  try {
    if (optOut) {
      window.localStorage.setItem(PUSH_OPT_OUT_KEY, '1');
    } else {
      window.localStorage.removeItem(PUSH_OPT_OUT_KEY);
    }
  } catch {
    // Ignore storage access errors
  }
}

function isDeviceOptedOut(): boolean {
  try {
    return window.localStorage.getItem(PUSH_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}

export async function getActiveBrowserPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const registration =
      (await navigator.serviceWorker.getRegistration('/')) ||
      (await navigator.serviceWorker.getRegistration());
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function serializeBrowserSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  const endpoint = json.endpoint || sub.endpoint;
  const p256dh = json.keys?.p256dh || '';
  const auth = json.keys?.auth || '';
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Browser push subscription keys are incomplete.');
  }
  return {
    endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

function arrayBufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function enableBrowserPushSubscription(
  enablePreference = true
): Promise<{
  permission: NotificationPermission | 'unsupported';
  subscriptions: PushDeviceSubscription[];
  user?: User;
}> {
  if (!isWebPushSupported()) {
    throw new Error('Web Push notifications are not supported in this browser.');
  }

  // Only request permission in response to explicit user action
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    return { permission, subscriptions: [] };
  }

  const registration = await registerPushServiceWorker();
  if (!registration) {
    throw new Error('Service Worker registration failed.');
  }

  const publicKey = await pushApi.getVapidPublicKey();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const existingServerKey = arrayBufferToBase64Url(
      subscription.options?.applicationServerKey || null
    );
    if (existingServerKey && existingServerKey !== publicKey) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  setDeviceOptOut(false);

  const res = await pushApi.subscribe({
    subscription: serializeBrowserSubscription(subscription),
    deviceId: getOrCreatePushDeviceId(),
    deviceLabel: getBrowserDeviceLabel(),
    enablePreference,
  });

  return {
    permission,
    subscriptions: res.data.subscriptions,
    user: res.data.user,
  };
}

export async function disableBrowserPushSubscription(
  disablePreference = false
): Promise<{
  subscriptions: PushDeviceSubscription[];
  user?: User;
}> {
  setDeviceOptOut(true);

  const deviceId = getOrCreatePushDeviceId();
  let endpoint: string | undefined;

  const existing = await getActiveBrowserPushSubscription();
  if (existing) {
    endpoint = existing.endpoint;
    await existing.unsubscribe().catch(() => {});
  }

  const res = await pushApi.unsubscribe({
    endpoint,
    deviceId,
    disablePreference,
  });

  return {
    subscriptions: res.data.subscriptions,
    user: res.data.user,
  };
}

/**
 * Re-binds an already-granted browser push subscription to the authenticated user
 * on startup/login without ever triggering a browser permission prompt.
 */
export async function syncBrowserPushSubscriptionIfPermitted(
  pushEnabled: boolean
): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  if (getBrowserNotificationState() !== 'granted') return false;
  if (!pushEnabled || isDeviceOptedOut()) return false;

  try {
    const registration = await registerPushServiceWorker();
    if (!registration) return false;

    const existing = await registration.pushManager.getSubscription();
    if (!existing) return false;

    const publicKey = await pushApi.getVapidPublicKey();
    const existingServerKey = arrayBufferToBase64Url(
      existing.options?.applicationServerKey || null
    );

    let activeSub = existing;
    if (existingServerKey && existingServerKey !== publicKey) {
      await existing.unsubscribe().catch(() => {});
      activeSub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await pushApi.subscribe({
      subscription: serializeBrowserSubscription(activeSub),
      deviceId: getOrCreatePushDeviceId(),
      deviceLabel: getBrowserDeviceLabel(),
      enablePreference: false,
    });
    return true;
  } catch {
    return false;
  }
}
