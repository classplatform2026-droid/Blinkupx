import { useEffect, useState } from 'react';
import { getPendingOutgoingMessages } from '../utils/indexedDb';

export function useOnlineStatus(userId?: string) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [justReconnected, setJustReconnected] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const onOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => setJustReconnected(false), 3200);
    };

    const onOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setPendingCount(0);
      return;
    }

    const refreshCount = async () => {
      const pending = await getPendingOutgoingMessages(userId);
      setPendingCount(pending.length);
    };

    refreshCount();

    const onQueueChange = () => {
      void refreshCount();
    };

    window.addEventListener('blinkupz:offline-queue-updated', onQueueChange);
    return () => {
      window.removeEventListener('blinkupz:offline-queue-updated', onQueueChange);
    };
  }, [userId]);

  return {
    isOnline,
    justReconnected,
    pendingCount,
  };
}
