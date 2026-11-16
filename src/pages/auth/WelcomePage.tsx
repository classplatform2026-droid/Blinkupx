import { useState } from 'react';
import { ArrowRight, Download, MessageSquare, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { Modal } from '../../components/Modal';
import { PrimaryButton } from '../../components/PrimaryButton';
import { usePwa } from '../../context/PwaContext';

export function WelcomePage() {
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);
  const { canPromptInstall, isInstalled, installing, browserInfo, installApp } =
    usePwa();

  return (
    <div className="min-h-dvh bg-[#181818] text-[#FFFFFF] flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8 border-b border-[#303030]">
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
          <BrandMark size={28} />
          <span className="text-lg font-bold tracking-tight">BlinkUpZ</span>
        </div>

        <nav className="hidden sm:flex items-center gap-6 text-sm text-[#999999]">
          <Link to="/login" className="hover:text-[#FFFFFF] transition-colors whitespace-nowrap">
            Log In
          </Link>
          <button
            type="button"
            onClick={() => setLegalModal('terms')}
            className="hover:text-[#FFFFFF] transition-colors whitespace-nowrap cursor-pointer"
          >
            Terms
          </button>
          <button
            type="button"
            onClick={() => setLegalModal('privacy')}
            className="hover:text-[#FFFFFF] transition-colors whitespace-nowrap cursor-pointer"
          >
            Privacy
          </button>
        </nav>

        <div className="shrink-0">
          <Link to="/signup">
            <PrimaryButton>Get Started</PrimaryButton>
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-6 space-y-6">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <span className="text-2xl font-bold tracking-tight">BlinkUpZ</span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] text-[#FFFFFF]">
            Connect. Communicate. Together.
          </h1>

          <p className="text-base sm:text-lg text-[#999999] max-w-xl leading-relaxed">
            Direct messaging, real-time communities, voice notes, and seamless media sharing in one focused dark workspace built for clarity and speed.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/signup" className="w-full sm:w-auto">
              <PrimaryButton fullWidth className="sm:w-auto">
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            </Link>
            <Link to="/login" className="w-full sm:w-auto">
              <PrimaryButton variant="secondary" fullWidth className="sm:w-auto">
                Log In
              </PrimaryButton>
            </Link>
            {!isInstalled && (canPromptInstall || browserInfo.isIOS) && (
              <PrimaryButton
                variant="secondary"
                loading={installing}
                onClick={() => void installApp()}
                className="w-full sm:w-auto"
              >
                <Download className="w-4 h-4" />
                <span>{browserInfo.isIOS ? 'Install on iOS' : 'Install App'}</span>
              </PrimaryButton>
            )}
          </div>

          <div className="pt-4 flex items-center gap-4 text-xs text-[#999999]">
            <button
              type="button"
              onClick={() => setLegalModal('terms')}
              className="hover:text-[#FFFFFF] underline underline-offset-4 cursor-pointer"
            >
              Terms of Service
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setLegalModal('privacy')}
              className="hover:text-[#FFFFFF] underline underline-offset-4 cursor-pointer"
            >
              Privacy Policy
            </button>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-2xl bg-[#202020] border border-[#303030] p-6 sm:p-8 space-y-6">
            <div className="pb-5 border-b border-[#303030]">
              <h2 className="text-lg font-semibold text-[#FFFFFF]">
                Built for calm, real-time conversation
              </h2>
              <p className="text-sm text-[#999999] mt-1">
                Everything you need in Version 1.0 without unnecessary noise.
              </p>
            </div>

            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#242424] border border-[#303030] flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5 text-[#FFFFFF]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#FFFFFF]">
                    Instant 1:1 & Group Messaging
                  </h3>
                  <p className="text-sm text-[#999999] mt-0.5 leading-relaxed">
                    Real-time delivery and read receipts, message replies, reactions, voice recordings, and document sharing.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#242424] border border-[#303030] flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-[#FFFFFF]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#FFFFFF]">
                    Public & Private Communities
                  </h3>
                  <p className="text-sm text-[#999999] mt-0.5 leading-relaxed">
                    Create dedicated spaces with role-based moderation, pinned announcements, and instant member discovery.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#242424] border border-[#303030] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-[#FFFFFF]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#FFFFFF]">
                    Verified Account Sessions
                  </h3>
                  <p className="text-sm text-[#999999] mt-0.5 leading-relaxed">
                    Phone OTP verification, bcrypt-hashed credentials, HTTP-only session cookies, and server-enforced room membership.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Modal
        open={legalModal !== null}
        onClose={() => setLegalModal(null)}
        title={legalModal === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
      >
        {legalModal === 'terms' ? (
          <div className="space-y-3 text-sm text-[#999999] leading-relaxed">
            <p className="text-[#FFFFFF] font-medium">BlinkUpZ Terms of Service (V1.0)</p>
            <p>
              By creating an account on BlinkUpZ, you agree to provide accurate registration details, maintain the security of your password, and refrain from automated abuse, spam, or unlawful content distribution.
            </p>
            <p>
              Community owners and moderators are responsible for managing public and private spaces in accordance with applicable laws and respectful conduct.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-[#999999] leading-relaxed">
            <p className="text-[#FFFFFF] font-medium">BlinkUpZ Privacy Policy (V1.0)</p>
            <p>
              BlinkUpZ collects your full name, username, verified phone number, and profile preferences solely to operate messaging, community membership, and account authentication.
            </p>
            <p>
              Passwords are stored exclusively as salted bcrypt hashes. Conversations are restricted strictly to authorized participants on the server.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
