import { useEffect, useState } from 'react';
import {
  Bell,
  Eye,
  MessageSquare,
  Smartphone,
  Users,
  Volume2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractApiError, userApi } from '../../services/api';
import type {
  NotificationSoundTone,
  UserNotificationSettings,
} from '../../types';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getBrowserNotificationState,
  isVibrationSupported,
  playNotificationTone,
  requestBrowserNotificationPermission,
  SOUND_TONE_OPTIONS,
  triggerNotificationVibration,
  type BrowserNotificationSupportState,
} from '../../utils/notifications';

export function NotificationSettingsPage() {
  const navigate = useNavigate();
  const { user, setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [browserPerm, setBrowserPerm] = useState<BrowserNotificationSupportState>(
    getBrowserNotificationState
  );
  const vibrationSupported = isVibrationSupported();

  useEffect(() => {
    setBrowserPerm(getBrowserNotificationState());
  }, []);

  if (!user) return null;

  const notifications: UserNotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(user.settings?.notifications || {}),
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
      showToast('Notification preference saved.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleRequestBrowserPermission = async () => {
    const next = await requestBrowserNotificationPermission();
    setBrowserPerm(next);
    if (next === 'granted') {
      showToast('Browser notifications enabled.', 'success');
    } else if (next === 'denied') {
      showToast(
        'Browser notifications are blocked in your browser site settings.',
        'error'
      );
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Notifications"
        showBack
        onBack={() => navigate('/profile')}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Categories */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-[#999999]" />
              <div>
                <h2 className="text-sm font-semibold text-[#FFFFFF]">
                  Notification Categories
                </h2>
                <p className="text-xs text-[#999999]">
                  Disabled categories will not trigger alert sounds or popups. You can also mute individual conversations from the chat menu.
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
                Sound, Vibration & Previews
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
                    Message Preview
                  </p>
                  <p className="text-xs text-[#999999]">
                    Show message text inside incoming notification alerts. When off, only the sender name and &ldquo;New message&rdquo; are shown.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Message Preview"
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

          {/* Browser Notification Permission */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <Bell className="w-4 h-4 text-[#999999] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[#FFFFFF]">
                    Browser Notifications
                  </p>
                  <p className="text-xs text-[#999999] mt-0.5">
                    {browserPerm === 'granted'
                      ? 'Permission granted. Background alerts will appear through your browser.'
                      : browserPerm === 'denied'
                        ? 'Permission denied in your browser settings. In-app notifications will still appear while BlinkUpZ is open.'
                        : browserPerm === 'unsupported'
                          ? 'This browser does not support desktop or system Web Notifications.'
                          : 'Allow browser alerts to receive notifications when BlinkUpZ is in the background.'}
                  </p>
                </div>
              </div>

              {browserPerm === 'default' && (
                <PrimaryButton
                  variant="secondary"
                  onClick={handleRequestBrowserPermission}
                  className="min-h-[36px] py-1.5 px-3 text-xs shrink-0"
                >
                  Enable
                </PrimaryButton>
              )}
              {browserPerm === 'granted' && (
                <span className="text-xs font-medium text-[#22C55E] shrink-0">
                  Allowed
                </span>
              )}
            </div>
          </section>

          <div className="flex items-center gap-2 text-xs text-[#999999] px-1">
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span>
              Individual chat mute settings override sound and popup alerts for that conversation.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
