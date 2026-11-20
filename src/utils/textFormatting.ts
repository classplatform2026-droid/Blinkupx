export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'strike'; children: InlineToken[] }
  | { type: 'spoiler'; children: InlineToken[] };

export type MessageBlock =
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'blockquote'; lines: InlineToken[][] }
  | { type: 'code_block'; code: string; language?: string }
  | { type: 'bullet_list'; items: InlineToken[][] }
  | { type: 'numbered_list'; items: { marker: string; tokens: InlineToken[] }[] };

const MAX_INLINE_DEPTH = 4;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const URL_START_RE = /^((?:https?:\/\/|www\.)[^\s<>"'`)\]]+)/i;
const PREV_URL_BOUNDARY_RE = /[\s([{'"*_~|]/;

function isWordChar(ch: string): boolean {
  return ch !== '' && WORD_CHAR_RE.test(ch);
}

function normalizeNewlines(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}

function stripBalancedUrlTrailing(rawUrl: string): string {
  let clean = rawUrl.replace(/[.,!?;:'"\]}>]+$/, '');
  while (clean.endsWith(')')) {
    const opens = (clean.match(/\(/g) || []).length;
    const closes = (clean.match(/\)/g) || []).length;
    if (closes > opens) {
      clean = clean.slice(0, -1).replace(/[.,!?;:'"\]}>]+$/, '');
    } else {
      break;
    }
  }
  return clean;
}

function findClosingBacktick(text: string, startFrom: number): number {
  for (let k = startFrom; k < text.length; k++) {
    if (text[k] === '\n') return -1;
    if (text[k] === '`') return k;
  }
  return -1;
}

function findClosingSpoiler(text: string, startFrom: number): number {
  for (let k = startFrom; k < text.length - 1; k++) {
    if (text[k] === '`') {
      const endTick = findClosingBacktick(text, k + 1);
      if (endTick !== -1) {
        k = endTick;
        continue;
      }
    }
    if (text[k] === '|' && text[k + 1] === '|') {
      if (text.slice(startFrom, k).trim().length > 0) {
        return k;
      }
    }
  }
  return -1;
}

function findClosingDelimiter(
  text: string,
  startFrom: number,
  delim: '*' | '_' | '~'
): number {
  for (let k = startFrom; k < text.length; k++) {
    if (text[k] === '`') {
      const endTick = findClosingBacktick(text, k + 1);
      if (endTick !== -1) {
        k = endTick;
        continue;
      }
    }
    if (text[k] === delim) {
      const before = text[k - 1] ?? '';
      const after = text[k + 1] ?? '';
      if (!/\s/.test(before) && !isWordChar(after)) {
        return k;
      }
    }
  }
  return -1;
}

function pushTextToken(tokens: InlineToken[], chunk: string) {
  if (!chunk) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === 'text') {
    last.text += chunk;
  } else {
    tokens.push({ type: 'text', text: chunk });
  }
}

export function parseInlineTokens(text: string, depth = 0): InlineToken[] {
  if (!text) return [];
  const tokens: InlineToken[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // 1. Safe HTTP(S) / www URLs (scanned before _italic_ / ~strike~ so URLs stay intact)
    if (
      (ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') &&
      (i === 0 || PREV_URL_BOUNDARY_RE.test(text[i - 1]))
    ) {
      const slice = text.slice(i);
      const urlMatch = slice.match(URL_START_RE);
      if (urlMatch) {
        const cleanUrl = stripBalancedUrlTrailing(urlMatch[1]);
        if (cleanUrl && /^(?:https?:\/\/|www\.)/i.test(cleanUrl)) {
          const href = /^https?:\/\//i.test(cleanUrl)
            ? cleanUrl
            : `https://${cleanUrl}`;
          tokens.push({ type: 'link', text: cleanUrl, href });
          i += cleanUrl.length;
          continue;
        }
      }
    }

    // 2. Inline code `...`
    if (ch === '`') {
      const closeIdx = findClosingBacktick(text, i + 1);
      if (closeIdx > i + 1) {
        tokens.push({ type: 'code', text: text.slice(i + 1, closeIdx) });
        i = closeIdx + 1;
        continue;
      }
    }

    // 3. Spoiler ||...||
    if (depth < MAX_INLINE_DEPTH && ch === '|' && text[i + 1] === '|') {
      const closeIdx = findClosingSpoiler(text, i + 2);
      if (closeIdx !== -1) {
        const inner = text.slice(i + 2, closeIdx);
        tokens.push({
          type: 'spoiler',
          children: parseInlineTokens(inner, depth + 1),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // 4. Bold (*), Italic (_), Strikethrough (~)
    if (
      depth < MAX_INLINE_DEPTH &&
      (ch === '*' || ch === '_' || ch === '~')
    ) {
      const prev = i > 0 ? text[i - 1] : '';
      const next = i + 1 < text.length ? text[i + 1] : '';
      if (!isWordChar(prev) && next !== '' && !/\s/.test(next) && next !== ch) {
        const closeIdx = findClosingDelimiter(text, i + 1, ch);
        if (closeIdx > i + 1) {
          const inner = text.slice(i + 1, closeIdx);
          const children = parseInlineTokens(inner, depth + 1);
          if (ch === '*') {
            tokens.push({ type: 'bold', children });
          } else if (ch === '_') {
            tokens.push({ type: 'italic', children });
          } else {
            tokens.push({ type: 'strike', children });
          }
          i = closeIdx + 1;
          continue;
        }
      }
    }

    pushTextToken(tokens, ch);
    i += 1;
  }

  return tokens;
}

const QUOTE_START_RE = /^>\s+(.*)$/;
const QUOTE_CONT_RE = /^>(?:\s+(.*))?$/;
const BULLET_RE = /^-\s+(.+)$/;
const NUMBERED_RE = /^(\d{1,4})\.\s+(.+)$/;
const LANG_HINT_RE = /^[a-zA-Z0-9_+-]{1,20}$/;

function parseSegmentBlocks(segment: string): MessageBlock[] {
  if (!segment) return [];
  const lines = segment.split('\n');
  const blocks: MessageBlock[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];

    // Blockquote: > text
    const quoteStart = line.match(QUOTE_START_RE);
    if (quoteStart) {
      const quoteLines: InlineToken[][] = [parseInlineTokens(quoteStart[1])];
      idx += 1;
      while (idx < lines.length) {
        const cont = lines[idx].match(QUOTE_CONT_RE);
        if (!cont) break;
        quoteLines.push(parseInlineTokens(cont[1] ?? ''));
        idx += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // Bullet list: - text
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      const items: InlineToken[][] = [parseInlineTokens(bulletMatch[1])];
      idx += 1;
      while (idx < lines.length) {
        const nextBullet = lines[idx].match(BULLET_RE);
        if (!nextBullet) break;
        items.push(parseInlineTokens(nextBullet[1]));
        idx += 1;
      }
      blocks.push({ type: 'bullet_list', items });
      continue;
    }

    // Numbered list: 1. text
    const numMatch = line.match(NUMBERED_RE);
    if (numMatch) {
      const items: { marker: string; tokens: InlineToken[] }[] = [
        { marker: numMatch[1], tokens: parseInlineTokens(numMatch[2]) },
      ];
      idx += 1;
      while (idx < lines.length) {
        const nextNum = lines[idx].match(NUMBERED_RE);
        if (!nextNum) break;
        items.push({
          marker: nextNum[1],
          tokens: parseInlineTokens(nextNum[2]),
        });
        idx += 1;
      }
      blocks.push({ type: 'numbered_list', items });
      continue;
    }

    // Regular paragraph lines
    const paraLines: InlineToken[][] = [];
    while (idx < lines.length) {
      const cur = lines[idx];
      if (
        QUOTE_START_RE.test(cur) ||
        BULLET_RE.test(cur) ||
        NUMBERED_RE.test(cur)
      ) {
        break;
      }
      paraLines.push(parseInlineTokens(cur));
      idx += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paraLines });
    }
  }

  return blocks;
}

export function parseMessageBlocks(raw: string): MessageBlock[] {
  if (!raw) return [];
  const text = normalizeNewlines(raw);
  const segments: Array<
    | { kind: 'text'; value: string }
    | { kind: 'code_block'; code: string; language?: string }
  > = [];

  let cursor = 0;
  while (cursor < text.length) {
    const openIdx = text.indexOf('```', cursor);
    if (openIdx === -1) {
      segments.push({ kind: 'text', value: text.slice(cursor) });
      break;
    }

    const closeIdx = text.indexOf('```', openIdx + 3);
    if (closeIdx === -1) {
      segments.push({ kind: 'text', value: text.slice(cursor) });
      break;
    }

    let beforeText = text.slice(cursor, openIdx);
    // Avoid an empty trailing line right before a fenced code block
    if (beforeText.endsWith('\n')) {
      beforeText = beforeText.slice(0, -1);
    }
    if (beforeText) {
      segments.push({ kind: 'text', value: beforeText });
    }

    const inner = text.slice(openIdx + 3, closeIdx);
    let language: string | undefined;
    let code = inner;

    const firstNl = inner.indexOf('\n');
    if (firstNl !== -1) {
      const firstLine = inner.slice(0, firstNl).trim();
      if (firstLine && LANG_HINT_RE.test(firstLine)) {
        language = firstLine;
        code = inner.slice(firstNl + 1);
      } else if (firstLine === '') {
        code = inner.slice(firstNl + 1);
      }
      if (code.endsWith('\n')) {
        code = code.slice(0, -1);
      }
    }

    segments.push({ kind: 'code_block', code, language });

    cursor = closeIdx + 3;
    // Consume one immediate newline after closing fence to avoid extra blank paragraph line
    if (text[cursor] === '\n') {
      cursor += 1;
    }
  }

  const result: MessageBlock[] = [];
  for (const seg of segments) {
    if (seg.kind === 'code_block') {
      result.push({
        type: 'code_block',
        code: seg.code,
        language: seg.language,
      });
    } else {
      result.push(...parseSegmentBlocks(seg.value));
    }
  }

  return result;
}

/**
 * Flattens multi-block message content into a compact inline token stream
 * suitable for single-line / two-line previews (chat list, reply banner,
 * pinned message bar, search snippets) while keeping spoilers concealed.
 */
export function buildPreviewTokens(raw: string): InlineToken[] {
  if (!raw) return [];
  const blocks = parseMessageBlocks(raw);
  const out: InlineToken[] = [];

  const appendSpace = () => {
    if (out.length > 0) {
      const last = out[out.length - 1];
      if (!(last.type === 'text' && last.text.endsWith(' '))) {
        pushTextToken(out, ' ');
      }
    }
  };

  for (const block of blocks) {
    if (block.type === 'code_block') {
      appendSpace();
      const singleLine = block.code.replace(/\s*\n\s*/g, ' ').trim();
      out.push({ type: 'code', text: singleLine || 'code' });
      continue;
    }

    if (block.type === 'blockquote') {
      for (const line of block.lines) {
        if (line.length === 0) continue;
        appendSpace();
        pushTextToken(out, '› ');
        out.push(...line);
      }
      continue;
    }

    if (block.type === 'bullet_list') {
      for (const item of block.items) {
        appendSpace();
        pushTextToken(out, '• ');
        out.push(...item);
      }
      continue;
    }

    if (block.type === 'numbered_list') {
      for (const item of block.items) {
        appendSpace();
        pushTextToken(out, `${item.marker}. `);
        out.push(...item.tokens);
      }
      continue;
    }

    if (block.type === 'paragraph') {
      for (const line of block.lines) {
        if (line.length === 0) continue;
        appendSpace();
        out.push(...line);
      }
    }
  }

  return out;
}
