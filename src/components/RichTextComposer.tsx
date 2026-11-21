import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  findActiveMentionQuery,
  type ActiveMentionMatch,
} from '../utils/mentions';
import {
  parseMessageBlocks,
  type InlineToken,
  type MessageBlock,
} from '../utils/textFormatting';

export interface RichTextComposerHandle {
  focus: () => void;
  insertText: (snippet: string) => void;
  replaceRange: (start: number, end: number, replacement: string) => void;
}

interface RichTextComposerProps {
  value: string;
  onChange: (nextValue: string) => void;
  onSubmit: () => void;
  onPasteFiles?: (files: File[]) => void;
  enterToSend?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  validMentionUsernames?: Set<string>;
  onActiveMentionChange?: (match: ActiveMentionMatch | null) => void;
  onDropdownKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => boolean;
}

type VisualBlock =
  | { kind: 'line'; tokens: InlineToken[] }
  | { kind: 'blockquote'; tokens: InlineToken[] }
  | { kind: 'bullet'; tokens: InlineToken[] }
  | { kind: 'numbered'; marker: string; tokens: InlineToken[] }
  | { kind: 'code_block'; code: string; language?: string; multiline: boolean };

interface ExitBoundaryState {
  rawText: string;
  exitOffset: number;
  domNode: Text;
  domOffset: number;
}

const FMT_DELIMS: Record<string, { open: string; close: string }> = {
  bold: { open: '*', close: '*' },
  italic: { open: '_', close: '_' },
  strike: { open: '~', close: '~' },
  code: { open: '`', close: '`' },
  spoiler: { open: '||', close: '||' },
};

function expandBlocksToVisualLines(
  blocks: MessageBlock[],
  rawText: string
): VisualBlock[] {
  if (!rawText || blocks.length === 0) {
    return [{ kind: 'line', tokens: [] }];
  }

  const lines: VisualBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      for (const lineTokens of block.lines) {
        lines.push({ kind: 'line', tokens: lineTokens });
      }
    } else if (block.type === 'blockquote') {
      for (const lineTokens of block.lines) {
        lines.push({ kind: 'blockquote', tokens: lineTokens });
      }
    } else if (block.type === 'bullet_list') {
      for (const itemTokens of block.items) {
        lines.push({ kind: 'bullet', tokens: itemTokens });
      }
    } else if (block.type === 'numbered_list') {
      for (const item of block.items) {
        lines.push({
          kind: 'numbered',
          marker: item.marker,
          tokens: item.tokens,
        });
      }
    } else if (block.type === 'code_block') {
      lines.push({
        kind: 'code_block',
        code: block.code,
        language: block.language,
        multiline: block.code.includes('\n') || Boolean(block.language),
      });
    }
  }

  return lines.length > 0 ? lines : [{ kind: 'line', tokens: [] }];
}

function getBlockPrefixSuffix(el: Element): { prefix: string; suffix: string } {
  const blockKind = el.getAttribute('data-block');
  if (blockKind === 'blockquote') return { prefix: '> ', suffix: '' };
  if (blockKind === 'bullet') return { prefix: '- ', suffix: '' };
  if (blockKind === 'numbered') {
    const marker = el.getAttribute('data-marker') || '1';
    return { prefix: `${marker}. `, suffix: '' };
  }
  if (blockKind === 'code_block') {
    const lang = el.getAttribute('data-lang') || '';
    const multiline = el.getAttribute('data-multiline') === '1';
    if (multiline) {
      return { prefix: `\`\`\`${lang}\n`, suffix: '\n```' };
    }
    return { prefix: '```', suffix: '```' };
  }
  return { prefix: '', suffix: '' };
}

function isBlockElement(node: Node): node is HTMLElement {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;
  if (el.hasAttribute('data-block')) return true;
  const tag = el.tagName;
  return tag === 'DIV' || tag === 'P' || tag === 'PRE' || tag === 'BLOCKQUOTE';
}

