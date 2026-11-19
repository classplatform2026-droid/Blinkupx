import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import type { MediaUploadProgressItem } from '../types';
import {
  createNeutralWaveformPeaks,
  extractAudioWaveform,
} from '../utils/audioWaveform';
import { formatDuration } from '../utils/formatters';

const VOICE_PLAY_EVENT = 'blinkupz:voice-play';
const WAVEFORM_BAR_COUNT = 28;

export interface VoiceMessagePlayerProps {
  src: string;
  variant: 'incoming' | 'outgoing' | 'preview';
  fallbackDuration?: number;
  unavailable?: boolean;
  progressItem?: MediaUploadProgressItem;
  onAudioError?: () => void;
  onRetryUpload?: () => void;
}

export function VoiceMessagePlayer({
  src,
  variant,
  fallbackDuration = 0,
  unavailable = false,
  progressItem,
  onAudioError,
  onRetryUpload,
}: VoiceMessagePlayerProps) {
  const playerId = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [decodedDuration, setDecodedDuration] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<number[]>(() =>
    createNeutralWaveformPeaks(WAVEFORM_BAR_COUNT)
  );
  const [playbackError, setPlaybackError] = useState(false);

  const effectiveDuration =
    mediaDuration ??
    decodedDuration ??
    (fallbackDuration > 0 ? fallbackDuration : 0);

  const progressRatio =
    effectiveDuration > 0
      ? Math.min(1, Math.max(0, currentTime / effectiveDuration))
      : 0;

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Reset state cleanly whenever the resolved audio URL changes
  useEffect(() => {
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTime(0);
    setMediaDuration(null);
    setDecodedDuration(null);
    setPlaybackError(false);
    stopRaf();
  }, [src, stopRaf]);

  // Decode real waveform peaks and buffer duration for the audio source
  useEffect(() => {
    if (!src || unavailable) {
      setPeaks(createNeutralWaveformPeaks(WAVEFORM_BAR_COUNT));
      return;
    }
    let active = true;
    void extractAudioWaveform(src, WAVEFORM_BAR_COUNT).then((data) => {
      if (!active) return;
      setPeaks(data.peaks);
      if (data.duration && Number.isFinite(data.duration) && data.duration > 0) {
        setDecodedDuration(data.duration);
      }
    });
    return () => {
      active = false;
    };
  }, [src, unavailable]);

  // Ensure only one voice note plays at a time across the conversation
  useEffect(() => {
    const handleOtherPlay = (ev: Event) => {
      const detail = (ev as CustomEvent<{ playerId: string }>).detail;
      if (!detail || detail.playerId === playerId) return;
      const el = audioRef.current;
      if (el && !el.paused) {
        el.pause();
      }
    };
    window.addEventListener(VOICE_PLAY_EVENT, handleOtherPlay);
    return () => {
      window.removeEventListener(VOICE_PLAY_EVENT, handleOtherPlay);
    };
  }, [playerId]);

  // Smooth real-time progress loop locked strictly to audio.currentTime while playing
  useEffect(() => {
    if (!isPlaying) {
      stopRaf();
      return;
    }

    const tick = () => {
      const el = audioRef.current;
      if (el && !scrubbingRef.current) {
        setCurrentTime(el.currentTime || 0);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopRaf();
    };
  }, [isPlaying, stopRaf]);

  // Pause and clean up animation frame on unmount
  useEffect(() => {
    const el = audioRef.current;
    return () => {
      stopRaf();
      if (el && !el.paused) {
        el.pause();
      }
    };
  }, [stopRaf]);

  const togglePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el || unavailable || !src) return;

    if (el.paused) {
      setPlaybackError(false);
      setIsBuffering(true);
      window.dispatchEvent(
        new CustomEvent(VOICE_PLAY_EVENT, { detail: { playerId } })
      );
      try {
        await el.play();
        setIsPlaying(true);
        setIsBuffering(false);
      } catch {
        setIsPlaying(false);
        setIsBuffering(false);
        setPlaybackError(true);
      }
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const seekToClientX = useCallback(
    (clientX: number) => {
      const barContainer = waveformRef.current;
      const el = audioRef.current;
      if (!barContainer || !el || effectiveDuration <= 0) return;

      const rect = barContainer.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = ratio * effectiveDuration;

      if (el.readyState >= 1) {
        try {
          el.currentTime = targetTime;
        } catch {
          // Ignore seek errors on unbuffered streams
        }
      }
      setCurrentTime(targetTime);
    },
    [effectiveDuration]
  );

  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (unavailable || effectiveDuration <= 0) return;
    scrubbingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
    seekToClientX(e.clientX);
  };

  const handleWaveformPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    e.stopPropagation();
    seekToClientX(e.clientX);
  };

  const handleWaveformPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    e.stopPropagation();
    scrubbingRef.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore pointer capture release errors
    }
  };

  const handleWaveformKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || effectiveDuration <= 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowRight' ? 2 : -2;
      const next = Math.max(
        0,
        Math.min(effectiveDuration, (el.currentTime || 0) + delta)
      );
      if (el.readyState >= 1) {
        el.currentTime = next;
      }
      setCurrentTime(next);
    }
  };

  if (unavailable) {
    return (
      <div
        data-no-swipe="true"
        className={`flex items-center gap-2.5 py-2 px-2.5 rounded-xl border text-xs ${
          variant === 'outgoing'
            ? 'bg-[#181818]/10 border-[#181818]/15 text-[#181818]'
            : 'bg-[#181818] border-[#303030] text-[#999999]'
        }`}
      >
        <AlertCircle className="w-4 h-4 text-[#E5484D] shrink-0" />
        <span>Voice message unavailable</span>
      </div>
    );
  }

  const buttonStyles =
    variant === 'outgoing'
      ? 'bg-[#181818] text-[#FFFFFF] hover:bg-[#303030]'
      : variant === 'preview'
        ? 'bg-[#303030] text-[#FFFFFF] hover:bg-[#3D3D3D]'
        : 'bg-[#FFFFFF] text-[#181818] hover:bg-[#E8E8E8]';

  const activeBarClass =
    variant === 'outgoing'
      ? 'bg-[#181818]'
      : variant === 'preview'
        ? 'bg-[#22C55E]'
        : 'bg-[#FFFFFF]';

  const inactiveBarClass =
    variant === 'outgoing' ? 'bg-[#181818]/25' : 'bg-[#FFFFFF]/25';

  const primaryTimeClass =
    variant === 'outgoing' ? 'text-[#181818]' : 'text-[#FFFFFF]';

  const secondaryTimeClass =
    variant === 'outgoing' ? 'text-[#555555]' : 'text-[#999999]';

  const showUploadStatus = Boolean(progressItem && progressItem.stage !== 'sent');

  return (
    <div
      data-no-swipe="true"
      className="flex items-center gap-2.5 w-full min-w-0 py-0.5 select-none"
    >
      <audio
        ref={audioRef}
        src={src}
        preload={src.startsWith('blob:') ? 'auto' : 'metadata'}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setMediaDuration(d);
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setMediaDuration(d);
          }
        }}
        onTimeUpdate={(e) => {
          if (!scrubbingRef.current) {
            setCurrentTime(e.currentTarget.currentTime || 0);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => {
          setIsBuffering(false);
          setIsPlaying(false);
        }}
        onEnded={(e) => {
          setIsPlaying(false);
          setIsBuffering(false);
          e.currentTarget.currentTime = 0;
          setCurrentTime(0);
        }}
        onError={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          if (onAudioError) {
            onAudioError();
          } else {
            setPlaybackError(true);
          }
        }}
        className="hidden"
      />

      <button
        type="button"
        onClick={togglePlayPause}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] ${buttonStyles}`}
      >
        {isBuffering ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <div
          ref={waveformRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek voice message"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(effectiveDuration))}
          aria-valuenow={Math.round(currentTime)}
          onPointerDown={handleWaveformPointerDown}
          onPointerMove={handleWaveformPointerMove}
          onPointerUp={handleWaveformPointerUp}
          onPointerCancel={handleWaveformPointerUp}
          onKeyDown={handleWaveformKeyDown}
          className="w-full h-7 flex items-center gap-[2px] cursor-pointer touch-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#22C55E] rounded"
        >
          {peaks.map((peak, idx) => {
            const barCenterRatio = (idx + 0.5) / peaks.length;
            const isActive =
              progressRatio > 0 &&
              (barCenterRatio <= progressRatio || (idx === 0 && isPlaying));
            const heightPct = Math.round(Math.max(18, Math.min(100, peak * 100)));

            return (
              <span
                key={idx}
                aria-hidden="true"
                style={{ height: `${heightPct}%` }}
                className={`flex-1 min-w-[2px] rounded-full transition-colors duration-75 ${
                  isActive ? activeBarClass : inactiveBarClass
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums leading-none whitespace-nowrap">
            <span className={primaryTimeClass}>
              {formatDuration(currentTime)}
            </span>
            <span className={secondaryTimeClass} aria-hidden="true">
              /
            </span>
            <span className={secondaryTimeClass}>
              {formatDuration(effectiveDuration)}
            </span>
          </div>

          {playbackError ? (
            <span className="text-[10px] font-medium text-[#E5484D] truncate">
              Playback error
            </span>
          ) : showUploadStatus && progressItem ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-[10px] font-mono tabular-nums truncate ${
                  progressItem.stage === 'failed'
                    ? 'text-[#E5484D]'
                    : secondaryTimeClass
                }`}
              >
                {progressItem.stage === 'uploading'
                  ? `Uploading ${progressItem.progress}%`
                  : progressItem.stage === 'processing'
                    ? 'Processing...'
                    : progressItem.stage === 'failed'
                      ? 'Failed'
                      : 'Preparing...'}
              </span>
              {progressItem.stage === 'failed' && onRetryUpload && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryUpload();
                  }}
                  aria-label="Retry voice upload"
                  className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#E5484D] hover:underline cursor-pointer shrink-0"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
