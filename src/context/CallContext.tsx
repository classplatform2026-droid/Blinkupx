import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ConnectionQuality,
  DisconnectReason,
  LocalVideoTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
} from 'livekit-client';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { callApi, extractApiError } from '../services/api';
import type {
  CallPeerInfo,
  CallSessionSnapshot,
  CallState,
  CallType,
} from '../types';
import {
  dismissCallNotificationInSw,
  showBrowserNotification,
  startIncomingRingtone,
  startOutgoingRingback,
  stopCallTones,
  triggerNotificationVibration,
} from '../utils/notifications';
import { getActiveBrowserPushSubscription } from '../utils/pushNotifications';
import { queryKeys } from '../utils/queryClient';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useToast } from './ToastContext';

interface StartCallInput {
  recipientId: string;
  callType: CallType;
  conversationId?: string | null;
  peerHint?: Partial<CallPeerInfo>;
}

interface CallContextValue {
  session: CallSessionSnapshot | null;
  callState: CallState;
  durationSeconds: number;
  isMuted: boolean;
  isCameraOff: boolean;
  remoteCameraEnabled: boolean;
  remoteMicMuted: boolean;
  poorConnection: boolean;
  audioPlaybackBlocked: boolean;
  localVideoTrack: LocalVideoTrack | null;
  remoteVideoTrack: RemoteTrack | null;
  videoDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedVideoDeviceId: string;
  selectedAudioOutputId: string;
  supportsAudioOutputSwitch: boolean;
  permissionError: string | null;
  minimized: boolean;
  setMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  startCall: (input: StartCallInput) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  cancelOutgoingCall: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  switchAudioOutput: (deviceId: string) => Promise<void>;
  unlockAudioPlayback: () => Promise<void>;
  dismissEndedNotice: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

function mapMediaPermissionError(err: unknown, callType: CallType): string {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return callType === 'video'
      ? 'Camera and microphone permission was denied. Allow access in your browser settings to continue.'
      : 'Microphone permission was denied. Allow microphone access in your browser settings to continue.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return callType === 'video'
      ? 'No camera or microphone was detected on this device.'
      : 'No microphone was detected on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your camera or microphone is currently in use by another application.';
  }
  if (name === 'SecurityError') {
    return 'Calling requires a secure HTTPS connection (or localhost).';
  }
  return (
    (err as { message?: string })?.message ||
    'Could not access microphone or camera permissions.'
  );
}

