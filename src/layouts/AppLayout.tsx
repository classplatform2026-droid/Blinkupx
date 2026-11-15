import React from 'react';
import { useLocation } from 'react-router-dom';
import { BottomNavigation } from '../components/BottomNavigation';
import { Sidebar } from '../components/Sidebar';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // Hide mobile bottom navigation when inside full-screen message or sub-flow screens
  const isDetailScreen =
    /^\/chats\/[^/]+$/.test(location.pathname) ||
    /^\/community\/[^/]+$/.test(location.pathname) ||
    location.pathname === '/profile/edit' ||
    location.pathname === '/profile/settings';

  return (
    <div className="h-dvh w-full flex bg-[#181818] text-[#FFFFFF] overflow-hidden">
      <Sidebar />
      <main
        className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden ${
          isDetailScreen ? '' : 'pb-16 md:pb-0'
        }`}
      >
        {children}
      </main>
      {!isDetailScreen && <BottomNavigation />}
    </div>
  );
}
