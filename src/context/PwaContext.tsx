import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { InstallAppModal } from '../components/InstallAppModal';
import { useToast } from './ToastContext';
import {
  usePWAInstall,
  type PwaBrowserInfo,
} from '../hooks/usePWAInstall';
import {
  applySafeSwUpdate,
  checkForSwUpdates,
  getSwUpdateSnapshot,
  subscribeSwUpdateState,
} from '../utils/swRegistration';

interface PwaContextValue {
  canPromptInstall: boolean;
  isInstalled: boolean;
  installing: boolean;
  promptDismissed: boolean;
  browserInfo: PwaBrowserInfo;
  installApp: () => Promise<'accepted' | 'dismissed' | 'guide' | 'unavailable'>;
  openInstallGuide: () => void;
  dismissInstallPrompt: () => void;
  updateAvailable: boolean;
  updatingUpdate: boolean;
  checkingUpdate: boolean;
  updateDismissed: boolean;
  applyUpdate: () => Promise<void>;
  checkForUpdates: () => Promise<boolean>;
  dismissUpdateBanner: () => void;
}

const PwaContext = createContext<PwaContextValue | null>(null);

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const {
    canPromptInstall,
    isInstalled,
    installing,
    promptDismissed,
    browserInfo,
    promptInstall,
    dismissInstallPrompt,
  } = usePWAInstall();

  const [guideOpen, setGuideOpen] = useState(false);
  const [swState, setSwState] = useState(getSwUpdateSnapshot);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  useEffect(() => {
    return subscribeSwUpdateState((next) => {
      setSwState(next);
      if (next.updateAvailable) {
        setUpdateDismissed(false);
      }
    });
  }, []);

  const installApp = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'guide' | 'unavailable'
  > => {
    if (isInstalled) return 'unavailable';
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        showToast('BlinkUpZ installed successfully.', 'success');
      }
      return outcome;
    }
    setGuideOpen(true);
    return 'guide';
  }, [isInstalled, canPromptInstall, promptInstall, showToast]);

  const openInstallGuide = useCallback(() => {
    setGuideOpen(true);
  }, []);

  const applyUpdate = useCallback(async () => {
    await applySafeSwUpdate();
  }, []);

  const checkForUpdates = useCallback(async () => {
    const found = await checkForSwUpdates();
    if (found) {
      setUpdateDismissed(false);
      showToast('A new version of BlinkUpZ is ready to update.', 'info');
    } else {
      showToast('You are using the latest version of BlinkUpZ.', 'success');
    }
    return found;
  }, [showToast]);

  const dismissUpdateBanner = useCallback(() => {
    setUpdateDismissed(true);
  }, []);

  return (
    <PwaContext.Provider
      value={{
        canPromptInstall,
        isInstalled,
        installing,
        promptDismissed,
        browserInfo,
        installApp,
        openInstallGuide,
        dismissInstallPrompt,
        updateAvailable: swState.updateAvailable,
        updatingUpdate: swState.updating,
        checkingUpdate: swState.checking,
        updateDismissed,
        applyUpdate,
        checkForUpdates,
        dismissUpdateBanner,
      }}
    >
      {children}
      <InstallAppModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        browserInfo={browserInfo}
      />
    </PwaContext.Provider>
  );
}

export function usePwa() {
  const ctx = useContext(PwaContext);
  if (!ctx) throw new Error('usePwa must be used within PwaProvider');
  return ctx;
}
