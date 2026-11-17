import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { getStoredAuthToken } from '../services/api';
import type { Message, MessageLinkPreview, NotificationSoundTone } from '../types';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  playNotificationTone,
  showBrowserNotification,
  triggerNotificationVibration,
} from '../utils/notifications';
import { flushOfflineOutgoingQueue } from '../utils/offlineQueue';
import {
  getActiveBrowserPushSubscription,
  syncBrowserPushSubscriptionIfPermitted,
} from '../utils/pushNotifications';
import {
  invalidateConversationQueries,
  queryClient,
  queryKeys,
  syncIncomingMessageCaches,
  syncMessageDeleteCaches,
  syncMessageDeliveredCaches,
  syncMessageEditCaches,
  syncMessageLinksCaches,
  syncMessageReadCaches,
  syncReactionCaches,
} from '../utils/queryClient';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

export interface PresenceEntry {
  onlineStatus: boolean;
  lastSeen: string | null;
  lastSeenHidden?: boolean;
  onlineHidden?: boolean;
}

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  presenceMap: Record<string, PresenceEntry>;
  typingMap: Record<string, Array<{ userId: string; username: string }>>;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  presenceMap: {},
  typingMap: {},
});

function parseFocusedRoute(pathname: string): {
  conversationId: string | null;
  communityId: string | null;
} {
  const chatMatch = pathname.match(/^\/chats\/([^/]+)$/);
  if (chatMatch && chatMatch[1] !== 'new' && chatMatch[1] !== 'search') {
    return { conversationId: chatMatch[1], communityId: null };
  }

  const communityMatch = pathname.match(/^\/community\/([^/]+)$/);
  if (communityMatch && communityMatch[1] !== 'create') {
    return { conversationId: null, communityId: communityMatch[1] };
  }

  return { conversationId: null, communityId: null };
}