async function preflightMediaPermissions(callType: CallType): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new Error('Microphone and camera access require HTTPS or a supported browser.');
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video',
    });
  } catch (err) {
    // If video failed only because camera is absent on desktop, report clear error
    throw new Error(mapMediaPermissionError(err, callType));
  } finally {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const userId = user?.id || '';
  const incomingCallsEnabled = user?.settings?.notifications?.incomingCalls ?? true;
  const voiceRingtoneEnabled = user?.settings?.notifications?.voiceCallRingtone ?? true;
  const videoRingtoneEnabled = user?.settings?.notifications?.videoCallRingtone ?? true;
  const soundEnabled = user?.settings?.notifications?.soundEnabled ?? true;
  const vibrationEnabled = user?.settings?.notifications?.vibrationEnabled ?? true;

  const [session, setSession] = useState<CallSessionSnapshot | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(false);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const [poorConnection, setPoorConnection] = useState(false);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<RemoteTrack | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);

  const supportsAudioOutputSwitch =
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;

  const roomRef = useRef<Room | null>(null);
  const connectingCallIdRef = useRef<string | null>(null);
  const sessionRef = useRef<CallSessionSnapshot | null>(null);
  const remoteAudioElsRef = useRef<Set<HTMLMediaElement>>(new Set());
  const terminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const cancelledPendingRef = useRef<boolean>(false);
  const hasActivePushSubRef = useRef<boolean>(false);
  const handlingDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!userId) {
      hasActivePushSubRef.current = false;
      return;
    }
    let cancelled = false;
    const syncPushSubFlag = () => {
      void getActiveBrowserPushSubscription().then((sub) => {
        if (!cancelled) {
          hasActivePushSubRef.current = Boolean(sub);
        }
      });
    };
    syncPushSubFlag();
    window.addEventListener('blinkupz:push-subscription-changed', syncPushSubFlag);
    return () => {
      cancelled = true;
      window.removeEventListener('blinkupz:push-subscription-changed', syncPushSubFlag);
    };
  }, [userId]);

  const callState: CallState = session?.state || 'idle';

  const clearTerminalTimer = useCallback(() => {
    if (terminalTimerRef.current) {
      clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = null;
    }
  }, []);

  const cleanupLiveKitRoom = useCallback(async () => {
    connectingCallIdRef.current = null;
    const room = roomRef.current;
    roomRef.current = null;

    remoteAudioElsRef.current.forEach((el) => {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {
        // Ignore DOM cleanup failure
      }
    });
    remoteAudioElsRef.current.clear();

    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    setRemoteCameraEnabled(false);
    setRemoteMicMuted(false);
    setPoorConnection(false);
    setAudioPlaybackBlocked(false);

    if (room) {
      try {
        room.localParticipant.trackPublications.forEach((pub) => {
          pub.track?.stop();
        });
      } catch {
        // Ignore stop errors
      }
      try {
        await room.disconnect(true);
      } catch {
        // Ignore disconnect errors
      }
    }
  }, []);

  const invalidateHistory = useCallback(() => {
    if (!userId) return;
    void qc.invalidateQueries({ queryKey: queryKeys.callHistoryPrefix(userId) });
  }, [qc, userId]);

  const refreshMediaDevices = useCallback(async () => {
    try {
      const [cams, speakers] = await Promise.all([
        Room.getLocalDevices('videoinput', false),
        Room.getLocalDevices('audiooutput', false),
      ]);
      setVideoDevices(cams);
      setAudioOutputDevices(speakers);
      if (roomRef.current) {
        const activeVid = roomRef.current.getActiveDevice('videoinput') || '';
        const activeOut = roomRef.current.getActiveDevice('audiooutput') || '';
        if (activeVid) setSelectedVideoDeviceId(activeVid);
        if (activeOut) setSelectedAudioOutputId(activeOut);
      }
    } catch {
      // Ignore device enumeration errors
    }
  }, []);

  const scheduleTerminalDismiss = useCallback(
    (callId: string) => {
      clearTerminalTimer();
      terminalTimerRef.current = setTimeout(() => {
        setSession((curr) => (curr?.callId === callId ? null : curr));
        setPermissionError(null);
        setMinimized(false);
        setDurationSeconds(0);
      }, 2800);
    },
    [clearTerminalTimer]
  );

  const handleTerminalSession = useCallback(
    (incoming: CallSessionSnapshot) => {
      stopCallTones();
      dismissCallNotificationInSw(incoming.callId);
      void cleanupLiveKitRoom();
      setMinimized(false);
      setSession(incoming);
      invalidateHistory();
      scheduleTerminalDismiss(incoming.callId);
    },
    [cleanupLiveKitRoom, invalidateHistory, scheduleTerminalDismiss]
  );

  const connectToLiveKitRoom = useCallback(
    async (targetSession: CallSessionSnapshot) => {
      const { callId, callType } = targetSession;
      if (connectingCallIdRef.current === callId) return;
      if (roomRef.current && sessionRef.current?.callId === callId) return;

      await cleanupLiveKitRoom();
      connectingCallIdRef.current = callId;
      setIsMuted(false);
      setIsCameraOff(callType !== 'video');
      setPermissionError(null);

      try {
        const tokenData = await callApi.getToken(callId);

        // Ensure call wasn't cancelled/ended while awaiting token
        const latest = sessionRef.current;
        if (
          !latest ||
          latest.callId !== callId ||
          ['ended', 'rejected', 'missed', 'failed'].includes(latest.state)
        ) {
          connectingCallIdRef.current = null;
          return;
        }

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          stopLocalTrackOnUnpublish: true,
        });
        roomRef.current = room;

        const syncRemoteParticipantState = (participant: RemoteParticipant) => {
          let hasVideo = false;
          let micMuted = false;
          participant.trackPublications.forEach((pub) => {
            if (pub.source === Track.Source.Camera) {
              hasVideo = Boolean(pub.isSubscribed && pub.track && !pub.isMuted);
              if (pub.track && pub.track.kind === Track.Kind.Video && !pub.isMuted) {
                setRemoteVideoTrack(pub.track as RemoteTrack);
              }
            } else if (pub.source === Track.Source.Microphone) {
              micMuted = Boolean(pub.isMuted);
            }
          });
          setRemoteCameraEnabled(hasVideo);
          if (!hasVideo) {
            setRemoteVideoTrack(null);
          }
          setRemoteMicMuted(micMuted);
        };

        room.on(RoomEvent.Reconnecting, () => {
          setSession((prev) =>
            prev && prev.callId === callId
              ? { ...prev, state: 'reconnecting', endReason: 'Reconnecting...' }
              : prev
          );
          socket?.emit('call:state', { callId, state: 'reconnecting' });
        });

        room.on(RoomEvent.Reconnected, () => {
          setSession((prev) =>
            prev && prev.callId === callId
              ? { ...prev, state: 'connected', endReason: '' }
              : prev
          );
          socket?.emit('call:state', { callId, state: 'connected' });
        });

        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          // Unexpected drop when server session isn't already terminal
          const active = sessionRef.current;
          if (
            active &&
            active.callId === callId &&
            !['ended', 'rejected', 'missed', 'failed'].includes(active.state) &&
            reason !== DisconnectReason.CLIENT_INITIATED
          ) {
            socket?.emit('call:state', {
              callId,
              state: 'failed',
              reason: 'Disconnected from media room',
            });
          }
        });

        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          setAudioPlaybackBlocked(!room.canPlaybackAudio);
        });

        room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality) => {
          setPoorConnection(
            quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost
          );
        });

        room.on(RoomEvent.MediaDevicesChanged, () => {
          void refreshMediaDevices();
        });

        room.on(
          RoomEvent.LocalTrackPublished,
          (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.Camera && pub.track) {
              setLocalVideoTrack(pub.track as LocalVideoTrack);
              setIsCameraOff(false);
            }
          }
        );

        room.on(
          RoomEvent.LocalTrackUnpublished,
          (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.Camera) {
              setLocalVideoTrack(null);
              setIsCameraOff(true);
            }
          }
        );

        room.on(
          RoomEvent.TrackSubscribed,
          (
            track: RemoteTrack,
            _pub: RemoteTrackPublication,
            participant: RemoteParticipant
          ) => {
            if (track.kind === Track.Kind.Audio) {
              const audioEl = track.attach();
              audioEl.autoplay = true;
              audioEl.setAttribute('playsinline', 'true');
              audioEl.style.display = 'none';
              document.body.appendChild(audioEl);
              remoteAudioElsRef.current.add(audioEl);
              void room.startAudio().catch(() => {
                setAudioPlaybackBlocked(true);
              });
            } else if (track.kind === Track.Kind.Video) {
              setRemoteVideoTrack(track);
              setRemoteCameraEnabled(true);
            }
            syncRemoteParticipantState(participant);
          }
        );

        room.on(
          RoomEvent.TrackUnsubscribed,
          (
            track: RemoteTrack,
            _pub: RemoteTrackPublication,
            participant: RemoteParticipant
          ) => {
            const detached = track.detach();
            detached.forEach((el) => {
              remoteAudioElsRef.current.delete(el);
              el.remove();
            });
            if (track.kind === Track.Kind.Video) {
              setRemoteVideoTrack(null);
              setRemoteCameraEnabled(false);
            }
            syncRemoteParticipantState(participant);
          }
        );

        room.on(RoomEvent.TrackMuted, (_pub, participant) => {
          if (participant instanceof RemoteParticipant) {
            syncRemoteParticipantState(participant);
          }
        });

        room.on(RoomEvent.TrackUnmuted, (_pub, participant) => {
          if (participant instanceof RemoteParticipant) {
            syncRemoteParticipantState(participant);
          }
        });

        room.on(RoomEvent.ParticipantConnected, (participant) => {
          syncRemoteParticipantState(participant);
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
          setRemoteVideoTrack(null);
          setRemoteCameraEnabled(false);
        });

        await room.connect(tokenData.url, tokenData.token);

        // Guard if call ended while room.connect() was in flight
        const afterConnect = sessionRef.current;
        if (
          !afterConnect ||
          afterConnect.callId !== callId ||
          ['ended', 'rejected', 'missed', 'failed'].includes(afterConnect.state)
        ) {
          await cleanupLiveKitRoom();
          return;
        }

        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (micErr) {
          const msg = mapMediaPermissionError(micErr, 'voice');
          setPermissionError(msg);
          showToast(msg, 'error');
        }

        if (callType === 'video') {
          try {
            const camPub = await room.localParticipant.setCameraEnabled(true, {
              facingMode: 'user',
            });
            if (camPub?.track) {
              setLocalVideoTrack(camPub.track as LocalVideoTrack);
              setIsCameraOff(false);
            }
          } catch (camErr) {
            const msg = mapMediaPermissionError(camErr, 'video');
            setIsCameraOff(true);
            setPermissionError(msg);
            showToast(msg, 'error');
          }
        }

        setAudioPlaybackBlocked(!room.canPlaybackAudio);
        void refreshMediaDevices();

        setSession((prev) =>
          prev && prev.callId === callId
            ? {
                ...prev,
                state: 'connected',
                answeredAt: prev.answeredAt || new Date().toISOString(),
                endReason: '',
              }
            : prev
        );
        socket?.emit('call:state', { callId, state: 'connected' });
      } catch (err) {
        const msg = extractApiError(err).message || 'Failed to connect to call.';
        setPermissionError(msg);
        showToast(msg, 'error');
        socket?.emit('call:state', { callId, state: 'failed', reason: msg });
        setSession((prev) =>
          prev && prev.callId === callId
            ? { ...prev, state: 'failed', endReason: msg }
            : prev
        );
        await cleanupLiveKitRoom();
        scheduleTerminalDismiss(callId);
      } finally {
        if (connectingCallIdRef.current === callId) {
          connectingCallIdRef.current = null;
        }
      }
    },
    [
      cleanupLiveKitRoom,
      refreshMediaDevices,
      scheduleTerminalDismiss,
      showToast,
      socket,
    ]
  );

  // Manage ringback and ringtone sound loops automatically with call state
  useEffect(() => {
    if (!session) {
      stopCallTones();
      return;
    }

    if (
      session.role === 'caller' &&
      (session.state === 'initiating' || session.state === 'ringing')
    ) {
      startOutgoingRingback(soundEnabled);
    } else if (
      session.role === 'receiver' &&
      (session.state === 'initiating' || session.state === 'ringing')
    ) {
      const typeToneEnabled =
        session.callType === 'video' ? videoRingtoneEnabled : voiceRingtoneEnabled;
      const allowRing = incomingCallsEnabled && soundEnabled && typeToneEnabled;
      startIncomingRingtone(allowRing, session.callType);
    } else {
      stopCallTones();
    }

    return () => {
      stopCallTones();
    };
  }, [
    session?.callId,
    session?.role,
    session?.state,
    session?.callType,
    incomingCallsEnabled,
    voiceRingtoneEnabled,
    videoRingtoneEnabled,
    soundEnabled,
  ]);

  // Active call duration ticker
  useEffect(() => {
    if (
      !session ||
      (session.state !== 'connected' && session.state !== 'reconnecting')
    ) {
      return;
    }

    const baseAnchor = session.answeredAt
      ? new Date(session.answeredAt).getTime()
      : Date.now();

    const updateElapsed = () => {
      const secs = Math.max(0, Math.floor((Date.now() - baseAnchor) / 1000));
      setDurationSeconds(secs);
    };

    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [session?.callId, session?.state, session?.answeredAt]);

  // Clear call state completely if user logs out
  useEffect(() => {
    if (!userId) {
      stopCallTones();
      dismissCallNotificationInSw(null);
      clearTerminalTimer();
      void cleanupLiveKitRoom();
      setSession(null);
      setDurationSeconds(0);
    }
  }, [userId, cleanupLiveKitRoom, clearTerminalTimer]);

  // Socket.IO signaling event listeners
  useEffect(() => {
    if (!socket || !userId) return;

    const onIncoming = (incoming: CallSessionSnapshot) => {
      clearTerminalTimer();
      setDurationSeconds(0);
      setMinimized(false);
      setPermissionError(null);
      setSession({ ...incoming, state: 'ringing' });
      socket.emit('call:ringing', { callId: incoming.callId });
      if (vibrationEnabled && incomingCallsEnabled) {
        triggerNotificationVibration();
      }
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible' &&
        incomingCallsEnabled &&
        !hasActivePushSubRef.current
      ) {
        showBrowserNotification({
          title:
            incoming.callType === 'video'
              ? 'BlinkUpZ — Incoming Video Call'
              : 'BlinkUpZ — Incoming Voice Call',
          body:
            incoming.callType === 'video'
              ? `${incoming.peer.fullName} is starting a video call.`
              : `${incoming.peer.fullName} is calling you.`,
          tag: `blinkupz-call-${incoming.callId}`,
        });
      }
    };

    const onRinging = (updated: CallSessionSnapshot) => {
      setSession((prev) =>
        prev && prev.callId === updated.callId
          ? { ...prev, state: 'ringing', recipientOnline: true }
          : prev
      );
    };

    const onAccept = (updated: CallSessionSnapshot) => {
      stopCallTones();
      dismissCallNotificationInSw(updated.callId);
      clearTerminalTimer();
      const next: CallSessionSnapshot = {
        ...updated,
        state: 'connecting',
      };
      setSession(next);
      void connectToLiveKitRoom(next);
    };

    const onStateUpdate = (updated: CallSessionSnapshot) => {
      setSession((prev) => {
        if (!prev || prev.callId !== updated.callId) return prev;
        if (['ended', 'rejected', 'missed', 'failed'].includes(prev.state)) {
          return prev;
        }
        return {
          ...prev,
          state: updated.state,
          answeredAt: updated.answeredAt || prev.answeredAt,
          endReason: updated.endReason,
        };
      });
    };

    const onAnsweredElsewhere = (payload: { callId: string }) => {
      stopCallTones();
      dismissCallNotificationInSw(payload.callId);
      setSession((prev) => {
        if (prev && prev.callId === payload.callId && !roomRef.current) {
          return null;
        }
        return prev;
      });
    };

    const onDismissNotification = (payload: { callId?: string }) => {
      dismissCallNotificationInSw(payload?.callId || null);
    };

    const onRejected = (updated: CallSessionSnapshot) => {
      handleTerminalSession({
        ...updated,
        state: 'rejected',
        endReason: updated.endReason || 'Call rejected',
      });
    };

    const onBusy = (updated: CallSessionSnapshot) => {
      handleTerminalSession({
        ...updated,
        state: 'failed',
        endReason: updated.endReason || 'Recipient is busy on another call',
      });
    };

    const onMissed = (updated: CallSessionSnapshot) => {
      handleTerminalSession({
        ...updated,
        state: 'missed',
        endReason: updated.endReason || 'Missed call',
      });
    };

    const onFailed = (updated: CallSessionSnapshot) => {
      handleTerminalSession({
        ...updated,
        state: 'failed',
        endReason: updated.endReason || 'Call failed',
      });
    };

    const onEnded = (updated: CallSessionSnapshot) => {
      const curr = sessionRef.current;
      // Preserve more specific terminal state if already set (e.g. rejected/missed)
      if (
        curr &&
        curr.callId === updated.callId &&
        ['rejected', 'missed', 'failed'].includes(curr.state)
      ) {
        return;
      }
      handleTerminalSession(updated);
    };

    const onSync = (synced: CallSessionSnapshot) => {
      if (
        synced.role === 'receiver' &&
        (synced.state === 'initiating' || synced.state === 'ringing')
      ) {
        setSession({ ...synced, state: 'ringing' });
        socket.emit('call:ringing', { callId: synced.callId });
      } else if (
        ['connecting', 'connected', 'reconnecting'].includes(synced.state) &&
        !roomRef.current
      ) {
        // Recover active session after reconnect if room was lost
        setSession(synced);
        if (synced.role === 'caller' || synced.state !== 'connecting') {
          void connectToLiveKitRoom(synced);
        }
      } else {
        setSession(synced);
      }
    };

    const onHistoryUpdated = () => {
      invalidateHistory();
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:ringing', onRinging);
    socket.on('call:accept', onAccept);
    socket.on('call:state', onStateUpdate);
    socket.on('call:answered_elsewhere', onAnsweredElsewhere);
    socket.on('call:dismiss_notification', onDismissNotification);
    socket.on('call:reject', onRejected);
    socket.on('call:decline', onRejected);
    socket.on('call:busy', onBusy);
    socket.on('call:missed', onMissed);
    socket.on('call:failed', onFailed);
    socket.on('call:cancel', onEnded);
    socket.on('call:ended', onEnded);
    socket.on('call:sync', onSync);
    socket.on('call:history_updated', onHistoryUpdated);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:ringing', onRinging);
      socket.off('call:accept', onAccept);
      socket.off('call:state', onStateUpdate);
      socket.off('call:answered_elsewhere', onAnsweredElsewhere);
      socket.off('call:dismiss_notification', onDismissNotification);
      socket.off('call:reject', onRejected);
      socket.off('call:decline', onRejected);
      socket.off('call:busy', onBusy);
      socket.off('call:missed', onMissed);
      socket.off('call:failed', onFailed);
      socket.off('call:cancel', onEnded);
      socket.off('call:ended', onEnded);
      socket.off('call:sync', onSync);
      socket.off('call:history_updated', onHistoryUpdated);
    };
  }, [
    socket,
    userId,
    incomingCallsEnabled,
    vibrationEnabled,
    clearTerminalTimer,
    connectToLiveKitRoom,
    handleTerminalSession,
    invalidateHistory,
  ]);

  const startCall = useCallback(
    async ({ recipientId, callType, conversationId, peerHint }: StartCallInput) => {
      if (!user) {
        showToast('Please sign in to place a call.', 'error');
        return;
      }
      if (!socket?.connected) {
        showToast('Real-time connection unavailable. Check your internet connection.', 'error');
        return;
      }
      const existing = sessionRef.current;
      if (
        existing &&
        !['idle', 'ended', 'rejected', 'missed', 'failed'].includes(existing.state)
      ) {
        showToast('You already have an active call.', 'info');
        return;
      }

      clearTerminalTimer();
      setDurationSeconds(0);
      setMinimized(false);
      setPermissionError(null);

      try {
        await preflightMediaPermissions(callType);
      } catch (err) {
        const msg =
          (err as Error)?.message || 'Microphone/camera permission is required to call.';
        setPermissionError(msg);
        showToast(msg, 'error');
        return;
      }

      // Show immediate initiating screen with peer hint while server verifies & rings
      cancelledPendingRef.current = false;
      const optimisticTempId = `pending_${Date.now()}`;
      setSession({
        callId: optimisticTempId,
        roomName: '',
        conversationId: conversationId || null,
        callType,
        role: 'caller',
        state: 'initiating',
        peer: {
          id: recipientId,
          fullName: peerHint?.fullName || 'Calling...',
          username: peerHint?.username || '',
          avatar: peerHint?.avatar || '',
        },
        startedAt: new Date().toISOString(),
        answeredAt: null,
        endedAt: null,
        endReason: '',
      });

      const ack = await new Promise<{
        ok: boolean;
        data?: CallSessionSnapshot;
        code?: string;
        message?: string;
      }>((resolve) => {
        socket
          .timeout(8000)
          .emit(
            'call:initiate',
            { recipientId, callType, conversationId: conversationId || null },
            (
              err: Error | null,
              res?: {
                ok: boolean;
                data?: CallSessionSnapshot;
                code?: string;
                message?: string;
              }
            ) => {
              if (err) {
                resolve({ ok: false, message: 'Call request timed out.' });
                return;
              }
              resolve(res || { ok: false, message: 'No response from server.' });
            }
          );
      });

      if (!ack.ok || !ack.data) {
        const errMsg = ack.message || 'Could not start call.';
        if (ack.code === 'RECIPIENT_BUSY') {
          setSession((prev) =>
            prev
              ? { ...prev, state: 'failed', endReason: 'Recipient is busy on another call' }
              : null
          );
          scheduleTerminalDismiss(optimisticTempId);
        } else {
          setSession(null);
          showToast(errMsg, 'error');
        }
        invalidateHistory();
        return;
      }

      if (cancelledPendingRef.current) {
        cancelledPendingRef.current = false;
        socket.emit('call:cancel', {
          callId: ack.data.callId,
          reason: 'Call cancelled',
        });
        return;
      }

      setSession((curr) => {
        // Keep ringing state if `call:ringing` arrived before ack
        if (curr && curr.callId === ack.data!.callId && curr.state === 'ringing') {
          return curr;
        }
        return ack.data!;
      });
    },
    [
      user,
      socket,
      clearTerminalTimer,
      invalidateHistory,
      scheduleTerminalDismiss,
      showToast,
    ]
  );

  const acceptSessionFlow = useCallback(
    async (targetSession: CallSessionSnapshot) => {
      if (targetSession.role !== 'receiver') return;

      stopCallTones();
      dismissCallNotificationInSw(targetSession.callId);
      setPermissionError(null);

      try {
        await preflightMediaPermissions(targetSession.callType);
      } catch (err) {
        const msg =
          (err as Error)?.message || 'Permission required to answer call.';
        setPermissionError(msg);
        showToast(msg, 'error');
        return;
      }

      let acceptedSession: CallSessionSnapshot | null = null;

      if (socket?.connected) {
        const ack = await new Promise<{
          ok: boolean;
          data?: CallSessionSnapshot;
          message?: string;
        }>((resolve) => {
          socket
            .timeout(8000)
            .emit(
              'call:accept',
              { callId: targetSession.callId },
              (
                err: Error | null,
                res?: { ok: boolean; data?: CallSessionSnapshot; message?: string }
              ) => {
                if (err) {
                  resolve({ ok: false, message: 'Accept request timed out.' });
                  return;
                }
                resolve(res || { ok: false, message: 'Failed to accept call.' });
              }
            );
        });

        if (ack.ok && ack.data) {
          acceptedSession = ack.data;
        } else {
          showToast(ack.message || 'Call is no longer available.', 'error');
          setSession(null);
          return;
        }
      } else {
        try {
          acceptedSession = await callApi.accept(targetSession.callId);
        } catch (err) {
          showToast(
            extractApiError(err).message || 'Call is no longer available.',
            'error'
          );
          setSession(null);
          return;
        }
      }

      const next: CallSessionSnapshot = { ...acceptedSession, state: 'connecting' };
      setSession(next);
      void connectToLiveKitRoom(next);
    },
    [socket, connectToLiveKitRoom, showToast]
  );

  const acceptIncomingCall = useCallback(async () => {
    const curr = sessionRef.current;
    if (!curr || curr.role !== 'receiver') return;
    await acceptSessionFlow(curr);
  }, [acceptSessionFlow]);

  const hydrateIncomingCallFromNotification = useCallback(
    async (callId: string, action: 'open' | 'accept') => {
      if (!userId || !callId) return;
      const dedupeKey = `${callId}:${action}`;
      if (handlingDeepLinkRef.current === dedupeKey) return;
      handlingDeepLinkRef.current = dedupeKey;

      try {
        const current = sessionRef.current;
        if (
          current &&
          current.callId === callId &&
          ['connecting', 'connected', 'reconnecting'].includes(current.state)
        ) {
          return;
        }

        const result = await callApi.getCall(callId);
        if (!result.canAccept || result.isExpired) {
          dismissCallNotificationInSw(callId);
          const msg =
            result.session.endReason ||
            (result.isExpired
              ? 'This incoming call has expired.'
              : 'This call is no longer active.');
          showToast(msg, 'info');
          invalidateHistory();
          return;
        }

        clearTerminalTimer();
        setDurationSeconds(0);
        setMinimized(false);
        setPermissionError(null);
        const ringingSnapshot: CallSessionSnapshot = {
          ...result.session,
          state: 'ringing',
        };
        setSession(ringingSnapshot);

        if (socket?.connected) {
          socket.emit('call:ringing', { callId });
        }

        if (action === 'accept') {
          await acceptSessionFlow(ringingSnapshot);
        } else if (vibrationEnabled && incomingCallsEnabled) {
          triggerNotificationVibration();
        }
      } catch (err) {
        dismissCallNotificationInSw(callId);
        showToast(
          extractApiError(err).message || 'This incoming call is no longer available.',
          'info'
        );
      } finally {
        setTimeout(() => {
          if (handlingDeepLinkRef.current === dedupeKey) {
            handlingDeepLinkRef.current = null;
          }
        }, 1500);
      }
    },
    [
      userId,
      socket,
      incomingCallsEnabled,
      vibrationEnabled,
      clearTerminalTimer,
      acceptSessionFlow,
      invalidateHistory,
      showToast,
    ]
  );

  // Handle incoming call query params from opened PWA/browser notification clicks
  useEffect(() => {
    if (!userId || !location.search) return;
    const params = new URLSearchParams(location.search);
    const incomingCallId = params.get('incomingCall');
    if (!incomingCallId) return;

    const callAction = params.get('callAction') === 'accept' ? 'accept' : 'open';
    const callStatus = params.get('callStatus');

    params.delete('incomingCall');
    params.delete('callAction');
    params.delete('callStatus');
    const cleanSearch = params.toString();
    navigate(
      `${location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}`,
      { replace: true }
    );

    if (callStatus === 'expired') {
      dismissCallNotificationInSw(incomingCallId);
      showToast('This incoming call has already ended.', 'info');
      return;
    }

    void hydrateIncomingCallFromNotification(incomingCallId, callAction);
  }, [
    userId,
    location.pathname,
    location.search,
    navigate,
    hydrateIncomingCallFromNotification,
    showToast,
  ]);

  // Listen to Service Worker push notification actions & click messages while app is running
  useEffect(() => {
    if (!userId || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        callId?: string;
        action?: 'open' | 'accept';
        canAccept?: boolean;
        url?: string;
      } | null;

      if (!data?.type) return;

      if (data.type === 'BLINKUPZ_INCOMING_CALL' && data.callId) {
        if (typeof data.url === 'string' && data.url.startsWith('/')) {
          const cleanPath = data.url.split('?')[0];
          if (cleanPath && cleanPath !== location.pathname) {
            navigate(cleanPath);
          }
        }
        if (data.canAccept === false) {
          dismissCallNotificationInSw(data.callId);
          showToast('This incoming call has already ended.', 'info');
          return;
        }
        void hydrateIncomingCallFromNotification(
          data.callId,
          data.action === 'accept' ? 'accept' : 'open'
        );
        return;
      }

      if (data.type === 'BLINKUPZ_SYNC_ACTIVE_CALL' && data.callId) {
        const curr = sessionRef.current;
        if (!curr || curr.callId !== data.callId) {
          void hydrateIncomingCallFromNotification(data.callId, 'open');
        }
        return;
      }

      if (data.type === 'BLINKUPZ_CALL_DECLINED_FROM_NOTIFICATION' && data.callId) {
        if (sessionRef.current?.callId === data.callId) {
          stopCallTones();
          setSession(null);
        }
        invalidateHistory();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [
    userId,
    location.pathname,
    navigate,
    hydrateIncomingCallFromNotification,
    invalidateHistory,
    showToast,
  ]);

  const rejectIncomingCall = useCallback(async () => {
    const curr = sessionRef.current;
    if (!curr) return;
    stopCallTones();
    dismissCallNotificationInSw(curr.callId);
    if (socket?.connected) {
      socket.emit('call:reject', { callId: curr.callId, reason: 'Call rejected' });
    } else {
      void callApi.decline(curr.callId, 'Call rejected').catch(() => {});
    }
    handleTerminalSession({
      ...curr,
      state: 'rejected',
      endedAt: new Date().toISOString(),
      endReason: 'Call rejected',
    });
  }, [socket, handleTerminalSession]);

  const cancelOutgoingCall = useCallback(async () => {
    const curr = sessionRef.current;
    if (!curr) return;
    stopCallTones();
    if (curr.callId.startsWith('pending_')) {
      cancelledPendingRef.current = true;
    } else if (socket?.connected) {
      socket.emit('call:cancel', { callId: curr.callId, reason: 'Call cancelled' });
    }
    handleTerminalSession({
      ...curr,
      state: 'ended',
      endedAt: new Date().toISOString(),
      endReason: 'Call cancelled',
    });
  }, [socket, handleTerminalSession]);

  const endActiveCall = useCallback(async () => {
    const curr = sessionRef.current;
    if (!curr) return;
    stopCallTones();
    if (socket?.connected && !curr.callId.startsWith('pending_')) {
      socket.emit('call:end', { callId: curr.callId, reason: 'Call ended' });
    }
    handleTerminalSession({
      ...curr,
      state: 'ended',
      endedAt: new Date().toISOString(),
      endReason: 'Call ended',
    });
  }, [socket, handleTerminalSession]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !isMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMuted(nextMuted);
    } catch (err) {
      showToast(mapMediaPermissionError(err, 'voice'), 'error');
    }
  }, [isMuted, showToast]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextOff = !isCameraOff;
    try {
      const pub = await room.localParticipant.setCameraEnabled(!nextOff, {
        facingMode: facingModeRef.current,
      });
      setIsCameraOff(nextOff);
      setLocalVideoTrack(nextOff ? null : ((pub?.track as LocalVideoTrack) || null));
    } catch (err) {
      showToast(mapMediaPermissionError(err, 'video'), 'error');
    }
  }, [isCameraOff, showToast]);

  const switchCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const cams = await Room.getLocalDevices('videoinput', false);
      setVideoDevices(cams);

      if (cams.length > 1) {
        const currentId = room.getActiveDevice('videoinput') || selectedVideoDeviceId;
        const idx = cams.findIndex((d) => d.deviceId === currentId);
        const nextDevice = cams[(idx + 1) % cams.length];
        await room.switchActiveDevice('videoinput', nextDevice.deviceId);
        setSelectedVideoDeviceId(nextDevice.deviceId);
        return;
      }

      // Fallback facingMode toggle for mobile browsers exposing 1 virtual device
      const nextFacing = facingModeRef.current === 'user' ? 'environment' : 'user';
      facingModeRef.current = nextFacing;
      if (localVideoTrack) {
        await localVideoTrack.restartTrack({ facingMode: nextFacing });
      }
    } catch (err) {
      showToast((err as Error)?.message || 'Unable to switch camera.', 'error');
    }
  }, [localVideoTrack, selectedVideoDeviceId, showToast]);

  const switchAudioOutput = useCallback(
    async (deviceId: string) => {
      const room = roomRef.current;
      if (!room || !supportsAudioOutputSwitch) return;
      try {
        await room.switchActiveDevice('audiooutput', deviceId);
        setSelectedAudioOutputId(deviceId);
      } catch {
        showToast('Could not switch audio output device on this browser.', 'error');
      }
    },
    [supportsAudioOutputSwitch, showToast]
  );

  const unlockAudioPlayback = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setAudioPlaybackBlocked(!room.canPlaybackAudio);
    } catch {
      // Ignore error
    }
  }, []);

  const dismissEndedNotice = useCallback(() => {
    clearTerminalTimer();
    setSession(null);
    setPermissionError(null);
    setMinimized(false);
    setDurationSeconds(0);
  }, [clearTerminalTimer]);

  return (
    <CallContext.Provider
      value={{
        session,
        callState,
        durationSeconds,
        isMuted,
        isCameraOff,
        remoteCameraEnabled,
        remoteMicMuted,
        poorConnection,
        audioPlaybackBlocked,
        localVideoTrack,
        remoteVideoTrack,
        videoDevices,
        audioOutputDevices,
        selectedVideoDeviceId,
        selectedAudioOutputId,
        supportsAudioOutputSwitch,
        permissionError,
        minimized,
        setMinimized,
        startCall,
        acceptIncomingCall,
        rejectIncomingCall,
        cancelOutgoingCall,
        endActiveCall,
        toggleMute,
        toggleCamera,
        switchCamera,
        switchAudioOutput,
        unlockAudioPlayback,
        dismissEndedNotice,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used inside CallProvider');
  }
  return ctx;
}
