import { env } from '../../config/env.ts';

export type AiRequestStatus =
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'unavailable'
  | 'deduplicated';

export interface AiUsageLogEntry {
  requestId: string;
  userId: string;
  chatId: string;
  providerSlot: 'primary' | 'secondary' | 'none';
  model: string;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  failoverAttempts: number;
  failureCategory?: string | null;
  status: AiRequestStatus;
}

const userRequestTimestamps = new Map<string, number[]>();
const chatRequestTimestamps = new Map<string, number[]>();

// Maps `${conversationId}:${triggerMessageId}` -> timestamp (in-flight or finished)
const processedTriggerIds = new Map<string, number>();
const DEDUPE_TTL_MS = 10 * 60_000;
const MAX_DEDUPE_ENTRIES = 5000;

function pruneWindow(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

export function checkAndConsumeAiRateLimit(
  userId: string,
  chatId: string,
  overrides?: {
    userMax?: number;
    userWindowMs?: number;
    chatMax?: number;
    chatWindowMs?: number;
  }
): { allowed: boolean; scope?: 'user' | 'chat'; retryAfterMs?: number } {
  const now = Date.now();
  const userMax = overrides?.userMax ?? env.gemini.userRateLimitMax;
  const userWindowMs = overrides?.userWindowMs ?? env.gemini.userRateLimitWindowMs;
  const chatMax = overrides?.chatMax ?? env.gemini.chatRateLimitMax;
  const chatWindowMs = overrides?.chatWindowMs ?? env.gemini.chatRateLimitWindowMs;

  const userHistory = pruneWindow(userRequestTimestamps.get(userId) || [], userWindowMs, now);
  if (userHistory.length >= userMax) {
    userRequestTimestamps.set(userId, userHistory);
    const oldest = userHistory[0] || now;
    return {
      allowed: false,
      scope: 'user',
      retryAfterMs: Math.max(1000, oldest + userWindowMs - now),
    };
  }

  const chatHistory = pruneWindow(chatRequestTimestamps.get(chatId) || [], chatWindowMs, now);
  if (chatHistory.length >= chatMax) {
    chatRequestTimestamps.set(chatId, chatHistory);
    const oldest = chatHistory[0] || now;
    return {
      allowed: false,
      scope: 'chat',
      retryAfterMs: Math.max(1000, oldest + chatWindowMs - now),
    };
  }

  userHistory.push(now);
  chatHistory.push(now);
  userRequestTimestamps.set(userId, userHistory);
  chatRequestTimestamps.set(chatId, chatHistory);

  return { allowed: true };
}

export function claimTriggerDeduplication(
  conversationId: string,
  triggerMessageId: string
): boolean {
  const now = Date.now();
  const key = `${conversationId}:${triggerMessageId}`;
  const existingTs = processedTriggerIds.get(key);
  if (existingTs && now - existingTs < DEDUPE_TTL_MS) {
    return false;
  }

  processedTriggerIds.set(key, now);
  if (processedTriggerIds.size > MAX_DEDUPE_ENTRIES) {
    for (const [k, ts] of processedTriggerIds.entries()) {
      if (now - ts >= DEDUPE_TTL_MS || processedTriggerIds.size > MAX_DEDUPE_ENTRIES * 0.85) {
        processedTriggerIds.delete(k);
      }
      if (processedTriggerIds.size <= MAX_DEDUPE_ENTRIES * 0.85) break;
    }
  }
  return true;
}

export function logAiUsageEvent(entry: AiUsageLogEntry): void {
  const safePayload = {
    event: 'blink_ai_request',
    requestId: entry.requestId,
    userId: entry.userId,
    chatId: entry.chatId,
    providerSlot: entry.providerSlot,
    model: entry.model,
    latencyMs: Math.round(entry.latencyMs),
    inputTokens: typeof entry.inputTokens === 'number' ? entry.inputTokens : null,
    outputTokens: typeof entry.outputTokens === 'number' ? entry.outputTokens : null,
    failoverAttempts: entry.failoverAttempts,
    failureCategory: entry.failureCategory || null,
    status: entry.status,
    timestamp: new Date().toISOString(),
  };

  if (entry.status === 'failed' || entry.status === 'unavailable') {
    console.warn('[BlinkAI]', JSON.stringify(safePayload));
  } else {
    console.info('[BlinkAI]', JSON.stringify(safePayload));
  }
}

export function resetUsageTrackerStateForTest(): void {
  userRequestTimestamps.clear();
  chatRequestTimestamps.clear();
  processedTriggerIds.clear();
}
