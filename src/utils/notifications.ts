import type {
  CallType,
  NotificationSoundTone,
  UserNotificationSettings,
  UserPrivacySettings,
} from '../types';
import { postServiceWorkerMessage } from './swRegistration';

export const DEFAULT_PRIVACY_SETTINGS: UserPrivacySettings = {
  lastSeen: 'everyone',
  onlineStatus: 'everyone',
  profilePhoto: 'everyone',
  about: 'everyone',
  readReceipts: true,
};

export const DEFAULT_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  pushEnabled: true,
  privateMessages: true,
  groupMessages: true,
  communityMessages: true,
  communityActivity: true,
  incomingCalls: true,
  voiceCallRingtone: true,
  videoCallRingtone: true,
  soundEnabled: true,
  soundTone: 'chime',
  messagePreview: true,
  vibrationEnabled: true,
};

export const SOUND_TONE_OPTIONS: Array<{
  id: NotificationSoundTone;
  label: string;
  description: string;
}> = [
  { id: 'chime', label: 'Chime', description: 'Two-note crisp chime' },
  { id: 'ping', label: 'Ping', description: 'Single clean bell ping' },
  { id: 'pop', label: 'Pop', description: 'Short soft bubble pop' },
  { id: 'soft', label: 'Soft', description: 'Gentle warm fade' },
];

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playNotificationTone(tone: NotificationSoundTone = 'chime'): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;

    const scheduleNote = (
      freq: number,
      startOffset: number,
      duration: number,
      peakGain: number,
      type: OscillatorType = 'sine',
      slideToFreq?: number
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      if (slideToFreq) {
        osc.frequency.exponentialRampToValueAtTime(
          slideToFreq,
          now + startOffset + duration
        );
      }

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.linearRampToValueAtTime(peakGain, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    switch (tone) {
      case 'ping':
        scheduleNote(880, 0, 0.24, 0.09, 'sine');
        break;
      case 'pop':
        scheduleNote(320, 0, 0.09, 0.1, 'triangle', 680);
        break;
      case 'soft':
        scheduleNote(523.25, 0, 0.28, 0.06, 'sine');
        scheduleNote(659.25, 0.05, 0.3, 0.05, 'sine');
        break;
      case 'chime':
      default:
        scheduleNote(783.99, 0, 0.16, 0.08, 'sine');
        scheduleNote(1046.5, 0.11, 0.22, 0.08, 'sine');
        break;
    }

    return true;
  } catch {
    return false;
  }
}

export function isVibrationSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  );
}

export function triggerNotificationVibration(): boolean {
  if (!isVibrationSupported()) return false;
  try {
    return navigator.vibrate([110, 50, 110]);
  } catch {
    return false;
  }
}

export type BrowserNotificationSupportState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied';

export function getBrowserNotificationState(): BrowserNotificationSupportState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationSupportState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function showBrowserNotification(params: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): boolean {
  if (getBrowserNotificationState() !== 'granted') return false;
  try {
    const notif = new Notification(params.title, {
      body: params.body,
      tag: params.tag,
    });
    if (params.onClick) {
      notif.onclick = () => {
        window.focus();
        params.onClick?.();
        notif.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}

export const INCOMING_CALL_RINGTONE_SRC = '/incoming_call_ringtone.mp3';

export interface IncomingRingtoneOptions {
  callId?: string;
  onPlaying?: () => void;
  onBlocked?: () => void;
  onError?: () => void;
}

let activeCallToneTimer: ReturnType<typeof setInterval> | null = null;
const activeCallOscillators = new Set<OscillatorNode>();
let activeIncomingAudio: HTMLAudioElement | null = null;
let activeIncomingCallId: string | null = null;
let incomingRingtoneGeneration = 0;
let pendingRingUnlockCleanup: (() => void) | null = null;

function clearRingUnlockListeners(): void {
  if (pendingRingUnlockCleanup) {
    pendingRingUnlockCleanup();
    pendingRingUnlockCleanup = null;
  }
}

function stopIncomingAudioElement(): void {
  incomingRingtoneGeneration += 1;
  activeIncomingCallId = null;
  clearRingUnlockListeners();

  const audio = activeIncomingAudio;
  activeIncomingAudio = null;
  if (!audio) return;

  try {
    audio.onplaying = null;
    audio.onerror = null;
    audio.onended = null;
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute('src');
    audio.load();
  } catch {
    // Ignore audio teardown errors
  }
}

export function stopCallTones(): void {
  stopIncomingAudioElement();
  if (activeCallToneTimer) {
    clearInterval(activeCallToneTimer);
    activeCallToneTimer = null;
  }
  for (const osc of activeCallOscillators) {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      // Ignore already stopped oscillators
    }
  }
  activeCallOscillators.clear();
}

function trackCallOscillator(osc: OscillatorNode): void {
  activeCallOscillators.add(osc);
  osc.onended = () => {
    activeCallOscillators.delete(osc);
    try {
      osc.disconnect();
    } catch {
      // Ignore disconnect failure
    }
  };
}

export function startOutgoingRingback(enabled = true): void {
  stopCallTones();
  if (!enabled) return;

  const playBurst = () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.04);
      gain.gain.setValueAtTime(0.035, now + 0.72);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
      osc.connect(gain);
      gain.connect(ctx.destination);
      trackCallOscillator(osc);
      osc.start(now);
      osc.stop(now + 0.85);
    } catch {
      // Ignore Web Audio autoplay restriction
    }
  };

  playBurst();
  activeCallToneTimer = setInterval(playBurst, 2600);
}

