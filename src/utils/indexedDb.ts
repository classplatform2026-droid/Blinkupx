import type {
  CallHistoryItem,
  CommunityDetail,
  CommunityMembersResponse,
  CommunitySummary,
  Conversation,
  Message,
  MessageDeliveryStatus,
  User,
} from '../types';
import type { MediaKind } from './mediaConfig';

const DB_NAME = 'blinkupz_cache_v1';
const DB_VERSION = 1;

const MAX_MESSAGES_PER_CONVERSATION = 150;
const MAX_TOTAL_MESSAGES = 2500;
const MESSAGE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CachedThreadMeta {
  hasMore: boolean;
  nextCursor: string | null;
  latestMessageId: string | null;
  fetchedAt: number;
}

const STATUS_RANK: Record<MessageDeliveryStatus, number> = {
  failed: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export interface StoredStagedMediaItem {
  clientItemId: string;
  file: Blob;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind: MediaKind;
  caption: string;
  duration?: number;
}

export interface PendingOutgoingRecord {
  clientMessageId: string;
  ownerUserId: string;
  conversationId: string;
  content: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'voice';
  replyTo?: string | null;
  duration?: number;
  message: Message;
  stagedItems?: StoredStagedMediaItem[];
  retryCount: number;
  lastError: string | null;
  createdAt: string;
}

interface StoredConversationRecord {
  cacheKey: string;
  ownerUserId: string;
  id: string;
  updatedAt: string;
  cachedAt: number;
  data: Conversation;
}

interface StoredMessageRecord {
  cacheKey: string;
  ownerUserId: string;
  id: string;
  clientMessageId: string;
  conversationId: string;
  createdAt: string;
  cachedAt: number;
  data: Message;
}

interface StoredProfileRecord {
  cacheKey: string;
  ownerUserId: string;
  userId: string;
  username: string;
  expiresAt: number;
  cachedAt: number;
  data: User;
}

interface StoredCommunityRecord {
  cacheKey: string;
  ownerUserId: string;
  id: string;
  kind: 'summary' | 'detail' | 'members';
  updatedAt: number;
  data: CommunitySummary | CommunityDetail | CommunityMembersResponse;
}

interface StoredCallHistoryRecord {
  cacheKey: string;
  ownerUserId: string;
  id: string;
  createdAt: string;
  cachedAt: number;
  data: CallHistoryItem;
}

interface StoredPreferenceRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name || '';
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED'
  );
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openCacheDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return null;
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains('conversations')) {
          const store = db.createObjectStore('conversations', { keyPath: 'cacheKey' });
          store.createIndex('byOwner', 'ownerUserId', { unique: false });
          store.createIndex('byOwnerUpdated', ['ownerUserId', 'updatedAt'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'cacheKey' });
          store.createIndex('byOwner', 'ownerUserId', { unique: false });
          store.createIndex(
            'byOwnerConvCreated',
            ['ownerUserId', 'conversationId', 'createdAt'],
            { unique: false }
          );
          store.createIndex('byOwnerClientId', ['ownerUserId', 'clientMessageId'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('pendingMessages')) {
          const store = db.createObjectStore('pendingMessages', {
            keyPath: 'clientMessageId',
          });
          store.createIndex('byOwner', 'ownerUserId', { unique: false });
          store.createIndex('byOwnerCreated', ['ownerUserId', 'createdAt'], {
            unique: false,
          });
          store.createIndex('byOwnerConv', ['ownerUserId', 'conversationId'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('profiles')) {
          const store = db.createObjectStore('profiles', { keyPath: 'cacheKey' });
          store.createIndex('byOwner', 'ownerUserId', { unique: false });
          store.createIndex('byOwnerUsername', ['ownerUserId', 'username'], {
            unique: false,
          });
          store.createIndex('byExpiresAt', 'expiresAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('communities')) {
          const store = db.createObjectStore('communities', { keyPath: 'cacheKey' });
          store.createIndex('byOwner', 'ownerUserId', { unique: false });
          store.createIndex('byOwnerKind', ['ownerUserId', 'kind'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('callHistory')) {
          const store = db.createObjectStore('callHistory', { keyPath: 'cacheKey' });
          store.createIndex('byOwner', 'ownerUserId', { unique: false });
          store.createIndex('byOwnerCreated', ['ownerUserId', 'createdAt'], {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'key' });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

async function runWithQuotaRetry<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T | null> {
  const db = await openCacheDb();
  if (!db) return null;
  try {
    return await fn(db);
  } catch (err) {
    if (isQuotaError(err)) {
      await pruneOldCacheData(true);
      try {
        return await fn(db);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* ---------------- Sanitization helpers (No secrets, no stale retry blobs) ---------------- */

function sanitizeMessageForStorage(msg: Message): Message {
  return {
    ...msg,
    retryPayload: null,
    mediaProgress: undefined,
    localQueued: msg.localQueued ? true : undefined,
  };
}

function shouldReplaceMessage(existing: Message | undefined, incoming: Message): boolean {
  if (!existing) return true;
  if (existing.deletedAt && !incoming.deletedAt) return false;
  if (!existing.deletedAt && incoming.deletedAt) return true;

  const existingStatus = STATUS_RANK[existing.deliveryStatus] ?? 1;
  const incomingStatus = STATUS_RANK[incoming.deliveryStatus] ?? 1;
  if (incomingStatus < existingStatus && incomingStatus < 2) {
    return false;
  }
  if (existing.editedAt && incoming.editedAt) {
    return new Date(incoming.editedAt).getTime() >= new Date(existing.editedAt).getTime();
  }
  if (existing.editedAt && !incoming.editedAt && incomingStatus <= existingStatus) {
    // Do not let an unedited older payload clobber an edited newer one
    return false;
  }
  return true;
}

function mergeMessageRecords(existing: Message | undefined, incoming: Message): Message {
  if (!existing) return sanitizeMessageForStorage(incoming);
  if (!shouldReplaceMessage(existing, incoming)) {
    return {
      ...existing,
      deliveredTo: Array.from(new Set([...existing.deliveredTo, ...incoming.deliveredTo])),
      readBy: Array.from(new Set([...existing.readBy, ...incoming.readBy])),
      deliveryStatus:
        STATUS_RANK[incoming.deliveryStatus] > STATUS_RANK[existing.deliveryStatus]
          ? incoming.deliveryStatus
          : existing.deliveryStatus,
    };
  }
  const mergedDelivered = Array.from(new Set([...existing.deliveredTo, ...incoming.deliveredTo]));
  const mergedRead = Array.from(new Set([...existing.readBy, ...incoming.readBy]));
  const bestStatus =
    STATUS_RANK[existing.deliveryStatus] >= 2 &&
    STATUS_RANK[existing.deliveryStatus] > STATUS_RANK[incoming.deliveryStatus]
      ? existing.deliveryStatus
      : incoming.deliveryStatus;

  return sanitizeMessageForStorage({
    ...incoming,
    deliveredTo: mergedDelivered,
    readBy: mergedRead,
    deliveryStatus: bestStatus,
  });
}

/* ---------------- Preferences & Safe User Snapshot (NO SECRETS) ---------------- */

export async function getActiveUserSnapshot(expectedUserId?: string): Promise<User | null> {
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('preferences', 'readonly');
    const store = tx.objectStore('preferences');
    const pointer = (await requestToPromise(
      store.get('last_user_id')
    )) as StoredPreferenceRecord | undefined;
    const uid = expectedUserId || (typeof pointer?.value === 'string' ? pointer.value : '');
    if (!uid) return null;
    const rec = (await requestToPromise(
      store.get(`user_snapshot:${uid}`)
    )) as StoredPreferenceRecord | undefined;
    return (rec?.value as User) || null;
  } catch {
    return null;
  }
}

export async function saveActiveUserSnapshot(user: User): Promise<void> {
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('preferences', 'readwrite');
    const store = tx.objectStore('preferences');
    const now = Date.now();
    // Strip nothing secret here because User type contains no JWT/password,
    // and ensure only expected public/settings fields are stored.
    const safeUser: User = {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      isVerified: user.isVerified,
      onlineStatus: user.onlineStatus,
      lastSeen: user.lastSeen,
      blockedUsers: user.blockedUsers,
      settings: user.settings,
      createdAt: user.createdAt,
    };
    store.put({ key: 'last_user_id', value: user.id, updatedAt: now });
    store.put({ key: `user_snapshot:${user.id}`, value: safeUser, updatedAt: now });
    await txDone(tx);
  });
}

export async function getLastCachedUserId(): Promise<string | null> {
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('preferences', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('preferences').get('last_user_id')
    )) as StoredPreferenceRecord | undefined;
    return typeof rec?.value === 'string' ? rec.value : null;
  } catch {
    return null;
  }
}

/* ---------------- Conversations Store ---------------- */

export async function saveCachedConversations(
  ownerUserId: string,
  conversations: Conversation[]
): Promise<void> {
  if (!ownerUserId || conversations.length === 0) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    const now = Date.now();
    for (const conv of conversations) {
      const cacheKey = `${ownerUserId}:${conv.id}`;
      const existing = (await requestToPromise(store.get(cacheKey))) as
        | StoredConversationRecord
        | undefined;
      if (
        existing &&
        new Date(existing.updatedAt).getTime() > new Date(conv.updatedAt).getTime() &&
        existing.data.lastMessage?.messageId !== conv.lastMessage?.messageId
      ) {
        // Avoid overwriting newer local conversation state with older snapshot
        continue;
      }
      store.put({
        cacheKey,
        ownerUserId,
        id: conv.id,
        updatedAt: conv.updatedAt || new Date().toISOString(),
        cachedAt: now,
        data: conv,
      } satisfies StoredConversationRecord);
    }
    await txDone(tx);
  });
}

export async function saveCachedConversation(
  ownerUserId: string,
  conversation: Conversation
): Promise<void> {
  return saveCachedConversations(ownerUserId, [conversation]);
}

export async function getCachedConversations(
  ownerUserId: string,
  filter: 'all' | 'unread' | 'groups' | 'archived' = 'all'
): Promise<Conversation[]> {
  if (!ownerUserId) return [];
  const db = await openCacheDb();
  if (!db) return [];
  try {
    const tx = db.transaction('conversations', 'readonly');
    const index = tx.objectStore('conversations').index('byOwner');
    const records = (await requestToPromise(index.getAll(ownerUserId))) as StoredConversationRecord[];
    let items = records.map((r) => r.data);

    if (filter === 'archived') {
      items = items.filter((c) => c.isArchived);
    } else {
      items = items.filter((c) => !c.isArchived);
      if (filter === 'unread') {
        items = items.filter((c) => c.unreadCount > 0);
      } else if (filter === 'groups') {
        items = items.filter((c) => c.type === 'group' || c.type === 'community');
      }
    }

    return items.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  } catch {
    return [];
  }
}

export async function getCachedConversationById(
  ownerUserId: string,
  conversationId: string
): Promise<Conversation | null> {
  if (!ownerUserId || !conversationId) return null;
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('conversations', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('conversations').get(`${ownerUserId}:${conversationId}`)
    )) as StoredConversationRecord | undefined;
    return rec?.data || null;
  } catch {
    return null;
  }
}

export async function deleteCachedConversation(
  ownerUserId: string,
  conversationId: string
): Promise<void> {
  if (!ownerUserId || !conversationId) return;
  const db = await openCacheDb();
  if (!db) return;
  try {
    const tx = db.transaction(['conversations', 'messages', 'preferences'], 'readwrite');
    tx.objectStore('conversations').delete(`${ownerUserId}:${conversationId}`);
    tx.objectStore('preferences').delete(`thread_meta:${ownerUserId}:${conversationId}`);
    const msgStore = tx.objectStore('messages');
    const index = msgStore.index('byOwnerConvCreated');
    const range = IDBKeyRange.bound(
      [ownerUserId, conversationId, ''],
      [ownerUserId, conversationId, '\uffff']
    );
    const keys = await requestToPromise(index.getAllKeys(range));
    for (const k of keys) {
      msgStore.delete(k);
    }
    await txDone(tx);
  } catch {
    // Ignore deletion errors
  }
}

export async function saveCachedThreadMeta(
  ownerUserId: string,
  conversationId: string,
  meta: CachedThreadMeta
): Promise<void> {
  if (!ownerUserId || !conversationId) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('preferences', 'readwrite');
    tx.objectStore('preferences').put({
      key: `thread_meta:${ownerUserId}:${conversationId}`,
      value: meta,
      updatedAt: Date.now(),
    });
    await txDone(tx);
  });
}

export async function getCachedThreadMeta(
  ownerUserId: string,
  conversationId: string
): Promise<CachedThreadMeta | null> {
  if (!ownerUserId || !conversationId) return null;
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('preferences', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('preferences').get(`thread_meta:${ownerUserId}:${conversationId}`)
    )) as StoredPreferenceRecord | undefined;
    if (!rec?.value || Date.now() - rec.updatedAt > MESSAGE_RETENTION_MS) {
      return null;
    }
    return rec.value as CachedThreadMeta;
  } catch {
    return null;
  }
}

