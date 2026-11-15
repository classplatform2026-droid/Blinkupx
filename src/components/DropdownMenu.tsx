import React, { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  options: DropdownOption[];
  align?: 'left' | 'right';
}

export function DropdownMenu({
  trigger,
  options,
  align = 'right',
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <div onClick={() => setOpen((prev) => !prev)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={`absolute z-40 mt-1.5 min-w-[184px] rounded-xl bg-[#242424] border border-[#303030] py-1.5 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                opt.onClick();
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors cursor-pointer ${
                opt.danger
                  ? 'text-[#E5484D] hover:bg-[#2C2C2C]'
                  : 'text-[#FFFFFF] hover:bg-[#2C2C2C]'
              }`}
            >
              {opt.icon && <span className="shrink-0">{opt.icon}</span>}
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
