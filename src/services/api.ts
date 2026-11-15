import axios from 'axios';
import type {
  CallHistoryItem,
  CommunityDetail,
  CommunityMembersResponse,
  CommunitySettings,
  CommunitySummary,
  Conversation,
  Message,
  MessageAttachment,
  MyQrCodeData,
  SearchResults,
  ServiceStatus,
  SharedMediaResponse,
  User,
  UserSettings,
} from '../types';

const AUTH_TOKEN_KEY = 'blinkupz_token';
let memoryAuthToken: string | null = null;

export function getStoredAuthToken(): string | null {
  if (memoryAuthToken) return memoryAuthToken;
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      memoryAuthToken = token;
      return token;
    }
  } catch {
    // Ignore storage access errors in restricted iframes
  }
  return null;
}

export function setStoredAuthToken(token: string): void {
  memoryAuthToken = token;
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Fallback to in-memory token only
  }
}

export function clearStoredAuthToken(): void {
  memoryAuthToken = null;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = getStoredAuthToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAuthAttempt =
        url.includes('/auth/login') ||
        url.includes('/auth/register') ||
        url.includes('/auth/verify-otp') ||
        url.includes('/auth/forgot-password') ||
        url.includes('/auth/reset-password');
      if (!isAuthAttempt) {
        clearStoredAuthToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('blinkupz:unauthorized'));
        }
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiErrorInfo {
  message: string;
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
}

export function extractApiError(err: unknown): ApiErrorInfo {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { message?: string; code?: string; details?: Record<string, unknown> }
      | undefined;
    return {
      message: data?.message || err.message || 'Request failed.',
      code: data?.code,
      status: err.response?.status,
      details: data?.details,
    };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: 'An unexpected error occurred.' };
}

export const healthApi = {
  getStatus: async () => {
    const res = await api.get<{
      success: boolean;
      dbConnected: boolean;
      services: ServiceStatus;
    }>('/health');
    return res.data;
  },
};

export const authApi = {
  checkUsername: async (username: string) => {
    const res = await api.get<{ available: boolean; valid: boolean }>(
      '/auth/check-username',
      { params: { username } }
    );
    return res.data;
  },
  register: async (payload: {
    fullName: string;
    email: string;
    phone: string;
    username: string;
    password: string;
  }) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      data: { phone: string; email?: string; username: string; cooldownSeconds: number; expiresAt: string };
    }>('/auth/register', payload);
    return res.data;
  },
  verifyOtp: async (payload: {
    phone: string;
    code: string;
    purpose: 'register' | 'reset_password';
  }) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      data?: { user: User; token: string };
    }>('/auth/verify-otp', payload);
    return res.data;
  },
  resendOtp: async (payload: {
    phone: string;
    purpose: 'register' | 'reset_password';
  }) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      data: { cooldownSeconds: number };
    }>('/auth/resend-otp', payload);
    return res.data;
  },
  login: async (payload: { identifier: string; password: string }) => {
    const res = await api.post<{
      success: boolean;
      data: { user: User; token: string };
    }>('/auth/login', payload);
    return res.data;
  },
  forgotPassword: async (phone: string) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      data: { phone: string; email?: string; cooldownSeconds: number };
    }>('/auth/forgot-password', { phone });
    return res.data;
  },
  resetPassword: async (payload: {
    phone: string;
    code: string;
    newPassword: string;
  }) => {
    const res = await api.post<{ success: boolean; message: string }>(
      '/auth/reset-password',
      payload
    );
    return res.data;
  },
  logout: async () => {
    const res = await api.post('/auth/logout');
    return res.data;
  },
};

export const userApi = {
  getMe: async () => {
    const res = await api.get<{
      success: boolean;
      data: { user: User; services: ServiceStatus };
    }>('/users/me');
    return res.data.data;
  },
  search: async (q: string) => {
    const res = await api.get<{ success: boolean; data: User[] }>('/users/search', {
      params: { q },
    });
    return res.data.data;
  },
  getById: async (id: string) => {
    const res = await api.get<{ success: boolean; data: User }>(`/users/${id}`);
    return res.data.data;
  },
  getPublicByUsername: async (username: string) => {
    const clean = username.trim().toLowerCase().replace(/^@/, '');
    const res = await api.get<{ success: boolean; data: User }>(
      `/users/public/${encodeURIComponent(clean)}`
    );
    return res.data.data;
  },
  getMyQrCode: async (origin?: string) => {
    const res = await api.get<{ success: boolean; data: MyQrCodeData }>('/users/me/qr', {
      params: origin ? { origin } : undefined,
    });
    return res.data.data;
  },
  updateProfile: async (payload: {
    fullName?: string;
    username?: string;
    bio?: string;
    avatar?: string;
    settings?: Partial<UserSettings>;
  }) => {
    const res = await api.patch<{ success: boolean; data: User; message: string }>(
      '/users/profile',
      payload
    );
    return res.data;
  },
};

