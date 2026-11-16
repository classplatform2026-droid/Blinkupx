import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Eye,
  Laptop,
  MessageSquare,
  Smartphone,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractApiError, pushApi, userApi } from '../../services/api';
import type {
  NotificationSoundTone,
  PushDeviceSubscription,
  UserNotificationSettings,
} from '../../types';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getBrowserNotificationState,
  isVibrationSupported,
  playNotificationTone,
  SOUND_TONE_OPTIONS,
  triggerNotificationVibration,
  type BrowserNotificationSupportState,
} from '../../utils/notifications';
import {
  disableBrowserPushSubscription,
  enableBrowserPushSubscription,
  getActiveBrowserPushSubscription,
  getOrCreatePushDeviceId,
  isWebPushSupported,
} from '../../utils/pushNotifications';

function formatRelativeDeviceTime(iso?: string): string {
  if (!iso) return 'Just now';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationSettingsPage() {
  const navigate = useNavigate();
  const { user, setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<BrowserNotificationSupportState>(
    getBrowserNotificationState
  );
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [devices, setDevices] = useState<PushDeviceSubscription[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);

  const webPushSupported = isWebPushSupported();
  const vibrationSupported = isVibrationSupported();
  const currentDeviceId = getOrCreatePushDeviceId();

  const loadPushState = useCallback(async () => {
    setBrowserPerm(getBrowserNotificationState());
    const [activeSub, listRes] = await Promise.all([
      getActiveBrowserPushSubscription(),
      pushApi.listSubscriptions().catch(() => null),
    ]);
    setDeviceSubscribed(Boolean(activeSub));
    if (listRes) {
      setDevices(listRes);
    }
    setLoadingDevices(false);
  }, []);

  useEffect(() => {
    loadPushState();
  }, [loadPushState]);

  if (!user) return null;

  const notifications: UserNotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(user.settings?.notifications || {}),
  };

  const notifyPushChanged = () => {
    window.dispatchEvent(new CustomEvent('blinkupz:push-subscription-changed'));
  };

  const updateNotificationField = async <
    K extends keyof UserNotificationSettings,
  >(
    key: K,
    value: UserNotificationSettings[K]
  ) => {
    setSavingKey(String(key));
    try {
      const res = await userApi.updateNotifications({ [key]: value });
      setAuthenticatedUser(res.data);
      notifyPushChanged();
      showToast('Notification preference saved.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleEnablePush = async () => {
    if (!webPushSupported) {
      showToast('Web Push is not supported in this browser.', 'error');
      return;
    }
    setPushBusy(true);
    try {
      const result = await enableBrowserPushSubscription(true);
      setBrowserPerm(result.permission);
      if (result.permission === 'granted') {
        setDeviceSubscribed(true);
        setDevices(result.subscriptions);
        if (result.user) {
          setAuthenticatedUser(result.user);
        }
        notifyPushChanged();
        showToast('Push notifications enabled for this device.', 'success');
      } else if (result.permission === 'denied') {
        showToast(
          'Notification permission was blocked. Please allow it in browser site settings.',
          'error'
        );
      } else {
        showToast('Notification permission was dismissed.', 'info');
      }
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async (disablePreference = true) => {
    setPushBusy(true);
    try {
      const result = await disableBrowserPushSubscription(disablePreference);
      setDeviceSubscribed(false);
      setDevices(result.subscriptions);
      if (result.user) {
        setAuthenticatedUser(result.user);
      }
      notifyPushChanged();
      showToast('Push notifications disabled on this device.', 'info');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTogglePushMaster = async () => {
    if (notifications.pushEnabled && deviceSubscribed) {
      await handleDisablePush(true);
    } else if (!notifications.pushEnabled && browserPerm === 'granted' && deviceSubscribed) {
      await updateNotificationField('pushEnabled', true);
    } else if (notifications.pushEnabled && !deviceSubscribed) {
      await handleEnablePush();
    } else {
      await handleEnablePush();
    }
  };

  const handleRemoveDevice = async (sub: PushDeviceSubscription) => {
    setRemovingDeviceId(sub.id);
    try {
      if (sub.deviceId === currentDeviceId) {
        await handleDisablePush(false);
      } else {
        const res = await pushApi.removeSubscriptionById(sub.id);
        setDevices(res.data);
        showToast('Device subscription removed.', 'success');
      }
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setRemovingDeviceId(null);
    }
  };

  const categoryRows: Array<{
    key:
      | 'privateMessages'
      | 'groupMessages'
      | 'communityMessages'
      | 'communityActivity';
    title: string;
    desc: string;
  }> = [
    {
      key: 'privateMessages',
      title: 'Private Messages',
      desc: 'Alerts for incoming 1:1 direct messages',
    },
    {
      key: 'groupMessages',
      title: 'Group Messages',
      desc: 'Alerts for new messages inside group chats',
    },
    {
      key: 'communityMessages',
      title: 'Community Messages',
      desc: 'Alerts for messages posted inside community channels',
    },
    {
      key: 'communityActivity',
      title: 'Community Activity',
      desc: 'Join requests, approvals, invites, and role or membership updates',
    },
  ];

  const permissionBadge =
    !webPushSupported || browserPerm === 'unsupported'
      ? { label: 'Unsupported', tone: 'text-[#999999] bg-[#242424] border-[#303030]' }
      : browserPerm === 'granted' && deviceSubscribed && notifications.pushEnabled
        ? { label: 'Active', tone: 'text-[#22C55E] bg-[#22C55E]/10 border-[#22C55E]/30' }
        : browserPerm === 'granted' && !notifications.pushEnabled
          ? { label: 'Paused', tone: 'text-[#999999] bg-[#242424] border-[#303030]' }
          : browserPerm === 'granted'
            ? { label: 'Permitted · Off on device', tone: 'text-[#999999] bg-[#242424] border-[#303030]' }
            : browserPerm === 'denied'
              ? { label: 'Blocked in browser', tone: 'text-[#E5484D] bg-[#E5484D]/10 border-[#E5484D]/30' }
              : { label: 'Not enabled', tone: 'text-[#999999] bg-[#242424] border-[#303030]' };

  const masterSwitchOn =
    notifications.pushEnabled && browserPerm === 'granted' && deviceSubscribed;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Notifications"
        showBack
        onBack={() => navigate('/profile')}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Web Push Master Control & Permission */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                {masterSwitchOn ? (
                  <Bell className="w-4 h-4 text-[#22C55E] mt-0.5 shrink-0" />
                ) : (
                  <BellOff className="w-4 h-4 text-[#999999] mt-0.5 shrink-0" />
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-[#FFFFFF]">
                      Web Push Notifications
                    </h2>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${permissionBadge.tone}`}
                    >
                      {permissionBadge.label}
                    </span>
                  </div>
                  <p className="text-xs text-[#999999] mt-1 leading-relaxed">
                    {!webPushSupported
                      ? 'This browser does not support Service Worker Web Push notifications.'
                      : browserPerm === 'denied'
                        ? 'Notifications are blocked in your browser site settings. Re-enable permission there to receive push alerts.'
                        : masterSwitchOn
                          ? 'Receiving real-time background alerts even when BlinkUpZ is minimized or closed.'
                          : 'Enable push notifications to receive direct, group, and community alerts when away.'}
                  </p>
                </div>
              </div>

              {webPushSupported && browserPerm !== 'denied' && (
                <button
                  type="button"
                  role="switch"
                  aria-label="Enable Push Notifications"
                  aria-checked={masterSwitchOn}
                  disabled={pushBusy || savingKey === 'pushEnabled'}
                  onClick={handleTogglePushMaster}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                    masterSwitchOn ? 'bg-[#22C55E]' : 'bg-[#303030]'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                      masterSwitchOn ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              )}
            </div>

            {webPushSupported && browserPerm !== 'denied' && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#303030]">
                <div className="text-xs text-[#999999]">
                  Browser permission:{' '}
                  <span className="text-[#FFFFFF] font-medium capitalize">
                    {browserPerm}
                  </span>
                  {' · '}
                  This device:{' '}
                  <span className="text-[#FFFFFF] font-medium">
                    {deviceSubscribed ? 'Subscribed' : 'Not subscribed'}
                  </span>
                </div>

                {!masterSwitchOn ? (
                  <PrimaryButton
                    variant="secondary"
                    loading={pushBusy}
                    onClick={handleEnablePush}
                    className="min-h-[36px] py-1.5 px-3.5 text-xs shrink-0"
                  >
                    Enable Notifications
                  </PrimaryButton>
                ) : (
                  <PrimaryButton
                    variant="secondary"
                    loading={pushBusy}
                    onClick={() => handleDisablePush(true)}
                    className="min-h-[36px] py-1.5 px-3.5 text-xs shrink-0"
                  >
                    Disable on Device
                  </PrimaryButton>
                )}
              </div>
            )}
          </section>

          {/* Registered Devices */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Laptop className="w-4 h-4 text-[#999999]" />
                <div>
                  <h2 className="text-sm font-semibold text-[#FFFFFF]">
                    Subscribed Devices
                  </h2>
                  <p className="text-xs text-[#999999]">
                    Manage browsers receiving push notifications for your account
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-[#999999]">
                {devices.length}
              </span>
            </div>

            {loadingDevices ? (
              <p className="text-xs text-[#999999]">Loading devices...</p>
            ) : devices.length === 0 ? (
              <p className="text-xs text-[#999999]">
                No browsers are currently subscribed to push notifications.
              </p>
            ) : (
              <div className="divide-y divide-[#303030]">
                {devices.map((sub) => {
                  const isCurrent = sub.deviceId === currentDeviceId;
                  return (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#FFFFFF] truncate">
                            {sub.deviceLabel}
                          </p>
                          {isCurrent && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#242424] border border-[#303030] text-[#22C55E] shrink-0">
                              This device
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#999999] mt-0.5">
                          Last active {formatRelativeDeviceTime(sub.lastUsedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={removingDeviceId === sub.id || pushBusy}
                        onClick={() => handleRemoveDevice(sub)}
                        aria-label={`Remove ${sub.deviceLabel}`}
                        className="p-2 rounded-lg text-[#999999] hover:text-[#E5484D] hover:bg-[#242424] cursor-pointer transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Categories */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-[#999999]" />
              <div>
                <h2 className="text-sm font-semibold text-[#FFFFFF]">
                  Notification Categories
                </h2>
                <p className="text-xs text-[#999999]">
                  Disabled categories will not trigger alert sounds, popups, or Web Push alerts.
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#303030]">
              {categoryRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-4 py-3.5 first:pt-2 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-[#FFFFFF]">
                      {row.title}
                    </p>
                    <p className="text-xs text-[#999999]">{row.desc}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label={row.title}
                    aria-checked={notifications[row.key]}
                    disabled={savingKey === row.key}
                    onClick={() =>
                      updateNotificationField(row.key, !notifications[row.key])
                    }
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      notifications[row.key] ? 'bg-[#22C55E]' : 'bg-[#303030]'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                        notifications[row.key] ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Sound, Vibration & Previews */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-5">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 text-[#999999]" />
              <h2 className="text-sm font-semibold text-[#FFFFFF]">
                Sound, Vibration &amp; Previews
              </h2>
            </div>

            {/* Sound toggle */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[#FFFFFF]">
                  Notification Sound
                </p>
                <p className="text-xs text-[#999999]">
                  Play an audio tone when active notifications arrive
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Notification Sound"
                aria-checked={notifications.soundEnabled}
                disabled={savingKey === 'soundEnabled'}
                onClick={() =>
                  updateNotificationField(
                    'soundEnabled',
                    !notifications.soundEnabled
                  )
                }
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  notifications.soundEnabled ? 'bg-[#22C55E]' : 'bg-[#303030]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                    notifications.soundEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Tone picker */}
            {notifications.soundEnabled && (
              <div className="space-y-2.5 pt-3 border-t border-[#303030]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-[#999999]">
                    Notification Tone
                  </p>
                  <button
                    type="button"
                    onClick={() => playNotificationTone(notifications.soundTone)}
                    className="text-xs font-medium text-[#FFFFFF] hover:underline cursor-pointer"
                  >
                    Test Tone
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SOUND_TONE_OPTIONS.map((tone) => {
                    const active = notifications.soundTone === tone.id;
                    return (
                      <button
                        key={tone.id}
                        type="button"
                        disabled={savingKey === 'soundTone'}
                        onClick={() => {
                          playNotificationTone(tone.id as NotificationSoundTone);
                          updateNotificationField(
                            'soundTone',
                            tone.id as NotificationSoundTone
                          );
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#FFFFFF] text-[#181818] border-[#FFFFFF]'
                            : 'bg-[#242424] text-[#FFFFFF] border-[#303030] hover:bg-[#2A2A2A]'
                        }`}
                      >
                        <p className="text-xs font-semibold">{tone.label}</p>
                        <p
                          className={`text-[11px] mt-0.5 ${
                            active ? 'text-[#181818]/75' : 'text-[#999999]'
                          }`}
                        >
                          {tone.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Message Preview */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-[#303030]">
              <div className="flex items-start gap-2.5">
                <Eye className="w-4 h-4 text-[#999999] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">
                    Notification Preview
                  </p>
                  <p className="text-xs text-[#999999]">
                    Show message text inside incoming alerts. When off, only the sender name and &ldquo;New message&rdquo; are shown.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Notification Preview"
                aria-checked={notifications.messagePreview}
                disabled={savingKey === 'messagePreview'}
                onClick={() =>
                  updateNotificationField(
                    'messagePreview',
                    !notifications.messagePreview
                  )
                }
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  notifications.messagePreview ? 'bg-[#22C55E]' : 'bg-[#303030]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                    notifications.messagePreview
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Vibration */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-[#303030]">
              <div className="flex items-start gap-2.5">
                <Smartphone className="w-4 h-4 text-[#999999] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">Vibration</p>
                  <p className="text-xs text-[#999999]">
                    {vibrationSupported
                      ? 'Vibrate supported mobile devices when notifications arrive'
                      : 'Vibration API is not supported by this browser or device'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Vibration"
                aria-checked={notifications.vibrationEnabled}
                disabled={savingKey === 'vibrationEnabled'}
                onClick={() => {
                  const next = !notifications.vibrationEnabled;
                  if (next && vibrationSupported) {
                    triggerNotificationVibration();
                  }
                  updateNotificationField('vibrationEnabled', next);
                }}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  notifications.vibrationEnabled ? 'bg-[#22C55E]' : 'bg-[#303030]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                    notifications.vibrationEnabled
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </section>

          <div className="flex items-center gap-2 text-xs text-[#999999] px-1">
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span>
              Individual chat and community mute settings override sound, popups, and Web Push alerts for that conversation.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
