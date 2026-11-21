import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MessageMention } from '../types';
import {
  buildPreviewTokens,
  parseMessageBlocks,
  type InlineToken,
  type MessageBlock,
} from '../utils/textFormatting';

export type FormattedBubbleVariant = 'outgoing' | 'incoming';
export type FormattedPreviewVariant = 'outgoing' | 'incoming' | 'muted';

interface MentionRenderContext {
  mentions?: MessageMention[];
  currentUserId?: string;
  onUserMentionClick: (mention: MessageMention) => void;
}

function resolveTokenMention(
  username: string,
  mentions?: MessageMention[]
): MessageMention | null {
  const normalized = username.toLowerCase();
  if (mentions !== undefined) {
    const matched = mentions.find(
      (m) => m.username.toLowerCase() === normalized
    );
    return matched || null;
  }
  // Legacy fallback for messages stored prior to mention metadata support
  if (normalized === 'blink') {
    return {
      type: 'ai',
      userId: null,
      username: 'blink',
      fullName: 'Blink',
    };
  }
  return null;
}

function MentionBadge({
  rawText,
  resolved,
  variant,
  previewMode,
  previewVariant,
  currentUserId,
  onUserMentionClick,
}: {
  rawText: string;
  resolved: MessageMention;
  variant: FormattedBubbleVariant;
  previewMode: boolean;
  previewVariant: FormattedPreviewVariant;
  currentUserId?: string;
  onUserMentionClick: (mention: MessageMention) => void;
}) {
  const isMe = Boolean(
    currentUserId && resolved.type === 'user' && resolved.userId === currentUserId
  );

  if (previewMode) {
    const cls =
      resolved.type === 'ai'
        ? previewVariant === 'outgoing'
          ? 'font-semibold text-[#166534]'
          : 'font-semibold text-[#A3E635]'
        : resolved.type === 'everyone'
          ? previewVariant === 'outgoing'
            ? 'font-semibold text-[#B45309]'
            : 'font-semibold text-[#FCD34D]'
          : previewVariant === 'outgoing'
            ? 'font-semibold text-[#1D4ED8]'
            : 'font-semibold text-[#93C5FD]';
    return <span className={cls}>{rawText}</span>;
  }

  if (resolved.type === 'ai') {
    return (
      <span
        className={`inline rounded px-1 py-0.5 font-semibold ${
          variant === 'outgoing'
            ? 'bg-[#181818]/10 text-[#166534]'
            : 'bg-[#A3E635]/15 text-[#A3E635]'
        }`}
      >
        {rawText}
      </span>
    );
  }

  if (resolved.type === 'everyone') {
    return (
      <span
        className={`inline rounded px-1 py-0.5 font-semibold ${
          variant === 'outgoing'
            ? 'bg-[#D97706]/15 text-[#B45309]'
            : 'bg-[#F59E0B]/18 text-[#FCD34D]'
        }`}
      >
        {rawText}
      </span>
    );
  }

  const label = resolved.fullName
    ? `${resolved.fullName} (@${resolved.username})`
    : `@${resolved.username}`;

  return (
    <span
      role="button"
      tabIndex={0}
      data-no-swipe="true"
      title={`View ${label}'s profile`}
      aria-label={`Open profile for ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onUserMentionClick(resolved);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onUserMentionClick(resolved);
        }
      }}
      className={`inline rounded px-1 py-0.5 font-semibold cursor-pointer transition-colors ${
        variant === 'outgoing'
          ? isMe
            ? 'bg-[#2563EB] text-[#FFFFFF] hover:bg-[#1D4ED8]'
            : 'bg-[#2563EB]/12 text-[#1D4ED8] hover:bg-[#2563EB]/22'
          : isMe
            ? 'bg-[#60A5FA]/30 text-[#FFFFFF] ring-1 ring-[#60A5FA]/60 hover:bg-[#60A5FA]/40'
            : 'bg-[#60A5FA]/15 text-[#93C5FD] hover:bg-[#60A5FA]/25'
      }`}
    >
      {rawText}
    </span>
  );
}

function SpoilerText({
  variant,
  children,
}: {
  variant: FormattedBubbleVariant;
  children: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setRevealed((prev) => !prev);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      data-no-swipe="true"
      aria-expanded={revealed}
      aria-label={revealed ? 'Hide spoiler' : 'Reveal spoiler'}
      title={revealed ? 'Click to hide spoiler' : 'Spoiler — click to reveal'}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(e);
        }
      }}
      className={`inline rounded px-1 py-0.5 transition-colors cursor-pointer ${
        revealed
          ? variant === 'outgoing'
            ? 'bg-[#181818]/10 text-[#181818]'
            : 'bg-[#FFFFFF]/12 text-[#FFFFFF]'
          : variant === 'outgoing'
            ? 'bg-[#D4D4D8] hover:bg-[#C4C4C9] select-none'
            : 'bg-[#3A3A3A] hover:bg-[#474747] select-none'
      }`}
    >
      <span
        className={
          revealed
            ? 'transition-opacity duration-150'
            : 'opacity-0 pointer-events-none select-none'
        }
      >
        {children}
      </span>
    </span>
  );
}

function renderInlineTokens(
  tokens: InlineToken[],
  variant: FormattedBubbleVariant,
  mentionCtx: MentionRenderContext,
  previewMode = false,
  previewVariant: FormattedPreviewVariant = 'muted'
): React.ReactNode {
  return tokens.map((token, idx) => {
    switch (token.type) {
      case 'text':
        return <React.Fragment key={idx}>{token.text}</React.Fragment>;

      case 'mention': {
        const resolved = resolveTokenMention(token.username, mentionCtx.mentions);
        if (!resolved) {
          return <React.Fragment key={idx}>{token.text}</React.Fragment>;
        }
        return (
          <MentionBadge
            key={idx}
            rawText={token.text}
            resolved={resolved}
            variant={variant}
            previewMode={previewMode}
            previewVariant={previewVariant}
            currentUserId={mentionCtx.currentUserId}
            onUserMentionClick={mentionCtx.onUserMentionClick}
          />
        );
      }

      case 'bold':
        return (
          <strong key={idx} className="font-bold">
            {renderInlineTokens(
              token.children,
              variant,
              mentionCtx,
              previewMode,
              previewVariant
            )}
          </strong>
        );

      case 'italic':
        return (
          <em key={idx} className="italic">
            {renderInlineTokens(
              token.children,
              variant,
              mentionCtx,
              previewMode,
              previewVariant
            )}
          </em>
        );

      case 'strike':
        return (
          <s key={idx} className="line-through opacity-85">
            {renderInlineTokens(
              token.children,
              variant,
              mentionCtx,
              previewMode,
              previewVariant
            )}
          </s>
        );

      case 'code':
        return (
          <code
            key={idx}
            className={`font-mono text-[0.86em] px-1.5 py-0.5 rounded break-words ${
              previewMode
                ? previewVariant === 'outgoing'
                  ? 'bg-[#181818]/12 text-[#181818]'
                  : 'bg-[#2C2C2C] text-[#EAEAEA]'
                : variant === 'outgoing'
                  ? 'bg-[#181818]/10 text-[#181818] border border-[#181818]/10'
                  : 'bg-[#161616] text-[#F3F4F6] border border-[#383838]'
            }`}
          >
            {token.text}
          </code>
        );

      case 'link':
        if (previewMode) {
          return (
            <span key={idx} className="underline underline-offset-2">
              {token.text}
            </span>
          );
        }
        return (
          <a
            key={idx}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`underline underline-offset-2 break-all ${
              variant === 'outgoing'
                ? 'text-[#181818] hover:opacity-75'
                : 'text-[#FFFFFF] hover:opacity-80'
            }`}
          >
            {token.text}
          </a>
        );

      case 'spoiler':
        if (previewMode) {
          return (
            <span
              key={idx}
              aria-label="Hidden spoiler"
              className={`inline-block align-baseline rounded px-1 select-none ${
                previewVariant === 'outgoing'
                  ? 'bg-[#181818]/25 text-transparent'
                  : 'bg-[#383838] text-transparent'
              }`}
            >
              ••••
            </span>
          );
        }
        return (
          <SpoilerText key={idx} variant={variant}>
            {renderInlineTokens(
              token.children,
              variant,
              mentionCtx,
              false,
              previewVariant
            )}
          </SpoilerText>
        );
    }
  });
}

function renderBlock(
  block: MessageBlock,
  idx: number,
  variant: FormattedBubbleVariant,
  mentionCtx: MentionRenderContext
): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <div key={idx} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {block.lines.map((lineTokens, lineIdx) => (
            <React.Fragment key={lineIdx}>
              {lineIdx > 0 && '\n'}
              {renderInlineTokens(lineTokens, variant, mentionCtx)}
            </React.Fragment>
          ))}
        </div>
      );

    case 'blockquote':
      return (
        <blockquote
          key={idx}
          className={`my-0.5 pl-2.5 pr-1.5 py-1 border-l-2 rounded-r-md whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
            variant === 'outgoing'
              ? 'border-[#181818]/45 bg-[#181818]/[0.05] text-[#181818]/85'
              : 'border-[#FFFFFF]/45 bg-[#FFFFFF]/[0.06] text-[#E5E5E5]'
          }`}
        >
          {block.lines.map((lineTokens, lineIdx) => (
            <React.Fragment key={lineIdx}>
              {lineIdx > 0 && '\n'}
              {renderInlineTokens(lineTokens, variant, mentionCtx)}
            </React.Fragment>
          ))}
        </blockquote>
      );

    case 'code_block':
      return (
        <div
          key={idx}
          data-no-swipe="true"
          className={`my-1 rounded-xl overflow-hidden max-w-full min-w-0 border ${
            variant === 'outgoing'
              ? 'bg-[#F3F3F4] border-[#DCDCE0] text-[#181818]'
              : 'bg-[#161616] border-[#333333] text-[#F3F4F6]'
          }`}
        >
          {block.language && (
            <div
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border-b ${
                variant === 'outgoing'
                  ? 'border-[#DCDCE0] text-[#555555] bg-[#EAEAEA]'
                  : 'border-[#2B2B2B] text-[#999999] bg-[#1C1C1C]'
              }`}
            >
              {block.language}
            </div>
          )}
          <pre className="px-2.5 py-2 text-xs font-mono leading-relaxed overflow-x-auto max-w-full whitespace-pre">
            <code>{block.code}</code>
          </pre>
        </div>
      );

    case 'bullet_list':
      return (
        <ul key={idx} className="my-0.5 space-y-0.5 pl-0.5">
          {block.items.map((itemTokens, itemIdx) => (
            <li
              key={itemIdx}
              className="flex items-start gap-2 min-w-0 break-words [overflow-wrap:anywhere]"
            >
              <span
                aria-hidden="true"
                className="shrink-0 select-none opacity-75"
              >
                •
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                {renderInlineTokens(itemTokens, variant, mentionCtx)}
              </span>
            </li>
          ))}
        </ul>
      );

    case 'numbered_list':
      return (
        <ol key={idx} className="my-0.5 space-y-0.5 pl-0.5">
          {block.items.map((item, itemIdx) => (
            <li
              key={itemIdx}
              className="flex items-start gap-2 min-w-0 break-words [overflow-wrap:anywhere]"
            >
              <span
                aria-hidden="true"
                className="shrink-0 select-none font-mono text-[0.88em] tabular-nums opacity-75"
              >
                {item.marker}.
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                {renderInlineTokens(item.tokens, variant, mentionCtx)}
              </span>
            </li>
          ))}
        </ol>
      );
  }
}

