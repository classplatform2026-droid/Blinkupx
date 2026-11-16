import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { BrandMark } from './components/BrandMark';
import { AuthProvider, useAuth } from './context/AuthContext';
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
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/" replace />;
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
    <BrowserRouter>
      <ToastProvider>
        <PwaProvider>
          <AuthProvider>
            <SocketProvider>
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
          </SocketProvider>
        </AuthProvider>
        </PwaProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
