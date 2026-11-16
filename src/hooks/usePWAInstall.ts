import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type PwaPlatform = 'android' | 'ios' | 'desktop' | 'other';

export interface PwaBrowserInfo {
  platform: PwaPlatform;
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  isSafari: boolean;
  isFirefox: boolean;
  isEdge: boolean;
  isChrome: boolean;
  isInAppBrowser: boolean;
}

const DISMISS_STORAGE_KEY = 'blinkupz_pwa_install_dismissed_at';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Early global capture so `beforeinstallprompt` is never missed during route transitions
let capturedDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptSubscribers = new Set<(ev: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    capturedDeferredPrompt = e as BeforeInstallPromptEvent;
    for (const cb of promptSubscribers) {
      cb(capturedDeferredPrompt);
    }
  });

  window.addEventListener('appinstalled', () => {
    capturedDeferredPrompt = null;
    for (const cb of promptSubscribers) {
      cb(null);
    }
  });
}

export function detectPwaBrowser(): PwaBrowserInfo {
  if (typeof navigator === 'undefined') {
    return {
      platform: 'other',
      isIOS: false,
      isAndroid: false,
      isDesktop: false,
      isSafari: false,
      isFirefox: false,
      isEdge: false,
      isChrome: false,
      isInAppBrowser: false,
    };
  }

  const ua = navigator.userAgent || '';
  const lower = ua.toLowerCase();
  const isIPadOSDesktop =
    navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  const isIOS = /iphone|ipad|ipod/.test(lower) || isIPadOSDesktop;
  const isAndroid = /android/.test(lower);
  const isDesktop = !isIOS && !isAndroid;

  const isFirefox = /firefox|fxios/.test(lower);
  const isEdge = /edg|edga|edgios/.test(lower);
  const isChrome =
    (/chrome|crios/.test(lower) && !isEdge && !/opr|opera/.test(lower)) || false;
  const isSafari =
    /safari/.test(lower) &&
    !/chrome|crios|android|fxios|edg|edgios|opr|opera/.test(lower);
  const isInAppBrowser = /fban|fbav|instagram|line|wv\)|; wv/.test(lower);

  const platform: PwaPlatform = isIOS
    ? 'ios'
    : isAndroid
      ? 'android'
      : isDesktop
        ? 'desktop'
        : 'other';

  return {
    platform,
    isIOS,
    isAndroid,
    isDesktop,
    isSafari,
    isFirefox,
    isEdge,
    isChrome,
    isInAppBrowser,
  };
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    nav.standalone === true
  );
}

function isWithinDismissCooldown(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(capturedDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState<boolean>(checkIsStandalone);
  const [browserInfo] = useState<PwaBrowserInfo>(detectPwaBrowser);
  const [installing, setInstalling] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState<boolean>(
    isWithinDismissCooldown
  );

  useEffect(() => {
    const sub = (ev: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(ev);
    };
    promptSubscribers.add(sub);

    const media = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => {
      setIsInstalled(checkIsStandalone());
    };
    const handleAppInstalled = () => {
      capturedDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    media.addEventListener?.('change', handleDisplayChange);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      promptSubscribers.delete(sub);
      media.removeEventListener?.('change', handleDisplayChange);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const dismissInstallPrompt = useCallback(() => {
    setPromptDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore storage failures
    }
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    const activePrompt = deferredPrompt || capturedDeferredPrompt;
    if (!activePrompt) return 'unavailable';

    setInstalling(true);
    try {
      await activePrompt.prompt();
      const { outcome } = await activePrompt.userChoice;
      if (outcome === 'accepted') {
        capturedDeferredPrompt = null;
        setDeferredPrompt(null);
        setIsInstalled(true);
        return 'accepted';
      }
      dismissInstallPrompt();
      return 'dismissed';
    } catch {
      return 'unavailable';
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt, dismissInstallPrompt]);

  const canPromptInstall = Boolean(deferredPrompt) && !isInstalled;

  return {
    canPromptInstall,
    isInstalled,
    installing,
    promptDismissed,
    browserInfo,
    promptInstall,
    dismissInstallPrompt,
  };
}
