export interface DecodedWaveformData {
  peaks: number[];
  duration: number | null;
}

const DEFAULT_BAR_COUNT = 28;
const MAX_WAVEFORM_CACHE_ENTRIES = 200;

const waveformCache = new Map<string, DecodedWaveformData>();
const inFlightExtractions = new Map<string, Promise<DecodedWaveformData>>();

export function createNeutralWaveformPeaks(barCount = DEFAULT_BAR_COUNT): number[] {
  return Array.from({ length: barCount }, () => 0.22);
}

/**
 * Computes normalized RMS amplitude peaks from raw PCM samples.
 */
export function computeWaveformPeaksFromSamples(
  samples: Float32Array,
  barCount = DEFAULT_BAR_COUNT
): number[] {
  if (!samples || samples.length === 0 || barCount <= 0) {
    return createNeutralWaveformPeaks(Math.max(1, barCount));
  }

  const blockSize = Math.max(1, Math.floor(samples.length / barCount));
  const rawRms: number[] = [];
  let maxRms = 0;

  for (let i = 0; i < barCount; i++) {
    const start = i * blockSize;
    const end = i === barCount - 1 ? samples.length : Math.min(samples.length, start + blockSize);
    if (start >= samples.length) {
      rawRms.push(0);
      continue;
    }

    let sumSquares = 0;
    let count = 0;
    // Stride large blocks slightly for fast decoding on long voice notes
    const stride = Math.max(1, Math.floor((end - start) / 256));
    for (let j = start; j < end; j += stride) {
      const sample = samples[j];
      sumSquares += sample * sample;
      count += 1;
    }
    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    rawRms.push(rms);
    if (rms > maxRms) {
      maxRms = rms;
    }
  }

  if (maxRms <= 0.0001) {
    return createNeutralWaveformPeaks(barCount);
  }

  return rawRms.map((val) => {
    const normalized = Math.pow(val / maxRms, 0.72);
    return Math.max(0.16, Math.min(1, Number(normalized.toFixed(3))));
  });
}

function setCachedWaveform(key: string, data: DecodedWaveformData): void {
  if (waveformCache.size >= MAX_WAVEFORM_CACHE_ENTRIES) {
    const oldestKey = waveformCache.keys().next().value;
    if (oldestKey) {
      waveformCache.delete(oldestKey);
    }
  }
  waveformCache.set(key, data);
}

async function decodeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> {
  if (typeof window === 'undefined') return null;

  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  if (OfflineCtx) {
    try {
      const offline = new OfflineCtx(1, 1, 44100);
      return await offline.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      // Fall through to AudioContext fallback
    }
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) return null;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    return null;
  } finally {
    if (ctx) {
      void ctx.close().catch(() => {});
    }
  }
}

/**
 * Fetches and decodes actual audio waveform peaks + true buffer duration for a voice note URL.
 * Gracefully degrades to neutral baseline bars if CORS or browser codec decoding is unavailable.
 */
export async function extractAudioWaveform(
  src: string,
  barCount = DEFAULT_BAR_COUNT
): Promise<DecodedWaveformData> {
  if (!src || typeof fetch !== 'function') {
    return { peaks: createNeutralWaveformPeaks(barCount), duration: null };
  }

  const cacheKey = `${src}::${barCount}`;
  const cached = waveformCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = inFlightExtractions.get(cacheKey);
  if (pending) {
    return pending;
  }

  const job = (async (): Promise<DecodedWaveformData> => {
    try {
      const response = await fetch(src);
      if (!response.ok) {
        return { peaks: createNeutralWaveformPeaks(barCount), duration: null };
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await decodeAudioBuffer(arrayBuffer);
      if (!audioBuffer || audioBuffer.numberOfChannels === 0) {
        return { peaks: createNeutralWaveformPeaks(barCount), duration: null };
      }

      const channelData = audioBuffer.getChannelData(0);
      const peaks = computeWaveformPeaksFromSamples(channelData, barCount);
      const duration =
        Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0
          ? audioBuffer.duration
          : null;

      const result = { peaks, duration };
      setCachedWaveform(cacheKey, result);
      return result;
    } catch {
      return { peaks: createNeutralWaveformPeaks(barCount), duration: null };
    } finally {
      inFlightExtractions.delete(cacheKey);
    }
  })();

  inFlightExtractions.set(cacheKey, job);
  return job;
}
