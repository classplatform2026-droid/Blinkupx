import React from 'react';
import { AlertCircle } from 'lucide-react';
import { PrimaryButton } from './PrimaryButton';

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-[#242424] border border-[#303030] flex items-center justify-center text-[#999999] mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[#FFFFFF] mb-1.5">{title}</h3>
      <p className="text-sm text-[#999999] max-w-xs leading-relaxed mb-5">
        {description}
      </p>
      {actionLabel && onAction && (
        <PrimaryButton variant="secondary" onClick={onAction}>
          {actionLabel}
        </PrimaryButton>
      )}
    </div>
  );
}

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2 animate-pulse">
          <div className="w-11 h-11 rounded-full bg-[#242424] shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-[#242424]" />
            <div className="h-3 w-2/3 rounded bg-[#202020]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-11 h-11 rounded-2xl bg-[#242424] border border-[#303030] flex items-center justify-center text-[#E5484D] mb-3">
        <AlertCircle className="w-5 h-5" />
      </div>
      <p className="text-sm text-[#FFFFFF] font-medium mb-1">Something went wrong</p>
      <p className="text-sm text-[#999999] max-w-sm mb-4">{message}</p>
      {onRetry && (
        <PrimaryButton variant="secondary" onClick={onRetry}>
          Try Again
        </PrimaryButton>
      )}
    </div>
  );
}