function inspectEditorDom(root: HTMLElement): {
  raw: string;
  startOffset: number | null;
  endOffset: number | null;
} {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const hasSel = Boolean(
    sel &&
      sel.rangeCount > 0 &&
      sel.anchorNode &&
      root.contains(sel.anchorNode) &&
      sel.focusNode &&
      root.contains(sel.focusNode)
  );
  const anchorNode = hasSel ? sel!.anchorNode : null;
  const anchorOffset = hasSel ? sel!.anchorOffset : 0;
  const focusNode = hasSel ? sel!.focusNode : null;
  const focusOffset = hasSel ? sel!.focusOffset : 0;

  let raw = '';
  let startOffset: number | null = null;
  let endOffset: number | null = null;

  const markElementSlot = (el: Node, childIdx: number) => {
    if (!hasSel) return;
    if (el === anchorNode && anchorOffset === childIdx && startOffset === null) {
      startOffset = raw.length;
    }
    if (el === focusNode && focusOffset === childIdx && endOffset === null) {
      endOffset = raw.length;
    }
  };

  const walkInline = (node: Node, allowBrNewline = true) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue || '';
      if (hasSel) {
        if (node === anchorNode && startOffset === null) {
          startOffset = raw.length + Math.min(anchorOffset, val.length);
        }
        if (node === focusNode && endOffset === null) {
          endOffset = raw.length + Math.min(focusOffset, val.length);
        }
      }
      raw += val;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.tagName === 'BR') {
      if (allowBrNewline) {
        raw += '\n';
      }
      return;
    }

    const fmt = el.getAttribute('data-fmt');
    if (fmt && fmt !== 'link' && FMT_DELIMS[fmt]) {
      const innerText = el.textContent || '';
      if (innerText.length === 0) {
        // Empty wrapper should not emit dangling delimiters like **
        for (let i = 0; i <= el.childNodes.length; i++) {
          markElementSlot(el, i);
        }
        return;
      }

      if (fmt === 'code') {
        raw += FMT_DELIMS.code.open;
        for (let i = 0; i < el.childNodes.length; i++) {
          markElementSlot(el, i);
          const child = el.childNodes[i];
          if (child.nodeType === Node.TEXT_NODE) {
            const val = child.nodeValue || '';
            if (hasSel) {
              if (child === anchorNode && startOffset === null) {
                startOffset = raw.length + Math.min(anchorOffset, val.length);
              }
              if (child === focusNode && endOffset === null) {
                endOffset = raw.length + Math.min(focusOffset, val.length);
              }
            }
            raw += val;
          } else {
            raw += child.textContent || '';
          }
        }
        markElementSlot(el, el.childNodes.length);
        raw += FMT_DELIMS.code.close;
        return;
      }

      raw += FMT_DELIMS[fmt].open;
      for (let i = 0; i < el.childNodes.length; i++) {
        markElementSlot(el, i);
        walkInline(el.childNodes[i], allowBrNewline);
      }
      markElementSlot(el, el.childNodes.length);
      raw += FMT_DELIMS[fmt].close;
      return;
    }

    for (let i = 0; i < el.childNodes.length; i++) {
      markElementSlot(el, i);
      walkInline(el.childNodes[i], allowBrNewline);
    }
    markElementSlot(el, el.childNodes.length);
  };

  // Root traversal: support block elements or loose top-level nodes
  const children = Array.from(root.childNodes);
  if (children.length === 0) {
    markElementSlot(root, 0);
    return { raw: '', startOffset, endOffset };
  }

  let hasEmittedBlock = false;
  for (let i = 0; i < children.length; i++) {
    markElementSlot(root, i);
    const child = children[i];
    if (isBlockElement(child)) {
      if (hasEmittedBlock) {
        raw += '\n';
      }
      hasEmittedBlock = true;
      const { prefix, suffix } = getBlockPrefixSuffix(child);
      raw += prefix;

      if (child.getAttribute('data-block') === 'code_block') {
        const codeText = child.textContent || '';
        // Map caret directly inside code block text
        const walkCode = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const val = node.nodeValue || '';
            if (hasSel) {
              if (node === anchorNode && startOffset === null) {
                startOffset = raw.length + Math.min(anchorOffset, val.length);
              }
              if (node === focusNode && endOffset === null) {
                endOffset = raw.length + Math.min(focusOffset, val.length);
              }
            }
            raw += val;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.tagName === 'BR') {
              if (el !== child.lastChild) raw += '\n';
              return;
            }
            for (let k = 0; k < el.childNodes.length; k++) {
              markElementSlot(el, k);
              walkCode(el.childNodes[k]);
            }
            markElementSlot(el, el.childNodes.length);
          }
        };
        if (codeText.length === 0) {
          markElementSlot(child, 0);
        } else {
          for (let k = 0; k < child.childNodes.length; k++) {
            markElementSlot(child, k);
            walkCode(child.childNodes[k]);
          }
          markElementSlot(child, child.childNodes.length);
        }
        raw += suffix;
      } else {
        const innerNodes = Array.from(child.childNodes);
        const isOnlyPlaceholderBr =
          innerNodes.length === 1 &&
          innerNodes[0].nodeType === Node.ELEMENT_NODE &&
          (innerNodes[0] as HTMLElement).tagName === 'BR';

        if (isOnlyPlaceholderBr) {
          markElementSlot(child, 0);
          markElementSlot(child, 1);
        } else {
          for (let k = 0; k < innerNodes.length; k++) {
            markElementSlot(child, k);
            const inner = innerNodes[k];
            const isTrailingPlaceholder =
              k === innerNodes.length - 1 &&
              inner.nodeType === Node.ELEMENT_NODE &&
              (inner as HTMLElement).tagName === 'BR';
            walkInline(inner, !isTrailingPlaceholder);
          }
          markElementSlot(child, innerNodes.length);
        }
      }
    } else {
      if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === 'BR') {
        if (i < children.length - 1) {
          raw += '\n';
        }
      } else {
        walkInline(child, true);
      }
    }
  }
  markElementSlot(root, children.length);

  return { raw, startOffset, endOffset };
}