export function FormattedMessageText({
  text,
  variant = 'incoming',
  className = '',
  mentions,
  currentUserId,
  onMentionClick,
}: {
  text: string;
  variant?: FormattedBubbleVariant;
  className?: string;
  mentions?: MessageMention[];
  currentUserId?: string;
  onMentionClick?: (mention: MessageMention) => void;
}) {
  const navigate = useNavigate();
  const blocks = useMemo(() => parseMessageBlocks(text), [text]);

  if (blocks.length === 0) return null;

  const mentionCtx: MentionRenderContext = {
    mentions,
    currentUserId,
    onUserMentionClick: (mention) => {
      if (onMentionClick) {
        onMentionClick(mention);
      } else if (mention.type === 'user' && mention.username) {
        navigate(`/u/${mention.username}`);
      }
    },
  };

  return (
    <div
      className={`min-w-0 max-w-full space-y-1 break-words [overflow-wrap:anywhere] ${className}`}
    >
      {blocks.map((block, idx) => renderBlock(block, idx, variant, mentionCtx))}
    </div>
  );
}

export function FormattedMessagePreview({
  text,
  variant = 'muted',
  mentions,
  currentUserId,
}: {
  text: string;
  variant?: FormattedPreviewVariant;
  mentions?: MessageMention[];
  currentUserId?: string;
}) {
  const tokens = useMemo(() => buildPreviewTokens(text), [text]);
  if (tokens.length === 0) return <>{text}</>;
  const bubbleVariant: FormattedBubbleVariant =
    variant === 'outgoing' ? 'outgoing' : 'incoming';
  const mentionCtx: MentionRenderContext = {
    mentions,
    currentUserId,
    onUserMentionClick: () => {},
  };
  return (
    <>{renderInlineTokens(tokens, bubbleVariant, mentionCtx, true, variant)}</>
  );
}
