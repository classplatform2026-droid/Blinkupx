import { useState } from 'react';
import { getInitials } from '../utils/formatters';

interface UserAvatarProps {
  src?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

export function UserAvatar({
  src,
  name,
  size = 'md',
  online = false,
  className = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(src && !imgError);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {showImage ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover bg-[#242424] border border-[#303030]`}
        />
      ) : (
        <div
          aria-label={name}
          className={`${SIZE_CLASSES[size]} rounded-full bg-[#242424] border border-[#303030] flex items-center justify-center font-semibold text-[#FFFFFF] select-none`}
        >
          {getInitials(name)}
        </div>
      )}
      {online && (
        <span
          aria-label="Online"
          title="Online"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#22C55E] border-2 border-[#181818]"
        />
      )}
    </div>
  );
}
