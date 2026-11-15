import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getStoredAuthToken } from '../services/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

interface PresenceEntry {
  onlineStatus: boolean;
  lastSeen: string | null;
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
  const { user } = useAuth();
  const { showToast } = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceEntry>>({});
  const [typingMap, setTypingMap] = useState<
    Record<string, Array<{ userId: string; username: string }>>
  >({});
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!user) {
      setSocket((prev) => {
        prev?.disconnect();
        return null;
      });
      setConnected(false);
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
      (payload: { userId: string; onlineStatus: boolean; lastSeen: string }) => {
        setPresenceMap((prev) => ({
          ...prev,
          [payload.userId]: {
            onlineStatus: payload.onlineStatus,
            lastSeen: payload.lastSeen,
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
      'community:join_request',
      (payload: {
        communityId: string;
        communityName: string;
        requester: { fullName: string; username: string };
      }) => {
        showToast(
          `${payload.requester.fullName} requested to join ${payload.communityName}.`,
          'info'
        );
      }
    );

    s.on(
      'community:request_resolved',
      (payload: {
        communityId: string;
        communityName: string;
        decision: 'approve' | 'reject';
      }) => {
        showToast(
          payload.decision === 'approve'
            ? `Your request to join ${payload.communityName} was approved.`
            : `Your request to join ${payload.communityName} was declined.`,
          payload.decision === 'approve' ? 'success' : 'info'
        );
      }
    );

    s.on(
      'community:invited',
      (payload: { communityName: string; invitedBy: string }) => {
        showToast(
          `${payload.invitedBy} added you to ${payload.communityName}.`,
          'success'
        );
      }
    );

    s.on('community:removed', (payload: { communityName: string }) => {
      showToast(`You were removed from ${payload.communityName}.`, 'info');
    });

    s.on('community:deleted', (payload: { communityName: string }) => {
      showToast(`${payload.communityName} was deleted by the owner.`, 'info');
    });

    setSocket(s);

    return () => {
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id, showToast]);

  return (
    <SocketContext.Provider value={{ socket, connected, presenceMap, typingMap }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
