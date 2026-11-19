export type VoiceRecorderStatus = 'idle' | 'recording' | 'paused' | 'stopping';

export interface VoiceRecordingResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
];

export function pickSupportedAudioMimeType(): string {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return '';
  }
  for (const candidate of PREFERRED_AUDIO_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore probe errors for unsupported candidates
    }
  }
  return '';
}

export function getAudioExtensionFromMime(mimeType: string | undefined): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/aac':
      return 'aac';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/flac':
      return 'flac';
    case 'audio/webm':
    default:
      return 'webm';
  }
}

export function supportsNativeMediaRecorderPause(
  recorder: Pick<MediaRecorder, 'pause' | 'resume'> | null | undefined
): boolean {
  return Boolean(
    recorder &&
      typeof recorder.pause === 'function' &&
      typeof recorder.resume === 'function'
  );
}

/**
 * Tracks accurate active recording duration across pause/resume cycles.
 */
export class RecordingClock {
  private accumulatedMs = 0;
  private segmentStartedAt: number | null = null;

  start(now = Date.now()): void {
    this.accumulatedMs = 0;
    this.segmentStartedAt = now;
  }

  pause(now = Date.now()): number {
    if (this.segmentStartedAt !== null) {
      this.accumulatedMs += Math.max(0, now - this.segmentStartedAt);
      this.segmentStartedAt = null;
    }
    return this.accumulatedMs;
  }

  resume(now = Date.now()): void {
    if (this.segmentStartedAt === null) {
      this.segmentStartedAt = now;
    }
  }

  getElapsedMs(now = Date.now()): number {
    if (this.segmentStartedAt === null) {
      return this.accumulatedMs;
    }
    return this.accumulatedMs + Math.max(0, now - this.segmentStartedAt);
  }

  getDisplaySeconds(now = Date.now()): number {
    return Math.floor(this.getElapsedMs(now) / 1000);
  }

  finish(now = Date.now()): { totalMs: number; seconds: number } {
    const totalMs = this.pause(now);
    const seconds = totalMs > 0 ? Math.max(1, Math.round(totalMs / 1000)) : 0;
    return { totalMs, seconds };
  }

  reset(): void {
    this.accumulatedMs = 0;
    this.segmentStartedAt = null;
  }
}

/**
 * Encodes captured mono PCM Float32 chunks into a standard RIFF WAV Blob.
 * Used only as a fallback when a browser's MediaRecorder lacks pause/resume support.
 */
export function encodeMonoWavBlob(
  chunks: Float32Array[],
  sampleRate: number
): Blob {
  let totalSamples = 0;
  for (const chunk of chunks) {
    totalSamples += chunk.length;
  }

  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const clamped = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true
      );
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

interface StartRecorderCallbacks {
  onStatusChange: (status: VoiceRecorderStatus) => void;
  onSecondsChange: (seconds: number) => void;
  onError: (message: string) => void;
}

export interface VoiceRecorderSession {
  pause: () => void;
  resume: () => void;
  stop: () => Promise<VoiceRecordingResult | null>;
  cancel: () => void;
  getStatus: () => VoiceRecorderStatus;
  isFallbackMode: () => boolean;
}

function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore individual track stop errors
      }
    });
  } catch {
    // Ignore stream teardown errors
  }
}

/**
 * Starts a single reusable voice recording session with reliable pause/resume.
 * Prefers native MediaRecorder.pause() / MediaRecorder.resume() and falls back
 * to Web Audio PCM/WAV capture if the browser lacks MediaRecorder pause/resume.
 */
