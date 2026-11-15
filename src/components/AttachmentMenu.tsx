import { Image, Video, FileText } from 'lucide-react';

interface AttachmentMenuProps {
  onSelectType: (type: 'image' | 'video' | 'document') => void;
}

export function AttachmentMenu({ onSelectType }: AttachmentMenuProps) {
  return (
    <div className="w-48 rounded-xl bg-[#242424] border border-[#303030] p-1.5 shadow-xl space-y-0.5">
      <button
        type="button"
        onClick={() => onSelectType('image')}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#FFFFFF] hover:bg-[#303030] transition-colors cursor-pointer"
      >
        <Image className="w-4 h-4 text-[#999999]" />
        <span>Image</span>
      </button>
      <button
        type="button"
        onClick={() => onSelectType('video')}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#FFFFFF] hover:bg-[#303030] transition-colors cursor-pointer"
      >
        <Video className="w-4 h-4 text-[#999999]" />
        <span>Video</span>
      </button>
      <button
        type="button"
        onClick={() => onSelectType('document')}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#FFFFFF] hover:bg-[#303030] transition-colors cursor-pointer"
      >
        <FileText className="w-4 h-4 text-[#999999]" />
        <span>Document</span>
      </button>
    </div>
  );
}
