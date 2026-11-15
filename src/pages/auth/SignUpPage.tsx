import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Eye, EyeOff, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useToast } from '../../context/ToastContext';
import { authApi, extractApiError } from '../../services/api';

export function SignUpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect') || '';
  const safeRedirect = rawRedirect.startsWith('/') ? rawRedirect : undefined;
  const { showToast } = useToast();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [missingConfigVars, setMissingConfigVars] = useState<string[]>([]);

  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameStatus('idle');
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(clean)) {
      setUsernameStatus('invalid');
      return;
    }

    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await authApi.checkUsername(clean);
        setUsernameStatus(res.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setMissingConfigVars([]);

    if (fullName.trim().length < 2) {
      setErrorMsg('Full name must be at least 2 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Enter a valid email address for OTP verification.');
      return;
    }
    const cleanPhone = phone.replace(/[\s\-()]/g, '').trim();
    if (!/^(?:01\d{9}|\+?(?:88)?01\d{9}|\+?[1-9]\d{6,14})$/.test(cleanPhone)) {
      setErrorMsg('Enter a valid phone number (e.g. 01900000000).');
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) {
      setErrorMsg('Username must be 3-24 characters using letters, numbers, or underscores.');
      return;
    }
    if (usernameStatus === 'taken') {
      setErrorMsg('That username is already taken.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authApi.register({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        username: username.trim().toLowerCase(),
        password,
      });
      if (!res?.success || !res?.data?.phone) {
        throw new Error(res?.message || 'Unable to complete registration. Please check server configuration.');
      }
      showToast('Verification code sent to your email.', 'success');
      navigate('/verify-otp', {
        state: {
          phone: res.data.phone,
          email: res.data.email || email.trim().toLowerCase(),
          purpose: 'register',
          cooldownSeconds: res.data.cooldownSeconds,
          redirect: safeRedirect,
        },
      });
    } catch (err) {
      const info = extractApiError(err);
      setErrorMsg(info.message);
      if (info.code === 'OTP_PROVIDER_NOT_CONFIGURED' && Array.isArray(info.details?.missingVars)) {
        setMissingConfigVars(info.details.missingVars as string[]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#181818] text-[#FFFFFF] flex flex-col justify-center px-4 py-10">
      <div className="w-full max-w-md mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-[#999999] hover:text-[#FFFFFF] mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <BrandMark size={32} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
            <p className="text-sm text-[#999999]">Join BlinkUpZ and verify your phone number</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-4"
        >
          {errorMsg && (
            <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D] space-y-1.5">
              <p>{errorMsg}</p>
              {missingConfigVars.length > 0 && (
                <p className="text-xs text-[#999999] font-mono">
                  Required server vars: {missingConfigVars.join(', ')} (or set OTP_PROVIDER=webhook with OTP_WEBHOOK_URL)
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="fullName" className="block text-xs font-medium text-[#999999] mb-1.5">
              Full Name
            </label>
            <input
              id="fullName"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Mercer"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-[#999999] mb-1.5">
              Email Address (for OTP verification)
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-[#999999] mb-1.5">
              Phone Number
            </label>
            <input
              id="phone"
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01900000000"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm font-mono text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="username" className="block text-xs font-medium text-[#999999]">
                Username
              </label>
              {usernameStatus === 'checking' && (
                <span className="text-xs text-[#999999]">Checking...</span>
              )}
              {usernameStatus === 'available' && (
                <span className="inline-flex items-center gap-1 text-xs text-[#22C55E]">
                  <Check className="w-3.5 h-3.5" /> Available
                </span>
              )}
              {usernameStatus === 'taken' && (
                <span className="inline-flex items-center gap-1 text-xs text-[#E5484D]">
                  <X className="w-3.5 h-3.5" /> Already taken
                </span>
              )}
              {usernameStatus === 'invalid' && (
                <span className="text-xs text-[#E5484D]">3-24 chars (a-z, 0-9, _)</span>
              )}
            </div>
            <input
              id="username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="alex_mercer"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-[#999999] mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] pl-3.5 pr-11 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-[#999999] hover:text-white cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <PrimaryButton type="submit" fullWidth loading={submitting} className="mt-2">
            Create Account
          </PrimaryButton>
        </form>

        <p className="text-center text-sm text-[#999999] mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-[#FFFFFF] font-medium hover:underline">
            Log In
          </Link>
        </p>
      </div>
    </div>
  );
}