export async function createVoiceRecorderSession(
  callbacks: StartRecorderCallbacks
): Promise<VoiceRecorderSession> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new Error('Voice recording is not supported in this browser.');
  }

  let cancelled = false;
  let status: VoiceRecorderStatus = 'idle';
  let stream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let chosenMime = '';
  let timerId: ReturnType<typeof setInterval> | null = null;

  // Web Audio WAV fallback state (only used when MediaRecorder.pause/resume is unavailable)
  let fallbackMode = false;
  let audioCtx: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processorNode: ScriptProcessorNode | null = null;
  let silentGainNode: GainNode | null = null;
  let pcmChunks: Float32Array[] = [];
  let pcmSampleRate = 44100;

  const clock = new RecordingClock();

  const clearTicker = () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const startTicker = () => {
    clearTicker();
    callbacks.onSecondsChange(clock.getDisplaySeconds());
    timerId = setInterval(() => {
      callbacks.onSecondsChange(clock.getDisplaySeconds());
    }, 200);
  };

  const cleanupFallbackGraph = () => {
    try {
      processorNode?.disconnect();
    } catch {
      // Ignore
    }
    try {
      sourceNode?.disconnect();
    } catch {
      // Ignore
    }
    try {
      silentGainNode?.disconnect();
    } catch {
      // Ignore
    }
    if (processorNode) {
      processorNode.onaudioprocess = null;
    }
    processorNode = null;
    sourceNode = null;
    silentGainNode = null;
    if (audioCtx) {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  };

  const cleanupAllResources = () => {
    clearTicker();
    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onpause = null;
      mediaRecorder.onresume = null;
      mediaRecorder.onstop = null;
      mediaRecorder.onerror = null;
      if (mediaRecorder.state !== 'inactive') {
        try {
          mediaRecorder.stop();
        } catch {
          // Ignore stop errors during cleanup
        }
      }
      mediaRecorder = null;
    }
    cleanupFallbackGraph();
    stopMediaStream(stream);
    stream = null;
    chunks = [];
    pcmChunks = [];
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error('Microphone permission is required to record voice messages.');
  }

  const updateStatus = (next: VoiceRecorderStatus) => {
    status = next;
    callbacks.onStatusChange(next);
  };

  // Probe MediaRecorder support and whether native pause/resume exists
  let probeRecorder: MediaRecorder | null = null;
  if (typeof MediaRecorder !== 'undefined') {
    chosenMime = pickSupportedAudioMimeType();
    try {
      probeRecorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
    } catch {
      try {
        chosenMime = '';
        probeRecorder = new MediaRecorder(stream);
      } catch {
        probeRecorder = null;
      }
    }
  }

  if (probeRecorder && supportsNativeMediaRecorderPause(probeRecorder)) {
    mediaRecorder = probeRecorder;
    fallbackMode = false;

    mediaRecorder.ondataavailable = (ev) => {
      if (!cancelled && ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    mediaRecorder.onpause = () => {
      if (cancelled) return;
      clock.pause();
      clearTicker();
      callbacks.onSecondsChange(clock.getDisplaySeconds());
      if (status !== 'stopping') {
        updateStatus('paused');
      }
    };

    mediaRecorder.onresume = () => {
      if (cancelled) return;
      clock.resume();
      startTicker();
      if (status !== 'stopping') {
        updateStatus('recording');
      }
    };

    mediaRecorder.onerror = () => {
      if (cancelled) return;
      cleanupAllResources();
      clock.reset();
      updateStatus('idle');
      callbacks.onError('Voice recording interrupted. Please try again.');
    };

    mediaRecorder.start();
    clock.start();
    updateStatus('recording');
    startTicker();
  } else {
    // Fallback: capture mono PCM samples via Web Audio API into WAV chunks
    fallbackMode = true;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioCtx) {
      stopMediaStream(stream);
      throw new Error('Voice recording is not supported in this browser.');
    }

    audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(() => {});
    }
    pcmSampleRate = audioCtx.sampleRate || 44100;
    sourceNode = audioCtx.createMediaStreamSource(stream);
    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    silentGainNode = audioCtx.createGain();
    silentGainNode.gain.value = 0;

    processorNode.onaudioprocess = (ev) => {
      if (cancelled || status !== 'recording') return;
      const input = ev.inputBuffer.getChannelData(0);
      if (input && input.length > 0) {
        pcmChunks.push(new Float32Array(input));
      }
    };

    sourceNode.connect(processorNode);
    processorNode.connect(silentGainNode);
    silentGainNode.connect(audioCtx.destination);

    clock.start();
    updateStatus('recording');
    startTicker();
  }

  let stopPromise: Promise<VoiceRecordingResult | null> | null = null;

  return {
    getStatus: () => status,
    isFallbackMode: () => fallbackMode,

    pause: () => {
      if (cancelled || status !== 'recording') return;
      clock.pause();
      clearTicker();
      callbacks.onSecondsChange(clock.getDisplaySeconds());

      if (!fallbackMode && mediaRecorder) {
        if (mediaRecorder.state === 'recording') {
          try {
            mediaRecorder.pause();
            updateStatus('paused');
          } catch {
            // If native pause unexpectedly throws, revert clock and notify
            clock.resume();
            startTicker();
            callbacks.onError('Pause is not supported in this browser.');
          }
        }
        return;
      }

      updateStatus('paused');
    },

    resume: () => {
      if (cancelled || status !== 'paused') return;

      if (!fallbackMode && mediaRecorder) {
        if (mediaRecorder.state === 'paused') {
          try {
            mediaRecorder.resume();
            clock.resume();
            startTicker();
            updateStatus('recording');
          } catch {
            callbacks.onError('Could not resume recording.');
          }
        }
        return;
      }

      clock.resume();
      startTicker();
      updateStatus('recording');
    },

    stop: () => {
      if (cancelled) return Promise.resolve(null);
      if (stopPromise) return stopPromise;
      if (status !== 'recording' && status !== 'paused') {
        return Promise.resolve(null);
      }

      const { seconds } = clock.finish();
      clearTicker();
      callbacks.onSecondsChange(seconds);
      updateStatus('stopping');

      if (fallbackMode) {
        const captured = pcmChunks;
        const rate = pcmSampleRate;
        cleanupAllResources();
        clock.reset();
        updateStatus('idle');
        if (captured.length === 0) {
          callbacks.onError('No audio was captured. Please try again.');
          return Promise.resolve(null);
        }
        const blob = encodeMonoWavBlob(captured, rate);
        return Promise.resolve({
          blob,
          durationSeconds: seconds,
          mimeType: 'audio/wav',
        });
      }

      const recorder = mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        cleanupAllResources();
        clock.reset();
        updateStatus('idle');
        return Promise.resolve(null);
      }

      stopPromise = new Promise<VoiceRecordingResult | null>((resolve) => {
        recorder.onstop = () => {
          if (cancelled) {
            cleanupAllResources();
            resolve(null);
            return;
          }

          const finalMime =
            recorder.mimeType || chosenMime || chunks[0]?.type || 'audio/webm';
          const blob = new Blob(chunks, { type: finalMime });

          cleanupAllResources();
          clock.reset();
          updateStatus('idle');

          if (blob.size <= 0) {
            callbacks.onError('No audio was captured. Please try again.');
            resolve(null);
            return;
          }

          resolve({
            blob,
            durationSeconds: seconds,
            mimeType: finalMime,
          });
        };

        try {
          recorder.stop();
        } catch {
          cleanupAllResources();
          clock.reset();
          updateStatus('idle');
          resolve(null);
        }
      });

      return stopPromise;
    },

    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      clock.reset();
      cleanupAllResources();
      updateStatus('idle');
      callbacks.onSecondsChange(0);
    },
  };
}
