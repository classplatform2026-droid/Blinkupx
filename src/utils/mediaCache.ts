import { broadcastCacheSync } from './cacheSync';
import {
  clearAllUserIndexedDbData,
  getIndexedDbCounts,
  pruneOldCacheData,
} from './indexedDb';
import { queryClient } from './queryClient';
import { postServiceWorkerMessage } from './swRegistration';

export interface AppStorageStats {
  usageBytes: number | null;
  quotaBytes: number | null;
  mediaCacheEntries: number;
  staticCacheEntries: number;
  conversationsCount: number;
  messagesCount: number;
  pendingMessagesCount: number;
  profilesCount: number;
  communitiesCount: number;
  callHistoryCount: number;
}

export async function getAppStorageStats(userId?: string): Promise<AppStorageStats> {
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let mediaCacheEntries = 0;
  let staticCacheEntries = 0;

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number') usageBytes = est.usage;
      if (typeof est.quota === 'number') quotaBytes = est.quota;
    } catch {
      // Optional API
    }
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const names = await window.caches.keys();
      for (const name of names) {
        const cache = await window.caches.open(name);
        const keys = await cache.keys();
        if (name.startsWith('blinkupz-media-')) {
          mediaCacheEntries += keys.length;
        } else if (
          name.startsWith('blinkupz-static-') ||
          name.startsWith('blinkupz-shell-')
        ) {
          staticCacheEntries += keys.length;
        }
      }
    } catch {
      // Ignore CacheStorage inspect errors
    }
  }

  const dbCounts = await getIndexedDbCounts(userId);

  return {
    usageBytes,
    quotaBytes,
    mediaCacheEntries,
    staticCacheEntries,
    conversationsCount: dbCounts.conversations,
    messagesCount: dbCounts.messages,
    pendingMessagesCount: dbCounts.pendingMessages,
    profilesCount: dbCounts.profiles,
    communitiesCount: dbCounts.communities,
    callHistoryCount: dbCounts.callHistory,
  };
}

export async function clearCachedMediaOnly(): Promise<void> {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const names = await window.caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('blinkupz-media-'))
          .map((name) => window.caches.delete(name))
      );
    } catch {
      // Ignore
    }
  }
  await postServiceWorkerMessage({ type: 'BLINKUPZ_CLEAR_MEDIA_CACHE' });
  broadcastCacheSync({ type: 'CACHE_CLEARED', scope: 'media' });
}

export async function clearOfflineDataCache(preservePending = true): Promise<void> {
  queryClient.clear();
  await clearAllUserIndexedDbData(preservePending);
  broadcastCacheSync({ type: 'CACHE_CLEARED', scope: 'offline' });
}

export async function clearAllAccountCaches(userId?: string): Promise<void> {
  queryClient.clear();
  await clearAllUserIndexedDbData(false);

  try {
    if (userId) {
      window.localStorage.removeItem(`blinkupz_recent_searches_${userId}`);
    }
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('blinkupz_recent_searches_')) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Ignore localStorage restrictions
  }

  await clearCachedMediaOnly();
  broadcastCacheSync({ type: 'LOGOUT_CLEAR' });
}

export async function runPeriodicCacheMaintenance(): Promise<void> {
  await pruneOldCacheData(false);
}
