import React, { useMemo, useState } from 'react';
import {
  buildPreviewTokens,
  parseMessageBlocks,
  type InlineToken,
  type MessageBlock,
} from '../utils/textFormatting';

export type FormattedBubbleVariant = 'outgoing' | 'incoming';
export type FormattedPreviewVariant = 'outgoing' | 'incoming' | 'muted';

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
  previewMode = false,
  previewVariant: FormattedPreviewVariant = 'muted'
): React.ReactNode {
  return tokens.map((token, idx) => {
    switch (token.type) {
      case 'text':
        return <React.Fragment key={idx}>{token.text}</React.Fragment>;

      case 'bold':
        return (
          <strong key={idx} className="font-bold">
            {renderInlineTokens(token.children, variant, previewMode, previewVariant)}
          </strong>
        );

      case 'italic':
        return (
          <em key={idx} className="italic">
            {renderInlineTokens(token.children, variant, previewMode, previewVariant)}
          </em>
        );

      case 'strike':
        return (
          <s key={idx} className="line-through opacity-85">
            {renderInlineTokens(token.children, variant, previewMode, previewVariant)}
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
            {renderInlineTokens(token.children, variant, false, previewVariant)}
          </SpoilerText>
        );
    }
  });
}

function renderBlock(
  block: MessageBlock,
  idx: number,
  variant: FormattedBubbleVariant
): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <div key={idx} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {block.lines.map((lineTokens, lineIdx) => (
            <React.Fragment key={lineIdx}>
              {lineIdx > 0 && '\n'}
              {renderInlineTokens(lineTokens, variant)}
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
              {renderInlineTokens(lineTokens, variant)}
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
                {renderInlineTokens(itemTokens, variant)}
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
                {renderInlineTokens(item.tokens, variant)}
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
}: {
  text: string;
  variant?: FormattedBubbleVariant;
  className?: string;
}) {
  const blocks = useMemo(() => parseMessageBlocks(text), [text]);

  if (blocks.length === 0) return null;

  return (
    <div
      className={`min-w-0 max-w-full space-y-1 break-words [overflow-wrap:anywhere] ${className}`}
    >
      {blocks.map((block, idx) => renderBlock(block, idx, variant))}
    </div>
  );
}

export function FormattedMessagePreview({
  text,
  variant = 'muted',
}: {
  text: string;
  variant?: FormattedPreviewVariant;
}) {
  const tokens = useMemo(() => buildPreviewTokens(text), [text]);
  if (tokens.length === 0) return <>{text}</>;
  const bubbleVariant: FormattedBubbleVariant =
    variant === 'outgoing' ? 'outgoing' : 'incoming';
  return <>{renderInlineTokens(tokens, bubbleVariant, true, variant)}</>;
}
