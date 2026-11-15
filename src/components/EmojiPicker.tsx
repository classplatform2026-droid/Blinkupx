const EMOJI_LIST = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏',
  '🎉', '✅', '💯', '🚀', '👀', '🤔', '😊', '🙌',
  '✨', '💬', '⚡', '🤝', '👌', '😅', '🥳', '🫡',
];

export function EmojiPicker({
  onSelect,
  compact = false,
}: {
  onSelect: (emoji: string) => void;
  compact?: boolean;
}) {
  const items = compact ? EMOJI_LIST.slice(0, 8) : EMOJI_LIST;
  return (
    <div
      className={`rounded-xl bg-[#242424] border border-[#303030] p-2 shadow-xl ${
        compact ? 'flex items-center gap-1' : 'grid grid-cols-6 gap-1 w-60'
      }`}
    >
      {items.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-lg hover:bg-[#303030] transition-colors cursor-pointer"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