/* ---------------- Messages Store ---------------- */

export async function saveCachedMessages(
  ownerUserId: string,
  messages: Message[]
): Promise<void> {
  if (!ownerUserId || messages.length === 0) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const byClientIndex = store.index('byOwnerClientId');
    const now = Date.now();

    for (const raw of messages) {
      if (!raw?.id || !raw.conversationId) continue;
      // Never persist transient sending/failed bubbles in the confirmed messages store
      if (raw.deliveryStatus === 'sending' || raw.deliveryStatus === 'failed') continue;

      if (raw.clientMessageId) {
        const dupes = (await requestToPromise(
          byClientIndex.getAll([ownerUserId, raw.clientMessageId])
        )) as StoredMessageRecord[];
        for (const d of dupes) {
          if (d.id !== raw.id) {
            store.delete(d.cacheKey);
          }
        }
      }

      const cacheKey = `${ownerUserId}:${raw.id}`;
      const existing = (await requestToPromise(store.get(cacheKey))) as
        | StoredMessageRecord
        | undefined;

      const merged = mergeMessageRecords(existing?.data, raw);
      store.put({
        cacheKey,
        ownerUserId,
        id: merged.id,
        clientMessageId: merged.clientMessageId || '',
        conversationId: merged.conversationId,
        createdAt: merged.createdAt,
        cachedAt: now,
        data: merged,
      } satisfies StoredMessageRecord);
    }
    await txDone(tx);
  });
}

