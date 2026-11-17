import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  RefreshCw,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { useCall } from '../context/CallContext';
import { formatDuration } from '../utils/formatters';
import { UserAvatar } from './UserAvatar';

export function CallOverlay() {
  const {
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
    selectedAudioOutputId,
    supportsAudioOutputSwitch,
    permissionError,
    minimized,
    setMinimized,
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
  } = useCall();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [speakerMenuOpen, setSpeakerMenuOpen] = useState(false);

  // Draggable PiP offset for local video preview
  const [pipOffset, setPipOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setPipOffset({ x: 0, y: 0 });
    setSpeakerMenuOpen(false);
  }, [session?.callId]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el || !remoteVideoTrack) return;
    remoteVideoTrack.attach(el);
    return () => {
      remoteVideoTrack.detach(el);
    };
  }, [remoteVideoTrack, minimized, remoteCameraEnabled]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el || !localVideoTrack || isCameraOff) return;
    localVideoTrack.attach(el);
    return () => {
      localVideoTrack.detach(el);
    };
  }, [localVideoTrack, isCameraOff, minimized]);

  if (!session || callState === 'idle') {
    return null;
  }

  const isTerminal = ['ended', 'rejected', 'missed', 'failed'].includes(callState);
  const isIncomingRing =
    session.role === 'receiver' &&
    (callState === 'initiating' || callState === 'ringing');
  const isOutgoingRing =
    session.role === 'caller' &&
    (callState === 'initiating' || callState === 'ringing');
  const isActivePhase = ['connecting', 'connected', 'reconnecting'].includes(callState);
  const isVideoCall = session.callType === 'video';

  const getStatusLabel = (): string => {
    if (callState === 'initiating') {
      return session.recipientOnline === false ? 'Calling...' : 'Calling...';
    }
    if (callState === 'ringing') {
      return session.role === 'receiver'
        ? `Incoming ${session.callType} call`
        : 'Ringing...';
    }
    if (callState === 'connecting') return 'Connecting...';
    if (callState === 'reconnecting') return 'Reconnecting...';
    if (callState === 'connected') return formatDuration(durationSeconds);
    if (callState === 'rejected') return session.endReason || 'Call rejected';
    if (callState === 'missed') return session.endReason || 'No answer';
    if (callState === 'failed') return session.endReason || 'Call failed';
    if (callState === 'ended') return session.endReason || 'Call ended';
    return '';
  };

  // Compact floating card when user minimizes an active call to glance at chat
  if (minimized && isActivePhase) {
    return (
      <div
        role="region"
        aria-label="Active call mini bar"
        className="fixed top-4 right-4 z-50 w-72 rounded-2xl bg-[#242424] border border-[#303030] shadow-2xl p-3 flex items-center gap-3"
      >
        <UserAvatar
          src={session.peer.avatar}
          name={session.peer.fullName}
          size="sm"
          online={callState === 'connected'}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#FFFFFF] truncate">
            {session.peer.fullName}
          </p>
          <p
            className={`text-xs font-mono tabular-nums truncate ${
              callState === 'reconnecting' ? 'text-[#E5484D]' : 'text-[#22C55E]'
            }`}
          >
            {getStatusLabel()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void toggleMute()}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
            isMuted
              ? 'bg-[#FFFFFF] text-[#181818]'
              : 'bg-[#181818] text-[#FFFFFF] hover:bg-[#303030]'
          }`}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand call window"
          className="w-9 h-9 rounded-xl bg-[#181818] text-[#FFFFFF] hover:bg-[#303030] flex items-center justify-center cursor-pointer"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => void endActiveCall()}
          aria-label="End call"
          className="w-9 h-9 rounded-xl bg-[#E5484D] text-[#FFFFFF] hover:opacity-90 flex items-center justify-center cursor-pointer"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${session.callType === 'video' ? 'Video' : 'Voice'} call with ${session.peer.fullName}`}
      className="fixed inset-0 z-50 bg-[#181818] text-[#FFFFFF] flex flex-col justify-between overflow-hidden select-none"
    >
      {/* Active Video Remote Stage (background full-bleed inside overlay) */}
      {isActivePhase && isVideoCall && remoteCameraEnabled && remoteVideoTrack && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover bg-[#181818]"
        />
      )}

      {/* Subtle dark gradient readability veil for video controls */}
      {isActivePhase && isVideoCall && remoteCameraEnabled && remoteVideoTrack && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#181818]/75 via-transparent to-[#181818]/85"
        />
      )}

      {/* Top Bar */}
      <header className="relative z-10 px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#242424]/90 border border-[#303030] text-xs font-medium text-[#FFFFFF]">
            {isVideoCall ? (
              <Video className="w-3.5 h-3.5 text-[#22C55E]" />
            ) : (
              <Phone className="w-3.5 h-3.5 text-[#22C55E]" />
            )}
            <span>{isVideoCall ? 'Video Call' : 'Voice Call'}</span>
          </span>

          {poorConnection && isActivePhase && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E5484D]/15 border border-[#E5484D]/40 text-xs text-[#E5484D]">
              <Wifi className="w-3.5 h-3.5" />
              <span>Poor connection</span>
            </span>
          )}

          {callState === 'reconnecting' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#242424] border border-[#303030] text-xs text-[#FFFFFF]">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E5484D]" />
              <span>Reconnecting...</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isActivePhase && (
            <button
              type="button"
              onClick={() => setMinimized(true)}
              aria-label="Minimize call screen"
              className="w-10 h-10 rounded-xl bg-[#242424]/90 border border-[#303030] text-[#FFFFFF] hover:bg-[#303030] flex items-center justify-center cursor-pointer"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
          {isTerminal && (
            <button
              type="button"
              onClick={dismissEndedNotice}
              aria-label="Close call screen"
              className="w-10 h-10 rounded-xl bg-[#242424] border border-[#303030] text-[#FFFFFF] hover:bg-[#303030] flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Center Participant Stage (always shown for Voice, Ringing, Terminal, or when Remote Camera is off) */}
      {(!isActivePhase || !isVideoCall || !remoteCameraEnabled || !remoteVideoTrack) && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="relative mb-6">
            {(isIncomingRing || isOutgoingRing) && (
              <span
                aria-hidden="true"
                className="absolute -inset-3 rounded-full border border-[#22C55E]/40 animate-ping"
              />
            )}
            <div className="relative rounded-full p-1 bg-[#242424] border border-[#303030]">
              <UserAvatar
                src={session.peer.avatar}
                name={session.peer.fullName}
                size="xl"
              />
            </div>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#FFFFFF]">
            {session.peer.fullName}
          </h2>
          {session.peer.username && (
            <p className="text-sm text-[#999999] mt-1">@{session.peer.username}</p>
          )}

          <p
            className={`mt-4 text-sm font-medium ${
              callState === 'connected'
                ? 'text-[#22C55E] font-mono tabular-nums text-base'
                : callState === 'rejected' ||
                    callState === 'missed' ||
                    callState === 'failed'
                  ? 'text-[#E5484D]'
                  : 'text-[#999999]'
            }`}
          >
            {getStatusLabel()}
          </p>

          {isActivePhase && remoteMicMuted && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#242424] border border-[#303030] text-xs text-[#999999]">
              <MicOff className="w-3.5 h-3.5 text-[#E5484D]" />
              <span>{session.peer.fullName} muted microphone</span>
            </div>
          )}

          {isActivePhase && isVideoCall && !remoteCameraEnabled && (
            <p className="mt-2 text-xs text-[#999999]">
              {callState === 'connecting'
                ? 'Establishing encrypted video stream...'
                : 'Remote camera is off'}
            </p>
          )}

          {permissionError && (
            <div className="mt-5 max-w-md rounded-xl bg-[#242424] border border-[#E5484D]/40 px-4 py-3 text-xs text-[#FFFFFF] flex items-start gap-2.5 text-left">
              <AlertCircle className="w-4 h-4 text-[#E5484D] shrink-0 mt-0.5" />
              <span>{permissionError}</span>
            </div>
          )}
        </div>
      )}

      {/* Compact Top Info Overlay when Remote Video IS Active */}
      {isActivePhase && isVideoCall && remoteCameraEnabled && remoteVideoTrack && (
        <div className="relative z-10 px-6 flex flex-col items-start pointer-events-none">
          <h2 className="text-lg sm:text-xl font-bold text-[#FFFFFF] drop-shadow">
            {session.peer.fullName}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-mono tabular-nums text-[#22C55E] drop-shadow">
              {getStatusLabel()}
            </span>
            {remoteMicMuted && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#242424]/90 border border-[#303030] text-[11px] text-[#FFFFFF]">
                <MicOff className="w-3 h-3 text-[#E5484D]" />
                Muted
              </span>
            )}
          </div>
        </div>
      )}

      {/* Draggable Local Camera PiP View during Video Call */}
      {isActivePhase && isVideoCall && (
        <div
          style={{
            transform: `translate(${pipOffset.x}px, ${pipOffset.y}px)`,
          }}
          onPointerDown={(e) => {
            dragStateRef.current = {
              dragging: true,
              startX: e.clientX,
              startY: e.clientY,
              originX: pipOffset.x,
              originY: pipOffset.y,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!dragStateRef.current?.dragging) return;
            setPipOffset({
              x: dragStateRef.current.originX + (e.clientX - dragStateRef.current.startX),
              y: dragStateRef.current.originY + (e.clientY - dragStateRef.current.startY),
            });
          }}
          onPointerUp={() => {
            if (dragStateRef.current) dragStateRef.current.dragging = false;
          }}
          aria-label="Your local camera preview"
          className="absolute right-4 sm:right-6 bottom-28 sm:bottom-32 z-20 w-28 sm:w-36 aspect-[3/4] rounded-2xl overflow-hidden bg-[#242424] border border-[#303030] shadow-2xl touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          {!isCameraOff && localVideoTrack ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover -scale-x-100"
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-2 text-center">
              <VideoOff className="w-5 h-5 text-[#999999]" />
              <span className="text-[11px] text-[#999999]">Camera off</span>
            </div>
          )}
        </div>
      )}

      {/* Browser Audio Playback Unblock Banner (iOS/Safari policy) */}
      {isActivePhase && audioPlaybackBlocked && (
        <div className="relative z-20 mx-auto mb-3 px-4">
          <button
            type="button"
            onClick={() => void unlockAudioPlayback()}
            className="px-4 py-2 rounded-xl bg-[#22C55E] text-[#181818] text-xs font-semibold hover:opacity-90 cursor-pointer"
          >
            Tap to enable call audio
          </button>
        </div>
      )}

      {/* Bottom Controls Dock */}
      <footer className="relative z-20 px-4 sm:px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-4">
        <div className="max-w-md mx-auto">
          {/* Incoming Ring Controls */}
          {isIncomingRing && (
            <div className="flex items-center justify-center gap-10">
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => void rejectIncomingCall()}
                  aria-label="Reject incoming call"
                  className="w-16 h-16 rounded-full bg-[#E5484D] text-[#FFFFFF] hover:opacity-90 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>
                <span className="text-xs text-[#999999]">Decline</span>
              </div>

              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => void acceptIncomingCall()}
                  aria-label="Accept incoming call"
                  className="w-16 h-16 rounded-full bg-[#22C55E] text-[#181818] hover:opacity-90 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
                >
                  {isVideoCall ? (
                    <Video className="w-6 h-6" />
                  ) : (
                    <Phone className="w-6 h-6" />
                  )}
                </button>
                <span className="text-xs text-[#FFFFFF] font-medium">Accept</span>
              </div>
            </div>
          )}

          {/* Outgoing Ring Controls */}
          {isOutgoingRing && (
            <div className="flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => void cancelOutgoingCall()}
                  aria-label="Cancel outgoing call"
                  className="w-16 h-16 rounded-full bg-[#E5484D] text-[#FFFFFF] hover:opacity-90 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>
                <span className="text-xs text-[#999999]">Cancel</span>
              </div>
            </div>
          )}

          {/* Active Call Controls */}
          {isActivePhase && (
            <div className="relative rounded-2xl bg-[#242424]/95 border border-[#303030] p-3 flex items-center justify-around gap-2 shadow-2xl">
              {/* Mute / Unmute */}
              <button
                type="button"
                onClick={() => void toggleMute()}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                  isMuted
                    ? 'bg-[#FFFFFF] text-[#181818]'
                    : 'bg-[#181818] text-[#FFFFFF] hover:bg-[#303030]'
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Camera On/Off (for Video Calls) */}
              {isVideoCall && (
                <button
                  type="button"
                  onClick={() => void toggleCamera()}
                  aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    isCameraOff
                      ? 'bg-[#FFFFFF] text-[#181818]'
                      : 'bg-[#181818] text-[#FFFFFF] hover:bg-[#303030]'
                  }`}
                >
                  {isCameraOff ? (
                    <VideoOff className="w-5 h-5" />
                  ) : (
                    <Video className="w-5 h-5" />
                  )}
                </button>
              )}

              {/* Switch Camera (Video Calls when camera is on) */}
              {isVideoCall && (videoDevices.length > 1 || !isCameraOff) && (
                <button
                  type="button"
                  onClick={() => void switchCamera()}
                  disabled={isCameraOff}
                  aria-label="Switch camera"
                  className="w-12 h-12 rounded-xl bg-[#181818] text-[#FFFFFF] hover:bg-[#303030] disabled:opacity-40 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>
              )}

              {/* Audio Output / Speaker Selector (where supported) */}
              {supportsAudioOutputSwitch && audioOutputDevices.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSpeakerMenuOpen((p) => !p)}
                    aria-label="Audio output device"
                    className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      speakerMenuOpen
                        ? 'bg-[#FFFFFF] text-[#181818]'
                        : 'bg-[#181818] text-[#FFFFFF] hover:bg-[#303030]'
                    }`}
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>

                  {speakerMenuOpen && (
                    <div className="absolute bottom-16 right-0 w-60 rounded-xl bg-[#242424] border border-[#303030] shadow-2xl p-1.5 space-y-1 z-30">
                      <p className="px-2.5 py-1 text-[11px] font-medium text-[#999999]">
                        Audio Output
                      </p>
                      {audioOutputDevices.map((dev, idx) => {
                        const active = dev.deviceId === selectedAudioOutputId;
                        return (
                          <button
                            key={dev.deviceId || idx}
                            type="button"
                            onClick={() => {
                              void switchAudioOutput(dev.deviceId);
                              setSpeakerMenuOpen(false);
                            }}
                            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs truncate cursor-pointer ${
                              active
                                ? 'bg-[#FFFFFF] text-[#181818] font-medium'
                                : 'text-[#FFFFFF] hover:bg-[#303030]'
                            }`}
                          >
                            {dev.label || `Speaker ${idx + 1}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* End Call */}
              <button
                type="button"
                onClick={() => void endActiveCall()}
                aria-label="End active call"
                className="w-12 h-12 rounded-xl bg-[#E5484D] text-[#FFFFFF] hover:opacity-90 flex items-center justify-center transition-colors cursor-pointer"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Terminal Notice Close Button */}
          {isTerminal && (
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={dismissEndedNotice}
                className="px-6 py-2.5 rounded-xl bg-[#242424] border border-[#303030] text-sm font-medium text-[#FFFFFF] hover:bg-[#303030] cursor-pointer"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
