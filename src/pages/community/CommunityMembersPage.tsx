import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Search,
  Shield,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { InviteMembersModal } from '../../components/InviteMembersModal';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { communityApi, extractApiError } from '../../services/api';
import type { CommunityMemberEntry, CommunityMembersResponse } from '../../types';

type MembersTab = 'all' | 'admins' | 'moderators' | 'requests';

export function CommunityMembersPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { showToast } = useToast();

  const initialTab = (searchParams.get('tab') as MembersTab) || 'all';
  const [tab, setTab] = useState<MembersTab>(
    ['all', 'admins', 'moderators', 'requests'].includes(initialTab)
      ? initialTab
      : 'all'
  );
  const [query, setQuery] = useState('');
  const [data, setData] = useState<CommunityMembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CommunityMemberEntry | null>(null);

  const loadMembers = useCallback(async () => {
    if (!communityId) return;
    setError(null);
    try {
      const apiRole =
        tab === 'requests' ? 'all' : (tab as 'all' | 'admins' | 'moderators');
      const res = await communityApi.listMembers(communityId, {
        q: query.trim(),
        role: apiRole,
      });
      setData(res);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [communityId, tab, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadMembers();
    }, 150);
    return () => clearTimeout(timer);
  }, [loadMembers]);

  useEffect(() => {
    if (!socket || !communityId) return;
    const onRefresh = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        loadMembers();
      }
    };
    const onDeleted = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        navigate('/community', { replace: true });
      }
    };
    socket.on('community:updated', onRefresh);
    socket.on('community:join_request', onRefresh);
    socket.on('community:deleted', onDeleted);
    return () => {
      socket.off('community:updated', onRefresh);
      socket.off('community:join_request', onRefresh);
      socket.off('community:deleted', onDeleted);
    };
  }, [socket, communityId, loadMembers, navigate]);

  const handleTabChange = (nextTab: MembersTab) => {
    setTab(nextTab);
    setSearchParams(nextTab === 'all' ? {} : { tab: nextTab });
  };

  const canModifyRole = (entry: CommunityMemberEntry): boolean => {
    if (!data) return false;
    if (entry.user.id === user?.id) return false;
    if (entry.role === 'owner') return false;
    if (data.myRole === 'owner') return true;
    if (data.myRole === 'admin') {
      return entry.role === 'moderator' || entry.role === 'member';
    }
    return false;
  };

  const canRemoveEntry = (entry: CommunityMemberEntry): boolean => {
    if (!data) return false;
    if (entry.user.id === user?.id) return false;
    if (entry.role === 'owner') return false;
    if (data.myRole === 'owner') return true;
    if (data.myRole === 'admin') {
      return entry.role === 'moderator' || entry.role === 'member';
    }
    if (data.myRole === 'moderator') {
      return entry.role === 'member';
    }
    return false;
  };

  const handleRoleChange = async (
    targetId: string,
    nextRole: 'admin' | 'moderator' | 'member'
  ) => {
    if (!communityId) return;
    setBusyUserId(targetId);
    try {
      const res = await communityApi.updateRole(communityId, targetId, nextRole);
      showToast(res.message, 'success');
      await loadMembers();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!communityId || !removeTarget) return;
    setBusyUserId(removeTarget.user.id);
    try {
      const res = await communityApi.removeMember(communityId, removeTarget.user.id);
      showToast(res.message, 'info');
      setRemoveTarget(null);
      await loadMembers();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleReviewRequest = async (
    targetUserId: string,
    decision: 'approve' | 'reject'
  ) => {
    if (!communityId) return;
    setBusyUserId(targetUserId);
    try {
      const res = await communityApi.handleRequest(communityId, targetUserId, decision);
      showToast(res.message, decision === 'approve' ? 'success' : 'info');
      await loadMembers();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const tabs: Array<{ id: MembersTab; label: string; count?: number }> = [
    { id: 'all', label: 'All', count: data?.counts.all },
    { id: 'admins', label: 'Admins', count: data?.counts.admins },
    { id: 'moderators', label: 'Moderators', count: data?.counts.moderators },
    ...(data?.permissions.canManageRequests
      ? [{ id: 'requests' as const, label: 'Requests', count: data.counts.requests }]
      : []),
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title={data ? `${data.communityName} Members` : 'Community Members'}
        subtitle={
          data ? `${data.counts.all} member${data.counts.all === 1 ? '' : 's'}` : undefined
        }
        showBack
        onBack={() => navigate(`/community/${communityId}/details`)}
        rightSlot={
          data?.permissions.canInvite ? (
            <PrimaryButton
              className="min-h-[38px] px-3.5 py-1.5 text-xs"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="w-4 h-4" />
              <span>Invite</span>
            </PrimaryButton>
          ) : undefined
        }
      />

      <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col overflow-hidden px-4 sm:px-6">
        {/* Search Input */}
        <div className="pt-4">
          <div className="relative">
            <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members by name or @username..."
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-10 pr-10 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/50 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999999] hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 py-3 border-b border-[#303030] overflow-x-auto shrink-0">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                tab === item.id
                  ? 'bg-[#FFFFFF] text-[#181818]'
                  : 'bg-[#202020] text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424]'
              }`}
            >
              <span>{item.label}</span>
              {typeof item.count === 'number' && (
                <span
                  className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md ${
                    tab === item.id
                      ? 'bg-[#181818]/15 text-[#181818]'
                      : 'bg-[#242424] text-[#999999]'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto py-4 space-y-2.5">
          {loading ? (
            <LoadingState rows={6} />
          ) : error || !data ? (
            <ErrorState
              message={error || 'Unable to load members.'}
              onRetry={loadMembers}
            />
          ) : tab === 'requests' ? (
            data.pendingRequests.length === 0 ? (
              <EmptyState
                icon={<Shield className="w-5 h-5" />}
                title="No pending requests"
                description="Join requests for this private community will appear here."
              />
            ) : (
              data.pendingRequests.map((reqUser) => (
                <div
                  key={reqUser.id}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#202020] border border-[#303030]"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/u/${reqUser.username}`)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <UserAvatar
                      src={reqUser.avatar}
                      name={reqUser.fullName}
                      size="md"
                      online={reqUser.onlineStatus}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#FFFFFF] truncate">
                        {reqUser.fullName}
                      </p>
                      <p className="text-xs text-[#999999] truncate">
                        @{reqUser.username}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyUserId === reqUser.id}
                      onClick={() => handleReviewRequest(reqUser.id, 'approve')}
                      className="h-9 px-3 rounded-xl bg-[#22C55E] text-[#181818] text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyUserId === reqUser.id}
                      onClick={() => handleReviewRequest(reqUser.id, 'reject')}
                      className="h-9 px-3 rounded-xl bg-[#242424] border border-[#303030] text-[#E5484D] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#2C2C2C] disabled:opacity-50 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              ))
            )
          ) : data.members.length === 0 ? (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title="No matching members"
              description={
                query
                  ? 'Try adjusting your search or filter tab.'
                  : 'No members in this role filter yet.'
              }
            />
          ) : (
            data.members.map((entry) => {
              const showRoleSelect = canModifyRole(entry);
              const showRemoveBtn = canRemoveEntry(entry);

              return (
                <div
                  key={entry.user.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#202020] border border-[#303030]"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/u/${entry.user.username}`)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <UserAvatar
                      src={entry.user.avatar}
                      name={entry.user.fullName}
                      size="md"
                      online={entry.user.onlineStatus}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[#FFFFFF] truncate">
                          {entry.user.fullName}
                        </p>
                        {entry.user.id === user?.id && (
                          <span className="text-[11px] text-[#999999]">(You)</span>
                        )}
                      </div>
                      <p className="text-xs text-[#999999] truncate">
                        @{entry.user.username}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center justify-end gap-2 shrink-0">
                    {showRoleSelect ? (
                      <select
                        aria-label={`Role for ${entry.user.fullName}`}
                        disabled={busyUserId === entry.user.id}
                        value={entry.role}
                        onChange={(e) =>
                          handleRoleChange(
                            entry.user.id,
                            e.target.value as 'admin' | 'moderator' | 'member'
                          )
                        }
                        className="h-9 rounded-xl bg-[#242424] border border-[#303030] px-3 text-xs font-medium text-[#FFFFFF] focus:outline-none cursor-pointer"
                      >
                        <option value="member">Member</option>
                        <option value="moderator">Moderator</option>
                        {data.myRole === 'owner' && <option value="admin">Admin</option>}
                      </select>
                    ) : (
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize border ${
                          entry.role === 'owner'
                            ? 'bg-[#FFFFFF] text-[#181818] border-[#FFFFFF] font-semibold'
                            : entry.role === 'admin'
                              ? 'bg-[#242424] text-[#FFFFFF] border-[#303030]'
                              : entry.role === 'moderator'
                                ? 'bg-[#242424] text-[#22C55E] border-[#303030]'
                                : 'bg-[#181818] text-[#999999] border-[#303030]'
                        }`}
                      >
                        {entry.role}
                      </span>
                    )}

                    {showRemoveBtn && (
                      <button
                        type="button"
                        disabled={busyUserId === entry.user.id}
                        onClick={() => setRemoveTarget(entry)}
                        aria-label={`Remove ${entry.user.fullName}`}
                        title="Remove member"
                        className="w-9 h-9 rounded-xl bg-[#242424] border border-[#303030] flex items-center justify-center text-[#E5484D] hover:bg-[#2C2C2C] disabled:opacity-50 cursor-pointer"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {data && communityId && (
        <InviteMembersModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          communityId={communityId}
          communityName={data.communityName}
          existingMemberIds={data.members.map((m) => m.user.id)}
          onInvited={loadMembers}
        />
      )}

      {/* Remove Member Confirmation Modal */}
      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remove Member"
      >
        {removeTarget && (
          <div className="space-y-4">
            <p className="text-sm text-[#999999] leading-relaxed">
              Remove <strong className="text-[#FFFFFF]">{removeTarget.user.fullName}</strong> (@{removeTarget.user.username}) from this community? They will also lose access to the community chat.
            </p>
            <div className="flex justify-end gap-2">
              <PrimaryButton
                variant="secondary"
                onClick={() => setRemoveTarget(null)}
              >
                Cancel
              </PrimaryButton>
              <PrimaryButton
                variant="danger"
                loading={busyUserId === removeTarget.user.id}
                onClick={handleConfirmRemove}
              >
                Remove Member
              </PrimaryButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