export async function getCachedMessages(
  ownerUserId: string,
  conversationId: string,
  limit = 20
): Promise<Message[]> {
  if (!ownerUserId || !conversationId) return [];
  const db = await openCacheDb();
  if (!db) return [];
  try {
    const now = Date.now();
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('byOwnerConvCreated');
    const range = IDBKeyRange.bound(
      [ownerUserId, conversationId, ''],
      [ownerUserId, conversationId, '\uffff']
    );
    const records = (await requestToPromise(index.getAll(range))) as StoredMessageRecord[];
    const sorted = records
      .filter((r) => now - (r.cachedAt || now) <= MESSAGE_RETENTION_MS)
      .map((r) => r.data)
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
    if (sorted.length > limit) {
      return sorted.slice(sorted.length - limit);
    }
    return sorted;
  } catch {
    return [];
  }
}

export async function getOlderCachedMessages(
  ownerUserId: string,
  conversationId: string,
  beforeCreatedAt: string,
  beforeId: string,
  limit = 20
): Promise<{ messages: Message[]; hasMore: boolean }> {
  if (!ownerUserId || !conversationId || !beforeCreatedAt) {
    return { messages: [], hasMore: false };
  }
  const db = await openCacheDb();
  if (!db) return { messages: [], hasMore: false };
  try {
    const now = Date.now();
    const cutoffMs = new Date(beforeCreatedAt).getTime();
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('byOwnerConvCreated');
    const range = IDBKeyRange.bound(
      [ownerUserId, conversationId, ''],
      [ownerUserId, conversationId, beforeCreatedAt]
    );
    const records = (await requestToPromise(index.getAll(range))) as StoredMessageRecord[];
    const older = records
      .filter((r) => now - (r.cachedAt || now) <= MESSAGE_RETENTION_MS)
      .map((r) => r.data)
      .filter((m) => {
        const ms = new Date(m.createdAt).getTime();
        if (ms < cutoffMs) return true;
        if (ms === cutoffMs) return m.id.localeCompare(beforeId) < 0;
        return false;
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });

    const hasMore = older.length > limit;
    const slice = hasMore ? older.slice(older.length - limit) : older;
    return { messages: slice, hasMore };
  } catch {
    return { messages: [], hasMore: false };
  }
}

