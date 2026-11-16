import { Download, MessageSquare, Phone, User as UserIcon, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePwa } from '../context/PwaContext';
import { BrandMark } from './BrandMark';
import { UserAvatar } from './UserAvatar';

const NAV_ITEMS = [
  { to: '/chats', label: 'Chats', icon: MessageSquare },
  { to: '/community', label: 'Community', icon: Users },
  { to: '/calls', label: 'Call', icon: Phone },
  { to: '/profile', label: 'Profile', icon: UserIcon },
];

export function Sidebar() {
  const { user } = useAuth();
  const { canPromptInstall, isInstalled, installing, installApp } = usePwa();

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden md:flex flex-col w-[76px] lg:w-[240px] shrink-0 h-full bg-[#181818] border-r border-[#303030] select-none"
    >
      <div className="h-16 px-4 lg:px-5 flex items-center gap-3 border-b border-[#303030]">
        <BrandMark size={28} />
        <span className="hidden lg:inline text-base font-bold tracking-tight text-[#FFFFFF] whitespace-nowrap">
          BlinkUpZ
        </span>
      </div>

      <nav className="flex-1 px-2.5 lg:px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center justify-center lg:justify-start gap-3 min-h-[44px] px-3 rounded-xl text-sm font-medium transition-colors duration-150 whitespace-nowrap ${
                isActive
                  ? 'bg-[#242424] text-[#FFFFFF]'
                  : 'text-[#999999] hover:text-[#FFFFFF] hover:bg-[#202020]'
              }`
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline">{label}</span>
          </NavLink>
        ))}
      </nav>

      {canPromptInstall && !isInstalled && (
        <div className="px-2.5 lg:px-3 pb-3">
          <button
            type="button"
            disabled={installing}
            onClick={() => void installApp()}
            aria-label="Install BlinkUpZ"
            className="w-full flex items-center justify-center lg:justify-start gap-3 min-h-[42px] px-3 rounded-xl text-xs font-semibold bg-[#242424] text-[#FFFFFF] hover:bg-[#303030] border border-[#303030] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span className="hidden lg:inline">Install App</span>
          </button>
        </div>
      )}

      {user && (
        <div className="p-3 border-t border-[#303030]">
          <NavLink
            to="/profile"
            className="flex items-center justify-center lg:justify-start gap-3 p-2 rounded-xl hover:bg-[#202020] transition-colors"
          >
            <UserAvatar
              src={user.avatar}
              name={user.fullName}
              size="sm"
              online={user.onlineStatus}
            />
            <div className="hidden lg:block min-w-0">
              <p className="text-sm font-medium text-[#FFFFFF] truncate">
                {user.fullName}
              </p>
              <p className="text-xs text-[#999999] truncate">@{user.username}</p>
            </div>
          </NavLink>
        </div>
      )}
    </aside>
  );
}
