import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AppUpdateBanner } from '../components/AppUpdateBanner';
import { BottomNavigation } from '../components/BottomNavigation';
import { OfflineBanner } from '../components/OfflineBanner';
import { Sidebar } from '../components/Sidebar';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [mobileViewport, setMobileViewport] = useState<{
    height: number | null;
    offsetTop: number;
    keyboardOpen: boolean;
  }>({
    height: null,
    offsetTop: 0,
    keyboardOpen: false,
  });

  const maxMobileHeightRef = useRef<number>(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const lastWidthRef = useRef<number>(
    typeof window !== 'undefined' ? window.innerWidth : 0
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewport = () => {
      const isMobile = window.innerWidth < 768;
      if (!isMobile) {
        lastWidthRef.current = window.innerWidth;
        setMobileViewport((prev) =>
          prev.height === null && prev.offsetTop === 0 && !prev.keyboardOpen
            ? prev
            : { height: null, offsetTop: 0, keyboardOpen: false }
        );
        return;
      }

      const vv = window.visualViewport;
      if (vv && vv.scale !== 1) return;

      const currentHeight = Math.round(vv ? vv.height : window.innerHeight);
      const offsetTop = Math.round(vv ? vv.offsetTop : 0);

      if (Math.abs(window.innerWidth - lastWidthRef.current) > 20) {
        lastWidthRef.current = window.innerWidth;
        maxMobileHeightRef.current = Math.max(window.innerHeight, currentHeight);
      } else if (currentHeight > maxMobileHeightRef.current) {
        maxMobileHeightRef.current = currentHeight;
      }

      const activeTag = document.activeElement?.tagName;
      const isTextFocused =
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        (document.activeElement as HTMLElement | null)?.isContentEditable === true;

      const keyboardOpen =
        currentHeight < window.innerHeight - 80 ||
        (isTextFocused && currentHeight < maxMobileHeightRef.current - 120);

      if (offsetTop > 0 && isTextFocused) {
        window.scrollTo(0, 0);
      }

      setMobileViewport((prev) =>
        prev.height === currentHeight &&
        prev.offsetTop === offsetTop &&
        prev.keyboardOpen === keyboardOpen
          ? prev
          : {
              height: currentHeight,
              offsetTop,
              keyboardOpen,
            }
      );
    };

    updateViewport();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', updateViewport);
    vv?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    window.addEventListener('focusin', updateViewport);
    window.addEventListener('focusout', updateViewport);

    return () => {
      vv?.removeEventListener('resize', updateViewport);
      vv?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('focusin', updateViewport);
      window.removeEventListener('focusout', updateViewport);
    };
  }, []);

  // Hide mobile bottom navigation when inside full-screen message or sub-flow screens
  const isDetailScreen =
    /^\/chats\/[^/]+$/.test(location.pathname) ||
    /^\/community\/[^/]+(\/.*)?$/.test(location.pathname) ||
    /^\/profile\/.+$/.test(location.pathname);

  const showBottomNav = !isDetailScreen && !mobileViewport.keyboardOpen;

  return (
    <div
      data-keyboard-open={mobileViewport.keyboardOpen ? 'true' : 'false'}
      style={
        mobileViewport.height !== null
          ? {
              height: `${mobileViewport.height}px`,
              top: `${mobileViewport.offsetTop}px`,
            }
          : undefined
      }
      className="fixed inset-x-0 top-0 md:static h-dvh w-full flex bg-[#181818] text-[#FFFFFF] overflow-hidden"
    >
      <Sidebar />
      <main
        className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden ${
          showBottomNav ? 'pb-[calc(4.375rem+env(safe-area-inset-bottom))] md:pb-0' : ''
        }`}
      >
        <AppUpdateBanner />
        <OfflineBanner />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
      </main>
      {showBottomNav && <BottomNavigation />}
    </div>
  );
}
