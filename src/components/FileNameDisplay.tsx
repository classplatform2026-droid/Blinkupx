import { splitFileNameAndExtension } from '../utils/formatters';

interface FileNameDisplayProps {
  fileName: string | null | undefined;
  className?: string;
}

export function FileNameDisplay({
  fileName,
  className = '',
}: FileNameDisplayProps) {
  const { fullName, baseName, extension } = splitFileNameAndExtension(fileName);

  return (
    <span
      className={`flex items-baseline min-w-0 max-w-full ${className}`}
      title={fullName}
      aria-label={fullName}
    >
      <span className="truncate">{baseName}</span>
      {extension ? <span className="shrink-0">{extension}</span> : null}
    </span>
  );
}
