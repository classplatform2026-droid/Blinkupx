import { useEffect, useRef } from 'react';
import { Sparkles, Users } from 'lucide-react';
import type { MentionCandidate } from '../utils/mentions';
import { UserAvatar } from './UserAvatar';

interface MentionAutocompleteDropdownProps {
  candidates: MentionCandidate[];
  selectedIndex: number;
  onSelect: (candidate: MentionCandidate) => void;
  onHighlightIndex?: (index: number) => void;
}

export function MentionAutocompleteDropdown({
  candidates,
  selectedIndex,
  onSelect,
  onHighlightIndex,
}: MentionAutocompleteDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(
      `[data-mention-idx="${selectedIndex}"]`
    );
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (candidates.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 right-0 sm:max-w-md mb-2 z-40 rounded-2xl bg-[#202020] border border-[#303030] shadow-2xl overflow-hidden"
    >
      <div className="px-3 py-1.5 border-b border-[#2C2C2C] flex items-center justify-between text-[11px] text-[#999999]">
        <span>Mention</span>
        <span className="font-mono">↑↓ · Enter / Tap</span>
      </div>
      <div
        ref={listRef}
        className="max-h-60 overflow-y-auto overscroll-contain p-1.5 space-y-0.5"
      >
        {candidates.map((candidate, idx) => {
          const isActive = idx === selectedIndex;
          const roleBadge =
            candidate.type === 'user' &&
            candidate.role &&
            candidate.role !== 'member'
              ? candidate.role.charAt(0).toUpperCase() + candidate.role.slice(1)
              : null;

          return (
            <button
              key={candidate.key}
              type="button"
              role="option"
              aria-selected={isActive}
              data-mention-idx={idx}
              onMouseDown={(e) => {
                // Keep focus on the rich text composer on mouse/touch tap
                e.preventDefault();
              }}
              onMouseEnter={() => onHighlightIndex?.(idx)}
              onClick={() => onSelect(candidate)}
              className={`w-full min-h-[44px] px-2.5 py-2 rounded-xl flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#303030] text-[#FFFFFF]'
                  : 'text-[#EAEAEA] hover:bg-[#282828]'
              }`}
            >
              {candidate.type === 'everyone' ? (
                <div className="w-8 h-8 rounded-full bg-[#F59E0B]/15 border border-[#F59E0B]/35 flex items-center justify-center text-[#FCD34D] shrink-0">
                  <Users className="w-4 h-4" />
                </div>
              ) : candidate.type === 'ai' ? (
                <div className="w-8 h-8 rounded-full bg-[#242730] border border-[#3E4554] flex items-center justify-center text-[#A3E635] shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
              ) : (
                <UserAvatar
                  src={candidate.avatar}
                  name={candidate.fullName}
                  size="sm"
                  online={candidate.onlineStatus}
                />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-[#FFFFFF] truncate">
                    {candidate.type === 'everyone'
                      ? '@everyone'
                      : candidate.fullName}
                  </span>
                  {candidate.type === 'ai' && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#A3E635]/15 text-[#A3E635] shrink-0">
                      AI
                    </span>
                  )}
                  {roleBadge && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#2C2C2C] text-[#BBBBBB] shrink-0">
                      {roleBadge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#999999] truncate">
                  {candidate.type === 'ai'
                    ? `@${candidate.username} · ${candidate.subtitle}`
                    : candidate.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
