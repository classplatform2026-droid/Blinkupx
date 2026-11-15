import React from 'react';
import { Loader2 } from 'lucide-react';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  fullWidth?: boolean;
}

export function PrimaryButton({
  children,
  variant = 'primary',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: PrimaryButtonProps) {
  const variantClasses = {
    primary: 'bg-[#FFFFFF] text-[#181818] hover:bg-[#E8E8E8]',
    secondary: 'bg-[#242424] text-[#FFFFFF] border border-[#303030] hover:bg-[#2C2C2C]',
    danger: 'bg-[#E5484D] text-[#FFFFFF] hover:bg-[#D13B40]',
    ghost: 'bg-transparent text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424]',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${variantClasses} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
