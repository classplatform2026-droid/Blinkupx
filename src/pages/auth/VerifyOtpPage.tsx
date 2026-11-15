import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { authApi, extractApiError, setStoredAuthToken } from '../../services/api';

interface LocationState {
  phone?: string;
  email?: string;
  purpose?: 'register' | 'reset_password';
  cooldownSeconds?: number;
  redirect?: string;
}

export function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState) || {};

  const { setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [phone, setPhone] = useState(state.phone || '');
  const purpose = state.purpose || 'register';

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(state.cooldownSeconds ?? 60);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // If purpose === 'reset_password' and OTP is verified, allow setting new password
  const [verifiedResetCode, setVerifiedResetCode] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const code = digits.join('');

  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }
    if (clean.length > 1) {
      const chars = clean.slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      chars.forEach((ch, idx) => {
        next[idx] = ch;
      });
      setDigits(next);
      const focusIdx = Math.min(5, chars.length);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!phone.trim()) {
      setErrorMsg('Phone number is required.');
      return;
    }
    if (code.length !== 6) {
      setErrorMsg('Please enter the complete 6-digit verification code.');
      return;
    }

    setVerifying(true);
    try {
      if (purpose === 'reset_password') {
        setVerifiedResetCode(code);
      } else {
        const res = await authApi.verifyOtp({
          phone: phone.trim(),
          code,
          purpose: 'register',
        });
        if (res.data?.token) {
          setStoredAuthToken(res.data.token);
        }
        if (res.data?.user) {
          setAuthenticatedUser(res.data.user);
        }
        showToast('Phone number verified!', 'success');
        const nextPath =
          state.redirect && state.redirect.startsWith('/') ? state.redirect : '/chats';
        navigate(nextPath, { replace: true });
      }
    } catch (err) {
      setErrorMsg(extractApiError(err).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters.');
      return;
    }
    setVerifying(true);
    try {
      await authApi.resetPassword({
        phone: phone.trim(),
        code: verifiedResetCode!,
        newPassword,
      });
      showToast('Password updated. Please log in.', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      const info = extractApiError(err);
      setErrorMsg(info.message);
      if (info.code === 'OTP_INVALID' || info.code === 'OTP_EXPIRED_OR_MISSING') {
        setVerifiedResetCode(null);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || !phone.trim()) return;
    setErrorMsg(null);
    setResending(true);
    try {
      const res = await authApi.resendOtp({
        phone: phone.trim(),
        purpose,
      });
      setCountdown(res.data.cooldownSeconds || 60);
      showToast('A new verification code was sent.', 'success');
    } catch (err) {
      setErrorMsg(extractApiError(err).message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#181818] text-[#FFFFFF] flex flex-col justify-center px-4 py-10">
      <div className="w-full max-w-md mx-auto">
        <Link
          to={purpose === 'reset_password' ? '/login' : '/signup'}
          className="inline-flex items-center gap-2 text-sm text-[#999999] hover:text-[#FFFFFF] mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <BrandMark size={32} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {verifiedResetCode ? 'Set new password' : 'Verify your account'}
            </h1>
            <p className="text-sm text-[#999999]">
              {verifiedResetCode
                ? 'Choose a strong password for your account'
                : state.email || phone
                  ? `Enter the 6-digit code sent to ${state.email || phone}`
                  : 'Enter your phone number and 6-digit verification code'}
            </p>
          </div>
        </div>

        {verifiedResetCode ? (
          <form
            onSubmit={handleResetPasswordSubmit}
            className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-4"
          >
            {errorMsg && (
              <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D]">
                {errorMsg}
              </div>
            )}
            <div>
              <label htmlFor="newPass" className="block text-xs font-medium text-[#999999] mb-1.5">
                New Password
              </label>
              <input
                id="newPass"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] focus:border-[#FFFFFF]/50 focus:outline-none"
              />
            </div>
            <PrimaryButton type="submit" fullWidth loading={verifying}>
              Update Password
            </PrimaryButton>
          </form>
        ) : (
          <form
            onSubmit={handleVerify}
            className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-5"
          >
            {errorMsg && (
              <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D]">
                {errorMsg}
              </div>
            )}

            {!state.phone && (
              <div>
                <label htmlFor="otpPhone" className="block text-xs font-medium text-[#999999] mb-1.5">
                  Phone Number
                </label>
                <input
                  id="otpPhone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01900000000"
                  className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm font-mono text-[#FFFFFF] focus:border-[#FFFFFF]/50 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">
                6-Digit Verification Code
              </label>
              <div className="grid grid-cols-6 gap-2">
                {digits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    aria-label={`Digit ${idx + 1}`}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="h-12 w-full rounded-xl bg-[#242424] border border-[#303030] text-center text-lg font-mono font-semibold tabular-nums text-[#FFFFFF] focus:border-[#FFFFFF] focus:outline-none"
                  />
                ))}
              </div>
            </div>

            <PrimaryButton type="submit" fullWidth loading={verifying}>
              Verify
            </PrimaryButton>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[#999999] font-mono tabular-nums">
                {countdown > 0 ? `Resend available in ${countdown}s` : 'Did not receive the code?'}
              </span>
              <button
                type="button"
                disabled={countdown > 0 || resending}
                onClick={handleResend}
                className="font-medium text-[#FFFFFF] disabled:text-[#999999]/50 hover:underline cursor-pointer disabled:cursor-not-allowed"
              >
                {resending ? 'Sending...' : 'Resend Code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