function getIsPageVisible(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceEntry>>({});
  const [typingMap, setTypingMap] = useState<
    Record<string, Array<{ userId: string; username: string }>>
  >({});
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ackedDeliveredIdsRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  const pathnameRef = useRef(location.pathname);
  const hasActivePushRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  const emitFocusState = useCallback((targetSocket: Socket | null) => {
    if (!targetSocket?.connected) return;
    const { conversationId, communityId } = parseFocusedRoute(pathnameRef.current);
    targetSocket.emit('conversation:focus', {
      conversationId,
      communityId,
      pageVisible: getIsPageVisible(),
    });
  }, []);

  const pushEnabledPref = user?.settings?.notifications?.pushEnabled ?? true;

  useEffect(() => {
    if (!user?.id) {
      hasActivePushRef.current = false;
      return;
    }

    let cancelled = false;

    const refreshPushState = async () => {
      await syncBrowserPushSubscriptionIfPermitted(pushEnabledPref);
      const activeSub = await getActiveBrowserPushSubscription();
      if (!cancelled) {
        hasActivePushRef.current = Boolean(activeSub && pushEnabledPref);
      }
    };

    refreshPushState();

    const handlePushChanged = () => {
      getActiveBrowserPushSubscription().then((sub) => {
        if (!cancelled) {
          const enabledNow =
            userRef.current?.settings?.notifications?.pushEnabled ?? true;
          hasActivePushRef.current = Boolean(sub && enabledNow);
        }
      });
    };

    window.addEventListener('blinkupz:push-subscription-changed', handlePushChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('blinkupz:push-subscription-changed', handlePushChanged);
    };
  }, [user?.id, pushEnabledPref]);

  // Handle Service Worker notification click navigation inside SPA
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === 'BLINKUPZ_NAVIGATE' && typeof data.url === 'string' && data.url.startsWith('/')) {
        navigate(data.url);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [navigate]);

  // Flush offline outgoing queue whenever browser goes online
  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return;
    const onOnline = () => {
      void flushOfflineOutgoingQueue(socketRef.current, user.id);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.id]);

  // Emit conversation focus whenever route or tab visibility/focus changes
  useEffect(() => {
    emitFocusState(socketRef.current);

    const handleFocusChange = () => {
      emitFocusState(socketRef.current);
    };

    window.addEventListener('focus', handleFocusChange);
    window.addEventListener('blur', handleFocusChange);
    document.addEventListener('visibilitychange', handleFocusChange);
    return () => {
      window.removeEventListener('focus', handleFocusChange);
      window.removeEventListener('blur', handleFocusChange);
      document.removeEventListener('visibilitychange', handleFocusChange);
    };
  }, [location.pathname, connected, emitFocusState]);

  useEffect(() => {
    if (!user) {
      socketRef.current = null;
      setSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      setConnected(false);
      setPresenceMap({});
      ackedDeliveredIdsRef.current.clear();
      return;
    }

    const currentUserId = user.id;
    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    const token = getStoredAuthToken();
    const s = io(socketUrl, {
      withCredentials: true,
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
    });
    socketRef.current = s;

    const acknowledgeDelivered = (
      msg?: Pick<Message, 'id' | 'conversationId' | 'senderId' | 'messageType'>
    ) => {
      if (!msg?.id || !msg.conversationId || msg.senderId === currentUserId) return;
      if (msg.messageType === 'system' || msg.messageType === 'call_event') return;
      if (ackedDeliveredIdsRef.current.has(msg.id)) return;
      ackedDeliveredIdsRef.current.add(msg.id);
      if (ackedDeliveredIdsRef.current.size > 250) {
        const first = ackedDeliveredIdsRef.current.values().next().value;
        if (first) ackedDeliveredIdsRef.current.delete(first);
      }
      s.emit('message:delivered', {
        conversationId: msg.conversationId,
        messageIds: [msg.id],
      });
    };

    s.on('connect', () => {
      setConnected(true);
      s.emit('message:sync_delivered');
      emitFocusState(s);
      void flushOfflineOutgoingQueue(s, currentUserId);
    });

    s.on('message:new', (msg: Message) => {
      acknowledgeDelivered(msg);
      syncIncomingMessageCaches(currentUserId, msg);
      invalidateConversationQueries(currentUserId);
    });

    s.on('message:edit', (updated: Message) => {
      syncMessageEditCaches(currentUserId, updated);
      invalidateConversationQueries(currentUserId);
    });

    s.on(
      'message:links',
      (payload: { id: string; conversationId: string; links: MessageLinkPreview[] }) => {
        syncMessageLinksCaches(currentUserId, payload);
      }
    );

    s.on(
      'message:delete',
      (payload: { id: string; conversationId: string; deletedAt: string }) => {
        syncMessageDeleteCaches(currentUserId, payload);
        invalidateConversationQueries(currentUserId);
      }
    );

    s.on(
      'message:delivered',
      (payload: { conversationId: string; messageIds: string[]; userId?: string }) => {
        syncMessageDeliveredCaches(currentUserId, payload);
      }
    );

    s.on(
      'message:read',
      (payload: { conversationId: string; messageIds: string[]; userId: string }) => {
        syncMessageReadCaches(currentUserId, payload);
        invalidateConversationQueries(currentUserId);
      }
    );

    const onReaction = (payload: {
      messageId: string;
      conversationId: string;
      reactions: Array<{ emoji: string; userIds: string[] }>;
    }) => {
      syncReactionCaches(currentUserId, payload);
    };
    s.on('reaction:add', onReaction);
    s.on('reaction:remove', onReaction);

    s.on(
      'conversation:activity',
      (payload: { conversationId?: string; message?: Message }) => {
        if (payload?.message) {
          acknowledgeDelivered(payload.message);
          syncIncomingMessageCaches(currentUserId, payload.message);
        }
        invalidateConversationQueries(currentUserId, payload?.conversationId);
      }
    );

    s.on('conversation:new', () => {
      invalidateConversationQueries(currentUserId);
    });

    s.on('conversation:updated', (payload: { conversationId?: string }) => {
      invalidateConversationQueries(currentUserId, payload?.conversationId);
    });

    const onCommunityEvent = (payload?: { communityId?: string }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.communitiesPrefix(currentUserId),
      });
      if (payload?.communityId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.community(currentUserId, payload.communityId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.communityMembersPrefix(currentUserId, payload.communityId),
        });
      }
    };
    s.on('community:updated', onCommunityEvent);
    s.on('community:join_request', onCommunityEvent);
    s.on('community:request_resolved', onCommunityEvent);
    s.on('community:invited', onCommunityEvent);
    s.on('community:removed', onCommunityEvent);
    s.on('community:deleted', onCommunityEvent);

    s.on('disconnect', () => {
      setConnected(false);
    });

    s.on(
      'user:status',
      (payload: {
        userId: string;
        onlineStatus: boolean;
        lastSeen: string | null;
        lastSeenHidden?: boolean;
        onlineHidden?: boolean;
      }) => {
        setPresenceMap((prev) => ({
          ...prev,
          [payload.userId]: {
            onlineStatus: payload.onlineStatus,
            lastSeen: payload.lastSeen,
            lastSeenHidden: payload.lastSeenHidden,
            onlineHidden: payload.onlineHidden,
          },
        }));
      }
    );

    s.on(
      'typing:start',
      (payload: { conversationId: string; userId: string; username: string }) => {
        if (payload.userId === currentUserId) return;
        const key = `${payload.conversationId}:${payload.userId}`;
        if (typingTimeoutsRef.current[key]) {
          clearTimeout(typingTimeoutsRef.current[key]);
        }
        setTypingMap((prev) => {
          const list = prev[payload.conversationId] || [];
          if (list.some((item) => item.userId === payload.userId)) return prev;
          return {
            ...prev,
            [payload.conversationId]: [
              ...list,
              { userId: payload.userId, username: payload.username },
            ],
          };
        });
        typingTimeoutsRef.current[key] = setTimeout(() => {
          setTypingMap((prev) => ({
            ...prev,
            [payload.conversationId]: (prev[payload.conversationId] || []).filter(
              (item) => item.userId !== payload.userId
            ),
          }));
        }, 4000);
      }
    );

    s.on('typing:stop', (payload: { conversationId: string; userId: string }) => {
      const key = `${payload.conversationId}:${payload.userId}`;
      if (typingTimeoutsRef.current[key]) {
        clearTimeout(typingTimeoutsRef.current[key]);
      }
      setTypingMap((prev) => ({
        ...prev,
        [payload.conversationId]: (prev[payload.conversationId] || []).filter(
          (item) => item.userId !== payload.userId
        ),
      }));
    });

    s.on(
      'notification:message',
      (payload: {
        id: string;
        conversationId: string;
        conversationType: 'direct' | 'group' | 'community';
        communityId?: string | null;
        title: string;
        body: string;
        previewHidden?: boolean;
        soundEnabled?: boolean;
        soundTone?: NotificationSoundTone;
        vibrationEnabled?: boolean;
      }) => {
        const notifPrefs =
          userRef.current?.settings?.notifications || DEFAULT_NOTIFICATION_SETTINGS;

        const categoryEnabled =
          payload.conversationType === 'direct'
            ? notifPrefs.privateMessages
            : payload.conversationType === 'group'
              ? notifPrefs.groupMessages
              : notifPrefs.communityMessages;
        if (!categoryEnabled) return;

        const currPath = pathnameRef.current;
        const viewingThisThread =
          currPath === `/chats/${payload.conversationId}` ||
          Boolean(payload.communityId && currPath === `/community/${payload.communityId}`);
        const isPageVisible = getIsPageVisible();

        if (viewingThisThread && isPageVisible) {
          return;
        }

        const displayBody = notifPrefs.messagePreview
          ? payload.body
          : 'New message';

        if (notifPrefs.soundEnabled && payload.soundEnabled !== false) {
          playNotificationTone(payload.soundTone || notifPrefs.soundTone);
        }
        if (notifPrefs.vibrationEnabled && payload.vibrationEnabled !== false) {
          triggerNotificationVibration();
        }

        if (!isPageVisible) {
          if (!hasActivePushRef.current) {
            showBrowserNotification({
              title: payload.title,
              body: displayBody,
              tag: `conv-${payload.conversationId}`,
              onClick: () => {
                navigate(
                  payload.communityId
                    ? `/community/${payload.communityId}`
                    : `/chats/${payload.conversationId}`
                );
              },
            });
          }
        } else {
          showToast(`${payload.title}: ${displayBody}`, 'info');
        }
      }
    );

    s.on(
      'notification:community',
      (payload: {
        event: string;
        communityId: string;
        communityName: string;
        title: string;
        body: string;
        soundEnabled?: boolean;
        soundTone?: NotificationSoundTone;
        vibrationEnabled?: boolean;
      }) => {
        const notifPrefs =
          userRef.current?.settings?.notifications || DEFAULT_NOTIFICATION_SETTINGS;
        if (!notifPrefs.communityActivity) return;

        if (notifPrefs.soundEnabled && payload.soundEnabled !== false) {
          playNotificationTone(payload.soundTone || notifPrefs.soundTone);
        }
        if (notifPrefs.vibrationEnabled && payload.vibrationEnabled !== false) {
          triggerNotificationVibration();
        }

        const isPageVisible = getIsPageVisible();
        const variant = payload.event === 'invited' ? 'success' : 'info';

        if (!isPageVisible) {
          if (!hasActivePushRef.current) {
            showBrowserNotification({
              title: payload.title,
              body: payload.body,
              tag: `comm-${payload.communityId}-${payload.event}`,
              onClick: () => navigate(`/community/${payload.communityId}`),
            });
          }
        } else {
          showToast(payload.body, variant);
        }
      }
    );

    s.on('user:blocked_updated', () => {
      refreshUser();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.blockedUsers(currentUserId),
      });
      invalidateConversationQueries(currentUserId);
      window.dispatchEvent(new CustomEvent('blinkupz:relationship-updated'));
    });

    s.on('user:privacy_updated', (payload: { userId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['publicProfile', currentUserId] });
      invalidateConversationQueries(currentUserId);
      window.dispatchEvent(
        new CustomEvent('blinkupz:relationship-updated', { detail: payload })
      );
    });

    setSocket(s);

    return () => {
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
      socketRef.current = null;
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id, showToast, refreshUser, navigate, emitFocusState]);

  return (
    <SocketContext.Provider value={{ socket, connected, presenceMap, typingMap }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
