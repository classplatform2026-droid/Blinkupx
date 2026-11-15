import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { authApi, extractApiError, setStoredAuthToken } from '../../services/api';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect') || '';
  const safeRedirect = rawRedirect.startsWith('/') ? rawRedirect : '/chats';
  const incomingIdentifier =
    ((location.state as { identifier?: string } | null)?.identifier || '').trim();
  const { setAuthenticatedUser } = useAuth();
  const { showToast } = useToast();

  const [identifier, setIdentifier] = useState(incomingIdentifier);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unverifiedPhone, setUnverifiedPhone] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setUnverifiedPhone(null);

    if (!identifier.trim() || !password) {
      setErrorMsg('Enter your phone number or username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authApi.login({
        identifier: identifier.trim(),
        password,
      });
      if (res.data?.token) {
        setStoredAuthToken(res.data.token);
      }
      setAuthenticatedUser(res.data.user);
      showToast(`Welcome back, ${res.data.user.fullName}`, 'success');
      navigate(safeRedirect, { replace: true });
    } catch (err) {
      const info = extractApiError(err);
      setErrorMsg(info.message);
      if (info.code === 'ACCOUNT_NOT_VERIFIED' && typeof info.details?.phone === 'string') {
        setUnverifiedPhone(info.details.phone);
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
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-sm text-[#999999]">Log in to continue on BlinkUpZ</p>
          </div>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-2xl bg-[#202020] border border-[#303030] p-6 space-y-4"
        >
          {errorMsg && (
            <div className="rounded-xl bg-[#242424] border border-[#E5484D]/50 px-4 py-3 text-sm text-[#E5484D] space-y-2">
              <p>{errorMsg}</p>
              {unverifiedPhone && (
                <button
                  type="button"
                  onClick={() =>
                    navigate('/verify-otp', {
                      state: { phone: unverifiedPhone, purpose: 'register' },
                    })
                  }
                  className="text-xs text-[#FFFFFF] underline underline-offset-4 cursor-pointer"
                >
                  Verify {unverifiedPhone} now
                </button>
              )}
            </div>
          )}

          <div>
            <label htmlFor="identifier" className="block text-xs font-medium text-[#999999] mb-1.5">
              Phone Number, Email, or Username
            </label>
            <input
              id="identifier"
              type="text"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="alex_mercer, email, or 01900000000"
              className="w-full h-11 rounded-xl bg-[#242424] border border-[#303030] px-3.5 text-sm text-[#FFFFFF] placeholder:text-[#999999]/60 focus:border-[#FFFFFF]/50 focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="loginPassword" className="block text-xs font-medium text-[#999999]">
                Password
              </label>
              <button
                type="button"
                onClick={() =>
                  navigate('/forgot-password', {
                    state: identifier.trim() ? { identifier: identifier.trim() } : undefined,
                  })
                }
                className="text-xs text-[#999999] hover:text-[#FFFFFF] transition-colors cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                id="loginPassword"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
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
            Log In
          </PrimaryButton>
        </form>

        <p className="text-center text-sm text-[#999999] mt-6">
          New to BlinkUpZ?{' '}
          <Link to="/signup" className="text-[#FFFFFF] font-medium hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