export function retryBlockedIncomingRingtone(): void {
  const audio = activeIncomingAudio;
  if (!audio) return;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

export function startIncomingRingtone(
  enabled = true,
  _callType: CallType = 'voice',
  options?: IncomingRingtoneOptions
): void {
  if (!enabled) {
    stopCallTones();
    return;
  }

  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return;
  }

  const targetCallId = options?.callId || '__default_incoming_ring__';

  // Prevent duplicate overlapping instances if repeated Socket.IO events fire for the same callId
  if (activeIncomingAudio && activeIncomingCallId === targetCallId) {
    if (activeIncomingAudio.paused) {
      const resumePromise = activeIncomingAudio.play();
      if (resumePromise && typeof resumePromise.catch === 'function') {
        resumePromise.catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'NotAllowedError') {
            options?.onBlocked?.();
          }
        });
      }
    } else {
      options?.onPlaying?.();
    }
    return;
  }

  stopCallTones();

  const gen = ++incomingRingtoneGeneration;
  activeIncomingCallId = targetCallId;

  const audio = new Audio(INCOMING_CALL_RINGTONE_SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 1;
  audio.setAttribute('playsinline', 'true');
  activeIncomingAudio = audio;

  const attachUnlockListeners = () => {
    if (pendingRingUnlockCleanup || gen !== incomingRingtoneGeneration) return;
    const unlock = () => {
      if (gen !== incomingRingtoneGeneration || activeIncomingAudio !== audio) {
        clearRingUnlockListeners();
        return;
      }
      void attemptPlay();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    pendingRingUnlockCleanup = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  };

  let hasNotifiedPlaying = false;
  const notifyPlaying = () => {
    clearRingUnlockListeners();
    if (!hasNotifiedPlaying) {
      hasNotifiedPlaying = true;
      options?.onPlaying?.();
    }
  };

  audio.onplaying = () => {
    if (gen !== incomingRingtoneGeneration) return;
    notifyPlaying();
  };

  audio.onerror = () => {
    if (gen !== incomingRingtoneGeneration) return;
    clearRingUnlockListeners();
    options?.onError?.();
  };

  const attemptPlay = async () => {
    if (gen !== incomingRingtoneGeneration || activeIncomingAudio !== audio) return;
    hasNotifiedPlaying = false;
    try {
      await audio.play();
      if (gen !== incomingRingtoneGeneration) {
        audio.pause();
        return;
      }
      notifyPlaying();
    } catch (err: unknown) {
      if (gen !== incomingRingtoneGeneration || activeIncomingAudio !== audio) return;
      const errName = (err as { name?: string })?.name || '';
      if (errName === 'NotAllowedError') {
        attachUnlockListeners();
        options?.onBlocked?.();
      } else if (errName !== 'AbortError') {
        options?.onError?.();
      }
    }
  };

  void attemptPlay();
}

export function dismissCallNotificationInSw(callId?: string | null): void {
  void postServiceWorkerMessage({
    type: 'BLINKUPZ_DISMISS_CALL_NOTIFICATION',
    callId: callId || null,
  });
}
