/* BlinkUpZ Unified Service Worker — PWA App Shell, Static Assets, Safe Media Caching & Web Push */

const CACHE_VERSION = 'v4';
const SHELL_CACHE = `blinkupz-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `blinkupz-static-${CACHE_VERSION}`;
const MEDIA_CACHE = `blinkupz-media-${CACHE_VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, STATIC_CACHE, MEDIA_CACHE]);

const SHELL_PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-192x192.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/blinkupz-icon.png',
  '/blinkupz-badge.png',
];

const MAX_MEDIA_ENTRIES = 160;
const RECENT_MESSAGE_IDS = new Set();

function rememberMessageId(id) {
  if (!id) return true;
  if (RECENT_MESSAGE_IDS.has(id)) return false;
  RECENT_MESSAGE_IDS.add(id);
  if (RECENT_MESSAGE_IDS.size > 300) {
    const first = RECENT_MESSAGE_IDS.values().next().value;
    if (first) RECENT_MESSAGE_IDS.delete(first);
  }
  return true;
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch {
    // Ignore CacheStorage pruning errors
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await Promise.all(
          SHELL_PRECACHE_URLS.map(async (url) => {
            try {
              const res = await fetch(url, { cache: 'reload' });
              if (res && res.ok) {
                await cache.put(url, res);
              }
            } catch {
              // Non-fatal during install (e.g., offline install check)
            }
          })
        );
      } finally {
        // Only activate immediately on first fresh install when no previous worker is active;
        // existing controlled sessions wait safely until the user clicks "Update Now".
        if (!self.registration || !self.registration.active) {
          await self.skipWaiting();
        }
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) => {
          if (name.startsWith('blinkupz-') && !ACTIVE_CACHES.has(name)) {
            return caches.delete(name);
          }
          return Promise.resolve(false);
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'BLINKUPZ_SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'BLINKUPZ_CLEAR_MEDIA_CACHE') {
    event.waitUntil(caches.delete(MEDIA_CACHE));
    return;
  }
  if (data.type === 'BLINKUPZ_CLEAR_ALL_USER_CACHES') {
    event.waitUntil(Promise.all([caches.delete(MEDIA_CACHE), caches.delete(SHELL_CACHE)]));
    return;
  }
  if (data.type === 'BLINKUPZ_DISMISS_CALL_NOTIFICATION') {
    event.waitUntil(closeCallNotificationsById(data.callId || null));
  }
});

function isStaticAssetRequest(url) {
  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith('/assets/') ||
      url.pathname === '/manifest.webmanifest' ||
      url.pathname === '/icon.svg' ||
      url.pathname === '/apple-touch-icon.png' ||
      url.pathname.startsWith('/pwa-') ||
      url.pathname === '/blinkupz-icon.png' ||
      url.pathname === '/blinkupz-badge.png' ||
      /\.(?:js|css|woff2?|ttf|eot|svg|ico)$/i.test(url.pathname)
    ) {
      return true;
    }
  }
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    return true;
  }
  return false;
}

function isCacheableMediaRequest(request, url) {
  // Never cache authenticated requests carrying Authorization header in shared CacheStorage
  if (request.headers.has('Authorization')) return false;
  // Never cache byte-range requests (partial 206 responses break Cache.put)
  if (request.headers.has('Range')) return false;

  if (url.hostname === 'res.cloudinary.com') {
    return (
      request.destination === 'image' ||
      /\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname) ||
      url.pathname.includes('/image/upload/')
    );
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/uploads/')) return true;
    if (
      request.destination === 'image' &&
      /\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname)
    ) {
      return true;
    }
  }

  return false;
}

