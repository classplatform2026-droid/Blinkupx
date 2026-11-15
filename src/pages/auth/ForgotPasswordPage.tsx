import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, MailCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useToast } from '../../context/ToastContext';
import { authApi, extractApiError } from '../../services/api';

type ResetStep = 'request' | 'verify' | 'reset';

interface StoredResetFlow {
  step: ResetStep;
  identifier: string;
  phone: string;
  maskedEmail: string;
  resetToken: string;
  resendAvailableAt: number;
}

const STORAGE_KEY = 'blinkupz_pw_reset_flow';

function loadStoredFlow(): StoredResetFlow | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredResetFlow;
    if (!parsed || !['request', 'verify', 'reset'].includes(parsed.step)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredFlow(flow: StoredResetFlow | null) {
  try {
    if (!flow) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flow));
    }
  } catch {
    // Ignore storage errors in private browsing
  }
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const incomingIdentifier =
    ((location.state as { identifier?: string } | null)?.identifier || '').trim();
  const saved = loadStoredFlow();

  const [step, setStep] = useState<ResetStep>(() => {
    if (saved && saved.step !== 'request' && saved.phone) {
      if (saved.step === 'reset' && !saved.resetToken) return 'verify';
      return saved.step;
    }
    return 'request';
  });

  const [identifier, setIdentifier] = useState(
    incomingIdentifier || saved?.identifier || ''
  );
  const [phone, setPhone] = useState(saved?.phone || '');
  const [maskedEmail, setMaskedEmail] = useState(saved?.maskedEmail || '');
  const [resetToken, setResetToken] = useState(saved?.resetToken || '');
  const [resendAvailableAt, setResendAvailableAt] = useState(
    saved?.resendAvailableAt || 0
  );

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState<number>(() => {
    if (!saved?.resendAvailableAt) return 0;
    return Math.max(0, Math.ceil((saved.resendAvailableAt - Date.now()) / 1000));
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [missingConfigVars, setMissingConfigVars] = useState<string[]>([]);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (step === 'request') {
      saveStoredFlow(null);
      return;
    }
    saveStoredFlow({
      step,
      identifier,
      phone,
      maskedEmail,
      resetToken,
      resendAvailableAt,
    });
  }, [step, identifier, phone, maskedEmail, resetToken, resendAvailableAt]);

  useEffect(() => {
    if (!resendAvailableAt) {
      setCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
      setCountdown(remaining);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAvailableAt]);

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

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setMissingConfigVars([]);
    const trimmed = identifier.trim();
    if (trimmed.length < 2) {
      setErrorMsg('Enter your registered phone number, email, or username.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authApi.forgotPassword(trimmed);
      if (!res?.success || !res?.data?.phone) {
        throw new Error(res?.message || 'Unable to send reset code.');
      }
      const nextAvailable = Date.now() + (res.data.cooldownSeconds || 60) * 1000;
      setPhone(res.data.phone);
      setMaskedEmail(res.data.email || '');
      setResetToken('');
      setDigits(['', '', '', '', '', '']);
      setResendAvailableAt(nextAvailable);
      setStep('verify');
      showToast('Password reset code sent to your registered email.', 'success');
      setTimeout(() => inputRefs.current[0]?.focus(), 60);
    } catch (err) {
      const info = extractApiError(err);
      setErrorMsg(info.message);
      if (
        info.code === 'OTP_PROVIDER_NOT_CONFIGURED' &&
        Array.isArray(info.details?.missingVars)
      ) {
        setMissingConfigVars(info.details.missingVars as string[]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (code.length !== 6) {
      setErrorMsg('Enter the complete 6-digit verification code.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authApi.verifyOtp({
        phone,
        code,
        purpose: 'reset_password',
      });
      if (!res?.data?.resetToken) {
        throw new Error('Unable to start password reset session. Please try again.');
      }
      setResetToken(res.data.resetToken);
      setStep('reset');
      showToast('Verification code confirmed.', 'success');
    } catch (err) {
      setErrorMsg(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending || !phone) return;
    setErrorMsg(null);
    setResending(true);
    try {
      const res = await authApi.resendOtp({
        phone,
        purpose: 'reset_password',
      });
      if (res.data?.email) {
        setMaskedEmail(res.data.email);
      }
      setResendAvailableAt(Date.now() + (res.data?.cooldownSeconds || 60) * 1000);
      setDigits(['', '', '', '', '', '']);
      showToast('A new verification code was sent.', 'success');
      inputRefs.current[0]?.focus();
    } catch (err) {
      setErrorMsg(extractApiError(err).message);
    } finally {
      setResending(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword({
        phone,
        resetToken,
        newPassword,
      });
      saveStoredFlow(null);
      showToast('Password updated successfully. You can now log in.', 'success');
      navigate('/login', {
        replace: true,
        state: { identifier: identifier.trim() || phone },
      });
    } catch (err) {
      const info = extractApiError(err);
      setErrorMsg(info.message);
      if (
        info.code === 'RESET_TOKEN_INVALID' ||
        info.code === 'OTP_INVALID' ||
        info.code === 'OTP_EXPIRED_OR_MISSING'
      ) {
        setResetToken('');
        setDigits(['', '', '', '', '', '']);
        setStep('verify');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartOver = () => {
    setErrorMsg(null);
    setResetToken('');
    setDigits(['', '', '', '', '', '']);
    setNewPassword('');
    setConfirmPassword('');
    saveStoredFlow(null);
    setStep('request');
  };

  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;

  return (
    <div className="min-h-dvh bg-[#181818] text-[#FFFFFF] flex flex-col justify-center px-4 py-10">
      <div className="w-full max-w-md mx-auto">
        <Link
          to="/login"
          onClick={() => {
            if (step === 'reset') saveStoredFlow(null);
          }}
          className="inline-flex items-center gap-2 text-sm text-[#999999] hover:text-[#FFFFFF] mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to login</span>
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <BrandMark size={32} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {step === 'request'
                ? 'Forgot password'
                : step === 'verify'
                  ? 'Check your email'
                  : 'Set new password'}
            </h1>
            <p className="text-sm text-[#999999]">
              {step === 'request'
                ? 'We will send a 6-digit code to your registered email'
                : step === 'verify'
                  ? `Enter the 6-digit code sent to ${maskedEmail || phone}`
                  : 'Create a strong password for your BlinkUpZ account'}
            </p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { key: 'request', label: '1. Account' },
            { key: 'verify', label: '2. Verify' },
            { key: 'reset', label: '3. Password' },
          ].map((item, idx) => {
            const currentIdx = step === 'request' ? 0 : step === 'verify' ? 1 : 2;
            const active = idx === currentIdx;
            const done = idx < currentIdx;
            return (
              <div
                key={item.key}
                className={`rounded-xl px-3 py-2 text-xs font-medium border text-center transition-colors ${
                  active
                    ? 'bg-[#242424] border-[#FFFFFF]/40 text-[#FFFFFF]'
                    : done
                      ? 'bg-[#202020] border-[#22C55E]/40 text-[#22C55E]'
                      : 'bg-[#1D1D1D] border-[#303030] text-[#999999]'
                }`}
              >
                {item.label}
              </div>
            );
          })}
        </div>

        {step === 'request' && (
          <form
            onSubmit={handleRequestCode}
            className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-4"
          >
            {errorMsg && (
              <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D] space-y-1.5">
                <p>{errorMsg}</p>
                {missingConfigVars.length > 0 && (
                  <p className="text-xs text-[#999999] font-mono">
                    Required server vars: {missingConfigVars.join(', ')}
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor="forgotIdentifier"
                className="block text-xs font-medium text-[#999999] mb-1.5"
              >
                Registered Phone Number, Email, or Username
              </label>
              <input
                id="forgotIdentifier"
                type="text"
                required
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="01900000000, you@example.com, or username"
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
              />
            </div>

            <PrimaryButton type="submit" fullWidth loading={submitting}>
              Send Verification Code
            </PrimaryButton>
          </form>
        )}

        {step === 'verify' && (
          <form
            onSubmit={handleVerifyCode}
            className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-5"
          >
            <div className="flex items-center gap-3 rounded-xl bg-[#242424] border border-[#303030] px-3.5 py-2.5">
              <MailCheck className="w-4 h-4 text-[#22C55E] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#FFFFFF] truncate">
                  Code sent to {maskedEmail || phone}
                </p>
                <p className="text-[11px] text-[#999999]">Expires in 5 minutes</p>
              </div>
              <button
                type="button"
                onClick={handleStartOver}
                className="text-xs text-[#999999] hover:text-[#FFFFFF] underline underline-offset-4 cursor-pointer shrink-0"
              >
                Change
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D]">
                {errorMsg}
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
                    autoComplete={idx === 0 ? 'one-time-code' : 'off'}
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

            <PrimaryButton type="submit" fullWidth loading={submitting}>
              Verify Code
            </PrimaryButton>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[#999999] font-mono tabular-nums">
                {countdown > 0
                  ? `Resend available in ${countdown}s`
                  : 'Did not receive the code?'}
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

        {step === 'reset' && (
          <form
            onSubmit={handleResetPassword}
            className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-4"
          >
            <div className="flex items-center gap-2.5 rounded-xl bg-[#242424] border border-[#303030] px-3.5 py-2.5">
              <KeyRound className="w-4 h-4 text-[#22C55E] shrink-0" />
              <p className="text-xs text-[#999999]">
                Verified account:{' '}
                <span className="text-[#FFFFFF] font-mono">{maskedEmail || phone}</span>
              </p>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D]">
                {errorMsg}
              </div>
            )}

            <div>
              <label
                htmlFor="resetNewPass"
                className="block text-xs font-medium text-[#999999] mb-1.5"
              >
                New Password
              </label>
              <div className="relative">
                <input
                  id="resetNewPass"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-3.5 pr-11 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((p) => !p)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-[#999999] hover:text-white cursor-pointer"
                >
                  {showNewPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="resetConfirmPass"
                className="block text-xs font-medium text-[#999999] mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="resetConfirmPass"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-3.5 pr-11 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-[#999999] hover:text-white cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {confirmPassword.length > 0 && (
                <p
                  className={`mt-1.5 text-xs flex items-center gap-1.5 ${
                    passwordsMatch ? 'text-[#22C55E]' : 'text-[#E5484D]'
                  }`}
                >
                  {passwordsMatch && <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>
                    {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                  </span>
                </p>
              )}
            </div>

            <PrimaryButton type="submit" fullWidth loading={submitting}>
              Update Password
            </PrimaryButton>
          </form>
        )}
      </div>
    </div>
  );
}
