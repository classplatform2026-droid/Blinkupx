import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Info,
  Lock,
  MoreVertical,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu } from '../../components/DropdownMenu';
import { PrimaryButton } from '../../components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { communityApi, extractApiError } from '../../services/api';
import type { CommunitySummary } from '../../types';
import {
  getCachedCommunitiesList,
  saveCachedCommunitiesList,
} from '../../utils/indexedDb';
import { CACHE_TIMES, queryKeys } from '../../utils/queryClient';

export function CommunityPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();

  const userId = user?.id || '';
  const [tab, setTab] = useState<'joined' | 'discover'>('joined');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [idbSeed, setIdbSeed] = useState<CommunitySummary[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!userId || debouncedQuery) return;
    let active = true;
    getCachedCommunitiesList(userId, tab).then((cached) => {
      if (!active) return;
      setIdbSeed(cached);
      if (cached.length > 0) {
        const key = queryKeys.communities(userId, tab, '');
        if (!qc.getQueryData(key)) {
          qc.setQueryData(key, cached);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [userId, tab, debouncedQuery, qc]);

  const {
    data: queryCommunities,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.communities(userId, tab, debouncedQuery),
    enabled: Boolean(userId),
    staleTime: CACHE_TIMES.communities.staleTime,
    gcTime: CACHE_TIMES.communities.gcTime,
    queryFn: async () => {
      try {
        const fresh = await communityApi.list(tab, debouncedQuery);
        if (!debouncedQuery) {
          void saveCachedCommunitiesList(userId, tab, fresh);
        }
        return fresh;
      } catch (err) {
        if (!debouncedQuery) {
          const cached = await getCachedCommunitiesList(userId, tab);
          if (cached.length > 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            return cached;
          }
        }
        throw err;
      }
    },
  });

  const communities = queryCommunities ?? (!debouncedQuery ? idbSeed ?? [] : []);
  const showLoading = isLoading && communities.length === 0 && (Boolean(debouncedQuery) || idbSeed === null);
  const errorMsg =
    queryError && communities.length === 0
      ? extractApiError(queryError).message
      : null;

  const handleJoin = async (community: CommunitySummary) => {
    if (community.isMember) {
      navigate(`/community/${community.id}`);
      return;
    }
    setJoiningId(community.id);
    try {
      const res = await communityApi.join(community.id);
      showToast(res.message, 'success');
      void qc.invalidateQueries({ queryKey: queryKeys.communitiesPrefix(userId) });
      if (res.data.isMember) {
        navigate(`/community/${community.id}`);
      } else {
        void refetch();
      }
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <header className="h-16 px-4 sm:px-6 flex items-center justify-between gap-3 border-b border-[#303030] shrink-0">
        <h1 className="text-lg font-bold tracking-tight text-[#FFFFFF]">Community</h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen((p) => !p)}
            aria-label="Search communities"
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
          >
            <Search className="w-5 h-5" />
          </button>
          <PrimaryButton
            onClick={() => navigate('/community/create')}
            className="min-h-[38px] px-3.5 py-1.5 text-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Create</span>
          </PrimaryButton>
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label="Community options"
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#999999] hover:text-white hover:bg-[#242424] cursor-pointer"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            }
            options={[
              {
                label: 'Create community',
                icon: <Plus className="w-4 h-4" />,
                onClick: () => navigate('/community/create'),
              },
              {
                label: 'Discover public communities',
                icon: <Users className="w-4 h-4" />,
                onClick: () => setTab('discover'),
              },
            ]}
          />
        </div>
      </header>

      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col overflow-hidden px-4 sm:px-6">
        {(searchOpen || tab === 'discover') && (
          <div className="pt-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus={searchOpen}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  tab === 'discover'
                    ? 'Discover public communities by name or keyword...'
                    : 'Search your communities...'
                }
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-10 pr-10 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:outline-none"
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
        )}

        <div className="flex items-center gap-2 py-3 border-b border-[#303030] shrink-0">
          {(['joined', 'discover'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                tab === t
                  ? 'bg-[#FFFFFF] text-[#181818]'
                  : 'bg-[#202020] text-[#999999] hover:text-[#FFFFFF] hover:bg-[#242424]'
              }`}
            >
              {t === 'discover' ? 'Discover Communities' : 'Joined'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {showLoading ? (
            <LoadingState rows={5} />
          ) : errorMsg ? (
            <ErrorState message={errorMsg} onRetry={() => void refetch()} />
          ) : communities.length === 0 ? (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title={
                tab === 'joined'
                  ? 'No joined communities yet'
                  : 'No public communities found'
              }
              description={
                tab === 'joined'
                  ? 'Discover public communities or create your own space to collaborate.'
                  : query
                    ? 'Try a different keyword or create a new community.'
                    : 'Be the first to create a public community on BlinkUpZ.'
              }
              actionLabel={tab === 'joined' ? 'Discover Communities' : 'Create Community'}
              onAction={() =>
                tab === 'joined' ? setTab('discover') : navigate('/community/create')
              }
            />
          ) : (
            communities.map((comm) => (
              <div
                key={comm.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#202020] border border-[#303030] hover:bg-[#242424] transition-colors"
              >
                <div
                  className="flex items-start gap-3.5 min-w-0 flex-1 cursor-pointer"
                  onClick={() => navigate(`/community/${comm.id}/details`)}
                >
                  <UserAvatar src={comm.image} name={comm.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-[#FFFFFF] truncate">
                        {comm.name}
                      </h2>
                      {comm.privacy === 'private' && (
                        <Lock className="w-3.5 h-3.5 text-[#999999] shrink-0" />
                      )}
                      {comm.isMember && tab === 'discover' && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#242424] border border-[#303030] text-[#22C55E]">
                          Joined
                        </span>
                      )}
                      {typeof comm.pendingRequestsCount === 'number' &&
                        comm.pendingRequestsCount > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/community/${comm.id}/members?tab=requests`);
                            }}
                            className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#FFFFFF] text-[#181818] cursor-pointer"
                          >
                            {comm.pendingRequestsCount} request
                            {comm.pendingRequestsCount === 1 ? '' : 's'}
                          </button>
                        )}
                    </div>
                    {comm.description && (
                      <p className="text-sm text-[#999999] line-clamp-2 mt-0.5">
                        {comm.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-[#999999] mt-2 font-mono tabular-nums">
                      <span>
                        {comm.memberCount} member{comm.memberCount === 1 ? '' : 's'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize font-sans">{comm.privacy}</span>
                      {comm.myRole && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize font-sans text-[#FFFFFF]">
                            {comm.myRole}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/community/${comm.id}/details`)}
                    aria-label={`Details for ${comm.name}`}
                    title="Community details"
                    className="w-10 h-10 rounded-xl bg-[#242424] border border-[#303030] flex items-center justify-center text-[#999999] hover:text-[#FFFFFF] hover:bg-[#2C2C2C] cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>

                  {comm.isMember ? (
                    <PrimaryButton
                      variant="secondary"
                      onClick={() => navigate(`/community/${comm.id}`)}
                    >
                      Open Chat
                    </PrimaryButton>
                  ) : comm.isPending ? (
                    <PrimaryButton variant="secondary" disabled>
                      Requested
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton
                      loading={joiningId === comm.id}
                      onClick={() => handleJoin(comm)}
                    >
                      {comm.privacy === 'private' ? 'Request Join' : 'Join'}
                    </PrimaryButton>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
