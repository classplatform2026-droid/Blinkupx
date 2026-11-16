import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  authApi,
  clearStoredAuthToken,
  getStoredAuthToken,
  healthApi,
  pushApi,
  userApi,
} from '../services/api';
import type { ServiceStatus, User } from '../types';
import { subscribeCacheSync } from '../utils/cacheSync';
import {
  getActiveUserSnapshot,
  getLastCachedUserId,
  saveActiveUserSnapshot,
} from '../utils/indexedDb';
import { clearAllAccountCaches } from '../utils/mediaCache';
import {
  getActiveBrowserPushSubscription,
  getOrCreatePushDeviceId,
} from '../utils/pushNotifications';
import { isLikelyNetworkDisconnectError } from '../utils/offlineQueue';
import { queryClient } from '../utils/queryClient';

interface AuthContextValue {
  user: User | null;
  services: ServiceStatus | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  setAuthenticatedUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [services, setServices] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await userApi.getMe();
      const prevCachedUserId = await getLastCachedUserId();
      if (prevCachedUserId && prevCachedUserId !== data.user.id) {
        // Account changed on this browser — enforce strict account cache isolation
        await clearAllAccountCaches(prevCachedUserId);
      }
      await saveActiveUserSnapshot(data.user);
      setUser(data.user);
      setServices(data.services);
    } catch (err) {
      const hasToken = Boolean(getStoredAuthToken());
      if (hasToken && isLikelyNetworkDisconnectError(err)) {
        // Offline recovery: restore non-secret user snapshot from IndexedDB only when token exists
        const snapshot = await getActiveUserSnapshot();
        if (snapshot) {
          setUser(snapshot);
          return;
        }
      }

      setUser(null);
      try {
        const health = await healthApi.getStatus();
        setServices(health.services);
      } catch {
        // Ignore health probe error when offline
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Re-verify session silently once connectivity returns
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      if (getStoredAuthToken()) {
        void refreshUser();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshUser]);

  // Listen for unauthorized & cross-tab logout signals
  useEffect(() => {
    const handleUnauthorized = () => {
      const uid = user?.id;
      clearStoredAuthToken();
      setUser(null);
      void clearAllAccountCaches(uid);
    };

    const unsubSync = subscribeCacheSync((msg) => {
      if (msg.type === 'LOGOUT_CLEAR') {
        clearStoredAuthToken();
        queryClient.clear();
        setUser(null);
      }
    });

    window.addEventListener('blinkupz:unauthorized', handleUnauthorized);
    return () => {
      unsubSync();
      window.removeEventListener('blinkupz:unauthorized', handleUnauthorized);
    };
  }, [user?.id]);

  const setAuthenticatedUser = useCallback((nextUser: User | null) => {
    if (nextUser) {
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[1] !== nextUser.id,
      });
      void (async () => {
        const prevCachedUserId = await getLastCachedUserId();
        if (prevCachedUserId && prevCachedUserId !== nextUser.id) {
          await clearAllAccountCaches(prevCachedUserId);
        }
        await saveActiveUserSnapshot(nextUser);
      })();
    } else {
      queryClient.clear();
    }
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    const uid = user?.id;
    try {
      const existingSub = await getActiveBrowserPushSubscription().catch(() => null);
      if (existingSub?.endpoint) {
        await pushApi
          .unsubscribe({
            endpoint: existingSub.endpoint,
            deviceId: getOrCreatePushDeviceId(),
            disablePreference: false,
          })
          .catch(() => {});
      }
      await authApi.logout();
    } catch {
      // Proceed with local cleanup even if offline during logout
    } finally {
      clearStoredAuthToken();
      setUser(null);
      await clearAllAccountCaches(uid);
    }
  }, [user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        services,
        loading,
        refreshUser,
        setAuthenticatedUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
