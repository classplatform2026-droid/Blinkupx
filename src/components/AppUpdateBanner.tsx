import { RefreshCw, X } from 'lucide-react';
import { usePwa } from '../context/PwaContext';

export function AppUpdateBanner() {
  const { updateAvailable, updatingUpdate, updateDismissed, applyUpdate, dismissUpdateBanner } =
    usePwa();

  if (!updateAvailable || updateDismissed) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="px-4 py-2 bg-[#202020] border-b border-[#303030] flex items-center justify-between gap-3 shrink-0"
    >
      <div className="flex items-center gap-2 min-w-0 text-xs text-[#FFFFFF]">
        <RefreshCw
          className={`w-3.5 h-3.5 text-[#22C55E] shrink-0 ${
            updatingUpdate ? 'animate-spin' : ''
          }`}
        />
        <span className="truncate font-medium">
          A new version of BlinkUpZ is ready.
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={updatingUpdate}
          onClick={() => void applyUpdate()}
          className="px-3 py-1 rounded-lg bg-[#FFFFFF] text-[#181818] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap disabled:opacity-60"
        >
          {updatingUpdate ? 'Updating...' : 'Update Now'}
        </button>
        <button
          type="button"
          onClick={dismissUpdateBanner}
          aria-label="Dismiss update notification"
          className="p-1 rounded-lg text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
