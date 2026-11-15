import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  Edit3,
  MessageSquare,
  QrCode,
  Share2,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { BrandMark } from '../../components/BrandMark';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { QrCodeModal } from '../../components/QrCodeModal';
import { ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { conversationApi, extractApiError, userApi } from '../../services/api';
import type { User } from '../../types';
import { formatLastSeen } from '../../utils/formatters';

export function PublicProfilePage() {
  const { username = '' } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user: currentUser, setAuthenticatedUser } = useAuth();
  const { presenceMap } = useSocket();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockingBusy, setBlockingBusy] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await userApi.getPublicByUsername(username);
      setProfile(data);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const onRelationshipUpdated = () => {
      loadProfile();
    };
    window.addEventListener('blinkupz:relationship-updated', onRelationshipUpdated);
    return () => {
      window.removeEventListener('blinkupz:relationship-updated', onRelationshipUpdated);
    };
  }, [loadProfile]);

  const isOwnProfile = Boolean(currentUser && profile && currentUser.id === profile.id);
  const profileUrl = `${window.location.origin}/u/${profile?.username || username}`;

  const handleStartConversation = async () => {
    if (!profile) return;
    if (!currentUser) {
      navigate(`/login?redirect=${encodeURIComponent(`/u/${profile.username}`)}`);
      return;
    }
    setStartingChat(true);
    try {
      const conv = await conversationApi.create({
        type: 'direct',
        participantIds: [profile.id],
      });
      navigate(`/chats/${conv.id}`);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setStartingChat(false);
    }
  };

  const handleToggleBlock = async () => {
    if (!profile || !currentUser) return;
    setBlockingBusy(true);
    try {
      if (profile.isBlockedByMe) {
        const res = await userApi.unblockUser(profile.id);
        if (res.data.user) setAuthenticatedUser(res.data.user);
        showToast(`${profile.fullName} unblocked.`, 'success');
      } else {
        const res = await userApi.blockUser(profile.id);
        if (res.data.user) setAuthenticatedUser(res.data.user);
        showToast(`${profile.fullName} blocked.`, 'info');
      }
      setBlockConfirmOpen(false);
      await loadProfile();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setBlockingBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      showToast('Profile link copied.', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Unable to copy automatically.', 'error');
    }
  };

  const handleShare = async () => {
    if (!profile) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${profile.fullName} on BlinkUpZ`,
          text: `Message @${profile.username} on BlinkUpZ`,
          url: profileUrl,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    await handleCopy();
  };

  const livePresence = profile ? presenceMap[profile.id] : undefined;
  const isBlockedPair = Boolean(profile?.isBlockedByMe || profile?.hasBlockedMe);
  const isOnline = isBlockedPair
    ? false
    : livePresence
      ? livePresence.onlineStatus
      : Boolean(profile?.onlineStatus);
  const lastSeen = isBlockedPair
    ? null
    : livePresence
      ? livePresence.lastSeen
      : profile?.lastSeen || null;
  const lastSeenHidden = Boolean(
    isBlockedPair ||
      livePresence?.lastSeenHidden ||
      profile?.privacyStatus?.lastSeenHidden
  );
  const aboutHidden = Boolean(isBlockedPair || profile?.privacyStatus?.aboutHidden);

  return (
    <div className="flex-1 flex flex-col min-h-dvh lg:min-h-0 h-full bg-[#181818] text-[#FFFFFF] overflow-hidden">
      {currentUser ? (
        <AppHeader
          title={profile ? `@${profile.username}` : 'Profile'}
          showBack
          onBack={() => navigate(-1)}
        />
      ) : (
        <header className="h-16 px-4 sm:px-6 border-b border-[#303030] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <BrandMark size={28} />
            <span className="text-base font-bold tracking-tight">BlinkUpZ</span>
          </button>
          <div className="flex items-center gap-2">
            <PrimaryButton
              variant="secondary"
              onClick={() =>
                navigate(`/login?redirect=${encodeURIComponent(`/u/${username}`)}`)
              }
              className="text-xs min-h-[38px] px-3.5 py-1.5"
            >
              Log In
            </PrimaryButton>
          </div>
        </header>
      )}

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-8">
        <div className="max-w-lg mx-auto">
          {loading ? (
            <LoadingState rows={4} />
          ) : error || !profile ? (
            <ErrorState
              message={error || 'Profile not found.'}
              onRetry={loadProfile}
            />
          ) : (
            <section className="rounded-2xl bg-[#202020] border border-[#303030] p-6 sm:p-8 space-y-6">
              <div className="flex flex-col items-center text-center">
                <UserAvatar
                  src={profile.avatar}
                  name={profile.fullName}
                  size="xl"
                  online={isOnline}
                />
                <h1 className="text-2xl font-bold tracking-tight text-[#FFFFFF] mt-4">
                  {profile.fullName}
                </h1>
                <p className="text-sm text-[#999999] font-mono mt-0.5">
                  @{profile.username}
                </p>
                <p
                  className={`text-xs mt-1.5 ${
                    isOnline ? 'text-[#22C55E]' : 'text-[#999999]'
                  }`}
                >
                  {isBlockedPair
                    ? profile.isBlockedByMe
                      ? 'Blocked contact'
                      : 'Unavailable'
                    : isOnline
                      ? 'Online'
                      : formatLastSeen(lastSeen, lastSeenHidden)}
                </p>

                <p className="text-sm text-[#FFFFFF]/90 mt-4 leading-relaxed max-w-md">
                  {aboutHidden ? (
                    <span className="text-[#999999]">About information is hidden.</span>
                  ) : (
                    profile.bio || 'Connected on BlinkUpZ.'
                  )}
                </p>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-[#303030]">
                {currentUser ? (
                  isOwnProfile ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <PrimaryButton
                        variant="secondary"
                        onClick={() => navigate('/profile/edit')}
                      >
                        <Edit3 className="w-4 h-4" />
                        <span>Edit Profile</span>
                      </PrimaryButton>
                      <PrimaryButton onClick={() => setQrOpen(true)}>
                        <QrCode className="w-4 h-4" />
                        <span>My QR Code</span>
                      </PrimaryButton>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {profile.isBlockedByMe ? (
                        <div className="rounded-xl bg-[#181818] border border-[#303030] p-3 text-center space-y-2">
                          <p className="text-xs text-[#999999]">
                            You blocked this contact. Unblock them to start a conversation.
                          </p>
                          <PrimaryButton
                            variant="secondary"
                            fullWidth
                            onClick={() => setBlockConfirmOpen(true)}
                          >
                            <ShieldCheck className="w-4 h-4 text-[#22C55E]" />
                            <span>Unblock Contact</span>
                          </PrimaryButton>
                        </div>
                      ) : profile.hasBlockedMe ? (
                        <div className="rounded-xl bg-[#181818] border border-[#303030] p-3 text-center">
                          <p className="text-xs text-[#999999]">
                            Messaging is unavailable for this account.
                          </p>
                        </div>
                      ) : (
                        <PrimaryButton
                          fullWidth
                          loading={startingChat}
                          onClick={handleStartConversation}
                        >
                          <MessageSquare className="w-4 h-4" />
                          <span>Start Conversation</span>
                        </PrimaryButton>
                      )}
                    </div>
                  )
                ) : (
                  <div className="space-y-2.5">
                    <PrimaryButton
                      fullWidth
                      onClick={() =>
                        navigate(
                          `/login?redirect=${encodeURIComponent(`/u/${profile.username}`)}`
                        )
                      }
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>Log In to Message {profile.fullName.split(' ')[0]}</span>
                    </PrimaryButton>
                    <PrimaryButton
                      variant="secondary"
                      fullWidth
                      onClick={() =>
                        navigate(
                          `/signup?redirect=${encodeURIComponent(`/u/${profile.username}`)}`
                        )
                      }
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Create BlinkUpZ Account</span>
                    </PrimaryButton>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <PrimaryButton variant="secondary" onClick={handleShare} className="text-xs">
                    <Share2 className="w-4 h-4" />
                    <span>Share Profile</span>
                  </PrimaryButton>
                  <PrimaryButton variant="secondary" onClick={handleCopy} className="text-xs">
                    {copied ? <Check className="w-4 h-4 text-[#22C55E]" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Copied Link' : 'Copy Link'}</span>
                  </PrimaryButton>
                </div>

                {currentUser && !isOwnProfile && !profile.isBlockedByMe && (
                  <button
                    type="button"
                    onClick={() => setBlockConfirmOpen(true)}
                    className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-medium text-[#E5484D] hover:bg-[#242424] transition-colors cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Block @{profile.username}</span>
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {currentUser && (
        <QrCodeModal open={qrOpen} onClose={() => setQrOpen(false)} />
      )}

      {profile && (
        <Modal
          open={blockConfirmOpen}
          onClose={() => setBlockConfirmOpen(false)}
          title={
            profile.isBlockedByMe
              ? `Unblock ${profile.fullName}?`
              : `Block ${profile.fullName}?`
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[#999999] leading-relaxed">
              {profile.isBlockedByMe
                ? `@${profile.username} will be allowed to message you and see your profile information according to your privacy settings.`
                : `@${profile.username} will no longer be able to send you messages, start conversations with you, or view your online status and profile details.`}
            </p>
            <div className="flex justify-end gap-2">
              <PrimaryButton
                variant="secondary"
                onClick={() => setBlockConfirmOpen(false)}
              >
                Cancel
              </PrimaryButton>
              <PrimaryButton
                variant={profile.isBlockedByMe ? 'primary' : 'danger'}
                loading={blockingBusy}
                onClick={handleToggleBlock}
              >
                {profile.isBlockedByMe ? 'Unblock' : 'Block Contact'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
