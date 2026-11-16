import { Download, Monitor, PlusSquare, Share, Smartphone } from 'lucide-react';
import { Modal } from './Modal';
import { PrimaryButton } from './PrimaryButton';
import type { PwaBrowserInfo } from '../hooks/usePWAInstall';

interface InstallAppModalProps {
  open: boolean;
  onClose: () => void;
  browserInfo: PwaBrowserInfo;
}

export function InstallAppModal({
  open,
  onClose,
  browserInfo,
}: InstallAppModalProps) {
  const { isIOS, isSafari, isAndroid, isFirefox, isInAppBrowser } = browserInfo;

  let title = 'Install BlinkUpZ';
  if (isIOS) title = 'Install on iPhone or iPad';
  else if (isAndroid) title = 'Install on Android';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4 text-sm text-[#999999]">
        {isInAppBrowser ? (
          <div className="space-y-3">
            <p className="text-[#FFFFFF] leading-relaxed">
              In-app browsers restrict app installation. Open BlinkUpZ in your system browser first:
            </p>
            <div className="rounded-xl bg-[#181818] border border-[#303030] p-3.5 space-y-2 text-xs leading-relaxed">
              <p>
                1. Tap the browser menu icon in the corner.
              </p>
              <p>
                2. Choose <span className="text-[#FFFFFF] font-medium">Open in Safari</span> (iOS) or <span className="text-[#FFFFFF] font-medium">Open in Chrome</span> (Android).
              </p>
              <p>
                3. Install BlinkUpZ from that browser.
              </p>
            </div>
          </div>
        ) : isIOS ? (
          <div className="space-y-3">
            {!isSafari && (
              <p className="text-xs text-[#F59E0B] leading-relaxed">
                For the best Home Screen experience and notifications, open this page in Safari on iOS 16.4 or newer.
              </p>
            )}
            <p className="text-[#FFFFFF] leading-relaxed">
              Add BlinkUpZ to your Home Screen to launch it full-screen like a native app:
            </p>
            <div className="rounded-xl bg-[#181818] border border-[#303030] p-4 space-y-3 text-xs">
              <div className="flex items-start gap-3">
                <Share className="w-4 h-4 text-[#FFFFFF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  1. Tap the <span className="text-[#FFFFFF] font-medium">Share</span> button in Safari&apos;s toolbar.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <PlusSquare className="w-4 h-4 text-[#FFFFFF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  2. Scroll down and tap <span className="text-[#FFFFFF] font-medium">Add to Home Screen</span>, then tap <span className="text-[#FFFFFF] font-medium">Add</span>.
                </p>
              </div>
            </div>
          </div>
        ) : isAndroid ? (
          <div className="space-y-3">
            <p className="text-[#FFFFFF] leading-relaxed">
              Install BlinkUpZ on your Android device via your browser menu:
            </p>
            <div className="rounded-xl bg-[#181818] border border-[#303030] p-4 space-y-2.5 text-xs">
              <div className="flex items-start gap-3">
                <Smartphone className="w-4 h-4 text-[#FFFFFF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  1. Open the browser menu (<span className="text-[#FFFFFF] font-medium">⋮</span>) in the top-right corner of Chrome or Edge.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Download className="w-4 h-4 text-[#FFFFFF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  2. Tap <span className="text-[#FFFFFF] font-medium">Install app</span> or <span className="text-[#FFFFFF] font-medium">Add to Home screen</span> and confirm.
                </p>
              </div>
            </div>
          </div>
        ) : isFirefox ? (
          <div className="space-y-3">
            <p className="text-[#FFFFFF] leading-relaxed">
              Desktop Firefox does not natively support one-click PWA installation.
            </p>
            <p className="text-xs leading-relaxed">
              You can still use BlinkUpZ with full offline caching and notifications here, or open BlinkUpZ in <span className="text-[#FFFFFF] font-medium">Google Chrome</span> or <span className="text-[#FFFFFF] font-medium">Microsoft Edge</span> to install it as a standalone desktop window.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[#FFFFFF] leading-relaxed">
              Install BlinkUpZ as a standalone desktop app window:
            </p>
            <div className="rounded-xl bg-[#181818] border border-[#303030] p-4 space-y-2.5 text-xs">
              <div className="flex items-start gap-3">
                <Monitor className="w-4 h-4 text-[#FFFFFF] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Look for the <span className="text-[#FFFFFF] font-medium">Install BlinkUpZ</span> icon in the right side of your Chrome or Edge address bar, or open browser menu → <span className="text-[#FFFFFF] font-medium">Apps / Save and share</span> → <span className="text-[#FFFFFF] font-medium">Install BlinkUpZ</span>.
                </p>
              </div>
            </div>
          </div>
        )}

        <PrimaryButton variant="secondary" fullWidth onClick={onClose}>
          Got it
        </PrimaryButton>
      </div>
    </Modal>
  );
}
