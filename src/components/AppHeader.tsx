import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  leftSlot,
  rightSlot,
}: AppHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="min-h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 sm:px-5 flex items-center justify-between gap-3 border-b border-[#303030] bg-[#181818] shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {showBack && (
          <button
            type="button"
            onClick={() => (onBack ? onBack() : navigate(-1))}
            aria-label="Go back"
            className="min-w-[40px] min-h-[40px] -ml-1.5 flex items-center justify-center rounded-xl text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        {leftSlot}
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight text-[#FFFFFF] truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-[#999999] truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {rightSlot && (
        <div className="flex items-center gap-1.5 shrink-0">{rightSlot}</div>
      )}
    </header>
  );
}
