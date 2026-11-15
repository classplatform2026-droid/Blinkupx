import { useState } from 'react';
import {
  Ban,
  CheckCheck,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Image,
  Shield,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractApiError, userApi } from '../../services/api';
import type { PrivacyVisibility, UserPrivacySettings } from '../../types';
import { DEFAULT_PRIVACY_SETTINGS } from '../../utils/notifications';

const VISIBILITY_OPTIONS: Array<{ value: PrivacyVisibility; label: string }> = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'My Contacts' },
  { value: 'nobody', label: 'Nobody' },
];

export function PrivacySettingsPage() {
  const navigate = useNavigate();
  const { user, setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (!user) return null;

  const privacy: UserPrivacySettings = {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...(user.settings?.privacy || {}),
    readReceipts:
      user.settings?.privacy?.readReceipts ??
      user.settings?.readReceipts ??
      DEFAULT_PRIVACY_SETTINGS.readReceipts,
  };

  const blockedCount = user.blockedUsers?.length || 0;

  const updatePrivacyField = async <K extends keyof UserPrivacySettings>(
    key: K,
    value: UserPrivacySettings[K]
  ) => {
    setSavingKey(String(key));
    try {
      const res = await userApi.updatePrivacy({ [key]: value });
      setAuthenticatedUser(res.data);
      showToast('Privacy setting updated.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const visibilityRows: Array<{
    key: 'lastSeen' | 'onlineStatus' | 'profilePhoto' | 'about';
    title: string;
    desc: string;
    icon: typeof Clock;
  }> = [
    {
      key: 'lastSeen',
      title: 'Last Seen',
      desc: 'Choose who can see when you were last active',
      icon: Clock,
    },
    {
      key: 'onlineStatus',
      title: 'Online Status',
      desc: 'Choose who can see when you are currently online',
      icon: Eye,
    },
    {
      key: 'profilePhoto',
      title: 'Profile Photo',
      desc: 'Control who can view your profile picture',
      icon: Image,
    },
    {
      key: 'about',
      title: 'About / Bio',
      desc: 'Control who can view your About bio text',
      icon: FileText,
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Privacy & Security"
        showBack
        onBack={() => navigate('/profile')}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Visibility Controls */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-5">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-[#999999]" />
              <div>
                <h2 className="text-sm font-semibold text-[#FFFFFF]">
                  Who can see my personal info
                </h2>
                <p className="text-xs text-[#999999] mt-0.5">
                  Changes apply immediately across chats and public profiles.
                </p>
              </div>
            </div>

            <div className="space-y-5 pt-2 border-t border-[#303030]">
              {visibilityRows.map((row) => {
                const Icon = row.icon;
                const currentValue = privacy[row.key];
                const isSaving = savingKey === row.key;

                return (
                  <div key={row.key} className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <Icon className="w-4 h-4 text-[#999999] mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[#FFFFFF]">
                          {row.title}
                        </p>
                        <p className="text-xs text-[#999999]">{row.desc}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {VISIBILITY_OPTIONS.map((opt) => {
                        const active = currentValue === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={isSaving}
                            onClick={() => updatePrivacyField(row.key, opt.value)}
                            className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer border ${
                              active
                                ? 'bg-[#FFFFFF] text-[#181818] border-[#FFFFFF]'
                                : 'bg-[#242424] text-[#999999] border-[#303030] hover:text-[#FFFFFF]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Read Receipts */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <CheckCheck className="w-4 h-4 text-[#999999] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[#FFFFFF]">
                    Read Receipts
                  </p>
                  <p className="text-xs text-[#999999] mt-0.5 leading-relaxed">
                    When disabled, others won&apos;t see when you&apos;ve read messages in private 1:1 conversations. Delivery status remains separate, and group or community chats may still show read status.
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-label="Read Receipts"
                aria-checked={privacy.readReceipts}
                disabled={savingKey === 'readReceipts'}
                onClick={() =>
                  updatePrivacyField('readReceipts', !privacy.readReceipts)
                }
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  privacy.readReceipts ? 'bg-[#22C55E]' : 'bg-[#303030]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                    privacy.readReceipts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Blocked Contacts */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] overflow-hidden">
            <button
              type="button"
              onClick={() => navigate('/profile/blocked')}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Ban className="w-5 h-5 text-[#E5484D]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">
                    Blocked Contacts
                  </p>
                  <p className="text-xs text-[#999999]">
                    {blockedCount === 0
                      ? 'No blocked contacts'
                      : `${blockedCount} blocked ${
                          blockedCount === 1 ? 'contact' : 'contacts'
                        }`}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
