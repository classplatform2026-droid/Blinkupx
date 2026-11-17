import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type {
  CallHistoryItem,
  CommunityDetail,
  CommunityMembersResponse,
  CommunitySummary,
  Conversation,
  Message,
  MessageLinkPreview,
  User,
} from '../types';
import {
  clearAllUserIndexedDbData,
  deleteCachedConversation,
  patchCachedMessageStatus,
  removeCachedCallEntry,
  removeCachedMessage,
  saveCachedConversation,
  saveCachedMessages,
} from './indexedDb';
import { reconcileIncomingMessage } from './optimisticMessages';

function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status && status >= 400 && status < 500) return false;
    if (!error.response) return failureCount < 1;
  }
  return failureCount < 2;
}

export const CACHE_TIMES = {
  conversations: { staleTime: 30_000, gcTime: 30 * 60_000 },
  conversationDetail: { staleTime: 30_000, gcTime: 30 * 60_000 },
  messages: { staleTime: 60_000, gcTime: 30 * 60_000 },
  communities: { staleTime: 120_000, gcTime: 30 * 60_000 },
  communityDetail: { staleTime: 120_000, gcTime: 30 * 60_000 },
  communityMembers: { staleTime: 90_000, gcTime: 20 * 60_000 },
  callHistory: { staleTime: 120_000, gcTime: 30 * 60_000 },
  profile: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  settings: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      retry: shouldRetryRequest,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 30_000,
      gcTime: 30 * 60_000,
    },
    mutations: {
      networkMode: 'online',
      retry: false,
    },
  },
});

export const queryKeys = {
  conversations: (
    userId: string,
    filter: 'all' | 'unread' | 'groups' | 'archived' = 'all'
  ) => ['conversations', userId, filter] as const,
  conversationsPrefix: (userId: string) => ['conversations', userId] as const,
  conversation: (userId: string, conversationId: string) =>
    ['conversation', userId, conversationId] as const,
  messages: (userId: string, conversationId: string) =>
    ['messages', userId, conversationId] as const,
  communities: (userId: string, tab: 'joined' | 'discover', q = '') =>
    ['communities', userId, tab, q] as const,
  communitiesPrefix: (userId: string) => ['communities', userId] as const,
  community: (userId: string, communityId: string) =>
    ['community', userId, communityId] as const,
  communityMembers: (
    userId: string,
    communityId: string,
    role = 'all',
    q = ''
  ) => ['communityMembers', userId, communityId, role, q] as const,
  communityMembersPrefix: (userId: string, communityId: string) =>
    ['communityMembers', userId, communityId] as const,
  callHistory: (userId: string, filter: 'all' | 'missed', q = '') =>
    ['callHistory', userId, filter, q] as const,
  callHistoryPrefix: (userId: string) => ['callHistory', userId] as const,
  publicProfile: (viewerId: string, username: string) =>
    ['publicProfile', viewerId, username.trim().toLowerCase().replace(/^@/, '')] as const,
  blockedUsers: (userId: string) => ['blockedUsers', userId] as const,
};

export interface ThreadMessagesCacheData {
  messages: Message[];
  hasMore: boolean;
  nextCursor: string | null;
  hasNewer?: boolean;
  fetchedAt: number;
}

export function syncIncomingMessageCaches(userId: string, msg: Message): void {
  if (!userId || !msg?.id || !msg.conversationId) return;

  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, msg.conversationId),
    (prev) => {
      if (!prev || prev.hasNewer) return prev;
      return {
        ...prev,
        messages: reconcileIncomingMessage(prev.messages, msg),
        fetchedAt: Date.now(),
      };
    }
  );

  // Optimistically update conversation list preview and bump to top
  const filters: Array<'all' | 'unread' | 'groups' | 'archived'> = [
    'all',
    'unread',
    'groups',
    'archived',
  ];
  for (const filter of filters) {
    queryClient.setQueryData<Conversation[]>(
      queryKeys.conversations(userId, filter),
      (list) => {
        if (!list) return list;
        const idx = list.findIndex((c) => c.id === msg.conversationId);
        if (idx < 0) return list;
        const target = list[idx];
        const previewText =
          msg.content ||
          (msg.messageType === 'voice'
            ? 'Voice message'
            : msg.messageType === 'image'
              ? 'Photo'
              : msg.messageType === 'video'
                ? 'Video'
                : msg.messageType === 'document'
                  ? 'Document'
                  : '');
        const updatedConv: Conversation = {
          ...target,
          lastMessage: {
            messageId: msg.id,
            senderId: msg.senderId,
            content: previewText,
            messageType: msg.messageType,
            createdAt: msg.createdAt,
          },
          updatedAt: msg.createdAt,
        };
        const next = [...list];
        next[idx] = updatedConv;
        next.sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        void saveCachedConversation(userId, updatedConv);
        return next;
      }
    );
  }

  void saveCachedMessages(userId, [msg]);
}

export function syncMessageEditCaches(userId: string, updated: Message): void {
  if (!userId || !updated?.id) return;
  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, updated.conversationId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) => (m.id === updated.id ? updated : m)),
      };
    }
  );
  void saveCachedMessages(userId, [updated]);
}

export function syncMessageLinksCaches(
  userId: string,
  payload: { id: string; conversationId: string; links: MessageLinkPreview[] }
): void {
  if (!userId || !payload.id) return;
  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, payload.conversationId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === payload.id ? { ...m, links: payload.links } : m
        ),
      };
    }
  );
  void patchCachedMessageStatus(userId, [payload.id], (m) => ({
    ...m,
    links: payload.links,
  }));
}

