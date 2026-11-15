import { useEffect, useState } from 'react';
import { Check, Copy, Download, QrCode, ScanLine, Share2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { extractApiError, userApi } from '../services/api';
import type { MyQrCodeData } from '../types';
import { Modal } from './Modal';
import { PrimaryButton } from './PrimaryButton';
import { UserAvatar } from './UserAvatar';

interface QrCodeModalProps {
  open: boolean;
  onClose: () => void;
  onOpenScanner?: () => void;
}

export function QrCodeModal({ open, onClose, onOpenScanner }: QrCodeModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [qrData, setQrData] = useState<MyQrCodeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    userApi
      .getMyQrCode(window.location.origin)
      .then((data) => {
        if (!cancelled) setQrData(data);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!user) return null;

  const profileUrl = qrData?.profileUrl || `${window.location.origin}/u/${user.username}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      showToast('Profile link copied.', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Unable to copy automatically.', 'error');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${user.fullName} on BlinkUpZ`,
          text: `Connect with @${user.username} on BlinkUpZ`,
          url: profileUrl,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }
    }
    await handleCopyLink();
  };

  const handleDownload = async () => {
    if (!qrData?.qrDataUrl) return;
    setDownloading(true);
    try {
      const qrImg = new Image();
      await new Promise<void>((resolve, reject) => {
        qrImg.onload = () => resolve();
        qrImg.onerror = () => reject(new Error('Failed to render QR image.'));
        qrImg.src = qrData.qrDataUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable.');

      // Dark BlinkUpZ card background
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Inner card
      ctx.fillStyle = '#202020';
      ctx.strokeStyle = '#303030';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(40, 40, 640, 820, 32);
      ctx.fill();
      ctx.stroke();

      // Header text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(user.fullName, canvas.width / 2, 120);

      ctx.fillStyle = '#999999';
      ctx.font = '24px monospace';
      ctx.fillText(`@${user.username}`, canvas.width / 2, 160);

      // White QR container
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(120, 210, 480, 480, 24);
      ctx.fill();

      ctx.drawImage(qrImg, 144, 234, 432, 432);

      // Footer
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('BlinkUpZ', canvas.width / 2, 760);

      ctx.fillStyle = '#999999';
      ctx.font = '20px sans-serif';
      ctx.fillText('Scan to open profile & start messaging', canvas.width / 2, 800);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `blinkupz-${user.username}-qr.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('QR code downloaded.', 'success');
    } catch (err) {
      showToast(extractApiError(err).message, 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="My QR Code" maxWidth="max-w-md">
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <UserAvatar
            src={user.avatar}
            name={user.fullName}
            size="lg"
            online={user.onlineStatus}
          />
          <h3 className="text-base font-bold text-[#FFFFFF] mt-3">{user.fullName}</h3>
          <p className="text-xs text-[#999999] font-mono">@{user.username}</p>
        </div>

        <div className="flex justify-center">
          {loading ? (
            <div className="w-60 h-60 rounded-2xl bg-[#242424] border border-[#303030] animate-pulse flex items-center justify-center">
              <QrCode className="w-8 h-8 text-[#999999]" />
            </div>
          ) : error ? (
            <div className="w-full rounded-xl bg-[#242424] border border-[#E5484D]/40 p-4 text-center text-sm text-[#E5484D]">
              {error}
            </div>
          ) : qrData?.qrDataUrl ? (
            <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#303030]">
              <img
                src={qrData.qrDataUrl}
                alt={`BlinkUpZ QR code for @${user.username}`}
                className="w-56 h-56 block"
              />
            </div>
          ) : null}
        </div>

        <div className="rounded-xl bg-[#242424] border border-[#303030] px-3.5 py-2.5 flex items-center justify-between gap-2">
          <span className="text-xs font-mono text-[#999999] truncate">{profileUrl}</span>
          <button
            type="button"
            onClick={handleCopyLink}
            aria-label="Copy profile link"
            className="text-xs font-medium text-[#FFFFFF] hover:underline shrink-0 cursor-pointer flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#22C55E]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PrimaryButton
            variant="secondary"
            loading={downloading}
            disabled={!qrData?.qrDataUrl}
            onClick={handleDownload}
            className="text-xs px-2.5"
          >
            <Download className="w-4 h-4" />
            <span>Download</span>
          </PrimaryButton>
          <PrimaryButton
            variant="secondary"
            onClick={handleShare}
            className="text-xs px-2.5"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </PrimaryButton>
          <PrimaryButton
            onClick={handleCopyLink}
            className="text-xs px-2.5"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied' : 'Copy Link'}</span>
          </PrimaryButton>
        </div>

        {onOpenScanner && (
          <div className="pt-2 border-t border-[#303030]">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenScanner();
              }}
              className="w-full min-h-[44px] rounded-xl bg-[#242424] border border-[#303030] text-sm font-medium text-[#FFFFFF] hover:bg-[#303030] transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <ScanLine className="w-4 h-4" />
              <span>Scan Someone&apos;s QR Code</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
