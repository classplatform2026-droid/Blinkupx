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

let activeCallToneTimer: ReturnType<typeof setInterval> | null = null;
const activeCallOscillators = new Set<OscillatorNode>();
let pendingRingUnlockCleanup: (() => void) | null = null;

function clearRingUnlockListeners(): void {
  if (pendingRingUnlockCleanup) {
    pendingRingUnlockCleanup();
    pendingRingUnlockCleanup = null;
  }
}

export function stopCallTones(): void {
  clearRingUnlockListeners();
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

export function startIncomingRingtone(
  enabled = true,
  callType: CallType = 'voice'
): void {
  stopCallTones();
  if (!enabled) return;

  const playRing = () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;

      const schedulePulse = (
        offset: number,
        freqs: number[],
        pulseDur: number,
        peak: number
      ) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = callType === 'video' ? 'triangle' : 'sine';
        const step = pulseDur / freqs.length;
        freqs.forEach((f, idx) => {
          osc.frequency.setValueAtTime(f, now + offset + idx * step);
        });
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.linearRampToValueAtTime(peak, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + pulseDur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        trackCallOscillator(osc);
        osc.start(now + offset);
        osc.stop(now + offset + pulseDur + 0.02);
      };

      if (callType === 'video') {
        // Crisp 3-note video ringtone phrase
        schedulePulse(0, [587.33, 739.99, 880], 0.38, 0.065);
        schedulePulse(0.46, [739.99, 880, 1174.66], 0.4, 0.065);
      } else {
        // Classic warm two-pulse voice ringtone
        schedulePulse(0, [659.25, 880], 0.34, 0.065);
        schedulePulse(0.42, [659.25, 880], 0.34, 0.065);
      }
    } catch {
      // Ignore Web Audio autoplay restriction
    }
  };

  if (typeof window !== 'undefined') {
    const resumeAndPlay = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().then(() => playRing()).catch(() => {});
      }
      clearRingUnlockListeners();
    };
    window.addEventListener('pointerdown', resumeAndPlay, { passive: true });
    window.addEventListener('keydown', resumeAndPlay, { passive: true });
    pendingRingUnlockCleanup = () => {
      window.removeEventListener('pointerdown', resumeAndPlay);
      window.removeEventListener('keydown', resumeAndPlay);
    };
  }

  playRing();
  activeCallToneTimer = setInterval(playRing, 2400);
}

export function dismissCallNotificationInSw(callId?: string | null): void {
  void postServiceWorkerMessage({
    type: 'BLINKUPZ_DISMISS_CALL_NOTIFICATION',
    callId: callId || null,
  });
}
