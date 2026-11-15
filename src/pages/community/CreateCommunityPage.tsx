import React, { useRef, useState } from 'react';
import { Globe, Lock, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { UserAvatar } from '../../components/UserAvatar';
import { useToast } from '../../context/ToastContext';
import { communityApi, extractApiError, mediaApi } from '../../services/api';

export function CreateCommunityPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [image, setImage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const res = await mediaApi.upload(file, 'communities');
      setImage(res.url);
      showToast('Community image uploaded.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 3) {
      setError('Community name must be at least 3 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await communityApi.create({
        name: name.trim(),
        description: description.trim(),
        image,
        privacy,
      });
      showToast('Community created.', 'success');
      navigate(`/community/${created.id}`, { replace: true });
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181818] overflow-hidden">
      <AppHeader
        title="Create Community"
        subtitle="You will become the Owner of this community"
        showBack
        onBack={() => navigate('/community')}
      />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <form
          onSubmit={handleCreate}
          className="max-w-xl mx-auto rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-5"
        >
          {error && (
            <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D]">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <UserAvatar src={image} name={name || 'Community'} size="xl" />
            <div>
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
                <span>{image ? 'Change Image' : 'Upload Community Image'}</span>
              </PrimaryButton>
              <p className="text-xs text-[#999999] mt-1.5">
                Optional square image (PNG, JPG, WebP)
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="commName" className="block text-xs font-medium text-[#999999] mb-1.5">
              Community Name
            </label>
            <input
              id="commName"
              type="text"
              required
              minLength={3}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Frontend Builders"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="commDesc" className="block text-xs font-medium text-[#999999] mb-1.5">
              Description
            </label>
            <textarea
              id="commDesc"
              rows={3}
              maxLength={400}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this community about?"
              className="w-full rounded-xl bg-[#242424] border border-[#303030] p-3.5 text-sm text-[#FFFFFF] resize-none focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-[#999999] mb-2">
              Privacy
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPrivacy('public')}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
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
                  Discoverable in search and anyone can join immediately.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setPrivacy('private')}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
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
                  Requires administrator approval to join.
                </p>
              </button>
            </div>
          </div>

          <PrimaryButton type="submit" fullWidth loading={submitting}>
            Create Community
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}