export function syncMessageDeleteCaches(
  userId: string,
  payload: { id: string; conversationId: string; deletedAt?: string; scope?: 'everyone' | 'me' }
): void {
  if (!userId || !payload.id) return;
  if (payload.scope === 'me') {
    queryClient.setQueryData<ThreadMessagesCacheData>(
      queryKeys.messages(userId, payload.conversationId),
      (prev) =>
        prev
          ? { ...prev, messages: prev.messages.filter((m) => m.id !== payload.id) }
          : prev
    );
    void removeCachedMessage(userId, payload.id);
    return;
  }

  const deletedAt = payload.deletedAt || new Date().toISOString();
  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, payload.conversationId),
    (prev) =>
      prev
        ? {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === payload.id
                ? {
                    ...m,
                    deletedAt,
                    content: 'This message was deleted',
                    attachments: [],
                    reactions: [],
                  }
                : m
            ),
          }
        : prev
  );
  void patchCachedMessageStatus(userId, [payload.id], (m) => ({
    ...m,
    deletedAt,
    content: 'This message was deleted',
    attachments: [],
    reactions: [],
  }));
}

export function syncMessageDeliveredCaches(
  userId: string,
  payload: { conversationId: string; messageIds: string[]; userId?: string }
): void {
  if (!userId || payload.messageIds.length === 0) return;
  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, payload.conversationId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) => {
          if (!payload.messageIds.includes(m.id)) return m;
          const nextDeliveredTo =
            payload.userId && !m.deliveredTo.includes(payload.userId)
              ? [...m.deliveredTo, payload.userId]
              : m.deliveredTo;
          return {
            ...m,
            deliveredTo: nextDeliveredTo,
            deliveryStatus: m.deliveryStatus === 'sent' ? 'delivered' : m.deliveryStatus,
          };
        }),
      };
    }
  );
  void patchCachedMessageStatus(userId, payload.messageIds, (m) => ({
    ...m,
    deliveredTo:
      payload.userId && !m.deliveredTo.includes(payload.userId)
        ? [...m.deliveredTo, payload.userId]
        : m.deliveredTo,
    deliveryStatus: m.deliveryStatus === 'sent' ? 'delivered' : m.deliveryStatus,
  }));
}

export function syncMessageReadCaches(
  userId: string,
  payload: { conversationId: string; messageIds: string[]; userId: string }
): void {
  if (!userId || payload.messageIds.length === 0) return;
  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, payload.conversationId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          payload.messageIds.includes(m.id)
            ? {
                ...m,
                deliveryStatus: 'read',
                deliveredTo: m.deliveredTo.includes(payload.userId)
                  ? m.deliveredTo
                  : [...m.deliveredTo, payload.userId],
                readBy: m.readBy.includes(payload.userId)
                  ? m.readBy
                  : [...m.readBy, payload.userId],
              }
            : m
        ),
      };
    }
  );
  void patchCachedMessageStatus(userId, payload.messageIds, (m) => ({
    ...m,
    deliveryStatus: 'read',
    deliveredTo: m.deliveredTo.includes(payload.userId)
      ? m.deliveredTo
      : [...m.deliveredTo, payload.userId],
    readBy: m.readBy.includes(payload.userId)
      ? m.readBy
      : [...m.readBy, payload.userId],
  }));
}

export function syncReactionCaches(
  userId: string,
  payload: {
    messageId: string;
    conversationId: string;
    reactions: Array<{ emoji: string; userIds: string[] }>;
  }
): void {
  if (!userId || !payload.messageId) return;
  queryClient.setQueryData<ThreadMessagesCacheData>(
    queryKeys.messages(userId, payload.conversationId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
        ),
      };
    }
  );
  void patchCachedMessageStatus(userId, [payload.messageId], (m) => ({
    ...m,
    reactions: payload.reactions,
  }));
}

export function invalidateConversationQueries(userId: string, conversationId?: string): void {
  if (!userId) return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsPrefix(userId) });
  if (conversationId) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.conversation(userId, conversationId),
    });
  }
}

export function removeConversationFromCaches(userId: string, conversationId: string): void {
  if (!userId || !conversationId) return;
  queryClient.removeQueries({ queryKey: queryKeys.conversation(userId, conversationId) });
  queryClient.removeQueries({ queryKey: queryKeys.messages(userId, conversationId) });
  const filters: Array<'all' | 'unread' | 'groups' | 'archived'> = [
    'all',
    'unread',
    'groups',
    'archived',
  ];
  for (const f of filters) {
    queryClient.setQueryData<Conversation[]>(
      queryKeys.conversations(userId, f),
      (prev) => prev?.filter((c) => c.id !== conversationId)
    );
  }
  void deleteCachedConversation(userId, conversationId);
}

export function removeCallFromCaches(userId: string, callId: string): void {
  if (!userId || !callId) return;
  queryClient.setQueriesData<CallHistoryItem[]>(
    { queryKey: queryKeys.callHistoryPrefix(userId) },
    (prev) => prev?.filter((c) => c.id !== callId)
  );
  void removeCachedCallEntry(userId, callId);
}

export function resetAllQueryAndDbCaches(): Promise<void> {
  queryClient.clear();
  return clearAllUserIndexedDbData(false);
}

export type {
  CommunityDetail,
  CommunityMembersResponse,
  CommunitySummary,
  User,
};