export const conversationApi = {
  list: async (filter: 'all' | 'unread' | 'groups' | 'archived' = 'all') => {
    const res = await api.get<{ success: boolean; data: Conversation[] }>(
      '/conversations',
      { params: { filter } }
    );
    return res.data.data;
  },
  create: async (payload: {
    type: 'direct' | 'group';
    participantIds: string[];
    name?: string;
    avatar?: string;
  }) => {
    const res = await api.post<{ success: boolean; data: Conversation }>(
      '/conversations',
      payload
    );
    return res.data.data;
  },
  getById: async (id: string) => {
    const res = await api.get<{ success: boolean; data: Conversation }>(
      `/conversations/${id}`
    );
    return res.data.data;
  },
  updateMeta: async (
    id: string,
    action:
      | 'pin'
      | 'unpin'
      | 'mute'
      | 'unmute'
      | 'archive'
      | 'unarchive'
      | 'read'
      | 'pinMessage'
      | 'unpinMessage',
    pinnedMessageId?: string
  ) => {
    const res = await api.patch<{ success: boolean; data: Conversation }>(
      `/conversations/${id}`,
      { action, pinnedMessageId }
    );
    return res.data.data;
  },
  markAllRead: async () => {
    const res = await api.post('/conversations/mark-all-read');
    return res.data;
  },
  getSharedMedia: async (
    id: string,
    params: {
      tab: 'media' | 'files' | 'links';
      q?: string;
      subType?: string;
    }
  ) => {
    const res = await api.get<{ success: boolean; data: SharedMediaResponse }>(
      `/conversations/${id}/shared-media`,
      { params }
    );
    return res.data.data;
  },
  delete: async (id: string) => {
    const res = await api.delete(`/conversations/${id}`);
    return res.data;
  },
};

export const messageApi = {
  list: async (conversationId: string, before?: string) => {
    const res = await api.get<{
      success: boolean;
      data: { messages: Message[]; hasMore: boolean };
    }>(`/messages/${conversationId}`, { params: { before, limit: 40 } });
    return res.data.data;
  },
  getAround: async (conversationId: string, messageId: string) => {
    const res = await api.get<{
      success: boolean;
      data: { messages: Message[]; hasMore: boolean; hasNewer?: boolean };
    }>(`/messages/${conversationId}/around/${messageId}`);
    return res.data.data;
  },
  send: async (payload: {
    conversationId: string;
    content?: string;
    messageType?: 'text' | 'image' | 'video' | 'document' | 'voice';
    attachments?: MessageAttachment[];
    replyTo?: string | null;
    forwardedFrom?: { messageId: string; senderName: string } | null;
  }) => {
    const res = await api.post<{ success: boolean; data: Message }>('/messages', payload);
    return res.data.data;
  },
  edit: async (id: string, content: string) => {
    const res = await api.patch<{ success: boolean; data: Message }>(
      `/messages/${id}`,
      { content }
    );
    return res.data.data;
  },
  delete: async (id: string, scope: 'everyone' | 'me' = 'everyone') => {
    const res = await api.delete(`/messages/${id}`, { params: { scope } });
    return res.data;
  },
  toggleReaction: async (id: string, emoji: string) => {
    const res = await api.post<{
      success: boolean;
      data: { messageId: string; reactions: Array<{ emoji: string; userIds: string[] }> };
    }>(`/messages/${id}/reactions`, { emoji });
    return res.data.data;
  },
};

