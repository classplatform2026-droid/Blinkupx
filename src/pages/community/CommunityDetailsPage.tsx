import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Globe,
  Lock,
  LogOut,
  MessageSquare,
  MoreVertical,
  Settings,
  Share2,
  Shield,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { DropdownMenu } from '../../components/DropdownMenu';
import { InviteMembersModal } from '../../components/InviteMembersModal';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { communityApi, extractApiError } from '../../services/api';
import type { CommunityDetail } from '../../types';
import { formatDateSeparator } from '../../utils/formatters';

const INVITE_LABELS: Record<string, string> = {
  owner_only: 'Owner only',
  admins: 'Owner & Admins',
  moderators: 'Moderators & above',
  all_members: 'All members',
};

const PIN_LABELS: Record<string, string> = {
  admins: 'Owner & Admins',
  moderators: 'Moderators & above',
};

const POST_LABELS: Record<string, string> = {
  all_members: 'All members',
  moderators_only: 'Moderators & above only',
};

export function CommunityDetailsPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { showToast } = useToast();

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!communityId) return;
    setError(null);
    try {
      const data = await communityApi.getById(communityId);
      setCommunity(data);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    setLoading(true);
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    if (!socket || !communityId) return;
    const onUpdated = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        loadDetails();
      }
    };
    const onDeleted = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        navigate('/community', { replace: true });
      }
    };
    const onRemoved = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        loadDetails();
      }
    };
    const onReqResolved = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        loadDetails();
      }
    };

    socket.on('community:updated', onUpdated);
    socket.on('community:join_request', onUpdated);
    socket.on('community:deleted', onDeleted);
    socket.on('community:removed', onRemoved);
    socket.on('community:request_resolved', onReqResolved);
    return () => {
      socket.off('community:updated', onUpdated);
      socket.off('community:join_request', onUpdated);
      socket.off('community:deleted', onDeleted);
      socket.off('community:removed', onRemoved);
      socket.off('community:request_resolved', onReqResolved);
    };
  }, [socket, communityId, loadDetails, navigate]);

  const handleJoin = async () => {
    if (!community) return;
    setActionLoading(true);
    try {
      const res = await communityApi.join(community.id);
      showToast(res.message, 'success');
      if (res.data.isMember) {
        await loadDetails();
      } else {
        setCommunity((prev) => (prev ? { ...prev, isPending: true } : prev));
      }
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!community) return;
    setActionLoading(true);
    try {
      const res = await communityApi.cancelJoinRequest(community.id);
      showToast(res.message, 'info');
      setCommunity((prev) => (prev ? { ...prev, isPending: false } : prev));
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!community) return;
    setActionLoading(true);
    try {
      await communityApi.leave(community.id);
      if (community.conversationId) {
        socket?.emit('group:leave', { conversationId: community.conversationId });
      }
      showToast(`Left ${community.name}.`, 'info');
      navigate('/community', { replace: true });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
      setLeaveConfirmOpen(false);
    }
  };

  const handleShare = async () => {
    if (!community) return;
    const shareUrl = `${window.location.origin}/community/${community.id}/details`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: community.name,
          text: community.description || `Join ${community.name} on BlinkUpZ`,
          url: shareUrl,
        });
        return;
      }
    } catch {
      // Fallback to clipboard if user cancels or share unavailable
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Community link copied to clipboard.', 'success');
    } catch {
      showToast(shareUrl, 'info');
    }
  };

  const handleReviewRequest = async (
    targetUserId: string,
    decision: 'approve' | 'reject'
  ) => {
    if (!community) return;
    setProcessingRequestId(targetUserId);
    try {
      const res = await communityApi.handleRequest(community.id, targetUserId, decision);
      showToast(res.message, decision === 'approve' ? 'success' : 'info');
      await loadDetails();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setProcessingRequestId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#181818]">
        <AppHeader
          title="Community Details"
          showBack
          onBack={() => navigate('/community')}
        />
        <LoadingState rows={5} />
      </div>
    );
  }

  if (error || !community) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#181818]">
        <AppHeader
          title="Community Details"
          showBack
          onBack={() => navigate('/community')}
        />
        <div className="flex-1 flex items-center justify-center">
          <ErrorState
            message={error || 'Community not found.'}
            onRetry={loadDetails}
          />
        </div>
      </div>
    );
  }

  const isOwner = community.myRole === 'owner';
  const canInvite = Boolean(community.permissions?.canInvite);
  const canManageSettings = Boolean(community.permissions?.canManageSettings);
  const canManageRequests = Boolean(community.permissions?.canManageRequests);
  const isPrivateRestricted = community.privacy === 'private' && !community.isMember;

  const adminsAndMods = community.members.filter((m) =>
    ['owner', 'admin', 'moderator'].includes(m.role)
  );
  const previewMembers = community.members.slice(0, 6);

  const moreOptions = [
    ...(community.isMember
      ? [
          {
            label: 'Open community chat',
            icon: <MessageSquare className="w-4 h-4" />,
            onClick: () => navigate(`/community/${community.id}`),
          },
          {
            label: `Members (${community.memberCount})`,
            icon: <Users className="w-4 h-4" />,
            onClick: () => navigate(`/community/${community.id}/members`),
          },
        ]
      : []),
    {
      label: 'Share community link',
      icon: <Share2 className="w-4 h-4" />,
      onClick: handleShare,
    },
    ...(canManageSettings
      ? [
          {
            label: 'Community settings',
            icon: <Settings className="w-4 h-4" />,
            onClick: () => navigate(`/community/${community.id}/settings`),
          },
        ]
      : []),
    ...(community.isMember && !isOwner
      ? [
          {
            label: 'Leave community',
            icon: <LogOut className="w-4 h-4" />,
            danger: true,
            onClick: () => setLeaveConfirmOpen(true),
          },
        ]
      : []),
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Community Details"
        showBack
        onBack={() =>
          navigate(community.isMember ? `/community/${community.id}` : '/community')
        }
        rightSlot={
          <div className="flex items-center gap-1">
            {canInvite && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                aria-label="Invite members"
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share community"
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <DropdownMenu
              trigger={
                <button
                  type="button"
                  aria-label="Community menu"
                  className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              }
              options={moreOptions}
            />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Hero Info Card */}
          <section className="rounded-2xl bg-[#202020] border border-[#303030] p-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-5">
              <UserAvatar src={community.image} name={community.name} size="xl" />

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-[#FFFFFF]">{community.name}</h2>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-[#242424] border border-[#303030] text-xs text-[#999999] capitalize">
                    {community.privacy === 'private' ? (
                      <Lock className="w-3 h-3" />
                    ) : (
                      <Globe className="w-3 h-3" />
                    )}
                    {community.privacy}
                  </span>
                  {community.myRole && (
                    <span className="px-2.5 py-0.5 rounded-lg bg-[#FFFFFF] text-[#181818] text-xs font-semibold capitalize">
                      {community.myRole}
                    </span>
                  )}
                </div>

                <p className="text-xs text-[#999999] mt-1.5 font-mono tabular-nums">
                  {community.memberCount} member{community.memberCount === 1 ? '' : 's'}
                  {community.createdAt
                    ? ` · Created ${formatDateSeparator(community.createdAt)}`
                    : ''}
                </p>

                <p className="text-sm text-[#FFFFFF]/90 mt-3 leading-relaxed">
                  {community.description || 'No description provided for this community.'}
                </p>

                <div className="flex flex-wrap items-center gap-2.5 mt-5">
                  {community.isMember ? (
                    <>
                      <PrimaryButton
                        onClick={() => navigate(`/community/${community.id}`)}
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>Open Chat</span>
                      </PrimaryButton>

                      {canInvite && (
                        <PrimaryButton
                          variant="secondary"
                          onClick={() => setInviteOpen(true)}
                        >
                          <UserPlus className="w-4 h-4" />
                          <span>Invite</span>
                        </PrimaryButton>
                      )}

                      <PrimaryButton variant="secondary" onClick={handleShare}>
                        <Share2 className="w-4 h-4" />
                        <span>Share</span>
                      </PrimaryButton>

                      {canManageSettings && (
                        <PrimaryButton
                          variant="secondary"
                          onClick={() => navigate(`/community/${community.id}/settings`)}
                        >
                          <Settings className="w-4 h-4" />
                          <span>Settings</span>
                        </PrimaryButton>
                      )}

                      {!isOwner && (
                        <PrimaryButton
                          variant="danger"
                          onClick={() => setLeaveConfirmOpen(true)}
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Leave</span>
                        </PrimaryButton>
                      )}
                    </>
                  ) : community.isPending ? (
                    <>
                      <PrimaryButton variant="secondary" disabled>
                        Request Pending Approval
                      </PrimaryButton>
                      <PrimaryButton
                        variant="ghost"
                        loading={actionLoading}
                        onClick={handleCancelRequest}
                      >
                        Cancel Request
                      </PrimaryButton>
                    </>
                  ) : (
                    <PrimaryButton loading={actionLoading} onClick={handleJoin}>
                      {community.privacy === 'private'
                        ? 'Request to Join'
                        : 'Join Community'}
                    </PrimaryButton>
                  )}
                </div>
              </div>
            </div>
          </section>

          {isPrivateRestricted ? (
            <section className="rounded-2xl bg-[#202020] border border-[#303030] p-6 text-center space-y-2">
              <Lock className="w-6 h-6 text-[#999999] mx-auto" />
              <h3 className="text-sm font-semibold text-[#FFFFFF]">
                Private Community
              </h3>
              <p className="text-xs text-[#999999] max-w-md mx-auto leading-relaxed">
                Member lists, discussions, and community settings are restricted to approved members. Send a join request above and an administrator will review it.
              </p>
            </section>
          ) : (
            <>
              {/* Join Requests Alert Card (Admins & Owner) */}
              {canManageRequests && community.pendingRequests.length > 0 && (
                <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#FFFFFF]">
                        Pending Join Requests ({community.pendingRequests.length})
                      </h3>
                      <p className="text-xs text-[#999999]">
                        Approve or decline users waiting to join this private community.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/community/${community.id}/members?tab=requests`)
                      }
                      className="text-xs font-medium text-[#FFFFFF] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>Manage all</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {community.pendingRequests.slice(0, 3).map((reqUser) => (
                      <div
                        key={reqUser.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#181818] border border-[#303030]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar
                            src={reqUser.avatar}
                            name={reqUser.fullName}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#FFFFFF] truncate">
                              {reqUser.fullName}
                            </p>
                            <p className="text-xs text-[#999999] truncate">
                              @{reqUser.username}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={processingRequestId === reqUser.id}
                            onClick={() => handleReviewRequest(reqUser.id, 'approve')}
                            aria-label={`Approve ${reqUser.fullName}`}
                            className="h-9 px-3 rounded-xl bg-[#22C55E] text-[#181818] text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            disabled={processingRequestId === reqUser.id}
                            onClick={() => handleReviewRequest(reqUser.id, 'reject')}
                            aria-label={`Reject ${reqUser.fullName}`}
                            className="h-9 px-3 rounded-xl bg-[#242424] border border-[#303030] text-[#E5484D] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#2C2C2C] disabled:opacity-50 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Leadership / Admins & Moderators */}
              <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#999999]" />
                    <h3 className="text-sm font-semibold text-[#FFFFFF]">
                      Admins & Moderators ({adminsAndMods.length})
                    </h3>
                  </div>
                  {community.isMember && (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/community/${community.id}/members?tab=admins`)
                      }
                      className="text-xs text-[#999999] hover:text-[#FFFFFF] flex items-center gap-1 cursor-pointer"
                    >
                      <span>View</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {adminsAndMods.map((entry) => (
                    <button
                      key={entry.user.id}
                      type="button"
                      onClick={() => navigate(`/u/${entry.user.username}`)}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#181818] border border-[#303030] hover:bg-[#242424] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar
                          src={entry.user.avatar}
                          name={entry.user.fullName}
                          size="sm"
                          online={entry.user.onlineStatus}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#FFFFFF] truncate">
                            {entry.user.fullName}
                          </p>
                          <p className="text-xs text-[#999999] truncate">
                            @{entry.user.username}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#242424] border border-[#303030] text-[#FFFFFF] capitalize shrink-0">
                        {entry.role}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Members Preview (Visible to Members) */}
              {community.isMember && (
                <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#999999]" />
                      <h3 className="text-sm font-semibold text-[#FFFFFF]">
                        Members ({community.memberCount})
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/community/${community.id}/members`)}
                      className="text-xs font-medium text-[#FFFFFF] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>View all members</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {previewMembers.map((entry) => (
                      <button
                        key={entry.user.id}
                        type="button"
                        onClick={() => navigate(`/u/${entry.user.username}`)}
                        className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-[#242424] transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar
                            src={entry.user.avatar}
                            name={entry.user.fullName}
                            size="sm"
                            online={entry.user.onlineStatus}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#FFFFFF] truncate">
                              {entry.user.fullName}
                            </p>
                            <p className="text-xs text-[#999999] truncate">
                              @{entry.user.username}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-[#999999] capitalize shrink-0">
                          {entry.role}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Community Information & Permissions */}
              {community.settings && (
                <section className="rounded-2xl bg-[#202020] border border-[#303030] p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-[#999999]" />
                      <h3 className="text-sm font-semibold text-[#FFFFFF]">
                        Permissions & Settings
                      </h3>
                    </div>
                    {canManageSettings && (
                      <button
                        type="button"
                        onClick={() => navigate(`/community/${community.id}/settings`)}
                        className="text-xs font-medium text-[#FFFFFF] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>Edit settings</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-[#181818] border border-[#303030]">
                      <p className="text-[11px] text-[#999999]">Who can invite</p>
                      <p className="text-xs font-medium text-[#FFFFFF] mt-1">
                        {INVITE_LABELS[community.settings.whoCanInvite] || 'Owner & Admins'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#181818] border border-[#303030]">
                      <p className="text-[11px] text-[#999999]">Who can pin messages</p>
                      <p className="text-xs font-medium text-[#FFFFFF] mt-1">
                        {PIN_LABELS[community.settings.whoCanPinMessages] ||
                          'Moderators & above'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#181818] border border-[#303030]">
                      <p className="text-[11px] text-[#999999]">Who can post</p>
                      <p className="text-xs font-medium text-[#FFFFFF] mt-1">
                        {POST_LABELS[community.settings.whoCanPost] || 'All members'}
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Invite Members Modal */}
      <InviteMembersModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        communityId={community.id}
        communityName={community.name}
        existingMemberIds={community.members.map((m) => m.user.id)}
        onInvited={loadDetails}
      />

      {/* Leave Confirmation Modal */}
      <Modal
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        title="Leave Community"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#999999] leading-relaxed">
            Are you sure you want to leave <strong className="text-[#FFFFFF]">{community.name}</strong>?
            {community.privacy === 'private'
              ? ' Because this is a private community, you will need admin approval to rejoin.'
              : ' You can rejoin anytime from Discover Communities.'}
          </p>
          <div className="flex justify-end gap-2">
            <PrimaryButton
              variant="secondary"
              onClick={() => setLeaveConfirmOpen(false)}
            >
              Cancel
            </PrimaryButton>
            <PrimaryButton
              variant="danger"
              loading={actionLoading}
              onClick={handleLeave}
            >
              Leave Community
            </PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
