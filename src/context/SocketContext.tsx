import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { getStoredAuthToken } from '../services/api';
import type { NotificationSoundTone } from '../types';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  playNotificationTone,
  showBrowserNotification,
  triggerNotificationVibration,
} from '../utils/notifications';
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
  const userRef = useRef(user);
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!user) {
      setSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      setConnected(false);
      setPresenceMap({});
      return;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    const token = getStoredAuthToken();
    const s = io(socketUrl, {
      withCredentials: true,
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
    });

    s.on('connect', () => {
      setConnected(true);
    });

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
        if (payload.userId === user.id) return;
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
        const isPageVisible =
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          document.hasFocus();

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

        const isPageVisible =
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          document.hasFocus();

        const variant =
          payload.event === 'invited' ? 'success' : 'info';

        if (!isPageVisible) {
          showBrowserNotification({
            title: payload.title,
            body: payload.body,
            tag: `comm-${payload.communityId}-${payload.event}`,
            onClick: () => navigate(`/community/${payload.communityId}`),
          });
        } else {
          showToast(payload.body, variant);
        }
      }
    );

    s.on('user:blocked_updated', () => {
      refreshUser();
      window.dispatchEvent(new CustomEvent('blinkupz:relationship-updated'));
    });

    s.on('user:privacy_updated', (payload: { userId: string }) => {
      window.dispatchEvent(
        new CustomEvent('blinkupz:relationship-updated', { detail: payload })
      );
    });

    setSocket(s);

    return () => {
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id, showToast, refreshUser, navigate]);

  return (
    <SocketContext.Provider value={{ socket, connected, presenceMap, typingMap }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