export const communityApi = {
  list: async (tab: 'joined' | 'discover' = 'joined', q = '') => {
    const res = await api.get<{ success: boolean; data: CommunitySummary[] }>(
      '/communities',
      { params: { tab, q } }
    );
    return res.data.data;
  },
  create: async (payload: {
    name: string;
    description?: string;
    image?: string;
    privacy: 'public' | 'private';
  }) => {
    const res = await api.post<{ success: boolean; data: CommunitySummary }>(
      '/communities',
      payload
    );
    return res.data.data;
  },
  getById: async (id: string) => {
    const res = await api.get<{ success: boolean; data: CommunityDetail }>(
      `/communities/${id}`
    );
    return res.data.data;
  },
  listMembers: async (
    id: string,
    params: { q?: string; role?: 'all' | 'admins' | 'moderators' | 'members' } = {}
  ) => {
    const res = await api.get<{ success: boolean; data: CommunityMembersResponse }>(
      `/communities/${id}/members`,
      { params }
    );
    return res.data.data;
  },
  inviteMembers: async (id: string, userIds: string[]) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      data: { addedCount: number };
    }>(`/communities/${id}/invite`, { userIds });
    return res.data;
  },
  join: async (id: string) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      data: CommunitySummary;
    }>(`/communities/${id}/join`);
    return res.data;
  },
  cancelJoinRequest: async (id: string) => {
    const res = await api.delete<{
      success: boolean;
      message: string;
      data: CommunitySummary;
    }>(`/communities/${id}/join-request`);
    return res.data;
  },
  leave: async (id: string) => {
    const res = await api.post<{ success: boolean; message: string }>(
      `/communities/${id}/leave`
    );
    return res.data;
  },
  handleRequest: async (
    communityId: string,
    targetUserId: string,
    decision: 'approve' | 'reject'
  ) => {
    const res = await api.post<{ success: boolean; message: string }>(
      `/communities/${communityId}/requests`,
      {
        targetUserId,
        decision,
      }
    );
    return res.data;
  },
  updateRole: async (
    communityId: string,
    memberId: string,
    role: 'admin' | 'moderator' | 'member'
  ) => {
    const res = await api.patch<{ success: boolean; message: string }>(
      `/communities/${communityId}/members/${memberId}`,
      { role }
    );
    return res.data;
  },
  removeMember: async (communityId: string, memberId: string) => {
    const res = await api.delete<{ success: boolean; message: string }>(
      `/communities/${communityId}/members/${memberId}`
    );
    return res.data;
  },
  updateSettings: async (
    communityId: string,
    payload: {
      name?: string;
      description?: string;
      image?: string;
      privacy?: 'public' | 'private';
      settings?: Partial<CommunitySettings>;
    }
  ) => {
    const res = await api.patch<{
      success: boolean;
      message: string;
      data: CommunitySummary;
    }>(`/communities/${communityId}/settings`, payload);
    return res.data;
  },
  transferOwnership: async (communityId: string, newOwnerId: string) => {
    const res = await api.post<{ success: boolean; message: string }>(
      `/communities/${communityId}/transfer-ownership`,
      { newOwnerId }
    );
    return res.data;
  },
  delete: async (communityId: string) => {
    const res = await api.delete<{ success: boolean; message: string }>(
      `/communities/${communityId}`
    );
    return res.data;
  },
};

export const callApi = {
  listHistory: async (filter: 'all' | 'missed' = 'all', q = '') => {
    const res = await api.get<{ success: boolean; data: CallHistoryItem[] }>(
      '/calls/history',
      { params: { filter, q } }
    );
    return res.data.data;
  },
  deleteEntry: async (id: string) => {
    const res = await api.delete(`/calls/${id}`);
    return res.data;
  },
};

export const searchApi = {
  global: async (q: string, filter: 'all' | 'messages' | 'people' | 'groups' = 'all') => {
    const res = await api.get<{ success: boolean; data: SearchResults }>('/search', {
      params: { q, filter },
    });
    return res.data.data;
  },
};

export const mediaApi = {
  upload: async (
    file: File | Blob,
    folder = 'attachments',
    onProgress?: (percent: number) => void,
    fileName?: string
  ): Promise<MessageAttachment> => {
    const form = new FormData();
    if (file instanceof File) {
      form.append('file', file);
    } else {
      form.append('file', file, fileName || 'voice-message.webm');
    }
    form.append('folder', folder);

    const res = await api.post<{ success: boolean; data: MessageAttachment }>(
      '/media/upload',
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total && onProgress) {
            onProgress(Math.round((evt.loaded * 100) / evt.total));
          }
        },
      }
    );
    return res.data.data;
  },
  fetchAttachmentBlobUrl: async (
    messageId: string,
    attachmentIndex: number
  ): Promise<string> => {
    const res = await api.get<Blob>(
      `/media/download/${encodeURIComponent(messageId)}/${attachmentIndex}`,
      { params: { inline: 1 }, responseType: 'blob' }
    );
    return URL.createObjectURL(res.data);
  },
  fetchAttachmentText: async (
    messageId: string,
    attachmentIndex: number,
    maxBytes = 65536
  ): Promise<{ text: string; truncated: boolean }> => {
    const res = await api.get<Blob>(
      `/media/download/${encodeURIComponent(messageId)}/${attachmentIndex}`,
      { params: { inline: 1 }, responseType: 'blob' }
    );
    const truncated = res.data.size > maxBytes;
    const slice = truncated ? res.data.slice(0, maxBytes) : res.data;
    const text = await slice.text();
    return { text, truncated };
  },
  downloadAttachment: async (
    messageId: string,
    attachmentIndex: number,
    fileName: string
  ): Promise<void> => {
    const res = await api.get<Blob>(
      `/media/download/${encodeURIComponent(messageId)}/${attachmentIndex}`,
      { responseType: 'blob' }
    );
    const blobUrl = URL.createObjectURL(res.data);
    try {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
  },
};
