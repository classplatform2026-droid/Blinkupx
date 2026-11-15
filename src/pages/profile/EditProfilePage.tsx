import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { UserAvatar } from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractApiError, mediaApi, userApi } from '../../services/api';

export function EditProfilePage() {
  const navigate = useNavigate();
  const { user, setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const res = await mediaApi.upload(file, 'avatars');
      setAvatar(res.url);
      showToast('Profile image uploaded. Save changes to apply.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) {
      setError('Username must be 3-24 characters using letters, numbers, or underscores.');
      return;
    }

    setSaving(true);
    try {
      const res = await userApi.updateProfile({
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        bio: bio.trim(),
        avatar,
      });
      setAuthenticatedUser(res.data);
      showToast('Profile updated successfully.', 'success');
      navigate('/profile', { replace: true });
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Edit Profile"
        showBack
        onBack={() => navigate('/profile')}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <form
          onSubmit={handleSave}
          className="max-w-xl mx-auto rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-5"
        >
          {error && (
            <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D]">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <UserAvatar src={avatar} name={fullName || user.fullName} size="xl" />
            <div className="space-y-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <PrimaryButton
                variant="secondary"
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                <span>Upload Photo</span>
              </PrimaryButton>
              <p className="text-xs text-[#999999]">JPG, PNG, or WebP up to 25 MB</p>
            </div>
          </div>

          <div>
            <label htmlFor="editFullName" className="block text-xs font-medium text-[#999999] mb-1.5">
              Full Name
            </label>
            <input
              id="editFullName"
              type="text"
              required
              minLength={2}
              maxLength={60}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="editUsername" className="block text-xs font-medium text-[#999999] mb-1.5">
              Username
            </label>
            <input
              id="editUsername"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="editBio" className="block text-xs font-medium text-[#999999] mb-1.5">
              Bio
            </label>
            <textarea
              id="editBio"
              rows={3}
              maxLength={200}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people a bit about yourself..."
              className="w-full rounded-xl bg-[#242424] border border-[#303030] p-3.5 text-sm text-[#FFFFFF] resize-none focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="editPhone" className="block text-xs font-medium text-[#999999] mb-1.5">
              Phone Number (verified, read-only)
            </label>
            <input
              id="editPhone"
              type="text"
              readOnly
              disabled
              value={user.phone || ''}
              className="w-full h-11 rounded-xl bg-[#181818] border border-[#303030] px-3.5 text-sm font-mono text-[#999999] cursor-not-allowed"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <PrimaryButton variant="secondary" onClick={() => navigate('/profile')}>
              Cancel
            </PrimaryButton>
            <PrimaryButton type="submit" loading={saving}>
              Save Changes
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}