export async function removeCachedMessage(
  ownerUserId: string,
  messageId: string
): Promise<void> {
  if (!ownerUserId || !messageId) return;
  const db = await openCacheDb();
  if (!db) return;
  try {
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').delete(`${ownerUserId}:${messageId}`);
    await txDone(tx);
  } catch {
    // Ignore
  }
}

export async function patchCachedMessageStatus(
  ownerUserId: string,
  messageIds: string[],
  updater: (msg: Message) => Message
): Promise<void> {
  if (!ownerUserId || messageIds.length === 0) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const now = Date.now();
    for (const id of messageIds) {
      const cacheKey = `${ownerUserId}:${id}`;
      const existing = (await requestToPromise(store.get(cacheKey))) as
        | StoredMessageRecord
        | undefined;
      if (!existing) continue;
      const next = sanitizeMessageForStorage(updater(existing.data));
      store.put({
        ...existing,
        cachedAt: now,
        data: next,
      });
    }
    await txDone(tx);
  });
}

/* ---------------- Pending Outgoing Offline Queue Store ---------------- */

export async function savePendingOutgoingMessage(
  record: PendingOutgoingRecord
): Promise<void> {
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('pendingMessages', 'readwrite');
    // Strip transient blob URL strings in message attachments copy if stagedItems carries actual Blob,
    // so URL reconstruction happens safely on hydration
    const cleanMessage: Message = {
      ...record.message,
      deliveryStatus: 'sending',
      localQueued: true,
      localError: null,
      retryPayload: null,
    };
    tx.objectStore('pendingMessages').put({
      ...record,
      message: cleanMessage,
    });
    await txDone(tx);
  });
}

