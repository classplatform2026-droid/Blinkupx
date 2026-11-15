import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Globe,
  Lock,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ErrorState, LoadingState } from '../../components/States';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { communityApi, extractApiError, mediaApi } from '../../services/api';
import type {
  CommunityDetail,
  CommunityInvitePermission,
  CommunityPinPermission,
  CommunityPostPermission,
} from '../../types';

export function CommunitySettingsPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { showToast } = useToast();

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [whoCanInvite, setWhoCanInvite] =
    useState<CommunityInvitePermission>('admins');
  const [whoCanPinMessages, setWhoCanPinMessages] =
    useState<CommunityPinPermission>('moderators');
  const [whoCanPost, setWhoCanPost] =
    useState<CommunityPostPermission>('all_members');

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadCommunity = useCallback(async () => {
    if (!communityId) return;
    setError(null);
    try {
      const data = await communityApi.getById(communityId);
      setCommunity(data);
      setName(data.name);
      setDescription(data.description || '');
      setImage(data.image || '');
      setPrivacy(data.privacy);
      if (data.settings) {
        setWhoCanInvite(data.settings.whoCanInvite);
        setWhoCanPinMessages(data.settings.whoCanPinMessages);
        setWhoCanPost(data.settings.whoCanPost);
      }
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    setLoading(true);
    loadCommunity();
  }, [loadCommunity]);

  useEffect(() => {
    if (!socket || !communityId) return;
    const onDeleted = (payload: { communityId?: string }) => {
      if (payload?.communityId === communityId) {
        navigate('/community', { replace: true });
      }
    };
    socket.on('community:deleted', onDeleted);
    return () => {
      socket.off('community:deleted', onDeleted);
    };
  }, [socket, communityId, navigate]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await mediaApi.upload(file, 'communities');
      setImage(uploaded.url);
      showToast('Community image uploaded. Save changes to apply.', 'info');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!community) return;
    if (name.trim().length < 3) {
      showToast('Community name must be at least 3 characters.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await communityApi.updateSettings(community.id, {
        name: name.trim(),
        description: description.trim(),
        image,
        ...(community.permissions?.canChangePrivacy ? { privacy } : {}),
        settings: {
          whoCanInvite,
          whoCanPinMessages,
          whoCanPost,
        },
      });
      showToast(res.message, 'success');
      await loadCommunity();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!community || !selectedOwnerId) return;
    setTransferring(true);
    try {
      const res = await communityApi.transferOwnership(community.id, selectedOwnerId);
      showToast(res.message, 'success');
      setTransferModalOpen(false);
      setSelectedOwnerId('');
      await loadCommunity();
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setTransferring(false);
    }
  };

  const handleDeleteCommunity = async () => {
    if (!community) return;
    setDeleting(true);
    try {
      const res = await communityApi.delete(community.id);
      showToast(res.message, 'info');
      navigate('/community', { replace: true });
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#181818]">
        <AppHeader
          title="Community Settings"
          showBack
          onBack={() => navigate(`/community/${communityId}/details`)}
        />
        <LoadingState rows={5} />
      </div>
    );
  }

  if (error || !community) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#181818]">
        <AppHeader
          title="Community Settings"
          showBack
          onBack={() => navigate(`/community/${communityId}/details`)}
        />
        <div className="flex-1 flex items-center justify-center">
          <ErrorState
            message={error || 'Community not found.'}
            onRetry={loadCommunity}
          />
        </div>
      </div>
    );
  }

  if (!community.permissions?.canManageSettings) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#181818]">
        <AppHeader
          title="Community Settings"
          showBack
          onBack={() => navigate(`/community/${community.id}/details`)}
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <ErrorState
            message="Only community owners and admins can access settings."
            onRetry={() => navigate(`/community/${community.id}/details`)}
          />
        </div>
      </div>
    );
  }

  const isOwner = community.myRole === 'owner';
  const eligibleNewOwners = community.members.filter((m) => m.user.id !== user?.id);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Community Settings"
        subtitle={community.name}
        showBack
        onBack={() => navigate(`/community/${community.id}/details`)}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <form
            onSubmit={handleSave}
            className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-5"
          >
            <h2 className="text-base font-semibold text-[#FFFFFF]">General Information</h2>

            <div className="flex items-center gap-4">
              <UserAvatar src={image} name={name || community.name} size="xl" />
              <div className="space-y-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <PrimaryButton
                  variant="secondary"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  <span>Change Image</span>
                </PrimaryButton>
                <p className="text-xs text-[#999999]">PNG, JPG, or WebP square icon</p>
              </div>
            </div>

            <div>
              <label htmlFor="editCommName" className="block text-xs font-medium text-[#999999] mb-1.5">
                Community Name
              </label>
              <input
                id="editCommName"
                type="text"
                required
                minLength={3}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:border-[#FFFFFF]/50 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="editCommDesc" className="block text-xs font-medium text-[#999999] mb-1.5">
                Description
              </label>
              <textarea
                id="editCommDesc"
                rows={3}
                maxLength={400}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this community's purpose and rules..."
                className="w-full rounded-xl bg-[#242424] border border-[#303030] p-3.5 text-sm text-[#FFFFFF] resize-none focus:border-[#FFFFFF]/50 focus:outline-none"
              />
            </div>

            {/* Privacy Setting */}
            <div className="pt-2 border-t border-[#303030]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-[#999999]">
                  Community Privacy
                </span>
                {!isOwner && (
                  <span className="text-[11px] text-[#999999]">
                    Only the Owner can change privacy
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={!isOwner}
                  onClick={() => isOwner && setPrivacy('public')}
                  className={`p-3.5 rounded-xl border text-left transition-colors ${
                    !isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    privacy === 'public'
                      ? 'bg-[#242424] border-[#FFFFFF]'
                      : 'bg-[#181818] border-[#303030] hover:bg-[#242424]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#FFFFFF]">
                    <Globe className="w-4 h-4" />
                    <span>Public</span>
                  </div>
                  <p className="text-xs text-[#999999] mt-1">
                    Visible in Discover Communities. Any user can join directly.
                  </p>
                </button>

                <button
                  type="button"
                  disabled={!isOwner}
                  onClick={() => isOwner && setPrivacy('private')}
                  className={`p-3.5 rounded-xl border text-left transition-colors ${
                    !isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    privacy === 'private'
                      ? 'bg-[#242424] border-[#FFFFFF]'
                      : 'bg-[#181818] border-[#303030] hover:bg-[#242424]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#FFFFFF]">
                    <Lock className="w-4 h-4" />
                    <span>Private</span>
                  </div>
                  <p className="text-xs text-[#999999] mt-1">
                    Hidden from Discover. New members require admin approval.
                  </p>
                </button>
              </div>
            </div>

            {/* Member Permissions */}
            <div className="pt-2 border-t border-[#303030] space-y-4">
              <h3 className="text-sm font-semibold text-[#FFFFFF]">Member Permissions</h3>

              <div>
                <label htmlFor="whoCanInvite" className="block text-xs font-medium text-[#999999] mb-1.5">
                  Who can invite new members
                </label>
                <select
                  id="whoCanInvite"
                  value={whoCanInvite}
                  onChange={(e) =>
                    setWhoCanInvite(e.target.value as CommunityInvitePermission)
                  }
                  className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:outline-none cursor-pointer"
                >
                  <option value="owner_only">Owner only</option>
                  <option value="admins">Owner & Admins</option>
                  <option value="moderators">Moderators, Admins & Owner</option>
                  <option value="all_members">All community members</option>
                </select>
              </div>

              <div>
                <label htmlFor="whoCanPin" className="block text-xs font-medium text-[#999999] mb-1.5">
                  Who can pin messages
                </label>
                <select
                  id="whoCanPin"
                  value={whoCanPinMessages}
                  onChange={(e) =>
                    setWhoCanPinMessages(e.target.value as CommunityPinPermission)
                  }
                  className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:outline-none cursor-pointer"
                >
                  <option value="admins">Owner & Admins only</option>
                  <option value="moderators">Moderators, Admins & Owner</option>
                </select>
              </div>

              <div>
                <label htmlFor="whoCanPost" className="block text-xs font-medium text-[#999999] mb-1.5">
                  Who can send messages in chat
                </label>
                <select
                  id="whoCanPost"
                  value={whoCanPost}
                  onChange={(e) =>
                    setWhoCanPost(e.target.value as CommunityPostPermission)
                  }
                  className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:outline-none cursor-pointer"
                >
                  <option value="all_members">All members</option>
                  <option value="moderators_only">Moderators, Admins & Owner only</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <PrimaryButton type="submit" loading={saving}>
                <Save className="w-4 h-4" />
                <span>Save Settings</span>
              </PrimaryButton>
            </div>
          </form>

          {/* Owner-Only Danger Zone */}
          {isOwner && (
            <section className="rounded-2xl bg-[#202020] border border-[#E5484D]/35 p-6 space-y-4">
              <div className="flex items-center gap-2 text-[#E5484D]">
                <AlertTriangle className="w-4 h-4" />
                <h2 className="text-base font-semibold">Owner Actions</h2>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#181818] border border-[#303030]">
                <div>
                  <p className="text-sm font-medium text-[#FFFFFF]">Transfer Ownership</p>
                  <p className="text-xs text-[#999999] mt-0.5">
                    Promote another member to Owner. Your role will become Admin.
                  </p>
                </div>
                <PrimaryButton
                  variant="secondary"
                  disabled={eligibleNewOwners.length === 0}
                  onClick={() => {
                    setSelectedOwnerId(eligibleNewOwners[0]?.user.id || '');
                    setTransferModalOpen(true);
                  }}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Transfer</span>
                </PrimaryButton>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#181818] border border-[#303030]">
                <div>
                  <p className="text-sm font-medium text-[#E5484D]">Delete Community</p>
                  <p className="text-xs text-[#999999] mt-0.5">
                    Permanently deletes this community, all messages, and member access.
                  </p>
                </div>
                <PrimaryButton
                  variant="danger"
                  onClick={() => {
                    setDeleteConfirmText('');
                    setDeleteModalOpen(true);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </PrimaryButton>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Transfer Ownership Confirmation Modal */}
      <Modal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        title="Transfer Community Ownership"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#999999] leading-relaxed">
            Select a member to become the new Owner of <strong className="text-[#FFFFFF]">{community.name}</strong>. Once transferred, you will become an Admin and will no longer hold exclusive Owner privileges.
          </p>

          <div>
            <label htmlFor="newOwnerSelect" className="block text-xs font-medium text-[#999999] mb-1.5">
              New Owner
            </label>
            <select
              id="newOwnerSelect"
              value={selectedOwnerId}
              onChange={(e) => setSelectedOwnerId(e.target.value)}
              className="w-full h-11 rounded-xl bg-[#181818] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:outline-none"
            >
              {eligibleNewOwners.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.fullName} (@{m.user.username}) · {m.role}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <PrimaryButton
              variant="secondary"
              onClick={() => setTransferModalOpen(false)}
            >
              Cancel
            </PrimaryButton>
            <PrimaryButton
              disabled={!selectedOwnerId}
              loading={transferring}
              onClick={handleTransferOwnership}
            >
              Confirm Transfer
            </PrimaryButton>
          </div>
        </div>
      </Modal>

      {/* Delete Community Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Community Permanently"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#999999] leading-relaxed">
            This action cannot be undone. Type <strong className="text-[#FFFFFF]">{community.name}</strong> below to confirm permanent deletion of the community and all its messages.
          </p>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={community.name}
            className="w-full h-11 rounded-xl bg-[#181818] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#E5484D] focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <PrimaryButton
              variant="secondary"
              onClick={() => setDeleteModalOpen(false)}
            >
              Cancel
            </PrimaryButton>
            <PrimaryButton
              variant="danger"
              disabled={deleteConfirmText.trim() !== community.name.trim()}
              loading={deleting}
              onClick={handleDeleteCommunity}
            >
              Delete Community
            </PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