function getInlineTextConcat(tokens: InlineToken[]): string {
  return tokens
    .map((t) =>
      t.type === 'text' ||
      t.type === 'link' ||
      t.type === 'code' ||
      t.type === 'mention'
        ? t.text
        : getInlineTextConcat(t.children)
    )
    .join('');
}

function isMentionHighlightActive(
  username: string,
  validMentionUsernames?: Set<string>
): boolean {
  if (validMentionUsernames) {
    return validMentionUsernames.has(username.toLowerCase());
  }
  return username === 'blink' || username === 'everyone';
}

function inlineChildrenMatch(
  domNodes: Node[],
  tokens: InlineToken[],
  validMentionUsernames?: Set<string>
): boolean {
  let tokenIdx = 0;
  let nodeIdx = 0;

  while (nodeIdx < domNodes.length || tokenIdx < tokens.length) {
    // Skip empty text nodes or trailing placeholder <br>
    while (nodeIdx < domNodes.length) {
      const n = domNodes[nodeIdx];
      if (n.nodeType === Node.TEXT_NODE && (n.nodeValue || '') === '') {
        nodeIdx += 1;
        continue;
      }
      if (
        tokens.length === 0 &&
        domNodes.length === 1 &&
        n.nodeType === Node.ELEMENT_NODE &&
        (n as HTMLElement).tagName === 'BR'
      ) {
        return true;
      }
      break;
    }

    if (nodeIdx >= domNodes.length && tokenIdx >= tokens.length) {
      return true;
    }
    if (nodeIdx >= domNodes.length || tokenIdx >= tokens.length) {
      return false;
    }

    const tok = tokens[tokenIdx];
    const node = domNodes[nodeIdx];

    if (tok.type === 'text') {
      let combined = '';
      while (
        nodeIdx < domNodes.length &&
        domNodes[nodeIdx].nodeType === Node.TEXT_NODE
      ) {
        combined += domNodes[nodeIdx].nodeValue || '';
        nodeIdx += 1;
      }
      if (combined !== tok.text) return false;
      tokenIdx += 1;
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    const fmt = el.getAttribute('data-fmt');
    if (fmt !== tok.type) return false;

    if (tok.type === 'mention') {
      const expectedActive = isMentionHighlightActive(
        tok.username,
        validMentionUsernames
      )
        ? '1'
        : '0';
      if (
        el.getAttribute('data-username') === tok.username &&
        el.getAttribute('data-active') === expectedActive &&
        el.childNodes.length === 1 &&
        el.childNodes[0].nodeType === Node.TEXT_NODE &&
        (el.childNodes[0].nodeValue || '') === tok.text
      ) {
        nodeIdx += 1;
        tokenIdx += 1;
        continue;
      }
      return false;
    }

    if (tok.type === 'link' || tok.type === 'code') {
      if (
        el.childNodes.length === 1 &&
        el.childNodes[0].nodeType === Node.TEXT_NODE &&
        (el.childNodes[0].nodeValue || '') === tok.text
      ) {
        nodeIdx += 1;
        tokenIdx += 1;
        continue;
      }
      return false;
    }

    if (
      !inlineChildrenMatch(
        Array.from(el.childNodes),
        tok.children,
        validMentionUsernames
      )
    ) {
      return false;
    }
    nodeIdx += 1;
    tokenIdx += 1;
  }

  return true;
}

function doesDomMatchVisualLines(
  root: HTMLElement,
  visualLines: VisualBlock[],
  validMentionUsernames?: Set<string>
): boolean {
  const children = Array.from(root.childNodes);
  if (children.length !== visualLines.length) return false;

  for (let i = 0; i < visualLines.length; i++) {
    const child = children[i];
    if (child.nodeType !== Node.ELEMENT_NODE) return false;
    const el = child as HTMLElement;
    const expected = visualLines[i];
    if (el.getAttribute('data-block') !== expected.kind) return false;

    if (expected.kind === 'numbered') {
      if (el.getAttribute('data-marker') !== expected.marker) return false;
    }

    if (expected.kind === 'code_block') {
      const lang = el.getAttribute('data-lang') || '';
      const multiline = el.getAttribute('data-multiline') === '1';
      if (lang !== (expected.language || '')) return false;
      if (multiline !== expected.multiline) return false;
      if ((el.textContent || '') !== expected.code) return false;
      continue;
    }

    if (
      !inlineChildrenMatch(
        Array.from(el.childNodes),
        expected.tokens,
        validMentionUsernames
      )
    ) {
      return false;
    }
  }

  return true;
}

function createInlineDomNode(
  token: InlineToken,
  validMentionUsernames?: Set<string>
): Node {
  switch (token.type) {
    case 'text':
      return document.createTextNode(token.text);

    case 'link': {
      const span = document.createElement('span');
      span.setAttribute('data-fmt', 'link');
      span.className = 'underline underline-offset-2 text-[#FFFFFF]';
      span.textContent = token.text;
      return span;
    }

    case 'mention': {
      const isActive = isMentionHighlightActive(
        token.username,
        validMentionUsernames
      );
      const span = document.createElement('span');
      span.setAttribute('data-fmt', 'mention');
      span.setAttribute('data-username', token.username);
      span.setAttribute('data-active', isActive ? '1' : '0');
      if (isActive) {
        span.className =
          token.username === 'blink'
            ? 'font-semibold text-[#A3E635] bg-[#A3E635]/15 rounded px-0.5'
            : token.username === 'everyone'
              ? 'font-semibold text-[#FCD34D] bg-[#F59E0B]/15 rounded px-0.5'
              : 'font-semibold text-[#93C5FD] bg-[#60A5FA]/15 rounded px-0.5';
      }
      span.textContent = token.text;
      return span;
    }

    case 'code': {
      const code = document.createElement('code');
      code.setAttribute('data-fmt', 'code');
      code.className =
        'font-mono text-[0.86em] px-1.5 py-0.5 rounded bg-[#181818] text-[#F3F4F6] border border-[#383838]';
      code.textContent = token.text;
      return code;
    }

    case 'bold': {
      const strong = document.createElement('strong');
      strong.setAttribute('data-fmt', 'bold');
      strong.className = 'font-bold text-[#FFFFFF]';
      for (const child of token.children) {
        strong.appendChild(createInlineDomNode(child, validMentionUsernames));
      }
      return strong;
    }

    case 'italic': {
      const em = document.createElement('em');
      em.setAttribute('data-fmt', 'italic');
      em.className = 'italic';
      for (const child of token.children) {
        em.appendChild(createInlineDomNode(child, validMentionUsernames));
      }
      return em;
    }

    case 'strike': {
      const s = document.createElement('s');
      s.setAttribute('data-fmt', 'strike');
      s.className = 'line-through opacity-80';
      for (const child of token.children) {
        s.appendChild(createInlineDomNode(child, validMentionUsernames));
      }
      return s;
    }

    case 'spoiler': {
      const span = document.createElement('span');
      span.setAttribute('data-fmt', 'spoiler');
      span.setAttribute('title', 'Spoiler');
      span.className =
        'rounded px-1 py-0.5 bg-[#3A3A3A] text-[#E5E5E5] border border-dashed border-[#555555]';
      for (const child of token.children) {
        span.appendChild(createInlineDomNode(child, validMentionUsernames));
      }
      return span;
    }
  }
}

function renderVisualLinesIntoRoot(
  root: HTMLElement,
  visualLines: VisualBlock[],
  validMentionUsernames?: Set<string>
) {
  const frag = document.createDocumentFragment();

  for (const line of visualLines) {
    if (line.kind === 'code_block') {
      const pre = document.createElement('pre');
      pre.setAttribute('data-block', 'code_block');
      pre.setAttribute('data-lang', line.language || '');
      pre.setAttribute('data-multiline', line.multiline ? '1' : '0');
      pre.className =
        'my-0.5 px-2.5 py-1.5 rounded-lg bg-[#181818] border border-[#383838] font-mono text-xs text-[#F3F4F6] overflow-x-auto whitespace-pre-wrap';
      if (line.code.length > 0) {
        pre.appendChild(document.createTextNode(line.code));
      } else {
        pre.appendChild(document.createElement('br'));
      }
      frag.appendChild(pre);
      continue;
    }

    const div = document.createElement('div');
    div.setAttribute('data-block', line.kind);

    if (line.kind === 'blockquote') {
      div.className =
        'min-h-[1.35em] my-0.5 pl-2.5 pr-1.5 py-0.5 border-l-2 border-[#FFFFFF]/45 bg-[#FFFFFF]/[0.06] text-[#EAEAEA] rounded-r-md';
    } else if (line.kind === 'bullet') {
      div.setAttribute('data-prefix', '• ');
      div.className =
        'min-h-[1.35em] pl-1 before:content-[attr(data-prefix)] before:opacity-75 before:select-none before:pointer-events-none before:mr-1';
    } else if (line.kind === 'numbered') {
      div.setAttribute('data-marker', line.marker);
      div.setAttribute('data-prefix', `${line.marker}. `);
      div.className =
        'min-h-[1.35em] pl-1 before:content-[attr(data-prefix)] before:font-mono before:text-[0.88em] before:opacity-75 before:select-none before:pointer-events-none before:mr-1.5';
    } else {
      div.className = 'min-h-[1.35em]';
    }

    if (line.tokens.length === 0 || getInlineTextConcat(line.tokens) === '') {
      div.appendChild(document.createElement('br'));
    } else {
      for (const tok of line.tokens) {
        div.appendChild(createInlineDomNode(tok, validMentionUsernames));
      }
    }

    frag.appendChild(div);
  }

  root.replaceChildren(frag);
}

function resolveDomPointFromSourceOffset(
  root: HTMLElement,
  targetOffset: number,
  rawText: string
): {
  node: Node;
  offset: number;
  exitBoundary: ExitBoundaryState | null;
} {
  const clamped = Math.max(0, Math.min(targetOffset, rawText.length));
  let pos = 0;
  let result: { node: Node; offset: number } | null = null;
  const candidateRef: {
    value: { textNode: Text; endOffset: number } | null;
  } = { value: null };

  const findInInline = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const len = (textNode.nodeValue || '').length;
      if (clamped >= pos && clamped <= pos + len) {
        result = { node: textNode, offset: clamped - pos };
        return true;
      }
      pos += len;
      return false;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    const fmt = el.getAttribute('data-fmt');
    if (fmt && fmt !== 'link' && FMT_DELIMS[fmt]) {
      const delims = FMT_DELIMS[fmt];
      pos += delims.open.length;
      for (const child of Array.from(el.childNodes)) {
        if (findInInline(child)) return true;
      }
      const lastText = findLastTextNode(el);
      pos += delims.close.length;
      if (clamped === pos && lastText) {
        candidateRef.value = {
          textNode: lastText,
          endOffset: (lastText.nodeValue || '').length,
        };
      }
      return false;
    }

    for (const child of Array.from(el.childNodes)) {
      if (findInInline(child)) return true;
    }
    return false;
  };

  const blocks = Array.from(root.childNodes);
  for (let b = 0; b < blocks.length; b++) {
    if (b > 0) {
      if (clamped === pos) {
        // End of previous block; handled at previous block exit
      }
      pos += 1; // newline between blocks
    }
    const blockEl = blocks[b] as HTMLElement;
    const { prefix, suffix } = getBlockPrefixSuffix(blockEl);
    pos += prefix.length;

    if (clamped <= pos) {
      const firstText = findFirstTextNode(blockEl);
      if (firstText) {
        result = { node: firstText, offset: 0 };
      } else {
        result = { node: blockEl, offset: 0 };
      }
      break;
    }

    const isEmptyLine =
      blockEl.childNodes.length === 1 &&
      blockEl.childNodes[0].nodeType === Node.ELEMENT_NODE &&
      (blockEl.childNodes[0] as HTMLElement).tagName === 'BR';

    if (!isEmptyLine) {
      if (blockEl.getAttribute('data-block') === 'code_block') {
        const textNode = findFirstTextNode(blockEl);
        const len = textNode ? (textNode.nodeValue || '').length : 0;
        if (textNode && clamped >= pos && clamped <= pos + len) {
          result = { node: textNode, offset: clamped - pos };
          break;
        }
        pos += len;
      } else {
        let found = false;
        for (const child of Array.from(blockEl.childNodes)) {
          if (findInInline(child)) {
            found = true;
            break;
          }
        }
        if (found) break;

        const candidate = candidateRef.value;
        if (candidate && clamped === pos) {
          result = {
            node: candidate.textNode,
            offset: candidate.endOffset,
          };
          return {
            node: result.node,
            offset: result.offset,
            exitBoundary: {
              rawText,
              exitOffset: clamped,
              domNode: candidate.textNode,
              domOffset: candidate.endOffset,
            },
          };
        }
      }
    }

    pos += suffix.length;
    if (clamped <= pos) {
      const lastText = findLastTextNode(blockEl);
      if (lastText) {
        result = {
          node: lastText,
          offset: (lastText.nodeValue || '').length,
        };
      } else {
        result = { node: blockEl, offset: 0 };
      }
      break;
    }
  }

  if (!result) {
    const lastText = findLastTextNode(root);
    if (lastText) {
      result = {
        node: lastText,
        offset: (lastText.nodeValue || '').length,
      };
    } else {
      result = { node: root, offset: root.childNodes.length };
    }
  }

  return { node: result.node, offset: result.offset, exitBoundary: null };
}