export async function getPendingOutgoingMessages(
  ownerUserId: string,
  conversationId?: string
): Promise<PendingOutgoingRecord[]> {
  if (!ownerUserId) return [];
  const db = await openCacheDb();
  if (!db) return [];
  try {
    const tx = db.transaction('pendingMessages', 'readonly');
    const store = tx.objectStore('pendingMessages');
    let records: PendingOutgoingRecord[];
    if (conversationId) {
      records = (await requestToPromise(
        store.index('byOwnerConv').getAll([ownerUserId, conversationId])
      )) as PendingOutgoingRecord[];
    } else {
      records = (await requestToPromise(
        store.index('byOwner').getAll(ownerUserId)
      )) as PendingOutgoingRecord[];
    }
    return records.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

export async function removePendingOutgoingMessage(
  clientMessageId: string
): Promise<void> {
  if (!clientMessageId) return;
  const db = await openCacheDb();
  if (!db) return;
  try {
    const tx = db.transaction('pendingMessages', 'readwrite');
    tx.objectStore('pendingMessages').delete(clientMessageId);
    await txDone(tx);
  } catch {
    // Ignore
  }
}

/* ---------------- Profiles Store ---------------- */

export async function saveCachedProfile(
  ownerUserId: string,
  profile: User
): Promise<void> {
  if (!ownerUserId || !profile?.id) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('profiles', 'readwrite');
    const now = Date.now();
    tx.objectStore('profiles').put({
      cacheKey: `${ownerUserId}:${profile.username.toLowerCase()}`,
      ownerUserId,
      userId: profile.id,
      username: profile.username.toLowerCase(),
      expiresAt: now + PROFILE_TTL_MS,
      cachedAt: now,
      data: profile,
    } satisfies StoredProfileRecord);
    await txDone(tx);
  });
}

export async function getCachedProfileByUsername(
  ownerUserId: string,
  username: string
): Promise<User | null> {
  if (!ownerUserId || !username) return null;
  const clean = username.trim().toLowerCase().replace(/^@/, '');
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('profiles', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('profiles').get(`${ownerUserId}:${clean}`)
    )) as StoredProfileRecord | undefined;
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) return null;
    return rec.data;
  } catch {
    return null;
  }
}

/* ---------------- Communities Store ---------------- */

export async function saveCachedCommunitiesList(
  ownerUserId: string,
  tab: 'joined' | 'discover',
  list: CommunitySummary[]
): Promise<void> {
  if (!ownerUserId) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('communities', 'readwrite');
    const store = tx.objectStore('communities');
    const now = Date.now();
    // Clear older summary items for this tab prefix if needed and write fresh list items
    store.put({
      cacheKey: `${ownerUserId}:list:${tab}`,
      ownerUserId,
      id: `list:${tab}`,
      kind: 'summary',
      updatedAt: now,
      data: list as unknown as CommunitySummary,
    } satisfies StoredCommunityRecord);
    for (const c of list) {
      store.put({
        cacheKey: `${ownerUserId}:summary:${c.id}`,
        ownerUserId,
        id: c.id,
        kind: 'summary',
        updatedAt: now,
        data: c,
      } satisfies StoredCommunityRecord);
    }
    await txDone(tx);
  });
}

