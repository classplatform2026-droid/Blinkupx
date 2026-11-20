import { env } from '../../config/env.ts';
import type { GeminiErrorCategory } from './geminiProvider.ts';

export type ApiKeySlot = 'primary' | 'secondary';
export type CandidateHealthState = 'healthy' | 'degraded' | 'cooldown';

export interface ExecutionCandidate {
  id: string;
  keySlot: ApiKeySlot;
  apiKey: string;
  model: string;
  basePriority: number;
}

export interface SelectorConfigOverride {
  primaryApiKey?: string;
  secondaryApiKey?: string;
  primaryModel?: string;
  secondaryModel?: string;
  cooldownMs?: number;
}

interface CandidateMetrics {
  health: CandidateHealthState;
  consecutiveFailures: number;
  cooldownUntil: number;
  latencyEmaMs: number | null;
  lastErrorCategory: GeminiErrorCategory | null;
}

const candidateState = new Map<string, CandidateMetrics>();
const keyAuthBlockedUntil = new Map<ApiKeySlot, number>();
const keyQuotaCooldownUntil = new Map<ApiKeySlot, number>();

function getMetrics(id: string): CandidateMetrics {
  let m = candidateState.get(id);
  if (!m) {
    m = {
      health: 'healthy',
      consecutiveFailures: 0,
      cooldownUntil: 0,
      latencyEmaMs: null,
      lastErrorCategory: null,
    };
    candidateState.set(id, m);
  }
  return m;
}

export function buildAllConfiguredCandidates(
  override?: SelectorConfigOverride
): ExecutionCandidate[] {
  const primaryKey = (override?.primaryApiKey ?? env.gemini.primaryApiKey).trim();
  const secondaryKey = (override?.secondaryApiKey ?? env.gemini.secondaryApiKey).trim();
  const primaryModel = (override?.primaryModel ?? env.gemini.primaryModel).trim();
  const secondaryModel = (override?.secondaryModel ?? env.gemini.secondaryModel).trim();

  const keys: Array<{ slot: ApiKeySlot; apiKey: string }> = [];
  if (primaryKey) keys.push({ slot: 'primary', apiKey: primaryKey });
  if (secondaryKey && secondaryKey !== primaryKey) {
    keys.push({ slot: 'secondary', apiKey: secondaryKey });
  }

  const models: string[] = [];
  if (primaryModel) models.push(primaryModel);
  if (secondaryModel && secondaryModel !== primaryModel) {
    models.push(secondaryModel);
  }

  // Ordering prioritizes:
  // 1) primary key + primary model
  // 2) secondary key + primary model (immediate key failover for rate limit / quota)
  // 3) primary key + secondary model (model failover)
  // 4) secondary key + secondary model
  const candidates: ExecutionCandidate[] = [];
  let priority = 0;

  for (const model of models) {
    for (const k of keys) {
      candidates.push({
        id: `${k.slot}:${model}`,
        keySlot: k.slot,
        apiKey: k.apiKey,
        model,
        basePriority: priority++,
      });
    }
  }

  return candidates;
}

export function selectOrderedCandidates(
  override?: SelectorConfigOverride,
  now = Date.now()
): ExecutionCandidate[] {
  const all = buildAllConfiguredCandidates(override);
  if (all.length === 0) return [];

  // Recover expired cooldowns automatically
  for (const c of all) {
    const m = getMetrics(c.id);
    if (m.health === 'cooldown' && now >= m.cooldownUntil) {
      m.health = 'degraded';
      m.cooldownUntil = 0;
    }
  }

  const scored = all.map((c) => {
    const m = getMetrics(c.id);
    const authBlocked = (keyAuthBlockedUntil.get(c.keySlot) || 0) > now;
    const keyQuotaCool = (keyQuotaCooldownUntil.get(c.keySlot) || 0) > now;
    const isCooling = m.health === 'cooldown' || authBlocked || keyQuotaCool;

    let tier = 0;
    if (authBlocked) {
      tier = 4;
    } else if (m.health === 'cooldown' || keyQuotaCool) {
      tier = 3;
    } else if (m.health === 'degraded') {
      tier = 1;
    }

    // Penalize slow or repeatedly failing candidates while preserving deterministic base order on ties
    const latencyPenalty =
      m.latencyEmaMs && m.latencyEmaMs > 8000 ? 1 : 0;

    return {
      candidate: c,
      isCooling,
      authBlocked,
      score: tier * 100 + latencyPenalty * 10 + c.basePriority,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  // Exclude known auth-failed keys if non-auth-failed candidates exist
  const nonAuthBlocked = scored.filter((s) => !s.authBlocked);
  const pool = nonAuthBlocked.length > 0 ? nonAuthBlocked : scored;

  // Prefer healthy/degraded candidates; fall back to cooling candidates only when none are ready
  const ready = pool.filter((s) => !s.isCooling);
  if (ready.length > 0) {
    return ready.map((s) => s.candidate);
  }
  return pool.map((s) => s.candidate);
}

export function recordCandidateSuccess(
  candidate: ExecutionCandidate,
  latencyMs: number
): void {
  const m = getMetrics(candidate.id);
  m.health = 'healthy';
  m.consecutiveFailures = 0;
  m.cooldownUntil = 0;
  m.lastErrorCategory = null;
  m.latencyEmaMs =
    m.latencyEmaMs === null
      ? latencyMs
      : Math.round(m.latencyEmaMs * 0.7 + latencyMs * 0.3);

  keyAuthBlockedUntil.delete(candidate.keySlot);
  keyQuotaCooldownUntil.delete(candidate.keySlot);
}

export function recordCandidateFailure(
  candidate: ExecutionCandidate,
  category: GeminiErrorCategory,
  overrideCooldownMs?: number,
  now = Date.now()
): void {
  const baseCooldownMs = overrideCooldownMs ?? env.gemini.cooldownMs;
  const m = getMetrics(candidate.id);
  m.consecutiveFailures += 1;
  m.lastErrorCategory = category;

  if (category === 'auth_or_config') {
    m.health = 'cooldown';
    m.cooldownUntil = now + Math.max(baseCooldownMs, 5 * 60_000);
    keyAuthBlockedUntil.set(candidate.keySlot, m.cooldownUntil);
    return;
  }

  if (category === 'quota_or_rate_limit') {
    m.health = 'cooldown';
    m.cooldownUntil = now + baseCooldownMs;
    keyQuotaCooldownUntil.set(candidate.keySlot, now + Math.min(baseCooldownMs, 45_000));
    return;
  }

  if (category === 'model_unavailable') {
    m.health = 'cooldown';
    m.cooldownUntil = now + Math.max(baseCooldownMs, 2 * 60_000);
    return;
  }

  if (category === 'transient_upstream' || category === 'timeout' || category === 'empty_response') {
    if (m.consecutiveFailures >= 2) {
      m.health = 'cooldown';
      m.cooldownUntil = now + Math.round(baseCooldownMs * 0.6);
    } else {
      m.health = 'degraded';
    }
    return;
  }

  if (category !== 'invalid_input') {
    m.health = 'degraded';
  }
}

export function getCandidateStateSnapshotForTest() {
  const out: Record<string, CandidateMetrics> = {};
  for (const [k, v] of candidateState.entries()) {
    out[k] = { ...v };
  }
  return out;
}

export function resetModelSelectorState(): void {
  candidateState.clear();
  keyAuthBlockedUntil.clear();
  keyQuotaCooldownUntil.clear();
}