async function networkFirstNavigation(request) {
  const shellCache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        // Store navigation shell safely under '/'
        shellCache.put('/', response.clone()).catch(() => {});
      }
    }
    return response;
  } catch {
    const cachedShell = (await shellCache.match('/')) || (await caches.match(request));
    if (cachedShell) return cachedShell;
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="theme-color" content="#181818" /><title>BlinkUpZ — Offline</title></head><body style="background:#181818;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px"><div style="max-width:340px;width:100%;text-align:center;background:#202020;border:1px solid #303030;border-radius:16px;padding:24px"><h2 style="margin:0 0 8px;font-size:18px;font-weight:600">You are offline</h2><p style="color:#999999;font-size:13px;line-height:1.5;margin:0 0 18px">This page isn\'t cached yet. Check your internet connection and try again.</p><button onclick="window.location.reload()" style="background:#ffffff;color:#181818;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer">Try Again</button></div></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidateMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.status === 200 && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
        await trimCache(MEDIA_CACHE, MAX_MEDIA_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Revalidate quietly in background
    networkPromise.catch(() => {});
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return new Response('', { status: 504, statusText: 'Media offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // CRITICAL: Never cache API, Socket.IO, Vite dev HMR, or /sw.js itself
  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/socket.io/') ||
      url.pathname === '/sw.js' ||
      url.pathname.startsWith('/@vite') ||
      url.pathname.startsWith('/@react-refresh') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/')
    ) {
      return;
    }
  }

  // SPA navigation requests: Network First with offline app-shell fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Versioned JS/CSS/font/static assets: Cache First
  if (isStaticAssetRequest(url)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  // Public/authorized non-credentialed media & avatars: Stale-While-Revalidate + bounded eviction
  if (isCacheableMediaRequest(request, url)) {
    event.respondWith(staleWhileRevalidateMedia(request));
  }
});

/* ---------------- Web Push Notification Handlers ---------------- */

async function closeCallNotificationsById(callId) {
  try {
    const notifications = await self.registration.getNotifications();
    const targetTag = callId ? `blinkupz-call-${callId}` : null;
    for (const notif of notifications) {
      const notifData = notif.data || {};
      const isCallNotif =
        notifData.type === 'incoming_call' ||
        (typeof notif.tag === 'string' && notif.tag.startsWith('blinkupz-call-'));
      if (!isCallNotif) continue;
      if (!targetTag || notif.tag === targetTag || notifData.callId === callId) {
        notif.close();
      }
    }
  } catch {
    // Ignore Notification query errors
  }
}

async function cleanupExpiredCallNotifications() {
  try {
    const notifications = await self.registration.getNotifications();
    const now = Date.now();
    for (const notif of notifications) {
      const data = notif.data || {};
      if (data.type === 'incoming_call' && data.expiresAt && now > Number(data.expiresAt)) {
        notif.close();
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

function buildIncomingCallTargetUrl(baseUrl, callId, extraParams) {
  try {
    const parsed = new URL(
      typeof baseUrl === 'string' && baseUrl.startsWith('/') ? baseUrl : '/calls',
      self.location.origin
    );
    if (callId) {
      parsed.searchParams.set('incomingCall', callId);
    }
    if (extraParams && typeof extraParams === 'object') {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v === null || v === undefined || v === '') {
          parsed.searchParams.delete(k);
        } else {
          parsed.searchParams.set(k, String(v));
        }
      }
    }
    return parsed.pathname + parsed.search;
  } catch {
    return callId ? `/calls?incomingCall=${encodeURIComponent(callId)}` : '/calls';
  }
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = null;
  try {
    payload = event.data.json();
  } catch {
    const text = event.data.text();
    if (!text) return;
    payload = {
      title: 'BlinkUpZ',
      body: text,
      url: '/chats',
      tag: 'blinkupz-general',
    };
  }

  if (!payload || !payload.title) return;

  if (payload.type === 'incoming_call') {
    if (!payload.callId) return;
    if (payload.expiresAt && Date.now() > Number(payload.expiresAt)) {
      return;
    }
    if (!rememberMessageId(`call:${payload.callId}`)) {
      return;
    }

    const baseTargetUrl =
      typeof payload.url === 'string' && payload.url.startsWith('/')
        ? payload.url
        : payload.conversationId
          ? `/chats/${payload.conversationId}`
          : '/calls';
    const targetUrl = buildIncomingCallTargetUrl(baseTargetUrl, payload.callId);

    event.waitUntil(
      (async () => {
        await cleanupExpiredCallNotifications();

        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });

        const focusedVisibleClient = windowClients.find(
          (client) => client.focused && client.visibilityState === 'visible'
        );

        if (focusedVisibleClient) {
          // User already has BlinkUpZ focused in foreground — sync via client instead of duplicate OS push
          focusedVisibleClient.postMessage({
            type: 'BLINKUPZ_SYNC_ACTIVE_CALL',
            callId: payload.callId,
          });
          return;
        }

        const isVideo = payload.callType === 'video';
        const callerName = payload.callerName || 'Someone';
        const title =
          payload.title ||
          (isVideo ? 'BlinkUpZ — Incoming Video Call' : 'BlinkUpZ — Incoming Voice Call');
        const body =
          payload.body ||
          (isVideo
            ? `${callerName} is starting a video call.`
            : `${callerName} is calling you.`);

        const callOptions = {
          body,
          icon: payload.icon || '/blinkupz-icon.png',
          badge: '/blinkupz-badge.png',
          tag: payload.tag || `blinkupz-call-${payload.callId}`,
          renotify: true,
          requireInteraction: true,
          timestamp:
            typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
          silent: payload.soundEnabled === false,
          data: {
            url: targetUrl,
            conversationId: payload.conversationId || null,
            callId: payload.callId,
            callType: payload.callType || 'voice',
            callerId: payload.callerId || null,
            callerName,
            expiresAt: payload.expiresAt || null,
            type: 'incoming_call',
          },
          actions: [
            { action: 'accept_call', title: 'Accept' },
            { action: 'decline_call', title: 'Decline' },
          ],
        };

        if (payload.vibrationEnabled !== false) {
          callOptions.vibrate = [280, 140, 280, 140, 420];
        }

        await self.registration.showNotification(title, callOptions);

        // Best-effort cleanup if SW remains alive until call expiry deadline
        if (payload.expiresAt) {
          const remainingMs = Number(payload.expiresAt) - Date.now();
          if (remainingMs > 0 && remainingMs <= 90000) {
            setTimeout(() => {
              void closeCallNotificationsById(payload.callId);
            }, remainingMs + 500);
          }
        }
      })()
    );
    return;
  }

  if (payload.messageId && !rememberMessageId(payload.messageId)) {
    return;
  }

  const targetUrl =
    typeof payload.url === 'string' && payload.url.startsWith('/')
      ? payload.url
      : '/chats';

  event.waitUntil(
    (async () => {
      await cleanupExpiredCallNotifications();

      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const isActivelyViewingThread = windowClients.some((client) => {
        if (!client.focused || client.visibilityState !== 'visible') {
          return false;
        }
        try {
          const clientUrl = new URL(client.url);
          return clientUrl.pathname === targetUrl;
        } catch {
          return false;
        }
      });

      if (isActivelyViewingThread) {
        return;
      }

      const options = {
        body: payload.body || 'New notification',
        icon: payload.icon || '/pwa-192x192.png',
        badge: '/blinkupz-badge.png',
        tag:
          payload.tag ||
          (payload.conversationId
            ? `blinkupz-conv-${payload.conversationId}`
            : 'blinkupz-notif'),
        renotify: true,
        timestamp:
          typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
        silent: payload.soundEnabled === false,
        data: {
          url: targetUrl,
          conversationId: payload.conversationId || null,
          communityId: payload.communityId || null,
          messageId: payload.messageId || null,
          type: payload.type || 'direct_message',
        },
        actions: [
          { action: 'open', title: 'Open chat' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      };

      if (payload.vibrationEnabled !== false) {
        options.vibrate = [110, 50, 110];
      }

      await self.registration.showNotification(payload.title, options);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};

  if (notifData.type === 'incoming_call' && notifData.callId) {
    const callId = String(notifData.callId);

    if (event.action === 'decline_call') {
      event.waitUntil(
        (async () => {
          await closeCallNotificationsById(callId);
          try {
            await fetch(`/api/calls/${encodeURIComponent(callId)}/decline`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'Call declined' }),
            });
          } catch {
            // Ignore network/session errors during background decline
          }

          const windowClients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          for (const client of windowClients) {
            if (client.url.startsWith(self.location.origin)) {
              client.postMessage({
                type: 'BLINKUPZ_CALL_DECLINED_FROM_NOTIFICATION',
                callId,
              });
            }
          }
        })()
      );
      return;
    }

    const wantAccept = event.action === 'accept_call';
    event.waitUntil(
      (async () => {
        await closeCallNotificationsById(callId);

        let canStillAccept = true;
        if (notifData.expiresAt && Date.now() > Number(notifData.expiresAt)) {
          canStillAccept = false;
        }

        if (canStillAccept) {
          try {
            const verifyRes = await fetch(`/api/calls/${encodeURIComponent(callId)}`, {
              method: 'GET',
              credentials: 'include',
            });
            if (verifyRes.ok) {
              const json = await verifyRes.json();
              if (json && json.data && json.data.canAccept === false) {
                canStillAccept = false;
              }
            } else if (
              verifyRes.status === 404 ||
              verifyRes.status === 409 ||
              verifyRes.status === 410
            ) {
              canStillAccept = false;
            }
          } catch {
            // If offline/transient or token in memory only, let opened app validate via API/Socket
          }
        }

        const baseTarget =
          typeof notifData.url === 'string' && notifData.url.startsWith('/')
            ? notifData.url
            : notifData.conversationId
              ? `/chats/${notifData.conversationId}`
              : '/calls';

        const actionMode = wantAccept && canStillAccept ? 'accept' : 'open';
        const targetPath = buildIncomingCallTargetUrl(baseTarget, callId, {
          callAction: actionMode === 'accept' ? 'accept' : null,
          callStatus: canStillAccept ? null : 'expired',
        });
        const absoluteTargetUrl = new URL(targetPath, self.location.origin).href;

        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });

        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            await client.focus();
            client.postMessage({
              type: 'BLINKUPZ_INCOMING_CALL',
              callId,
              action: actionMode,
              canAccept: canStillAccept,
              url: targetPath,
            });
            return;
          }
        }

        if (self.clients.openWindow) {
          await self.clients.openWindow(absoluteTargetUrl);
        }
      })()
    );
    return;
  }

  if (event.action === 'dismiss') {
    return;
  }

  const targetPath =
    typeof notifData.url === 'string' && notifData.url.startsWith('/')
      ? notifData.url
      : '/chats';
  const absoluteTargetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      await cleanupExpiredCallNotifications();

      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          client.postMessage({
            type: 'BLINKUPZ_NAVIGATE',
            url: targetPath,
          });
          if ('navigate' in client) {
            try {
              const current = new URL(client.url);
              if (current.pathname !== targetPath) {
                await client.navigate(absoluteTargetUrl);
              }
            } catch {
              // Ignore if postMessage already handled SPA navigation
            }
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(absoluteTargetUrl);
      }
    })()
  );
});
