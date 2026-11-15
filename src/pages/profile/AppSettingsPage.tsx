import { useState } from 'react';
import {
  Database,
  Globe,
  HelpCircle,
  Info,
  MessageSquare,
  Palette,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractApiError, userApi } from '../../services/api';
import type { UserSettings } from '../../types';

export function AppSettingsPage() {
  const navigate = useNavigate();
  const { user, services, setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [infoModal, setInfoModal] = useState<'help' | 'about' | null>(null);

  if (!user) return null;

  const settings: UserSettings = user.settings || {
    density: 'comfortable',
    enterToSend: true,
    readReceipts: true,
    typingIndicators: true,
    autoDownloadMedia: true,
    language: 'en',
  };

  const updateSetting = async <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    setSavingKey(String(key));
    try {
      const res = await userApi.updateProfile({
        settings: { [key]: value },
      });
      setAuthenticatedUser(res.data);
      showToast('Setting saved.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleClearLocalCache = () => {
    localStorage.removeItem(`blinkupz_recent_searches_${user.id}`);
    showToast('Cleared local search history.', 'success');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="App Settings"
        showBack
        onBack={() => navigate('/profile')}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Appearance */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Palette className="w-4 h-4 text-[#999999]" />
              <h2 className="text-sm font-semibold text-[#FFFFFF]">Appearance</h2>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-[#FFFFFF]">Theme</p>
                <p className="text-xs text-[#999999]">
                  BlinkUpZ V1.0 uses a dedicated dark interface
                </p>
              </div>
              <span className="text-xs font-medium text-[#FFFFFF]">Dark (#181818)</span>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2 border-t border-[#303030]">
              <div>
                <p className="text-sm text-[#FFFFFF]">Message Density</p>
                <p className="text-xs text-[#999999]">
                  Adjust spacing between chat bubbles
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {(['comfortable', 'compact'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={savingKey === 'density'}
                    onClick={() => updateSetting('density', mode)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                      settings.density === mode
                        ? 'bg-[#FFFFFF] text-[#181818]'
                        : 'bg-[#242424] text-[#999999] hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Language */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Globe className="w-4 h-4 text-[#999999]" />
              <h2 className="text-sm font-semibold text-[#FFFFFF]">Language</h2>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-[#FFFFFF]">App Language</p>
                <p className="text-xs text-[#999999]">
                  Interface display language
                </p>
              </div>
              <select
                aria-label="App Language"
                value={settings.language}
                onChange={(e) => updateSetting('language', e.target.value)}
                className="h-9 rounded-lg bg-[#242424] border border-[#303030] px-3 text-xs text-[#FFFFFF]"
              >
                <option value="en">English (US)</option>
              </select>
            </div>
          </section>

          {/* Chat Settings */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-[#999999]" />
              <h2 className="text-sm font-semibold text-[#FFFFFF]">Chat Settings</h2>
            </div>

            {(
              [
                {
                  key: 'enterToSend',
                  title: 'Enter key sends message',
                  desc: 'Press Shift + Enter for a new line',
                },
                {
                  key: 'readReceipts',
                  title: 'Read receipts',
                  desc: 'Show and send message read indicators',
                },
                {
                  key: 'typingIndicators',
                  title: 'Typing indicators',
                  desc: 'Show when you are typing in active chats',
                },
              ] as const
            ).map((item, idx) => (
              <div
                key={item.key}
                className={`flex items-center justify-between gap-4 ${
                  idx > 0 ? 'pt-3 border-t border-[#303030]' : ''
                }`}
              >
                <div>
                  <p className="text-sm text-[#FFFFFF]">{item.title}</p>
                  <p className="text-xs text-[#999999]">{item.desc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings[item.key]}
                  disabled={savingKey === item.key}
                  onClick={() => updateSetting(item.key, !settings[item.key])}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                    settings[item.key] ? 'bg-[#22C55E]' : 'bg-[#303030]'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                      settings[item.key] ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </section>

          {/* Storage & Data */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-[#999999]" />
              <h2 className="text-sm font-semibold text-[#FFFFFF]">Storage & Data</h2>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-[#FFFFFF]">Auto-load chat media</p>
                <p className="text-xs text-[#999999]">
                  Automatically render shared images in chats
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoDownloadMedia}
                onClick={() =>
                  updateSetting('autoDownloadMedia', !settings.autoDownloadMedia)
                }
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  settings.autoDownloadMedia ? 'bg-[#22C55E]' : 'bg-[#303030]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-[#FFFFFF] transition-transform ${
                    settings.autoDownloadMedia ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 pt-3 border-t border-[#303030]">
              <div>
                <p className="text-sm text-[#FFFFFF]">Recent Search Cache</p>
                <p className="text-xs text-[#999999]">
                  Clear locally stored recent search terms
                </p>
              </div>
              <PrimaryButton
                variant="secondary"
                onClick={handleClearLocalCache}
                className="min-h-[36px] py-1.5 px-3.5 text-xs"
              >
                Clear Cache
              </PrimaryButton>
            </div>
          </section>

          {/* Help & About */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] divide-y divide-[#303030] overflow-hidden">
            <button
              type="button"
              onClick={() => setInfoModal('help')}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#242424] text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <HelpCircle className="w-4 h-4 text-[#999999]" />
                <span className="text-sm font-medium text-[#FFFFFF]">
                  Help & Support
                </span>
              </div>
              <span className="text-xs text-[#999999]">Service config</span>
            </button>

            <button
              type="button"
              onClick={() => setInfoModal('about')}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#242424] text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <Info className="w-4 h-4 text-[#999999]" />
                <span className="text-sm font-medium text-[#FFFFFF]">
                  About BlinkUpZ
                </span>
              </div>
              <span className="text-xs font-mono text-[#999999]">V1.0</span>
            </button>
          </section>
        </div>
      </div>

      <Modal
        open={infoModal !== null}
        onClose={() => setInfoModal(null)}
        title={infoModal === 'help' ? 'Help & Service Configuration' : 'About BlinkUpZ'}
      >
        {infoModal === 'help' ? (
          <div className="space-y-4 text-sm text-[#999999]">
            <p className="leading-relaxed">
              BlinkUpZ relies on external service credentials for SMS OTP delivery and Cloudinary media storage. Current server status:
            </p>
            <div className="rounded-xl bg-[#181818] border border-[#303030] p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span>MongoDB Database</span>
                <span className="text-[#22C55E] font-medium">
                  {services?.database === 'configured' ? 'Atlas / Configured' : 'Local Mongod'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Cloudinary Media Storage</span>
                <span className={services?.cloudinary ? 'text-[#22C55E]' : 'text-[#E5484D]'}>
                  {services?.cloudinary ? 'Configured' : 'Needs Env Vars'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>SMS OTP Provider ({services?.otpProviderType || 'twilio'})</span>
                <span className={services?.otpProvider ? 'text-[#22C55E]' : 'text-[#E5484D]'}>
                  {services?.otpProvider ? 'Configured' : 'Needs Env Vars'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-[#999999] leading-relaxed">
            <p className="text-[#FFFFFF] font-semibold">BlinkUpZ — Version 1.0 (MVP)</p>
            <p>Connect. Communicate. Together.</p>
            <p>
              Built with the MERN stack (MongoDB, Express.js, React, Node.js) and Socket.IO for real-time 1:1 messaging, group chats, and communities.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
