import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, ImagePlus, Link2, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { Modal } from './Modal';
import { PrimaryButton } from './PrimaryButton';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
}

export function extractUsernameFromQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Check URL format: https://.../u/<username> or /u/<username>
  try {
    const parsed = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(trimmed, 'https://blinkupz.app');
    const match = parsed.pathname.match(/\/u\/([a-z0-9_]{3,24})/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  } catch {
    // Not a URL, fall through
  }

  const directMatch = trimmed.match(/^@?([a-z0-9_]{3,24})$/i);
  if (directMatch?.[1]) {
    return directMatch[1].toLowerCase();
  }

  return null;
}

export function QrScannerModal({ open, onClose }: QrScannerModalProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCameraError(null);
      setManualInput('');
    }
    return () => {
      stopCamera();
    };
  }, [open, stopCamera]);

  const handleDecoded = useCallback(
    (payload: string) => {
      const username = extractUsernameFromQrPayload(payload);
      if (!username) {
        showToast('This QR code is not a valid BlinkUpZ profile.', 'error');
        return false;
      }
      stopCamera();
      onClose();
      navigate(`/u/${username}`);
      return true;
    },
    [navigate, onClose, showToast, stopCamera]
  );

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (result?.data) {
        if (handleDecoded(result.data)) {
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  }, [handleDecoded]);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser. Upload a QR image or paste a link below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
          rafRef.current = requestAnimationFrame(scanFrame);
        }
      });
    } catch {
      setCameraError('Camera permission denied or unavailable. You can upload a QR image below.');
    }
  };

  const handleUploadQrImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read image file.'));
        reader.readAsDataURL(file);
      });

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Invalid image file.'));
        img.src = dataUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable.');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (!code?.data) {
        showToast('No QR code detected in this image.', 'error');
        return;
      }

      handleDecoded(code.data);
    } catch {
      showToast('Unable to decode QR code from image.', 'error');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleDecoded(manualInput);
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan BlinkUpZ QR Code" maxWidth="max-w-md">
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUploadQrImage}
        />
        <canvas ref={canvasRef} className="hidden" />

        {cameraActive ? (
          <div className="space-y-3">
            <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black border border-[#303030]">
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-2xl border-2 border-[#FFFFFF]/80" />
              </div>
            </div>
            <PrimaryButton variant="secondary" fullWidth onClick={stopCamera}>
              Stop Camera
            </PrimaryButton>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#242424] border border-[#303030] p-5 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#181818] border border-[#303030] flex items-center justify-center mx-auto text-[#FFFFFF]">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#FFFFFF]">
                Scan a user&apos;s QR code
              </p>
              <p className="text-xs text-[#999999] mt-1">
                Point your camera at a BlinkUpZ QR code or upload a saved QR image.
              </p>
            </div>
            {cameraError && (
              <p className="text-xs text-[#E5484D] bg-[#181818] border border-[#E5484D]/40 rounded-xl px-3 py-2">
                {cameraError}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <PrimaryButton onClick={startCamera} className="text-xs">
                <Camera className="w-4 h-4" />
                <span>Use Camera</span>
              </PrimaryButton>
              <PrimaryButton
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs"
              >
                <ImagePlus className="w-4 h-4" />
                <span>Upload QR Image</span>
              </PrimaryButton>
            </div>
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="space-y-2 pt-2 border-t border-[#303030]">
          <label htmlFor="qrManualInput" className="block text-xs font-medium text-[#999999]">
            Or enter profile link / @username
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-[#999999] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="qrManualInput"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder=".../u/username or @username"
                className="w-full h-10 rounded-xl bg-[#242424] border border-[#303030] pl-9 pr-3 text-xs text-[#FFFFFF] placeholder:text-[#999999] focus:border-[#FFFFFF]/40 focus:outline-none"
              />
            </div>
            <PrimaryButton type="submit" className="min-h-[40px] px-4 text-xs">
              Open
            </PrimaryButton>
          </div>
        </form>
      </div>
    </Modal>
  );
}
