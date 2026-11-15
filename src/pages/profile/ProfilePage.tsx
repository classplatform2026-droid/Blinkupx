import { useState } from 'react';
import {
  Ban,
  Bell,
  ChevronRight,
  Edit3,
  LogOut,
  QrCode,
  ScanLine,
  Settings,
  Shield,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { QrCodeModal } from '../../components/QrCodeModal';
import { QrScannerModal } from '../../components/QrScannerModal';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { showToast } = useToast();

  const [qrOpen, setQrOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    showToast('You have been logged out.', 'info');
    navigate('/', { replace: true });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Profile"
        rightSlot={
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            aria-label="My QR Code"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
          >
            <QrCode className="w-5 h-5" />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-6 flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <UserAvatar
              src={user.avatar}
              name={user.fullName}
              size="xl"
              online={user.onlineStatus}
            />
            <div className="flex-1 text-center sm:text-left min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-[#FFFFFF] truncate">
                {user.fullName}
              </h2>
              <p className="text-sm text-[#999999] mt-0.5">@{user.username}</p>
              {user.phone && (
                <p className="text-xs font-mono text-[#999999] mt-1">{user.phone}</p>
              )}
              <p className="text-sm text-[#FFFFFF]/90 mt-3 leading-relaxed">
                {user.bio || 'No bio added yet.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PrimaryButton
                variant="secondary"
                onClick={() => setQrOpen(true)}
                aria-label="Open My QR Code"
                className="px-3.5"
              >
                <QrCode className="w-4 h-4" />
                <span>My QR</span>
              </PrimaryButton>
              <PrimaryButton
                variant="secondary"
                onClick={() => navigate('/profile/edit')}
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit Profile</span>
              </PrimaryButton>
            </div>
          </section>

          <section className="rounded-2xl bg-[#202020] border border-[#303030] divide-y divide-[#303030] overflow-hidden">
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <QrCode className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">My QR Code</p>
                  <p className="text-xs text-[#999999]">
                    Download, share, or copy your unique BlinkUpZ profile QR
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>

            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <ScanLine className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">Scan QR Code</p>
                  <p className="text-xs text-[#999999]">
                    Scan a BlinkUpZ QR code to open their profile and start chatting
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/profile/edit')}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Edit3 className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">Edit Profile</p>
                  <p className="text-xs text-[#999999]">
                    Update photo, display name, username, and bio
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/profile/privacy')}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Shield className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">
                    Privacy &amp; Security
                  </p>
                  <p className="text-xs text-[#999999]">
                    Last seen, online status, profile photo, about &amp; read receipts
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/profile/blocked')}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Ban className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">
                    Blocked Contacts
                  </p>
                  <p className="text-xs text-[#999999]">
                    Manage blocked users and messaging restrictions
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(user.blockedUsers?.length || 0) > 0 && (
                  <span className="text-xs font-mono text-[#999999]">
                    {user.blockedUsers!.length}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-[#999999]" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate('/profile/notifications')}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Bell className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">
                    Notifications
                  </p>
                  <p className="text-xs text-[#999999]">
                    Message alerts, community activity, sound, vibration &amp; previews
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/profile/settings')}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Settings className="w-5 h-5 text-[#999999]" />
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">App Settings</p>
                  <p className="text-xs text-[#999999]">
                    Appearance, chat behavior, storage, and about BlinkUpZ
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#999999]" />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#242424] transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <LogOut className="w-5 h-5 text-[#E5484D]" />
                <div>
                  <p className="text-sm font-medium text-[#E5484D]">Log Out</p>
                  <p className="text-xs text-[#999999]">
                    End your active session on this browser
                  </p>
                </div>
              </div>
            </button>
          </section>
        </div>
      </div>

      <QrCodeModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onOpenScanner={() => setScannerOpen(true)}
      />
      <QrScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </div>
  );
}
