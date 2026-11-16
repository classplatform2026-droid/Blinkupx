import { RefreshCw, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineBanner() {
  const { user } = useAuth();
  const { isOnline, justReconnected, pendingCount } = useOnlineStatus(user?.id);

  if (isOnline && !justReconnected && pendingCount === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`px-4 py-1.5 text-xs border-b flex items-center justify-center gap-2 shrink-0 transition-colors ${
        !isOnline
          ? 'bg-[#202020] border-[#303030] text-[#F59E0B]'
          : 'bg-[#202020] border-[#303030] text-[#22C55E]'
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">
            Offline mode · Showing cached data
            {pendingCount > 0
              ? ` · ${pendingCount} queued message${pendingCount === 1 ? '' : 's'}`
              : ''}
          </span>
        </>
      ) : (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="font-medium">
            {pendingCount > 0
              ? `Back online · Syncing ${pendingCount} queued message${pendingCount === 1 ? '' : 's'}...`
              : 'Back online · Synced'}
          </span>
        </>
      )}
    </div>
  );
}
