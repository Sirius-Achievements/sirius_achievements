import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { AuthProvider } from '@/contexts/AuthContext'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { onServerError } from '@/utils/serverErrorBus'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { VerifyCodePage } from '@/pages/auth/VerifyCodePage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import { PrivacyPage } from '@/pages/auth/PrivacyPage'
import { AchievementsPage } from '@/pages/achievements/AchievementsPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { DocumentsPage } from '@/pages/documents/DocumentsPage'
import { ForbiddenPage } from '@/pages/errors/ForbiddenPage'
import { NotFoundPage } from '@/pages/errors/NotFoundPage'
import { ServerErrorPage } from '@/pages/errors/ServerErrorPage'
import { LeaderboardPage } from '@/pages/leaderboard/LeaderboardPage'
import { ModerationAchievementsPage } from '@/pages/moderation/ModerationAchievementsPage'
import { ModerationSupportChatPage } from '@/pages/moderation/ModerationSupportChatPage'
import { ModerationSupportPage } from '@/pages/moderation/ModerationSupportPage'
import { ModerationUsersPage } from '@/pages/moderation/ModerationUsersPage'
import { MyWorkPage } from '@/pages/my-work/MyWorkPage'
import { ProfilePage } from '@/pages/profile/ProfilePage'
import { StudentProfilePage } from '@/pages/public/StudentProfilePage'
import { SupportChatPage } from '@/pages/support/SupportChatPage'
import { SupportPage } from '@/pages/support/SupportPage'
import { UserDetailPage } from '@/pages/users/UserDetailPage'
import { UsersPage } from '@/pages/users/UsersPage'
import { APP_PREFIX } from '@/utils/constants'

function ServerErrorToastBridge() {
  const { pushToast } = useToast()

  useEffect(
    () =>
      onServerError(() => {
        pushToast({
          title: 'Сервис временно недоступен',
          message: 'Не удалось связаться с сервером. Попробуйте повторить позже.',
          tone: 'error',
        })
      }),
    [pushToast],
  )

  return null
}

function RequireAuth() {
  const { isAuthenticated, isBootstrapping } = useAuth()
  const location = useLocation()

  if (isBootstrapping) {
    return <LoadingSpinner fullscreen />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

function RequireStaff() {
  const { user } = useAuth()

  if (user?.status === 'deleted' || (user?.role !== 'MODERATOR' && user?.role !== 'SUPER_ADMIN')) {
    return <Navigate to="/403" replace />
  }

  return <Outlet />
}

function RequireUsableAccount() {
  const { user } = useAuth()

  if (user?.status === 'deleted') {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-code" element={<VerifyCodePage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Route>

      <Route path="/students/:id" element={<StudentProfilePage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/support/:id" element={<SupportChatPage />} />

          <Route element={<RequireUsableAccount />}>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
          </Route>

          <Route element={<RequireStaff />}>
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/my-work" element={<MyWorkPage />} />
            <Route path="/moderation/users" element={<ModerationUsersPage />} />
            <Route path="/moderation/achievements" element={<ModerationAchievementsPage />} />
            <Route path="/moderation/support" element={<ModerationSupportPage />} />
            <Route path="/moderation/support/:id" element={<ModerationSupportChatPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/500" element={<ServerErrorPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <NotificationProvider>
            <BrowserRouter basename={APP_PREFIX}>
              <ServerErrorToastBridge />
              <AppRoutes />
              <ToastViewport />
            </BrowserRouter>
          </NotificationProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
