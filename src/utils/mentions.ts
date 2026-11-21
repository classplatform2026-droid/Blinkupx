import type { Conversation, MentionType, MessageMention } from '../types';

export interface MentionCandidate {
  key: string;
  type: MentionType;
  userId: string | null;
  username: string;
  fullName: string;
  avatar?: string;
  role?: 'owner' | 'admin' | 'moderator' | 'member';
  onlineStatus?: boolean;
  subtitle: string;
  memberCount?: number;
}

export interface ActiveMentionMatch {
  query: string;
  start: number;
  end: number;
}

const LEFT_DISALLOWED_RE = /[a-zA-Z0-9_.]/;
const HANDLE_CHAR_RE = /[a-zA-Z0-9_]/;

function maskCodeSegments(raw: string): string {
  if (!raw) return '';
  const chars = raw.split('');
  let i = 0;

  while (i < chars.length) {
    if (chars[i] === '`' && chars[i + 1] === '`' && chars[i + 2] === '`') {
      const closeIdx = raw.indexOf('```', i + 3);
      if (closeIdx !== -1) {
        for (let k = i; k < closeIdx + 3; k++) {
          if (chars[k] !== '\n') chars[k] = ' ';
        }
        i = closeIdx + 3;
        continue;
      }
    }

    if (chars[i] === '`') {
      let closeIdx = -1;
      for (let k = i + 1; k < raw.length; k++) {
        if (raw[k] === '\n') break;
        if (raw[k] === '`') {
          closeIdx = k;
          break;
        }
      }
      if (closeIdx > i + 1) {
        for (let k = i; k <= closeIdx; k++) {
          chars[k] = ' ';
        }
        i = closeIdx + 1;
        continue;
      }
    }

    i += 1;
  }

  return chars.join('');
}

export function extractMentionHandles(rawText: string | null | undefined): string[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const masked = maskCodeSegments(rawText);
  const handles: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '@') continue;
    const prev = i > 0 ? masked[i - 1] : '';
    if (prev && LEFT_DISALLOWED_RE.test(prev)) {
      continue;
    }

    let j = i + 1;
    while (j < masked.length && HANDLE_CHAR_RE.test(masked[j])) {
      j += 1;
    }

    const len = j - (i + 1);
    if (len < 3 || len > 24) {
      continue;
    }

    const next = j < masked.length ? masked[j] : '';
    const afterNext = j + 1 < masked.length ? masked[j + 1] : '';
    if (next === '.' && afterNext && HANDLE_CHAR_RE.test(afterNext)) {
      continue;
    }

    const handle = masked.slice(i + 1, j).toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      handles.push(handle);
    }
    i = j - 1;
  }

  return handles;
}

