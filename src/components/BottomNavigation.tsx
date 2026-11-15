import { MessageSquare, Users, Phone, User as UserIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/chats', label: 'Chats', icon: MessageSquare },
  { to: '/community', label: 'Community', icon: Users },
  { to: '/calls', label: 'Call', icon: Phone },
  { to: '/profile', label: 'Profile', icon: UserIcon },
];

export function BottomNavigation() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 min-h-[4.375rem] bg-[#181818]/95 backdrop-blur-md border-t border-[#303030] grid grid-cols-4 items-center px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-h-[44px] gap-1 transition-colors ${
              isActive ? 'text-[#FFFFFF]' : 'text-[#999999]'
            }`
          }
        >
          <Icon className="w-5 h-5" />
          <span className="text-[11px] font-medium leading-none">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
