import { useCallback, useEffect, useState } from 'react';
import { Check, Contact, ScanLine, Search, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { QrScannerModal } from '../../components/QrScannerModal';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useToast } from '../../context/ToastContext';
import { conversationApi, extractApiError, userApi } from '../../services/api';
import type { User } from '../../types';

export function NewChatPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  // Create Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const loadUsers = useCallback(async (q: string) => {
    setError(null);
    setLoading(true);
    try {
      const list = await userApi.search(q);
      setUsers(list);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, loadUsers]);

  const handleStartDirect = async (targetUser: User) => {
    setStartingId(targetUser.id);
    try {
      const conv = await conversationApi.create({
        type: 'direct',
        participantIds: [targetUser.id],
      });
      navigate(`/chats/${conv.id}`);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setStartingId(null);
    }
  };

  const handleToggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (groupName.trim().length < 2) {
      showToast('Enter a group name (at least 2 characters).', 'error');
      return;
    }
    if (selectedIds.length === 0) {
      showToast('Select at least one person for the group.', 'error');
      return;
    }
    setCreatingGroup(true);
    try {
      const conv = await conversationApi.create({
        type: 'group',
        name: groupName.trim(),
        participantIds: selectedIds,
      });
      setGroupModalOpen(false);
      showToast('Group created.', 'success');
      navigate(`/chats/${conv.id}`);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleImportContacts = async () => {
    const nav = navigator as Navigator & {
      contacts?: {
        select: (props: string[], opts?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
      };
    };
    if (!nav.contacts?.select) {
      showToast(
        'Device Contact Picker API is only available on supported mobile browsers.',
        'info'
      );
      return;
    }
    try {
      const picked = await nav.contacts.select(['name', 'tel'], { multiple: true });
      if (picked.length > 0 && picked[0].name?.[0]) {
        setQuery(picked[0].name[0]);
      }
    } catch {
      showToast('Contact access was cancelled or denied.', 'info');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="New Chat"
        subtitle="Start a 1:1 conversation or create a group"
        showBack
        onBack={() => navigate('/chats')}
      />

      <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col overflow-hidden px-4 sm:px-6 py-4">
        <div className="relative mb-4 shrink-0">
          <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search registered BlinkUpZ users by name or @username..."
            className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-10 pr-4 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-[#303030] shrink-0">
          <button
            type="button"
            onClick={() => setGroupModalOpen(true)}
            className="flex items-center gap-2.5 px-4 min-h-[44px] rounded-xl bg-[#202020] border border-[#303030] text-sm font-medium text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
          >
            <Users className="w-4 h-4" />
            <span>Create New Group</span>
          </button>

          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex items-center gap-2.5 px-4 min-h-[44px] rounded-xl bg-[#202020] border border-[#303030] text-sm font-medium text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
          >
            <ScanLine className="w-4 h-4" />
            <span>Scan QR Code</span>
          </button>

          <button
            type="button"
            onClick={handleImportContacts}
            className="flex items-center gap-2.5 px-4 min-h-[44px] rounded-xl bg-[#202020] border border-[#303030] text-sm font-medium text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] transition-colors cursor-pointer"
          >
            <Contact className="w-4 h-4" />
            <span>Phone Contacts</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {loading ? (
            <LoadingState rows={6} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => loadUsers(query)} />
          ) : users.length === 0 ? (
            <EmptyState
              title="No users found"
              description={
                query
                  ? `No verified BlinkUpZ users matched "${query}".`
                  : 'Other registered users will appear here once they verify their accounts.'
              }
            />
          ) : (
            users.map((u) => {
              const isBlocked = Boolean(u.isBlockedByMe || u.hasBlockedMe);
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-[#202020] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      src={u.avatar}
                      name={u.fullName}
                      size="md"
                      online={!isBlocked && u.onlineStatus}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#FFFFFF] truncate">
                        {u.fullName}
                      </p>
                      <p className="text-xs text-[#999999] truncate">@{u.username}</p>
                    </div>
                  </div>
                  {isBlocked ? (
                    <PrimaryButton
                      variant="secondary"
                      onClick={() => navigate(`/u/${u.username}`)}
                      className="min-h-[38px] px-3.5 py-1.5 text-xs text-[#E5484D]"
                    >
                      {u.isBlockedByMe ? 'Blocked' : 'Unavailable'}
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton
                      variant="secondary"
                      loading={startingId === u.id}
                      onClick={() => handleStartDirect(u)}
                      className="min-h-[38px] px-3.5 py-1.5 text-xs"
                    >
                      Message
                    </PrimaryButton>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <Modal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        title="Create New Group"
      >
        <form onSubmit={handleCreateGroup} className="space-y-4">
          <div>
            <label htmlFor="groupName" className="block text-xs font-medium text-[#999999] mb-1.5">
              Group Name
            </label>
            <input
              id="groupName"
              type="text"
              required
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Design & Product Team"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:border-[#FFFFFF]/40 focus:outline-none"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-[#999999] mb-2">
              Select Members ({selectedIds.length} selected)
            </p>
            <div className="max-h-56 overflow-y-auto space-y-1 border border-[#303030] rounded-xl p-2 bg-[#181818]">
              {users.filter((u) => !u.isBlockedByMe && !u.hasBlockedMe).length === 0 ? (
                <p className="text-xs text-[#999999] text-center py-4">
                  No other users available yet.
                </p>
              ) : (
                users
                  .filter((u) => !u.isBlockedByMe && !u.hasBlockedMe)
                  .map((u) => {
                  const selected = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleToggleMember(u.id)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                        selected ? 'bg-[#242424]' : 'hover:bg-[#202020]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar src={u.avatar} name={u.fullName} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm text-[#FFFFFF] truncate">{u.fullName}</p>
                          <p className="text-xs text-[#999999] truncate">@{u.username}</p>
                        </div>
                      </div>
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          selected
                            ? 'bg-[#FFFFFF] border-[#FFFFFF] text-[#181818]'
                            : 'border-[#303030]'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <PrimaryButton type="submit" fullWidth loading={creatingGroup}>
            Create Group
          </PrimaryButton>
        </form>
      </Modal>

      <QrScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </div>
  );
}