export function buildConversationMentionCandidates(params: {
  conversation?: Conversation | null;
  currentUserId?: string;
  canMentionEveryone?: boolean;
}): MentionCandidate[] {
  const { conversation, currentUserId, canMentionEveryone = true } = params;
  if (!conversation) return [];

  const candidates: MentionCandidate[] = [];
  const isGroupLike =
    conversation.type === 'group' || conversation.type === 'community';

  if (isGroupLike && canMentionEveryone) {
    const memberCount = conversation.participants.length;
    candidates.push({
      key: 'everyone',
      type: 'everyone',
      userId: null,
      username: 'everyone',
      fullName: 'Everyone',
      memberCount,
      subtitle: `Notify all ${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
    });
  }

  candidates.push({
    key: 'ai:blink',
    type: 'ai',
    userId: null,
    username: 'blink',
    fullName: 'Blink',
    subtitle: 'AI assistant in this conversation',
  });

  const rolePriority: Record<string, number> = {
    owner: 0,
    admin: 1,
    moderator: 2,
    member: 3,
  };

  const participantCandidates: MentionCandidate[] = [];
  const seenUsernames = new Set<string>(['everyone', 'blink']);

  for (const part of conversation.participants) {
    if (!part.user || !part.user.username) continue;
    if (currentUserId && part.userId === currentUserId) continue;
    const uname = part.user.username.toLowerCase();
    if (seenUsernames.has(uname)) continue;
    seenUsernames.add(uname);

    participantCandidates.push({
      key: `user:${part.userId}`,
      type: 'user',
      userId: part.userId,
      username: uname,
      fullName: part.user.fullName || uname,
      avatar: part.user.avatar,
      role: part.role,
      onlineStatus: Boolean(part.user.onlineStatus),
      subtitle: `@${uname}`,
    });
  }

  participantCandidates.sort((a, b) => {
    const onlineDiff = Number(Boolean(b.onlineStatus)) - Number(Boolean(a.onlineStatus));
    if (onlineDiff !== 0) return onlineDiff;
    const roleDiff =
      (rolePriority[a.role || 'member'] ?? 3) -
      (rolePriority[b.role || 'member'] ?? 3);
    if (roleDiff !== 0) return roleDiff;
    return a.fullName.localeCompare(b.fullName);
  });

  return [...candidates, ...participantCandidates];
}

export function findActiveMentionQuery(
  rawText: string,
  cursorOffset: number
): ActiveMentionMatch | null {
  if (typeof rawText !== 'string') return null;
  const pos = Math.max(0, Math.min(cursorOffset, rawText.length));
  if (pos === 0) return null;

  const masked = maskCodeSegments(rawText);
  // If cursor sits inside a masked code segment, do not open mention suggestions
  if (rawText[pos - 1] !== ' ' && masked[pos - 1] === ' ') {
    return null;
  }

  let start = pos;
  while (start > 0 && HANDLE_CHAR_RE.test(masked[start - 1])) {
    start -= 1;
  }

  if (start === 0 || masked[start - 1] !== '@') {
    return null;
  }

  const atIndex = start - 1;
  const charBeforeAt = atIndex > 0 ? masked[atIndex - 1] : '';
  if (charBeforeAt && LEFT_DISALLOWED_RE.test(charBeforeAt)) {
    return null;
  }

  const query = masked.slice(start, pos);
  if (query.length > 24) return null;

  return {
    query: query.toLowerCase(),
    start: atIndex,
    end: pos,
  };
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;

  const scored: Array<{ candidate: MentionCandidate; score: number }> = [];
  for (const candidate of candidates) {
    const uname = candidate.username.toLowerCase();
    const fname = candidate.fullName.toLowerCase();

    if (uname === q) {
      scored.push({ candidate, score: 0 });
    } else if (uname.startsWith(q)) {
      scored.push({ candidate, score: 1 });
    } else if (fname.split(/\s+/).some((word) => word.startsWith(q))) {
      scored.push({ candidate, score: 2 });
    } else if (uname.includes(q) || fname.includes(q)) {
      scored.push({ candidate, score: 3 });
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.candidate.fullName.localeCompare(b.candidate.fullName);
  });

  return scored.map((entry) => entry.candidate);
}

export function resolveOptimisticMentions(
  content: string,
  conversation?: Conversation | null,
  attachments?: Array<{ caption?: string }>
): MessageMention[] {
  const handles: string[] = [];
  const seen = new Set<string>();

  const pushAll = (items: string[]) => {
    for (const h of items) {
      if (!seen.has(h)) {
        seen.add(h);
        handles.push(h);
      }
    }
  };

  pushAll(extractMentionHandles(content));
  if (attachments) {
    for (const att of attachments) {
      if (att.caption) pushAll(extractMentionHandles(att.caption));
    }
  }

  if (handles.length === 0) return [];

  const isGroupLike =
    conversation?.type === 'group' || conversation?.type === 'community';
  const memberByUsername = new Map<
    string,
    { userId: string; username: string; fullName: string }
  >();

  if (conversation) {
    for (const part of conversation.participants) {
      if (part.user?.username) {
        const uname = part.user.username.toLowerCase();
        memberByUsername.set(uname, {
          userId: part.userId,
          username: uname,
          fullName: part.user.fullName || uname,
        });
      }
    }
  }

  const out: MessageMention[] = [];
  for (const handle of handles) {
    if (handle === 'blink') {
      out.push({
        type: 'ai',
        userId: null,
        username: 'blink',
        fullName: 'Blink',
      });
      continue;
    }

    if (handle === 'everyone') {
      if (isGroupLike) {
        out.push({
          type: 'everyone',
          userId: null,
          username: 'everyone',
          fullName: 'Everyone',
        });
      }
      continue;
    }

    const member = memberByUsername.get(handle);
    if (member) {
      out.push({
        type: 'user',
        userId: member.userId,
        username: member.username,
        fullName: member.fullName,
      });
    }
  }

  return out;
}

export function getValidMentionUsernameSet(
  conversation?: Conversation | null,
  currentUsername?: string,
  canMentionEveryone = true
): Set<string> {
  const set = new Set<string>(['blink']);
  if (currentUsername) {
    set.add(currentUsername.toLowerCase());
  }
  if (!conversation) return set;

  if (
    (conversation.type === 'group' || conversation.type === 'community') &&
    canMentionEveryone
  ) {
    set.add('everyone');
  }

  for (const part of conversation.participants) {
    if (part.user?.username) {
      set.add(part.user.username.toLowerCase());
    }
  }

  return set;
}
