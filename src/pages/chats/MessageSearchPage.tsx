import { useEffect, useState } from 'react';
import { Clock, MessageSquare, Search, Trash2, Users, User as UserIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { FormattedMessagePreview } from '../../components/FormattedMessageText';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { conversationApi, extractApiError, searchApi } from '../../services/api';
import type { SearchResults } from '../../types';
import { formatConversationTime } from '../../utils/formatters';

type SearchFilter = 'all' | 'messages' | 'people' | 'groups';

export function MessageSearchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const storageKey = `blinkupz_recent_searches_${user?.id || 'guest'}`;
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveRecent = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setRecentSearches((prev) => {
      const next = [clean, ...prev.filter((t) => t !== clean)].slice(0, 6);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const clean = query.trim();
    if (!clean) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const data = await searchApi.global(clean, filter);
        setResults(data);
        saveRecent(clean);
      } catch (err) {
        setError(extractApiError(err).message);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, filter]);

  const clearRecents = () => {
    setRecentSearches([]);
    localStorage.removeItem(storageKey);
  };

  const handleOpenPerson = async (personId: string) => {
    try {
      const conv = await conversationApi.create({
        type: 'direct',
        participantIds: [personId],
      });
      navigate(`/chats/${conv.id}`);
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    }
  };

  const totalMatches = results
    ? results.messages.length + results.people.length + results.groups.length
    : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Search"
        subtitle="Find messages, people, and groups"
        showBack
        onBack={() => navigate('/chats')}
      />

      <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col overflow-hidden px-4 sm:px-6 py-4">
        <div className="relative mb-3 shrink-0">
          <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, people, or groups..."
            className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-10 pr-4 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 pb-3 border-b border-[#303030] shrink-0 overflow-x-auto">
          {(['all', 'messages', 'people', 'groups'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                filter === tab
                  ? 'bg-[#FFFFFF] text-[#181818]'
                  : 'bg-[#202020] text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-6">
          {!query.trim() ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-[#999999] uppercase tracking-wider">
                  Recent Searches
                </h2>
                {recentSearches.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecents}
                    className="inline-flex items-center gap-1 text-xs text-[#999999] hover:text-[#FFFFFF] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
              {recentSearches.length === 0 ? (
                <EmptyState
                  icon={<Search className="w-5 h-5" />}
                  title="Search BlinkUpZ"
                  description="Enter keywords to search across your conversation history, people, and communities."
                />
              ) : (
                <div className="space-y-1">
                  {recentSearches.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setQuery(term)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#202020] text-left text-sm text-[#FFFFFF] cursor-pointer"
                    >
                      <Clock className="w-4 h-4 text-[#999999]" />
                      <span>{term}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : loading ? (
            <LoadingState rows={5} />
          ) : error ? (
            <ErrorState message={error} />
          ) : totalMatches === 0 ? (
            <EmptyState
              title="No matching results"
              description={`Nothing matched "${query}" under ${filter}.`}
            />
          ) : (
            <>
              {results && results.messages.length > 0 && (
                <section className="space-y-2">
                  <h2 className="flex items-center gap-2 text-xs font-semibold text-[#999999] px-1">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Messages ({results.messages.length})</span>
                  </h2>
                  <div className="space-y-1">
                    {results.messages.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          navigate(`/chats/${m.conversationId}?highlight=${m.id}`)
                        }
                        className="w-full text-left px-3.5 py-3 rounded-xl bg-[#202020] border border-[#303030] hover:bg-[#242424] transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-[#FFFFFF] truncate">
                            {m.conversationName} · {m.senderName}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-[#999999] shrink-0">
                            {formatConversationTime(m.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-[#999999] line-clamp-2">
                          <FormattedMessagePreview text={m.content} variant="muted" />
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {results && results.people.length > 0 && (
                <section className="space-y-2">
                  <h2 className="flex items-center gap-2 text-xs font-semibold text-[#999999] px-1">
                    <UserIcon className="w-3.5 h-3.5" />
                    <span>People ({results.people.length})</span>
                  </h2>
                  <div className="space-y-1">
                    {results.people.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => handleOpenPerson(person.id)}
                        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-[#202020] transition-colors text-left cursor-pointer"
                      >
                        <UserAvatar
                          src={person.avatar}
                          name={person.fullName}
                          size="sm"
                          online={person.onlineStatus}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#FFFFFF] truncate">
                            {person.fullName}
                          </p>
                          <p className="text-xs text-[#999999] truncate">
                            @{person.username}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {results && results.groups.length > 0 && (
                <section className="space-y-2">
                  <h2 className="flex items-center gap-2 text-xs font-semibold text-[#999999] px-1">
                    <Users className="w-3.5 h-3.5" />
                    <span>Groups & Communities ({results.groups.length})</span>
                  </h2>
                  <div className="space-y-1">
                    {results.groups.map((grp) => (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() =>
                          grp.communityId
                            ? navigate(`/community/${grp.communityId}`)
                            : navigate(`/chats/${grp.conversationId}`)
                        }
                        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-[#202020] transition-colors text-left cursor-pointer"
                      >
                        <UserAvatar src={grp.avatar} name={grp.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#FFFFFF] truncate">
                            {grp.name}
                          </p>
                          <p className="text-xs text-[#999999] font-mono tabular-nums">
                            {grp.memberCount} members · {grp.kind}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
