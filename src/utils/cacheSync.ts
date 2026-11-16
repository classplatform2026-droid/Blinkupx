export type CacheSyncMessage =
  | { type: 'LOGOUT_CLEAR'; tabId: string }
  | { type: 'CACHE_CLEARED'; scope: 'media' | 'offline' | 'all'; tabId: string }
  | { type: 'QUEUE_UPDATED'; conversationId?: string; tabId: string }
  | { type: 'MESSAGES_UPDATED'; conversationId: string; tabId: string }
  | { type: 'CONVERSATIONS_UPDATED'; tabId: string };

const CHANNEL_NAME = 'blinkupz_cache_sync';
const STORAGE_FALLBACK_KEY = 'blinkupz_cache_sync_signal';

const TAB_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return channel;
}

type DistributedPayload =
  | { type: 'LOGOUT_CLEAR' }
  | { type: 'CACHE_CLEARED'; scope: 'media' | 'offline' | 'all' }
  | { type: 'QUEUE_UPDATED'; conversationId?: string }
  | { type: 'MESSAGES_UPDATED'; conversationId: string }
  | { type: 'CONVERSATIONS_UPDATED' };

export function broadcastCacheSync(payload: DistributedPayload): void {
  const fullPayload = { ...payload, tabId: TAB_ID } as CacheSyncMessage;
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(fullPayload);
      return;
    } catch {
      // Fallback to localStorage event
    }
  }

  try {
    window.localStorage.setItem(
      STORAGE_FALLBACK_KEY,
      JSON.stringify({ ...fullPayload, ts: Date.now() })
    );
  } catch {
    // Ignore storage restriction
  }
}

export function subscribeCacheSync(
  handler: (msg: CacheSyncMessage) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const ch = getChannel();
  const onBcMessage = (ev: MessageEvent) => {
    const data = ev.data as CacheSyncMessage | null;
    if (!data || data.tabId === TAB_ID) return;
    handler(data);
  };

  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_FALLBACK_KEY || !ev.newValue) return;
    try {
      const parsed = JSON.parse(ev.newValue) as CacheSyncMessage | null;
      if (!parsed || parsed.tabId === TAB_ID) return;
      handler(parsed);
    } catch {
      // Ignore malformed signal
    }
  };

  ch?.addEventListener('message', onBcMessage);
  window.addEventListener('storage', onStorage);

  return () => {
    ch?.removeEventListener('message', onBcMessage);
    window.removeEventListener('storage', onStorage);
  };
}
