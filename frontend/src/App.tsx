import { lazy, Suspense, useEffect } from 'react'
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
import { APP_PREFIX } from '@/utils/constants'

// Route-level code splitting: each page ships as its own chunk, so heavy
// libraries (chart.js, pdf.js) load only when their page is opened. Pages use
// named exports, hence the `.then(m => ({ default: ... }))` shim for lazy().
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))
const VerifyCodePage = lazy(() => import('@/pages/auth/VerifyCodePage').then((m) => ({ default: m.VerifyCodePage })))
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })))
const PrivacyPage = lazy(() => import('@/pages/auth/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))
const AchievementsPage = lazy(() => import('@/pages/achievements/AchievementsPage').then((m) => ({ default: m.AchievementsPage })))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const DocumentsPage = lazy(() => import('@/pages/documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })))
const ForbiddenPage = lazy(() => import('@/pages/errors/ForbiddenPage').then((m) => ({ default: m.ForbiddenPage })))
const NotFoundPage = lazy(() => import('@/pages/errors/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))
const ServerErrorPage = lazy(() => import('@/pages/errors/ServerErrorPage').then((m) => ({ default: m.ServerErrorPage })))
const LeaderboardPage = lazy(() => import('@/pages/leaderboard/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })))
const ModerationAchievementsPage = lazy(() => import('@/pages/moderation/ModerationAchievementsPage').then((m) => ({ default: m.ModerationAchievementsPage })))
const ModerationSupportChatPage = lazy(() => import('@/pages/moderation/ModerationSupportChatPage').then((m) => ({ default: m.ModerationSupportChatPage })))
const ModerationSupportPage = lazy(() => import('@/pages/moderation/ModerationSupportPage').then((m) => ({ default: m.ModerationSupportPage })))
const ModerationUsersPage = lazy(() => import('@/pages/moderation/ModerationUsersPage').then((m) => ({ default: m.ModerationUsersPage })))
const MyWorkPage = lazy(() => import('@/pages/my-work/MyWorkPage').then((m) => ({ default: m.MyWorkPage })))
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const StudentProfilePage = lazy(() => import('@/pages/public/StudentProfilePage').then((m) => ({ default: m.StudentProfilePage })))
const SupportChatPage = lazy(() => import('@/pages/support/SupportChatPage').then((m) => ({ default: m.SupportChatPage })))
const SupportPage = lazy(() => import('@/pages/support/SupportPage').then((m) => ({ default: m.SupportPage })))
const UserDetailPage = lazy(() => import('@/pages/users/UserDetailPage').then((m) => ({ default: m.UserDetailPage })))
const UsersPage = lazy(() => import('@/pages/users/UsersPage').then((m) => ({ default: m.UsersPage })))

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
    <Suspense fallback={<LoadingSpinner fullscreen />}>
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
    </Suspense>
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
