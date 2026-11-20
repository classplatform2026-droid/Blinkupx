import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { BrandMark } from './components/BrandMark';
import { CallOverlay } from './components/CallOverlay';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import { PwaProvider } from './context/PwaContext';
import { SocketProvider } from './context/SocketContext';
import { ToastProvider } from './context/ToastContext';
import { AppLayout } from './layouts/AppLayout';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignUpPage } from './pages/auth/SignUpPage';
import { VerifyOtpPage } from './pages/auth/VerifyOtpPage';
import { WelcomePage } from './pages/auth/WelcomePage';
import { CallHistoryPage } from './pages/calls/CallHistoryPage';
import { ChatsPage } from './pages/chats/ChatsPage';
import { MessageSearchPage } from './pages/chats/MessageSearchPage';
import { NewChatPage } from './pages/chats/NewChatPage';
import { CommunityDetailsPage } from './pages/community/CommunityDetailsPage';
import { CommunityMembersPage } from './pages/community/CommunityMembersPage';
import { CommunityPage } from './pages/community/CommunityPage';
import { CommunitySettingsPage } from './pages/community/CommunitySettingsPage';
import { CreateCommunityPage } from './pages/community/CreateCommunityPage';
import { GroupChatPage } from './pages/community/GroupChatPage';
import { AppSettingsPage } from './pages/profile/AppSettingsPage';
import { BlockedContactsPage } from './pages/profile/BlockedContactsPage';
import { EditProfilePage } from './pages/profile/EditProfilePage';
import { NotificationSettingsPage } from './pages/profile/NotificationSettingsPage';
import { PrivacySettingsPage } from './pages/profile/PrivacySettingsPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { PublicProfilePage } from './pages/profile/PublicProfilePage';

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[BlinkUpZ] UI ErrorBoundary caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-[#181818] text-[#FFFFFF] flex items-center justify-center px-6">
          <div className="max-w-sm w-full rounded-2xl bg-[#202020] border border-[#303030] p-6 text-center space-y-4">
            <div className="flex justify-center">
              <BrandMark size={40} />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-[#FFFFFF]">
                Something went wrong
              </h2>
              <p className="text-xs text-[#999999] leading-relaxed">
                A display error occurred. Reload BlinkUpZ to restore your view.
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full h-10 rounded-xl bg-[#FFFFFF] text-[#181818] text-sm font-semibold hover:bg-[#E8E8E8] transition-colors cursor-pointer"
            >
              Reload BlinkUpZ
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function FullScreenLoader() {
  return (
    <div className="min-h-dvh bg-[#181818] text-[#FFFFFF] flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4">
        <BrandMark size={44} />
        <div className="w-6 h-6 rounded-full border-2 border-[#303030] border-t-[#FFFFFF] animate-spin" />
        <p className="text-xs text-[#999999]">Loading BlinkUpZ...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) {
    const dest = `${location.pathname}${location.search}`;
    if (location.search.includes('incomingCall=') || (location.pathname && location.pathname !== '/chats')) {
      return <Navigate to={`/login?redirect=${encodeURIComponent(dest)}`} replace />;
    }
    return <Navigate to="/" replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect') || '';
  const target = rawRedirect.startsWith('/') ? rawRedirect : '/chats';
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={target} replace />;
  return <>{children}</>;
}

function PublicProfileRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) {
    return (
      <AppLayout>
        <PublicProfilePage />
      </AppLayout>
    );
  }
  return <PublicProfilePage />;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <PwaProvider>
            <AuthProvider>
              <SocketProvider>
                <CallProvider>
                  <CallOverlay />
                  <Routes>
              {/* A. Authentication — 4 Screens */}
              <Route
                path="/"
                element={
                  <GuestRoute>
                    <WelcomePage />
                  </GuestRoute>
                }
              />
              <Route
                path="/signup"
                element={
                  <GuestRoute>
                    <SignUpPage />
                  </GuestRoute>
                }
              />
              <Route
                path="/login"
                element={
                  <GuestRoute>
                    <LoginPage />
                  </GuestRoute>
                }
              />
              <Route
                path="/forgot-password"
                element={
                  <GuestRoute>
                    <ForgotPasswordPage />
                  </GuestRoute>
                }
              />
              <Route path="/verify-otp" element={<VerifyOtpPage />} />

              {/* B. Chats — 4 Screens */}
              <Route
                path="/chats"
                element={
                  <ProtectedRoute>
                    <ChatsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats/new"
                element={
                  <ProtectedRoute>
                    <NewChatPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats/search"
                element={
                  <ProtectedRoute>
                    <MessageSearchPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chats/:conversationId"
                element={
                  <ProtectedRoute>
                    <ChatsPage />
                  </ProtectedRoute>
                }
              />

              {/* C. Community — 3 Screens */}
              <Route
                path="/community"
                element={
                  <ProtectedRoute>
                    <CommunityPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/community/create"
                element={
                  <ProtectedRoute>
                    <CreateCommunityPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/community/:communityId"
                element={
                  <ProtectedRoute>
                    <GroupChatPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/community/:communityId/details"
                element={
                  <ProtectedRoute>
                    <CommunityDetailsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/community/:communityId/members"
                element={
                  <ProtectedRoute>
                    <CommunityMembersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/community/:communityId/settings"
                element={
                  <ProtectedRoute>
                    <CommunitySettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* D. Call — 1 Screen */}
              <Route
                path="/calls"
                element={
                  <ProtectedRoute>
                    <CallHistoryPage />
                  </ProtectedRoute>
                }
              />

              {/* E. Profile — 3 Screens */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/edit"
                element={
                  <ProtectedRoute>
                    <EditProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/settings"
                element={
                  <ProtectedRoute>
                    <AppSettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/privacy"
                element={
                  <ProtectedRoute>
                    <PrivacySettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/blocked"
                element={
                  <ProtectedRoute>
                    <BlockedContactsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/notifications"
                element={
                  <ProtectedRoute>
                    <NotificationSettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* Public / QR User Profile */}
              <Route path="/u/:username" element={<PublicProfileRoute />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
                </CallProvider>
            </SocketProvider>
          </AuthProvider>
          </PwaProvider>
        </ToastProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
