import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  Phone,
  PhoneMissed,
  Plus,
  Search,
  Trash2,
  User as UserIcon,
  Video,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useToast } from '../../context/ToastContext';
import { callApi, conversationApi, extractApiError, userApi } from '../../services/api';
import type { CallHistoryItem, User } from '../../types';
import { formatConversationTime, formatDuration } from '../../utils/formatters';
import {
  getCachedCallHistory,
  saveCachedCallHistory,
} from '../../utils/indexedDb';
import {
  CACHE_TIMES,
  queryKeys,
  removeCallFromCaches,
} from '../../utils/queryClient';

export function CallHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { startCall } = useCall();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id || '';

  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [idbSeed, setIdbSeed] = useState<CallHistoryItem[] | null>(null);

  const [newCallModalOpen, setNewCallModalOpen] = useState(false);
  const [newCallSearch, setNewCallSearch] = useState('');
  const [initialCallContacts, setInitialCallContacts] = useState<User[]>([]);
  const [newCallContacts, setNewCallContacts] = useState<User[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [detailEntry, setDetailEntry] = useState<CallHistoryItem | null>(null);
  const [contactProfile, setContactProfile] = useState<User | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!userId || debouncedQuery) return;
    let active = true;
    getCachedCallHistory(userId, filter).then((cached) => {
      if (!active) return;
      setIdbSeed(cached);
      if (cached.length > 0) {
        const key = queryKeys.callHistory(userId, filter, '');
        if (!qc.getQueryData(key)) {
          qc.setQueryData(key, cached);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [userId, filter, debouncedQuery, qc]);

  const {
    data: queryCalls,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.callHistory(userId, filter, debouncedQuery),
    enabled: Boolean(userId),
    staleTime: CACHE_TIMES.callHistory.staleTime,
    gcTime: CACHE_TIMES.callHistory.gcTime,
    queryFn: async () => {
      try {
        const fresh = await callApi.listHistory(filter, debouncedQuery);
        if (!debouncedQuery && filter === 'all') {
          void saveCachedCallHistory(userId, fresh);
        }
        return fresh;
      } catch (err) {
        if (!debouncedQuery) {
          const cached = await getCachedCallHistory(userId, filter);
          if (cached.length > 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            return cached;
          }
        }
        throw err;
      }
    },
  });

  const calls = queryCalls ?? (!debouncedQuery ? idbSeed ?? [] : []);
  const loading = isLoading && calls.length === 0 && (Boolean(debouncedQuery) || idbSeed === null);
  const error =
    queryError && calls.length === 0
      ? extractApiError(queryError).message
      : null;

  const handleRemove = async (id: string) => {
    try {
      await callApi.deleteEntry(id);
      removeCallFromCaches(userId, id);
      if (detailEntry?.id === id) setDetailEntry(null);
      showToast('Call history entry removed.', 'info');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const openNewCallModal = useCallback(async () => {
    setNewCallModalOpen(true);
    setNewCallSearch('');
    setLoadingContacts(true);
    try {
      const convs = await conversationApi.list('all');
      const peers: User[] = [];
      const seen = new Set<string>();
      for (const conv of convs) {
        if (conv.type !== 'direct') continue;
        const peerPart = conv.participants.find((p) => p.userId !== userId);
        if (peerPart?.user && !seen.has(peerPart.user.id)) {
          seen.add(peerPart.user.id);
          peers.push(peerPart.user);
        }
      }
      setInitialCallContacts(peers);
      setNewCallContacts(peers);
    } catch {
      // Fall back to search
    } finally {
      setLoadingContacts(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!newCallModalOpen) return;
    const trimmed = newCallSearch.trim();
    if (!trimmed) {
      setNewCallContacts(initialCallContacts);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const users = await userApi.search(trimmed);
        if (active) {
          setNewCallContacts(users.filter((u) => u.id !== userId));
        }
      } catch {
        // Ignore transient search errors
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [newCallModalOpen, newCallSearch, userId, initialCallContacts]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <header className="h-16 px-4 sm:px-6 flex items-center justify-between gap-3 border-b border-[#303030] shrink-0">
        <h1 className="text-lg font-bold tracking-tight text-[#FFFFFF]">Calls</h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen((p) => !p)}
            aria-label="Search call history"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
          >
            <Search className="w-5 h-5" />
          </button>
          <PrimaryButton
            variant="secondary"
            onClick={() => void openNewCallModal()}
            className="min-h-[38px] px-3.5 py-1.5 text-xs"
          >
            <Plus className="w-4 h-4" />
            <span>New Call</span>
          </PrimaryButton>
        </div>
      </header>

      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col overflow-hidden px-4 sm:px-6">
        {searchOpen && (
          <div className="pt-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search call logs by contact..."
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-10 pr-10 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999999] hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 py-3 border-b border-[#303030] shrink-0">
          <div className="flex items-center gap-2">
            {(['all', 'missed'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                  filter === tab
                    ? 'bg-[#FFFFFF] text-[#181818]'
                    : 'bg-[#202020] text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <span className="text-xs text-[#999999] hidden sm:inline">
            1:1 Encrypted Voice & Video
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-3 space-y-1">
          {loading ? (
            <LoadingState rows={5} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void refetch()} />
          ) : calls.length === 0 ? (
            <EmptyState
              icon={<Phone className="w-5 h-5" />}
              title={filter === 'missed' ? 'No missed calls' : 'No call history yet'}
              description="Start a 1:1 voice or video call from any direct chat or click New Call above."
              actionLabel="Start New Call"
              onAction={() => void openNewCallModal()}
            />
          ) : (
            calls.map((entry) => {
              const isMissed = entry.direction === 'missed';
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl hover:bg-[#202020] transition-colors"
                >
                  <div
                    className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                    onClick={() => setDetailEntry(entry)}
                  >
                    <UserAvatar
                      src={entry.contact?.avatar}
                      name={entry.contact?.fullName || 'Unknown Contact'}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isMissed ? 'text-[#E5484D]' : 'text-[#FFFFFF]'
                        }`}
                      >
                        {entry.contact?.fullName || 'Unknown Contact'}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-[#999999] mt-0.5">
                        {entry.direction === 'incoming' ? (
                          <ArrowDownLeft className="w-3.5 h-3.5 text-[#22C55E]" />
                        ) : entry.direction === 'outgoing' ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-[#999999]" />
                        ) : (
                          <PhoneMissed className="w-3.5 h-3.5 text-[#E5484D]" />
                        )}
                        <span className="capitalize">{entry.direction}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{entry.callType}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatConversationTime(entry.createdAt)}
                        </span>
                        {entry.duration > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatDuration(entry.duration)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {entry.contact && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void startCall({
                              recipientId: entry.contact!.id,
                              callType: 'voice',
                              conversationId: entry.conversationId,
                              peerHint: {
                                id: entry.contact!.id,
                                fullName: entry.contact!.fullName,
                                username: entry.contact!.username,
                                avatar: entry.contact!.avatar,
                              },
                            })
                          }
                          aria-label={`Voice call ${entry.contact.fullName}`}
                          className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void startCall({
                              recipientId: entry.contact!.id,
                              callType: 'video',
                              conversationId: entry.conversationId,
                              peerHint: {
                                id: entry.contact!.id,
                                fullName: entry.contact!.fullName,
                                username: entry.contact!.username,
                                avatar: entry.contact!.avatar,
                              },
                            })
                          }
                          aria-label={`Video call ${entry.contact.fullName}`}
                          className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {entry.contact && (
                      <button
                        type="button"
                        onClick={() => setContactProfile(entry.contact)}
                        aria-label="Contact profile"
                        className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                      >
                        <UserIcon className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetailEntry(entry)}
                      aria-label="Call details"
                      className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(entry.id)}
                      aria-label="Remove entry"
                      className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-[#E5484D] hover:bg-[#242424] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* New Call Contact Picker Modal */}
      <Modal
        open={newCallModalOpen}
        onClose={() => setNewCallModalOpen(false)}
        title="Start a Call"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#999999] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={newCallSearch}
              onChange={(e) => setNewCallSearch(e.target.value)}
              placeholder="Search people by name or @username..."
              className="w-full h-10 rounded-xl bg-[#181818] border border-[#303030] pl-9 pr-3 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1">
            {loadingContacts ? (
              <LoadingState rows={3} />
            ) : newCallContacts.length === 0 ? (
              <p className="text-xs text-[#999999] text-center py-6">
                No contacts found. Search by username or start a chat first.
              </p>
            ) : (
              newCallContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-[#181818]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar
                      src={contact.avatar}
                      name={contact.fullName}
                      size="sm"
                      online={contact.onlineStatus}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#FFFFFF] truncate">
                        {contact.fullName}
                      </p>
                      <p className="text-xs text-[#999999] truncate">
                        @{contact.username}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setNewCallModalOpen(false);
                        void startCall({
                          recipientId: contact.id,
                          callType: 'voice',
                          peerHint: {
                            id: contact.id,
                            fullName: contact.fullName,
                            username: contact.username,
                            avatar: contact.avatar,
                          },
                        });
                      }}
                      aria-label={`Voice call ${contact.fullName}`}
                      className="w-9 h-9 rounded-lg bg-[#242424] hover:bg-[#303030] text-[#FFFFFF] flex items-center justify-center cursor-pointer"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewCallModalOpen(false);
                        void startCall({
                          recipientId: contact.id,
                          callType: 'video',
                          peerHint: {
                            id: contact.id,
                            fullName: contact.fullName,
                            username: contact.username,
                            avatar: contact.avatar,
                          },
                        });
                      }}
                      aria-label={`Video call ${contact.fullName}`}
                      className="w-9 h-9 rounded-lg bg-[#242424] hover:bg-[#303030] text-[#FFFFFF] flex items-center justify-center cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Call Details Modal */}
      <Modal
        open={detailEntry !== null}
        onClose={() => setDetailEntry(null)}
        title="Call Details"
      >
        {detailEntry && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <UserAvatar
                src={detailEntry.contact?.avatar}
                name={detailEntry.contact?.fullName || 'Unknown'}
                size="lg"
              />
              <div>
                <p className="text-base font-semibold text-[#FFFFFF]">
                  {detailEntry.contact?.fullName || 'Unknown Contact'}
                </p>
                <p className="text-xs text-[#999999]">
                  @{detailEntry.contact?.username || 'unknown'}
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-[#181818] border border-[#303030] p-3.5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#999999]">Type</span>
                <span className="capitalize">{detailEntry.callType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#999999]">Direction</span>
                <span className="capitalize">{detailEntry.direction}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#999999]">Status</span>
                <span className="capitalize">{detailEntry.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#999999]">Duration</span>
                <span className="font-mono tabular-nums">
                  {formatDuration(detailEntry.duration)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#999999]">Timestamp</span>
                <span className="font-mono tabular-nums">
                  {new Date(detailEntry.createdAt).toLocaleString()}
                </span>
              </div>
              {detailEntry.endReason && (
                <div className="flex justify-between gap-4">
                  <span className="text-[#999999]">Details</span>
                  <span className="text-right text-[#FFFFFF]">{detailEntry.endReason}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <PrimaryButton
                variant="danger"
                onClick={() => handleRemove(detailEntry.id)}
              >
                Remove Entry
              </PrimaryButton>
            </div>
          </div>
        )}
      </Modal>

      {/* Contact Profile Modal */}
      <Modal
        open={contactProfile !== null}
        onClose={() => setContactProfile(null)}
        title="Contact Profile"
      >
        {contactProfile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3.5">
              <UserAvatar
                src={contactProfile.avatar}
                name={contactProfile.fullName}
                size="lg"
                online={contactProfile.onlineStatus}
              />
              <div>
                <p className="text-base font-semibold text-[#FFFFFF]">
                  {contactProfile.fullName}
                </p>
                <p className="text-xs text-[#999999]">@{contactProfile.username}</p>
              </div>
            </div>
            {contactProfile.bio && (
              <p className="text-sm text-[#999999]">{contactProfile.bio}</p>
            )}
            <PrimaryButton
              fullWidth
              onClick={async () => {
                const conv = await conversationApi.create({
                  type: 'direct',
                  participantIds: [contactProfile.id],
                });
                setContactProfile(null);
                navigate(`/chats/${conv.id}`);
              }}
            >
              Send Message
            </PrimaryButton>
          </div>
        )}
      </Modal>
    </div>
  );
}
