import { useEffect, useState } from 'react';
import { Check, Search, UserPlus } from 'lucide-react';
import { communityApi, extractApiError, userApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import type { User } from '../types';
import { Modal } from './Modal';
import { PrimaryButton } from './PrimaryButton';
import { UserAvatar } from './UserAvatar';

interface InviteMembersModalProps {
  open: boolean;
  onClose: () => void;
  communityId: string;
  communityName: string;
  existingMemberIds: string[];
  onInvited: () => void;
}

export function InviteMembersModal({
  open,
  onClose,
  communityId,
  communityName,
  existingMemberIds,
  onInvited,
}: InviteMembersModalProps) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelectedIds([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const users = await userApi.search(query.trim());
        if (!cancelled) {
          const memberSet = new Set(existingMemberIds);
          setResults(users.filter((u) => !memberSet.has(u.id)));
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, existingMemberIds]);

  const toggleUser = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      const res = await communityApi.inviteMembers(communityId, selectedIds);
      showToast(res.message, 'success');
      onInvited();
      onClose();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Invite to ${communityName}`}>
      <div className="space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or @username..."
            className="w-full h-10 rounded-xl bg-[#181818] border border-[#303030] pl-10 pr-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/50 focus:outline-none"
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1.5">
          {loading ? (
            <div className="py-8 text-center text-xs text-[#999999]">Searching users...</div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#999999]">
              {query.trim()
                ? 'No matching users available to invite.'
                : 'Type a name or username to invite people.'}
            </div>
          ) : (
            results.map((u) => {
              const selected = selectedIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleUser(u.id)}
                  className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#242424] border-[#FFFFFF]'
                      : 'bg-[#181818] border-[#303030] hover:bg-[#242424]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar src={u.avatar} name={u.fullName} size="sm" online={u.onlineStatus} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#FFFFFF] truncate">{u.fullName}</p>
                      <p className="text-xs text-[#999999] truncate">@{u.username}</p>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ${
                      selected
                        ? 'bg-[#FFFFFF] border-[#FFFFFF] text-[#181818]'
                        : 'border-[#303030] text-transparent'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#303030]">
          <span className="text-xs text-[#999999]">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            <PrimaryButton variant="secondary" onClick={onClose}>
              Cancel
            </PrimaryButton>
            <PrimaryButton
              disabled={selectedIds.length === 0}
              loading={submitting}
              onClick={handleSubmit}
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Members</span>
            </PrimaryButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
