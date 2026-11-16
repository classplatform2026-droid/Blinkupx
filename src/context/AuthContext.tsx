import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, clearStoredAuthToken, healthApi, pushApi, userApi } from '../services/api';
import type { ServiceStatus, User } from '../types';
import { getActiveBrowserPushSubscription, getOrCreatePushDeviceId } from '../utils/pushNotifications';

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
      setUser(data.user);
      setServices(data.services);
    } catch {
      setUser(null);
      try {
        const health = await healthApi.getStatus();
        setServices(health.services);
      } catch {
        // Ignore health probe error
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearStoredAuthToken();
      setUser(null);
    };
    window.addEventListener('blinkupz:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('blinkupz:unauthorized', handleUnauthorized);
    };
  }, []);

  const setAuthenticatedUser = useCallback((nextUser: User | null) => {
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
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
    } finally {
      clearStoredAuthToken();
      setUser(null);
    }
  }, []);

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
