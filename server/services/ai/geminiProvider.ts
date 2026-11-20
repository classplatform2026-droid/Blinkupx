import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';

export type GeminiErrorCategory =
  | 'quota_or_rate_limit'
  | 'auth_or_config'
  | 'model_unavailable'
  | 'timeout'
  | 'transient_upstream'
  | 'invalid_input'
  | 'empty_response'
  | 'unknown';

export interface GeminiGenerateRequest {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
  timeoutMs: number;
}

export interface GeminiGenerateResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export class GeminiProviderError extends Error {
  readonly category: GeminiErrorCategory;
  readonly retryable: boolean;

  constructor(category: GeminiErrorCategory, message: string, retryable: boolean) {
    super(message);
    this.name = 'GeminiProviderError';
    this.category = category;
    this.retryable = retryable;
  }
}

const clientCache = new Map<string, GoogleGenAI>();

function getClientForApiKey(apiKey: string): GoogleGenAI {
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const existing = clientCache.get(keyHash);
  if (existing) {
    return existing;
  }

  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  clientCache.set(keyHash, client);
  if (clientCache.size > 10) {
    const firstKey = clientCache.keys().next().value;
    if (firstKey) clientCache.delete(firstKey);
  }
  return client;
}

export function classifyGeminiError(err: unknown): {
  category: GeminiErrorCategory;
  retryable: boolean;
  safeSummary: string;
} {
  if (err instanceof GeminiProviderError) {
    return {
      category: err.category,
      retryable: err.retryable,
      safeSummary: err.message,
    };
  }

  const anyErr = err as {
    status?: number;
    statusCode?: number;
    code?: string | number;
    name?: string;
    message?: string;
  } | null;

  const status = Number(anyErr?.status || anyErr?.statusCode || 0);
  const rawMsg = String(anyErr?.message || '');
  const lower = rawMsg.toLowerCase();
  const errName = String(anyErr?.name || '').toLowerCase();

  if (
    errName === 'aborterror' ||
    lower.includes('aborted') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    anyErr?.code === 'ETIMEDOUT'
  ) {
    return {
      category: 'timeout',
      retryable: true,
      safeSummary: 'Upstream Gemini request timed out',
    };
  }

  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return {
      category: 'quota_or_rate_limit',
      retryable: true,
      safeSummary: 'Gemini rate limit or quota reached',
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthorized')
  ) {
    return {
      category: 'auth_or_config',
      retryable: true, // Try secondary API key slot if available
      safeSummary: 'Gemini API authentication failed for configured slot',
    };
  }

  if (
    status === 404 ||
    lower.includes('model not found') ||
    lower.includes('is not found for api version') ||
    lower.includes('not supported for generatecontent')
  ) {
    return {
      category: 'model_unavailable',
      retryable: true, // Fail over to secondary model
      safeSummary: 'Requested Gemini model is unavailable',
    };
  }

  if (
    status >= 500 ||
    lower.includes('internal error') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return {
      category: 'transient_upstream',
      retryable: true,
      safeSummary: 'Transient upstream Gemini service error',
    };
  }

  if (status === 400 || lower.includes('invalid argument')) {
    return {
      category: 'invalid_input',
      retryable: false,
      safeSummary: 'Invalid request payload rejected by Gemini',
    };
  }

  return {
    category: 'unknown',
    retryable: true,
    safeSummary: 'Gemini generation failed',
  };
}

export async function generateWithGemini(
  req: GeminiGenerateRequest
): Promise<GeminiGenerateResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  try {
    const ai = getClientForApiKey(req.apiKey);
    const timeoutPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new GeminiProviderError('timeout', 'Gemini request timed out', true)),
        { once: true }
      );
    });

    const response = await Promise.race([
      ai.models.generateContent({
        model: req.model,
        contents: req.userPrompt,
        config: {
          systemInstruction: req.systemInstruction,
          abortSignal: controller.signal,
        },
      }),
      timeoutPromise,
    ]);

    const text = typeof response.text === 'string' ? response.text.trim() : '';
    if (!text) {
      throw new GeminiProviderError(
        'empty_response',
        'Gemini returned an empty response',
        true
      );
    }

    const usage = response.usageMetadata;
    return {
      text,
      inputTokens:
        typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : null,
      outputTokens:
        typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const classified = classifyGeminiError(err);
    throw new GeminiProviderError(
      classified.category,
      classified.safeSummary,
      classified.retryable
    );
  } finally {
    clearTimeout(timer);
  }
}