export async function getCachedCommunitiesList(
  ownerUserId: string,
  tab: 'joined' | 'discover'
): Promise<CommunitySummary[]> {
  if (!ownerUserId) return [];
  const db = await openCacheDb();
  if (!db) return [];
  try {
    const tx = db.transaction('communities', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('communities').get(`${ownerUserId}:list:${tab}`)
    )) as StoredCommunityRecord | undefined;
    if (!rec) return [];
    return Array.isArray(rec.data) ? (rec.data as unknown as CommunitySummary[]) : [];
  } catch {
    return [];
  }
}

export async function saveCachedCommunityDetail(
  ownerUserId: string,
  detail: CommunityDetail
): Promise<void> {
  if (!ownerUserId || !detail?.id) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('communities', 'readwrite');
    tx.objectStore('communities').put({
      cacheKey: `${ownerUserId}:detail:${detail.id}`,
      ownerUserId,
      id: detail.id,
      kind: 'detail',
      updatedAt: Date.now(),
      data: detail,
    } satisfies StoredCommunityRecord);
    await txDone(tx);
  });
}

export async function getCachedCommunityDetail(
  ownerUserId: string,
  communityId: string
): Promise<CommunityDetail | null> {
  if (!ownerUserId || !communityId) return null;
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('communities', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('communities').get(`${ownerUserId}:detail:${communityId}`)
    )) as StoredCommunityRecord | undefined;
    return (rec?.data as CommunityDetail) || null;
  } catch {
    return null;
  }
}

export async function saveCachedCommunityMembers(
  ownerUserId: string,
  communityId: string,
  res: CommunityMembersResponse
): Promise<void> {
  if (!ownerUserId || !communityId) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('communities', 'readwrite');
    tx.objectStore('communities').put({
      cacheKey: `${ownerUserId}:members:${communityId}`,
      ownerUserId,
      id: communityId,
      kind: 'members',
      updatedAt: Date.now(),
      data: res,
    } satisfies StoredCommunityRecord);
    await txDone(tx);
  });
}

export async function getCachedCommunityMembers(
  ownerUserId: string,
  communityId: string
): Promise<CommunityMembersResponse | null> {
  if (!ownerUserId || !communityId) return null;
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const tx = db.transaction('communities', 'readonly');
    const rec = (await requestToPromise(
      tx.objectStore('communities').get(`${ownerUserId}:members:${communityId}`)
    )) as StoredCommunityRecord | undefined;
    return (rec?.data as CommunityMembersResponse) || null;
  } catch {
    return null;
  }
}

/* ---------------- Call History Store ---------------- */

export async function saveCachedCallHistory(
  ownerUserId: string,
  calls: CallHistoryItem[]
): Promise<void> {
  if (!ownerUserId) return;
  await runWithQuotaRetry(async (db) => {
    const tx = db.transaction('callHistory', 'readwrite');
    const store = tx.objectStore('callHistory');
    const now = Date.now();
    for (const item of calls) {
      store.put({
        cacheKey: `${ownerUserId}:${item.id}`,
        ownerUserId,
        id: item.id,
        createdAt: item.createdAt,
        cachedAt: now,
        data: item,
      } satisfies StoredCallHistoryRecord);
    }
    await txDone(tx);
  });
}