function findFirstTextNode(root: Node): Text | null {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) return child as Text;
    const nested = findFirstTextNode(child);
    if (nested) return nested;
  }
  return null;
}

function findLastTextNode(root: Node): Text | null {
  const children = Array.from(root.childNodes);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.nodeType === Node.TEXT_NODE) return child as Text;
    const nested = findLastTextNode(child);
    if (nested) return nested;
  }
  return null;
}

export const RichTextComposer = forwardRef<
  RichTextComposerHandle,
  RichTextComposerProps
>(function RichTextComposer(
  {
    value,
    onChange,
    onSubmit,
    onPasteFiles,
    enterToSend = true,
    placeholder = 'Write a message...',
    className = '',
    ariaLabel = 'Message input',
    validMentionUsernames,
    onActiveMentionChange,
    onDropdownKeyDown,
  },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const lastRenderedValueRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<{ start: number; end: number } | null>(null);
  const lastSelectionRef = useRef<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const exitBoundaryRef = useRef<ExitBoundaryState | null>(null);

  const applySelectionToDom = useCallback(
    (startOffset: number, endOffset: number, rawText: string) => {
      const root = editorRef.current;
      if (!root || typeof window === 'undefined') return;
      const sel = window.getSelection();
      if (!sel) return;

      const startResolved = resolveDomPointFromSourceOffset(
        root,
        startOffset,
        rawText
      );
      const endResolved =
        endOffset === startOffset
          ? startResolved
          : resolveDomPointFromSourceOffset(root, endOffset, rawText);

      const range = document.createRange();
      try {
        range.setStart(startResolved.node, startResolved.offset);
        range.setEnd(endResolved.node, endResolved.offset);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        // Ignore transient selection range mismatch
      }

      exitBoundaryRef.current =
        startOffset === endOffset ? startResolved.exitBoundary : null;
      lastSelectionRef.current = { start: startOffset, end: endOffset };
    },
    []
  );

  // Sync external or formatted value changes cleanly without fighting active DOM/IME
  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    if (isComposingRef.current) return;

    const blocks = parseMessageBlocks(value);
    const visualLines = expandBlocksToVisualLines(blocks, value);

    const domAlreadyMatches = doesDomMatchVisualLines(
      root,
      visualLines,
      validMentionUsernames
    );
    const isInitialRender = lastRenderedValueRef.current === null;

    if (!domAlreadyMatches || isInitialRender) {
      renderVisualLinesIntoRoot(root, visualLines, validMentionUsernames);

      const isFocused =
        typeof document !== 'undefined' && document.activeElement === root;
      const targetCaret = pendingCaretRef.current;
      pendingCaretRef.current = null;

      if (targetCaret && isFocused) {
        applySelectionToDom(targetCaret.start, targetCaret.end, value);
      } else if (isFocused) {
        applySelectionToDom(value.length, value.length, value);
      } else {
        lastSelectionRef.current = { start: value.length, end: value.length };
        exitBoundaryRef.current = null;
      }
    } else if (pendingCaretRef.current) {
      const targetCaret = pendingCaretRef.current;
      pendingCaretRef.current = null;
      if (typeof document !== 'undefined' && document.activeElement === root) {
        applySelectionToDom(targetCaret.start, targetCaret.end, value);
      }
    }

    lastRenderedValueRef.current = value;
  }, [value, validMentionUsernames, applySelectionToDom]);

  const commitChangeWithCaret = useCallback(
    (nextValue: string, caretStart: number, caretEnd = caretStart) => {
      pendingCaretRef.current = { start: caretStart, end: caretEnd };
      lastSelectionRef.current = { start: caretStart, end: caretEnd };
      onChange(nextValue);
    },
    [onChange]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const root = editorRef.current;
        if (!root) return;
        root.focus();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
          applySelectionToDom(value.length, value.length, value);
        }
      },
      insertText: (snippet: string) => {
        if (!snippet) return;
        const root = editorRef.current;
        let { start, end } = lastSelectionRef.current;
        if (
          root &&
          typeof document !== 'undefined' &&
          document.activeElement === root
        ) {
          const inspected = inspectEditorDom(root);
          if (inspected.startOffset !== null && inspected.endOffset !== null) {
            start = Math.min(inspected.startOffset, inspected.endOffset);
            end = Math.max(inspected.startOffset, inspected.endOffset);
          }
        } else {
          start = value.length;
          end = value.length;
        }
        const safeStart = Math.max(0, Math.min(start, value.length));
        const safeEnd = Math.max(safeStart, Math.min(end, value.length));
        const nextVal =
          value.slice(0, safeStart) + snippet + value.slice(safeEnd);
        const nextPos = safeStart + snippet.length;
        root?.focus();
        commitChangeWithCaret(nextVal, nextPos, nextPos);
        onActiveMentionChange?.(findActiveMentionQuery(nextVal, nextPos));
      },
      replaceRange: (start: number, end: number, replacement: string) => {
        const safeStart = Math.max(0, Math.min(start, value.length));
        const safeEnd = Math.max(safeStart, Math.min(end, value.length));
        const nextVal =
          value.slice(0, safeStart) + replacement + value.slice(safeEnd);
        const nextPos = safeStart + replacement.length;
        exitBoundaryRef.current = null;
        editorRef.current?.focus();
        commitChangeWithCaret(nextVal, nextPos, nextPos);
        onActiveMentionChange?.(findActiveMentionQuery(nextVal, nextPos));
      },
    }),
    [value, applySelectionToDom, commitChangeWithCaret, onActiveMentionChange]
  );

  const handleInput = () => {
    if (isComposingRef.current) return;
    const root = editorRef.current;
    if (!root) return;

    // If user just finished a closed inline format (e.g. *Hello*) and typed outside it
    const boundary = exitBoundaryRef.current;
    if (boundary && boundary.rawText === value) {
      const currentNodeText = boundary.domNode.nodeValue || '';
      if (
        boundary.domNode.isConnected &&
        currentNodeText.length > boundary.domOffset
      ) {
        const inserted = currentNodeText.slice(boundary.domOffset);
        exitBoundaryRef.current = null;
        const nextRaw =
          value.slice(0, boundary.exitOffset) +
          inserted +
          value.slice(boundary.exitOffset);
        const nextPos = boundary.exitOffset + inserted.length;
        // Force DOM sync to move inserted text outside the inline wrapper
        renderVisualLinesIntoRoot(
          root,
          expandBlocksToVisualLines(parseMessageBlocks(nextRaw), nextRaw),
          validMentionUsernames
        );
        applySelectionToDom(nextPos, nextPos, nextRaw);
        lastRenderedValueRef.current = nextRaw;
        onActiveMentionChange?.(findActiveMentionQuery(nextRaw, nextPos));
        onChange(nextRaw);
        return;
      }
      exitBoundaryRef.current = null;
    }

    const { raw, startOffset, endOffset } = inspectEditorDom(root);
    const caretStart =
      startOffset !== null && endOffset !== null
        ? Math.min(startOffset, endOffset)
        : raw.length;
    const caretEnd =
      startOffset !== null && endOffset !== null
        ? Math.max(startOffset, endOffset)
        : raw.length;

    const blocks = parseMessageBlocks(raw);
    const visualLines = expandBlocksToVisualLines(blocks, raw);

    if (!doesDomMatchVisualLines(root, visualLines, validMentionUsernames)) {
      pendingCaretRef.current = { start: caretStart, end: caretEnd };
    } else {
      // Check if caret just landed on an inline format exit boundary
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && caretStart === caretEnd) {
        const resolved = resolveDomPointFromSourceOffset(root, caretStart, raw);
        exitBoundaryRef.current = resolved.exitBoundary;
      } else {
        exitBoundaryRef.current = null;
      }
      lastSelectionRef.current = { start: caretStart, end: caretEnd };
      lastRenderedValueRef.current = raw;
    }

    onActiveMentionChange?.(
      caretStart === caretEnd ? findActiveMentionQuery(raw, caretStart) : null
    );

    if (raw !== value) {
      onChange(raw);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) return;
    const root = editorRef.current;
    if (!root) return;

    if (onDropdownKeyDown && onDropdownKeyDown(e)) {
      return;
    }

    if (e.key === 'Enter') {
      if (enterToSend && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
        return;
      }

      // Insert clean multiline newline (with natural list/quote continuation/exit)
      e.preventDefault();
      exitBoundaryRef.current = null;
      const { raw, startOffset, endOffset } = inspectEditorDom(root);
      const s =
        startOffset !== null && endOffset !== null
          ? Math.min(startOffset, endOffset)
          : raw.length;
      const end =
        startOffset !== null && endOffset !== null
          ? Math.max(startOffset, endOffset)
          : raw.length;

      const lineStart = raw.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
      const lineEndIdx = raw.indexOf('\n', end);
      const lineEnd = lineEndIdx === -1 ? raw.length : lineEndIdx;
      const currentLine = raw.slice(lineStart, lineEnd);

      let insertStr = '\n';
      if (s === end) {
        if (currentLine === '> ' && s === lineEnd) {
          // Exit empty blockquote
          const nextRaw = raw.slice(0, lineStart) + raw.slice(lineEnd);
          commitChangeWithCaret(nextRaw, lineStart, lineStart);
          return;
        }
        const bulletMatch = currentLine.match(/^-\s+(.*)$/);
        if (bulletMatch) {
          if (bulletMatch[1].trim() === '' && s === lineEnd) {
            const nextRaw = raw.slice(0, lineStart) + raw.slice(lineEnd);
            commitChangeWithCaret(nextRaw, lineStart, lineStart);
            return;
          }
          insertStr = '\n- ';
        } else {
          const numMatch = currentLine.match(/^(\d{1,4})\.\s+(.*)$/);
          if (numMatch) {
            if (numMatch[2].trim() === '' && s === lineEnd) {
              const nextRaw = raw.slice(0, lineStart) + raw.slice(lineEnd);
              commitChangeWithCaret(nextRaw, lineStart, lineStart);
              return;
            }
            insertStr = `\n${parseInt(numMatch[1], 10) + 1}. `;
          }
        }
      }

      const nextRaw = raw.slice(0, s) + insertStr + raw.slice(end);
      const nextCaret = s + insertStr.length;
      commitChangeWithCaret(nextRaw, nextCaret, nextCaret);
      return;
    }

    if (e.key === 'Backspace') {
      const { raw, startOffset, endOffset } = inspectEditorDom(root);
      if (startOffset !== null && endOffset !== null && startOffset === endOffset) {
        const lineStart = raw.lastIndexOf('\n', Math.max(0, startOffset - 1)) + 1;
        const lineEndIdx = raw.indexOf('\n', startOffset);
        const lineEnd = lineEndIdx === -1 ? raw.length : lineEndIdx;
        const currentLine = raw.slice(lineStart, lineEnd);

        let prefixLen = 0;
        if (currentLine.startsWith('> ')) {
          prefixLen = 2;
        } else if (currentLine.startsWith('- ') && currentLine.length > 2) {
          prefixLen = 2;
        } else {
          const numMatch = currentLine.match(/^(\d{1,4}\.\s+)/);
          if (numMatch && currentLine.length > numMatch[1].length) {
            prefixLen = numMatch[1].length;
          }
        }

        // Caret at visual column 0 inside a blockquote/list: unwrap prefix cleanly
        if (prefixLen > 0 && startOffset === lineStart + prefixLen) {
          e.preventDefault();
          exitBoundaryRef.current = null;
          const nextRaw =
            raw.slice(0, lineStart) + raw.slice(lineStart + prefixLen);
          commitChangeWithCaret(nextRaw, lineStart, lineStart);
          return;
        }
      }
    }

    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.key === 'PageUp' ||
      e.key === 'PageDown'
    ) {
      exitBoundaryRef.current = null;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboardFiles = Array.from(e.clipboardData?.files || []);
    if (clipboardFiles.length > 0 && onPasteFiles) {
      e.preventDefault();
      onPasteFiles(clipboardFiles);
      return;
    }

    const pastedText = e.clipboardData?.getData('text/plain');
    if (typeof pastedText !== 'string') return;
    e.preventDefault();
    exitBoundaryRef.current = null;

    const root = editorRef.current;
    if (!root) return;
    const normalized = pastedText.replace(/\r\n?/g, '\n');
    const { raw, startOffset, endOffset } = inspectEditorDom(root);
    const s =
      startOffset !== null && endOffset !== null
        ? Math.min(startOffset, endOffset)
        : raw.length;
    const end =
      startOffset !== null && endOffset !== null
        ? Math.max(startOffset, endOffset)
        : raw.length;

    const nextRaw = raw.slice(0, s) + normalized + raw.slice(end);
    const nextCaret = s + normalized.length;
    commitChangeWithCaret(nextRaw, nextCaret, nextCaret);
  };

  const updateSelectionSnapshot = () => {
    if (isComposingRef.current) return;
    const root = editorRef.current;
    if (!root || typeof document === 'undefined' || document.activeElement !== root) {
      return;
    }
    const { raw, startOffset, endOffset } = inspectEditorDom(root);
    if (startOffset !== null && endOffset !== null) {
      const s = Math.min(startOffset, endOffset);
      const e = Math.max(startOffset, endOffset);
      lastSelectionRef.current = { start: s, end: e };
      onActiveMentionChange?.(
        s === e ? findActiveMentionQuery(raw, s) : null
      );

      // Clear exit boundary if user navigated away from the exact exit point
      if (exitBoundaryRef.current) {
        const sel = window.getSelection();
        if (
          !sel ||
          sel.rangeCount === 0 ||
          s !== e ||
          sel.anchorNode !== exitBoundaryRef.current.domNode ||
          sel.anchorOffset !== exitBoundaryRef.current.domOffset
        ) {
          exitBoundaryRef.current = null;
        }
      }
    } else {
      lastSelectionRef.current = { start: raw.length, end: raw.length };
      exitBoundaryRef.current = null;
      onActiveMentionChange?.(null);
    }
  };

  return (
    <div className={`relative flex-1 min-w-0 ${className}`}>
      {value.length === 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none select-none absolute left-4 top-2.5 right-4 text-sm text-[#999999] truncate"
        >
          {placeholder}
        </span>
      )}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        enterKeyHint={enterToSend ? 'send' : 'enter'}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onMouseDown={() => {
          exitBoundaryRef.current = null;
        }}
        onKeyUp={updateSelectionSnapshot}
        onMouseUp={updateSelectionSnapshot}
        onFocus={updateSelectionSnapshot}
        onCompositionStart={() => {
          isComposingRef.current = true;
          exitBoundaryRef.current = null;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          handleInput();
        }}
        className="w-full min-h-[44px] max-h-32 overflow-y-auto rounded-xl bg-[#242424] border border-[#303030] px-4 py-2.5 text-sm leading-relaxed text-[#FFFFFF] focus:border-[#FFFFFF]/40 focus:outline-none break-words [overflow-wrap:anywhere]"
      />
    </div>
  );
});
