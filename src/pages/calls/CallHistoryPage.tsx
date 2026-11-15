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
import { useToast } from '../../context/ToastContext';
import { callApi, conversationApi, extractApiError } from '../../services/api';
import type { CallHistoryItem, User } from '../../types';
import { formatConversationTime, formatDuration } from '../../utils/formatters';

export function CallHistoryPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [callNoticeModal, setCallNoticeModal] = useState<'voice' | 'video' | 'new' | null>(null);
  const [detailEntry, setDetailEntry] = useState<CallHistoryItem | null>(null);
  const [contactProfile, setContactProfile] = useState<User | null>(null);

  const loadHistory = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await callApi.listHistory(filter, query);
      setCalls(data);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadHistory();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadHistory]);

  const handleRemove = async (id: string) => {
    try {
      await callApi.deleteEntry(id);
      setCalls((prev) => prev.filter((item) => item.id !== id));
      if (detailEntry?.id === id) setDetailEntry(null);
      showToast('Call history entry removed.', 'info');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

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
            onClick={() => setCallNoticeModal('new')}
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
            Live calling planned post-V1.0
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-3 space-y-1">
          {loading ? (
            <LoadingState rows={5} />
          ) : error ? (
            <ErrorState message={error} onRetry={loadHistory} />
          ) : calls.length === 0 ? (
            <EmptyState
              icon={<Phone className="w-5 h-5" />}
              title={filter === 'missed' ? 'No missed calls' : 'No call history yet'}
              description="Live voice and video calling are scheduled for a future release. Any recorded call history will appear here."
              actionLabel="Go to Chats"
              onAction={() => navigate('/chats')}
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
                    <button
                      type="button"
                      onClick={() => setCallNoticeModal('voice')}
                      aria-label="Voice call"
                      className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallNoticeModal('video')}
                      aria-label="Video call"
                      className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                    </button>
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

      {/* Honest V1.0 Calling Notice Modal */}
      <Modal
        open={callNoticeModal !== null}
        onClose={() => setCallNoticeModal(null)}
        title="Calling in BlinkUpZ V1.0"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#999999] leading-relaxed">
            Live voice and video calling are not part of BlinkUpZ V1.0. This Call History screen is prepared for future WebRTC integration while you can send real-time voice notes and messages in Chats.
          </p>
          <div className="flex justify-end gap-2">
            <PrimaryButton variant="secondary" onClick={() => setCallNoticeModal(null)}>
              Close
            </PrimaryButton>
            <PrimaryButton
              onClick={() => {
                setCallNoticeModal(null);
                navigate('/chats');
              }}
            >
              Open Chats
            </PrimaryButton>
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
