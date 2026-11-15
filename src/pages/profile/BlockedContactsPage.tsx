import { useCallback, useEffect, useState } from 'react';
import { Ban, Search, ShieldCheck, UserX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractApiError, userApi } from '../../services/api';
import type { User } from '../../types';

export function BlockedContactsPage() {
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [candidates, setCandidates] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'block' | 'unblock';
    target: User;
  } | null>(null);

  const loadBlocked = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await userApi.getBlockedUsers();
      setBlockedUsers(list);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlocked();
  }, [loadBlocked]);

  useEffect(() => {
    if (!addModalOpen) return;
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await userApi.search(searchQuery);
        if (active) {
          const blockedIds = new Set(blockedUsers.map((u) => u.id));
          setCandidates(res.filter((u) => !blockedIds.has(u.id)));
        }
      } catch (err) {
        if (active) showToast(extractApiError(err).message, 'error');
      } finally {
        if (active) setSearching(false);
      }
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [addModalOpen, searchQuery, blockedUsers, showToast]);

  const handleConfirm = async () => {
    if (!confirmAction) return;
    const { type, target } = confirmAction;
    setBusyId(target.id);
    try {
      if (type === 'block') {
        const res = await userApi.blockUser(target.id);
        if (res.data.user) setAuthenticatedUser(res.data.user);
        setBlockedUsers((prev) =>
          prev.some((u) => u.id === target.id)
            ? prev
            : [...prev, { ...target, isBlockedByMe: true }]
        );
        setAddModalOpen(false);
        showToast(`${target.fullName} blocked.`, 'info');
      } else {
        const res = await userApi.unblockUser(target.id);
        if (res.data.user) setAuthenticatedUser(res.data.user);
        setBlockedUsers((prev) => prev.filter((u) => u.id !== target.id));
        showToast(`${target.fullName} unblocked.`, 'success');
      }
      setConfirmAction(null);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Blocked Contacts"
        showBack
        onBack={() => navigate('/profile/privacy')}
        rightSlot={
          <PrimaryButton
            variant="secondary"
            onClick={() => {
              setSearchQuery('');
              setAddModalOpen(true);
            }}
            className="min-h-[36px] py-1.5 px-3 text-xs"
          >
            <UserX className="w-3.5 h-3.5" />
            <span>Block User</span>
          </PrimaryButton>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="rounded-2xl bg-[#202020] border border-[#303030] p-4 flex items-start gap-3">
            <Ban className="w-4 h-4 text-[#E5484D] mt-0.5 shrink-0" />
            <p className="text-xs text-[#999999] leading-relaxed">
              Blocked contacts cannot send you direct messages, start new conversations with you, invite you to communities, or view your online status, last seen, photo, or bio.
            </p>
          </div>

          {loading ? (
            <LoadingState rows={4} />
          ) : error ? (
            <ErrorState message={error} onRetry={loadBlocked} />
          ) : blockedUsers.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="w-5 h-5" />}
              title="No blocked contacts"
              description="You have not blocked any BlinkUpZ users yet."
              actionLabel="Block a Contact"
              onAction={() => {
                setSearchQuery('');
                setAddModalOpen(true);
              }}
            />
          ) : (
            <section className="rounded-2xl bg-[#202020] border border-[#303030] divide-y divide-[#303030] overflow-hidden">
              {blockedUsers.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      src={person.avatar}
                      name={person.fullName}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#FFFFFF] truncate">
                        {person.fullName}
                      </p>
                      <p className="text-xs font-mono text-[#999999] truncate">
                        @{person.username}
                      </p>
                    </div>
                  </div>

                  <PrimaryButton
                    variant="secondary"
                    loading={busyId === person.id}
                    onClick={() =>
                      setConfirmAction({ type: 'unblock', target: person })
                    }
                    className="min-h-[36px] py-1.5 px-3.5 text-xs shrink-0"
                  >
                    Unblock
                  </PrimaryButton>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>

      {/* Add Blocked Contact Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Block a Contact"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or @username..."
              className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#181818] border border-[#303030] text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none focus:border-[#FFFFFF]"
            />
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1">
            {searching ? (
              <LoadingState rows={3} />
            ) : candidates.length === 0 ? (
              <p className="text-xs text-[#999999] text-center py-6">
                No matching users available to block.
              </p>
            ) : (
              candidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-[#242424]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      src={candidate.avatar}
                      name={candidate.fullName}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#FFFFFF] truncate">
                        {candidate.fullName}
                      </p>
                      <p className="text-xs font-mono text-[#999999] truncate">
                        @{candidate.username}
                      </p>
                    </div>
                  </div>
                  <PrimaryButton
                    variant="danger"
                    onClick={() =>
                      setConfirmAction({ type: 'block', target: candidate })
                    }
                    className="min-h-[34px] py-1 px-3 text-xs shrink-0"
                  >
                    Block
                  </PrimaryButton>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Confirm Block / Unblock Modal */}
      <Modal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction?.type === 'block'
            ? `Block ${confirmAction.target.fullName}?`
            : `Unblock ${confirmAction?.target.fullName}?`
        }
      >
        {confirmAction && (
          <div className="space-y-4">
            <p className="text-sm text-[#999999] leading-relaxed">
              {confirmAction.type === 'block'
                ? `@${confirmAction.target.username} will no longer be able to send you messages, start conversations with you, or see your online status and profile details.`
                : `@${confirmAction.target.username} will be able to message you and view your profile according to your privacy settings.`}
            </p>
            <div className="flex justify-end gap-2">
              <PrimaryButton
                variant="secondary"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </PrimaryButton>
              <PrimaryButton
                variant={confirmAction.type === 'block' ? 'danger' : 'primary'}
                loading={busyId === confirmAction.target.id}
                onClick={handleConfirm}
              >
                {confirmAction.type === 'block' ? 'Block User' : 'Unblock'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
