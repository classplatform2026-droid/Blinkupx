import assert from 'node:assert/strict';
import {
  extractMentionHandles,
  extractMessageMentionHandles,
  serializeMessageMentions,
} from './server/services/mentionService.ts';
import {
  buildPreviewTokens,
  parseInlineTokens,
  parseMessageBlocks,
} from './src/utils/textFormatting.ts';
import {
  buildConversationMentionCandidates,
  filterMentionCandidates,
  findActiveMentionQuery,
  getValidMentionUsernameSet,
  resolveOptimisticMentions,
} from './src/utils/mentions.ts';
import type { Conversation } from './src/types/index.ts';

// 1. Backend handle extraction
assert.deepEqual(
  extractMentionHandles('Hello @Alice, check @blink and @everyone!'),
  ['alice', 'blink', 'everyone']
);

assert.deepEqual(
  extractMentionHandles('Email me at john.doe@example.com or `@skip_me` not @real_user.'),
  ['real_user']
);

assert.deepEqual(
  extractMentionHandles('```\nconst x = "@fenced_user";\n```\nPing @outside_user'),
  ['outside_user']
);

assert.deepEqual(
  extractMessageMentionHandles('Look at *@bob_12*', [{ caption: 'Also @charlie' }]),
  ['bob_12', 'charlie']
);

// 2. Frontend inline & preview token parsing
const tokens = parseInlineTokens('Hi *@alice*, ask @blink & @everyone. Mail a@b.com');
assert.equal(tokens.some((t) => t.type === 'bold' && t.children.some((c) => c.type === 'mention' && c.username === 'alice')), true);
assert.equal(tokens.some((t) => t.type === 'mention' && t.username === 'blink'), true);
assert.equal(tokens.some((t) => t.type === 'mention' && t.username === 'everyone'), true);
assert.equal(tokens.some((t) => t.type === 'mention' && t.username === 'b'), false);

const blocks = parseMessageBlocks('```ts\nconst m = "@in_code";\n```\nHello @rahim');
assert.equal(blocks[0]?.type, 'code_block');
assert.equal(
  blocks[1]?.type === 'paragraph' &&
    blocks[1].lines[0]?.some((t) => t.type === 'mention' && t.username === 'rahim'),
  true
);

const preview = buildPreviewTokens('> Reply to @alice about @everyone');
assert.equal(preview.some((t) => t.type === 'mention' && t.username === 'alice'), true);
assert.equal(preview.some((t) => t.type === 'mention' && t.username === 'everyone'), true);

// 3. Active @query detection
assert.deepEqual(findActiveMentionQuery('Hey @al', 7), {
  query: 'al',
  start: 4,
  end: 7,
});
assert.deepEqual(findActiveMentionQuery('@', 1), {
  query: '',
  start: 0,
  end: 1,
});
assert.equal(findActiveMentionQuery('email@al', 8), null);
assert.equal(findActiveMentionQuery('`@al', 4), null);
assert.equal(findActiveMentionQuery('```code @al```', 11), null);

// 4. Conversation candidate generation & non-member / direct chat rules
const baseUser = (id: string, username: string, fullName: string, onlineStatus = false) => ({
  id,
  username,
  fullName,
  avatar: '',
  bio: '',
  onlineStatus,
  lastSeen: null,
});

const directConv: Conversation = {
  id: 'c1',
  type: 'direct',
  name: 'Alice',
  username: 'alice',
  avatar: '',
  onlineStatus: true,
  lastSeen: null,
  communityId: null,
  participants: [
    { userId: 'u1', role: 'member', lastReadAt: '', user: baseUser('u1', 'me_user', 'Me User', true) },
    { userId: 'u2', role: 'member', lastReadAt: '', user: baseUser('u2', 'alice', 'Alice Rahman', true) },
  ],
  lastMessage: null,
  pinnedMessage: null,
  unreadCount: 0,
  isPinned: false,
  pinnedAt: null,
  isMuted: false,
  mutedUntil: null,
  isArchived: false,
  updatedAt: '',
  createdAt: '',
};

const directCandidates = buildConversationMentionCandidates({
  conversation: directConv,
  currentUserId: 'u1',
});
assert.equal(directCandidates.some((c) => c.username === 'everyone'), false, 'No @everyone in direct chats');
assert.equal(directCandidates.some((c) => c.username === 'me_user'), false, 'Exclude self from suggestions');
assert.equal(directCandidates.some((c) => c.username === 'alice'), true);
assert.equal(directCandidates.some((c) => c.username === 'blink'), true);

const groupConv: Conversation = {
  ...directConv,
  id: 'c2',
  type: 'community',
  name: 'Devs',
  participants: [
    ...directConv.participants,
    { userId: 'u3', role: 'admin', lastReadAt: '', user: baseUser('u3', 'karim_dev', 'Karim Hossain', false) },
  ],
};

const groupCandidates = buildConversationMentionCandidates({
  conversation: groupConv,
  currentUserId: 'u1',
  canMentionEveryone: true,
});
assert.equal(groupCandidates.some((c) => c.username === 'everyone'), true);
assert.deepEqual(
  filterMentionCandidates(groupCandidates, 'kar').map((c) => c.username),
  ['karim_dev']
);
assert.deepEqual(
  filterMentionCandidates(groupCandidates, 'bli').map((c) => c.username),
  ['blink']
);

const directSet = getValidMentionUsernameSet(directConv, 'me_user', true);
assert.equal(directSet.has('everyone'), false);
assert.equal(directSet.has('alice'), true);
assert.equal(directSet.has('stranger'), false);

// 5. Optimistic mention resolution mirrors backend non-member protection
const directOptimistic = resolveOptimisticMentions(
  'Hi @alice, @everyone and @stranger plus @blink',
  directConv
);
assert.deepEqual(
  directOptimistic.map((m) => m.username),
  ['alice', 'blink']
);

const groupOptimistic = resolveOptimisticMentions(
  'Hi @everyone and @karim_dev and @stranger',
  groupConv
);
assert.deepEqual(
  groupOptimistic.map((m) => m.username),
  ['everyone', 'karim_dev']
);

const serialized = serializeMessageMentions([
  { type: 'user', userId: null, username: 'alice', fullName: 'Alice' },
  { type: 'everyone', userId: null, username: 'everyone', fullName: 'Everyone' },
]);
assert.equal(serialized.length, 2);

console.log('ALL MENTION VERIFICATION CHECKS PASSED');