export async function getCachedCallHistory(
  ownerUserId: string,
  filter: 'all' | 'missed' = 'all'
): Promise<CallHistoryItem[]> {
  if (!ownerUserId) return [];
  const db = await openCacheDb();
  if (!db) return [];
  try {
    const tx = db.transaction('callHistory', 'readonly');
    const records = (await requestToPromise(
      tx.objectStore('callHistory').index('byOwner').getAll(ownerUserId)
    )) as StoredCallHistoryRecord[];
    let items = records.map((r) => r.data);
    if (filter === 'missed') {
      items = items.filter((c) => c.direction === 'missed' || c.status === 'missed');
    }
    return items.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

export async function removeCachedCallEntry(
  ownerUserId: string,
  callId: string
): Promise<void> {
  if (!ownerUserId || !callId) return;
  const db = await openCacheDb();
  if (!db) return;
  try {
    const tx = db.transaction('callHistory', 'readwrite');
    tx.objectStore('callHistory').delete(`${ownerUserId}:${callId}`);
    await txDone(tx);
  } catch {
    // Ignore
  }
}

/* ---------------- Retention, Quota Pruning & Account Cleanup ---------------- */

export async function pruneOldCacheData(aggressive = false): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    const now = Date.now();
    const msgCutoff = now - (aggressive ? 7 * 24 * 60 * 60 * 1000 : MESSAGE_RETENTION_MS);
    const maxPerConv = aggressive ? 80 : MAX_MESSAGES_PER_CONVERSATION;
    const maxTotal = aggressive ? 800 : MAX_TOTAL_MESSAGES;

    const tx = db.transaction(['messages', 'profiles', 'preferences'], 'readwrite');
    const msgStore = tx.objectStore('messages');
    const profileStore = tx.objectStore('profiles');
    const prefStore = tx.objectStore('preferences');

    const allMsgs = (await requestToPromise(msgStore.getAll())) as StoredMessageRecord[];
    const byConv = new Map<string, StoredMessageRecord[]>();

    for (const rec of allMsgs) {
      const createdMs = new Date(rec.createdAt).getTime();
      if (now - (rec.cachedAt || createdMs) > MESSAGE_RETENTION_MS || createdMs < msgCutoff) {
        msgStore.delete(rec.cacheKey);
        continue;
      }
      const key = `${rec.ownerUserId}:${rec.conversationId}`;
      const list = byConv.get(key) || [];
      list.push(rec);
      byConv.set(key, list);
    }

    const surviving: StoredMessageRecord[] = [];
    for (const [, list] of byConv) {
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      list.forEach((rec, idx) => {
        if (idx >= maxPerConv) {
          msgStore.delete(rec.cacheKey);
        } else {
          surviving.push(rec);
        }
      });
    }

    if (surviving.length > maxTotal) {
      surviving.sort((a, b) => a.cachedAt - b.cachedAt);
      const excess = surviving.length - maxTotal;
      for (let i = 0; i < excess; i++) {
        msgStore.delete(surviving[i].cacheKey);
      }
    }

    const allProfiles = (await requestToPromise(
      profileStore.getAll()
    )) as StoredProfileRecord[];
    for (const p of allProfiles) {
      if (p.expiresAt < now) {
        profileStore.delete(p.cacheKey);
      }
    }

    const allPrefs = (await requestToPromise(
      prefStore.getAll()
    )) as StoredPreferenceRecord[];
    for (const pref of allPrefs) {
      if (
        pref.key.startsWith('thread_meta:') &&
        now - (pref.updatedAt || 0) > MESSAGE_RETENTION_MS
      ) {
        prefStore.delete(pref.key);
      }
    }

    await txDone(tx);
  } catch {
    // Ignore background prune errors
  }
}

export async function clearAllUserIndexedDbData(preservePending = false): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;
  try {
    const storeNames = [
      'conversations',
      'messages',
      'profiles',
      'communities',
      'callHistory',
      'preferences',
      ...(preservePending ? [] : ['pendingMessages']),
    ];
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    await txDone(tx);
  } catch {
    // Ignore clear errors
  }
}

export async function getIndexedDbCounts(ownerUserId?: string): Promise<{
  conversations: number;
  messages: number;
  pendingMessages: number;
  profiles: number;
  communities: number;
  callHistory: number;
}> {
  const empty = {
    conversations: 0,
    messages: 0,
    pendingMessages: 0,
    profiles: 0,
    communities: 0,
    callHistory: 0,
  };
  const db = await openCacheDb();
  if (!db) return empty;
  try {
    const tx = db.transaction(
      [
        'conversations',
        'messages',
        'pendingMessages',
        'profiles',
        'communities',
        'callHistory',
      ],
      'readonly'
    );
    const countFor = async (storeName: string) => {
      const store = tx.objectStore(storeName);
      if (ownerUserId) {
        return requestToPromise(store.index('byOwner').count(ownerUserId));
      }
      return requestToPromise(store.count());
    };

    const [conversations, messages, pendingMessages, profiles, communities, callHistory] =
      await Promise.all([
        countFor('conversations'),
        countFor('messages'),
        countFor('pendingMessages'),
        countFor('profiles'),
        countFor('communities'),
        countFor('callHistory'),
      ]);

    return {
      conversations,
      messages,
      pendingMessages,
      profiles,
      communities,
      callHistory,
    };
  } catch {
    return empty;
  }
}
