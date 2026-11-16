/* BlinkUpZ Web Push Service Worker */

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

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

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
  if (payload.messageId && !rememberMessageId(payload.messageId)) {
    return;
  }

  const targetUrl = typeof payload.url === 'string' && payload.url.startsWith('/')
    ? payload.url
    : '/chats';

  event.waitUntil(
    (async () => {
      // Avoid showing OS push notification if user is actively focused on that exact thread
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
        icon: payload.icon || '/blinkupz-icon.png',
        badge: '/blinkupz-badge.png',
        tag: payload.tag || (payload.conversationId ? `blinkupz-conv-${payload.conversationId}` : 'blinkupz-notif'),
        renotify: true,
        timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
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

  if (event.action === 'dismiss') {
    return;
  }

  const notifData = event.notification.data || {};
  const targetPath =
    typeof notifData.url === 'string' && notifData.url.startsWith('/')
      ? notifData.url
      : '/chats';
  const absoluteTargetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
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
