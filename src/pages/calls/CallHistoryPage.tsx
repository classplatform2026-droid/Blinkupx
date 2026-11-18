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

function getCallRowPresentation(entry: CallHistoryItem) {
  const isMissed = entry.direction === 'missed' || entry.status === 'missed';
  const isCompleted = entry.status === 'completed';
  const directionLabel = isMissed
    ? 'Missed'
    : entry.direction === 'incoming'
      ? 'Incoming'
      : 'Outgoing';
  const typeLabel = entry.callType === 'video' ? 'Video' : 'Voice';
  const hasValidDuration = isCompleted && entry.duration > 0;

  return {
    isMissed,
    isCompleted,
    directionLabel,
    typeLabel,
    summaryText: `${directionLabel} · ${typeLabel}`,
    hasValidDuration,
  };
}

function getCallStatusLabel(entry: CallHistoryItem): string {
  switch (entry.status) {
    case 'completed':
      return 'Completed';
    case 'missed':
      return 'Missed';
    case 'declined':
    case 'rejected':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
    case 'busy':
      return 'Busy';
    case 'failed':
      return 'Failed';
    default:
      return entry.status;
  }
}

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
  const [deleteTargetEntry, setDeleteTargetEntry] = useState<CallHistoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const confirmDelete = async () => {
    if (!deleteTargetEntry || deleting) return;
    const id = deleteTargetEntry.id;
    setDeleting(true);
    try {
      await callApi.deleteEntry(id);
      removeCallFromCaches(userId, id);
      if (detailEntry?.id === id) setDetailEntry(null);
      setDeleteTargetEntry(null);
      showToast('Call history entry removed.', 'info');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setDeleting(false);
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
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[#181818] overflow-hidden">
      <header className="h-16 px-3 sm:px-6 flex items-center justify-between gap-3 border-b border-[#303030] shrink-0">
        <h1 className="text-lg font-bold tracking-tight text-[#FFFFFF] min-w-0 truncate">
          Calls
        </h1>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSearchOpen((p) => !p)}
            aria-label={searchOpen ? 'Close call history search' : 'Search call history'}
            aria-expanded={searchOpen}
            title="Search call history"
            className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFFFFF]/40 transition-colors cursor-pointer"
          >
            <Search className="w-5 h-5" />
          </button>
          <PrimaryButton
            variant="secondary"
            onClick={() => void openNewCallModal()}
            className="!min-h-[40px] !px-3.5 !py-2 text-xs whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Call</span>
          </PrimaryButton>
        </div>
      </header>

      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col min-h-0 overflow-hidden px-2 min-[360px]:px-3 sm:px-6">
        {searchOpen && (
          <div className="pt-3 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search call logs by contact..."
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-10 pr-11 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none focus:border-[#4A4A4A]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#999999] hover:text-[#FFFFFF] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 py-3 border-b border-[#303030] shrink-0">
          <div className="flex items-center gap-2" role="tablist" aria-label="Call history filter">
            {(['all', 'missed'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={filter === tab}
                onClick={() => setFilter(tab)}
                className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-medium capitalize whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFFFFF]/40 cursor-pointer ${
                  filter === tab
                    ? 'bg-[#FFFFFF] text-[#181818]'
                    : 'bg-[#242424] text-[#999999] hover:text-[#FFFFFF] hover:bg-[#2C2C2C]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <span className="text-xs text-[#999999] hidden sm:inline whitespace-nowrap">
            1:1 Encrypted Voice & Video
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2 pb-8 sm:pb-6">
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
            <ul className="divide-y divide-[#303030]/60" aria-label="Call history list">
              {calls.map((entry) => {
                const {
                  isMissed,
                  isCompleted,
                  summaryText,
                  hasValidDuration,
                } = getCallRowPresentation(entry);
                const contactName = entry.contact?.fullName || 'Unknown Contact';

                return (
                  <li key={entry.id} className="min-w-0">
                    <div className="flex items-center justify-between gap-1.5 min-[360px]:gap-2 sm:gap-4 px-1.5 min-[360px]:px-2.5 sm:px-3.5 py-3 rounded-xl hover:bg-[#242424]/70 transition-colors min-w-0">
                      {/* LEFT SECTION: Avatar + User Name + Call Status & Type */}
                      <button
                        type="button"
                        onClick={() => setDetailEntry(entry)}
                        aria-label={`View call details for ${contactName}`}
                        className="flex items-center gap-2 min-[360px]:gap-2.5 sm:gap-3.5 min-w-0 flex-1 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFFFFF]/35 cursor-pointer"
                      >
                        <UserAvatar
                          src={entry.contact?.avatar}
                          name={contactName}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm font-semibold truncate leading-snug ${
                              isMissed ? 'text-[#E5484D]' : 'text-[#FFFFFF]'
                            }`}
                          >
                            {contactName}
                          </p>
                          <div
                            className={`flex items-center gap-1.5 text-xs mt-0.5 min-w-0 leading-snug ${
                              isMissed ? 'text-[#E5484D]' : 'text-[#999999]'
                            }`}
                          >
                            {isMissed ? (
                              <PhoneMissed className="w-3.5 h-3.5 text-[#E5484D] shrink-0" />
                            ) : entry.direction === 'incoming' ? (
                              <ArrowDownLeft
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  isCompleted ? 'text-[#22C55E]' : 'text-[#999999]'
                                }`}
                              />
                            ) : (
                              <ArrowUpRight
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  isCompleted ? 'text-[#22C55E]' : 'text-[#999999]'
                                }`}
                              />
                            )}
                            <span className="truncate">{summaryText}</span>
                          </div>
                        </div>
                      </button>

                      {/* RIGHT SECTION: Date/Time + Duration (if completed) + Info + Delete */}
                      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                        <div className="flex flex-col items-end justify-center text-right shrink-0 min-w-[46px]">
                          <span className="text-xs text-[#999999] font-mono tabular-nums whitespace-nowrap leading-snug">
                            {formatConversationTime(entry.createdAt)}
                          </span>
                          {hasValidDuration && (
                            <span className="text-xs font-mono tabular-nums text-[#22C55E] whitespace-nowrap leading-snug mt-0.5">
                              {formatDuration(entry.duration)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setDetailEntry(entry)}
                            aria-label={`Call details for ${contactName}`}
                            title="Call details"
                            className="min-w-[40px] min-h-[40px] min-[360px]:min-w-[44px] min-[360px]:min-h-[44px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFFFFF]/40 transition-colors cursor-pointer"
                          >
                            <Info className="w-[18px] h-[18px] shrink-0" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTargetEntry(entry)}
                            aria-label={`Delete call record with ${contactName}`}
                            title="Delete call record"
                            className="min-w-[40px] min-h-[40px] min-[360px]:min-w-[44px] min-[360px]:min-h-[44px] rounded-xl flex items-center justify-center text-[#999999] hover:text-[#E5484D] hover:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5484D]/50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-[18px] h-[18px] shrink-0" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
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
            <Search className="w-4 h-4 text-[#999999] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <UserAvatar
                      src={contact.avatar}
                      name={contact.fullName}
                      size="sm"
                      online={contact.onlineStatus}
                    />
                    <div className="min-w-0 flex-1">
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
                      title="Voice call"
                      className="min-w-[40px] min-h-[40px] rounded-xl bg-[#242424] hover:bg-[#303030] text-[#FFFFFF] flex items-center justify-center cursor-pointer"
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
                      title="Video call"
                      className="min-w-[40px] min-h-[40px] rounded-xl bg-[#242424] hover:bg-[#303030] text-[#FFFFFF] flex items-center justify-center cursor-pointer"
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
        {detailEntry && (() => {
          const { isMissed, isCompleted, hasValidDuration } =
            getCallRowPresentation(detailEntry);
          const contact = detailEntry.contact;
          const contactName = contact?.fullName || 'Unknown Contact';

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <UserAvatar
                    src={contact?.avatar}
                    name={contactName}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[#FFFFFF] truncate">
                      {contactName}
                    </p>
                    <p className="text-xs text-[#999999] truncate">
                      @{contact?.username || 'unknown'}
                    </p>
                  </div>
                </div>
                {contact && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailEntry(null);
                      setContactProfile(contact);
                    }}
                    aria-label="View contact profile"
                    title="View contact profile"
                    className="min-w-[40px] min-h-[40px] rounded-xl bg-[#242424] border border-[#303030] hover:bg-[#2C2C2C] text-[#FFFFFF] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <UserIcon className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="rounded-xl bg-[#181818] border border-[#303030] p-3.5 space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#999999]">Type</span>
                  <span className="capitalize text-[#FFFFFF]">{detailEntry.callType}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#999999]">Direction</span>
                  <span className="capitalize text-[#FFFFFF]">{detailEntry.direction}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#999999]">Status</span>
                  <span
                    className={
                      isMissed
                        ? 'text-[#E5484D] font-medium'
                        : isCompleted
                          ? 'text-[#22C55E] font-medium'
                          : 'text-[#FFFFFF]'
                    }
                  >
                    {getCallStatusLabel(detailEntry)}
                  </span>
                </div>
                {hasValidDuration && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#999999]">Duration</span>
                    <span className="font-mono tabular-nums text-[#22C55E]">
                      {formatDuration(detailEntry.duration)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#999999] shrink-0">Timestamp</span>
                  <span className="font-mono tabular-nums text-right text-[#FFFFFF] text-xs sm:text-sm">
                    {new Date(detailEntry.createdAt).toLocaleString()}
                  </span>
                </div>
                {detailEntry.endReason && (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-[#999999] shrink-0">Details</span>
                    <span className="text-right text-[#FFFFFF] break-words">
                      {detailEntry.endReason}
                    </span>
                  </div>
                )}
              </div>

              {contact && (
                <div className="grid grid-cols-2 gap-2.5">
                  <PrimaryButton
                    variant="secondary"
                    fullWidth
                    onClick={() => {
                      setDetailEntry(null);
                      void startCall({
                        recipientId: contact.id,
                        callType: 'voice',
                        conversationId: detailEntry.conversationId,
                        peerHint: {
                          id: contact.id,
                          fullName: contact.fullName,
                          username: contact.username,
                          avatar: contact.avatar,
                        },
                      });
                    }}
                  >
                    <Phone className="w-4 h-4 shrink-0" />
                    <span>Voice Call</span>
                  </PrimaryButton>
                  <PrimaryButton
                    variant="secondary"
                    fullWidth
                    onClick={() => {
                      setDetailEntry(null);
                      void startCall({
                        recipientId: contact.id,
                        callType: 'video',
                        conversationId: detailEntry.conversationId,
                        peerHint: {
                          id: contact.id,
                          fullName: contact.fullName,
                          username: contact.username,
                          avatar: contact.avatar,
                        },
                      });
                    }}
                  >
                    <Video className="w-4 h-4 shrink-0" />
                    <span>Video Call</span>
                  </PrimaryButton>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <PrimaryButton
                  variant="danger"
                  onClick={() => setDeleteTargetEntry(detailEntry)}
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>Delete Entry</span>
                </PrimaryButton>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Delete Call Record Confirmation Modal */}
      <Modal
        open={deleteTargetEntry !== null}
        onClose={() => {
          if (!deleting) setDeleteTargetEntry(null);
        }}
        title="Delete Call Record"
        maxWidth="max-w-sm"
      >
        {deleteTargetEntry && (
          <div className="space-y-4">
            <p className="text-sm text-[#FFFFFF] leading-relaxed">
              Remove this call history record with{' '}
              <span className="font-semibold">
                {deleteTargetEntry.contact?.fullName || 'Unknown Contact'}
              </span>
              ?
            </p>
            <div className="rounded-xl bg-[#181818] border border-[#303030] px-3.5 py-2.5 text-xs text-[#999999] flex items-center justify-between gap-2">
              <span className="truncate">
                {getCallRowPresentation(deleteTargetEntry).summaryText}
              </span>
              <span className="font-mono tabular-nums shrink-0">
                {formatConversationTime(deleteTargetEntry.createdAt)}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2.5">
              <PrimaryButton
                variant="secondary"
                disabled={deleting}
                onClick={() => setDeleteTargetEntry(null)}
              >
                Cancel
              </PrimaryButton>
              <PrimaryButton
                variant="danger"
                loading={deleting}
                onClick={() => void confirmDelete()}
              >
                Delete
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
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-[#FFFFFF] truncate">
                  {contactProfile.fullName}
                </p>
                <p className="text-xs text-[#999999] truncate">
                  @{contactProfile.username}
                </p>
              </div>
            </div>
            {contactProfile.bio && (
              <p className="text-sm text-[#999999] break-words">{contactProfile.bio}</p>
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
