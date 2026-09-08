import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { clearAllAuthFlows, getAuthFlowEmail, getAuthFlowRemainingSeconds, hasStoredAuthFlow } from '@/utils/authFlow'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/utils/http'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { pushToast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasPendingVerifyEmail = hasStoredAuthFlow('verify_email')
  const hasPendingResetPassword = hasStoredAuthFlow('reset_password')
  const hasPendingVerifiedReset = hasStoredAuthFlow('reset_password_verified')
  const verifyEmailHint = getAuthFlowEmail('verify_email')
  const resetEmailHint = getAuthFlowEmail('reset_password') || getAuthFlowEmail('reset_password_verified')
  const verifyEmailTimeLeft = getAuthFlowRemainingSeconds('verify_email')
  const resetTimeLeft = getAuthFlowRemainingSeconds('reset_password')
  const forgotPasswordHref = email.trim()
    ? `/forgot-password?email=${encodeURIComponent(email.trim())}`
    : '/forgot-password'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await login(email, password)
      clearAllAuthFlows()
      pushToast({
        title: 'Вход выполнен',
        message: 'Перенаправляем в личный кабинет.',
        tone: 'success',
      })
      navigate('/dashboard')
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось войти. Проверьте email и пароль.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="theme-auth-card w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
      <div className="mb-8">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-strong)]">
          Личный кабинет
        </p>
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Вход в систему</h1>
        <p className="mt-3 text-sm text-slate-500">
          Впервые здесь?{' '}
          <Link to="/register" className="font-semibold text-[var(--color-accent-strong)] hover:underline">
            Регистрация
          </Link>
        </p>
      </div>

      {hasPendingVerifyEmail ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Подтверждение email уже начато</p>
          <p className="mt-1 text-sm text-slate-600">
            {verifyEmailHint ? `Код был отправлен на ${verifyEmailHint}. ` : 'Код подтверждения уже был отправлен. '}
            {verifyEmailTimeLeft > 0
              ? `Повторная отправка будет доступна через ${verifyEmailTimeLeft} сек.`
              : 'Можно сразу продолжить ввод кода.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/verify-email')}
            className="mt-3 text-sm font-medium text-[var(--color-accent-strong)] hover:underline"
          >
            Продолжить подтверждение
          </button>
        </div>
      ) : null}

      {hasPendingVerifiedReset ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Сброс пароля уже подтверждён</p>
          <p className="mt-1 text-sm text-slate-600">
            {resetEmailHint ? `Для ${resetEmailHint} можно сразу задать новый пароль.` : 'Можно сразу задать новый пароль.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/reset-password')}
            className="mt-3 text-sm font-medium text-[var(--color-accent-strong)] hover:underline"
          >
            Перейти к новому паролю
          </button>
        </div>
      ) : null}

      {!hasPendingVerifiedReset && hasPendingResetPassword ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Восстановление пароля уже начато</p>
          <p className="mt-1 text-sm text-slate-600">
            {resetEmailHint ? `Код был отправлен на ${resetEmailHint}. ` : 'Код для сброса уже был отправлен. '}
            {resetTimeLeft > 0
              ? `Повторная отправка будет доступна через ${resetTimeLeft} сек.`
              : 'Можно сразу продолжить ввод кода.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/verify-code')}
            className="mt-3 text-sm font-medium text-[var(--color-accent-strong)] hover:underline"
          >
            Продолжить восстановление
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg text-center">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            Email
          </label>
          <input
            type="email"
            name="email"
            id="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-[var(--color-accent-soft-strong)] focus:border-[var(--color-accent)] outline-none transition-all"
          />
        </div>

        <div>
          <div className="mb-1.5">
            <label
              htmlFor="password"
              className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider"
            >
              Пароль
            </label>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              id="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full px-4 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-[var(--color-accent-soft-strong)] focus:border-[var(--color-accent)] outline-none transition-all"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              <svg
                className={`w-5 h-5 eye-open ${showPassword ? 'hidden' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              <svg
                className={`w-5 h-5 eye-closed ${showPassword ? '' : 'hidden'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? 'Входим...' : 'Войти'}
        </button>

        <div className="text-center">
          <Link
            to={forgotPasswordHref}
            className="text-xs font-semibold text-[var(--color-accent-strong)] hover:underline"
          >
            Восстановить пароль
          </Link>
        </div>
      </form>

      <div className="mt-7 border-t border-slate-200 pt-5 text-center text-xs leading-relaxed text-slate-400">
        <Link
          to="/privacy"
          className="font-medium text-[var(--color-text-muted)] hover:text-[var(--color-accent-strong)]"
        >
          Политика конфиденциальности
        </Link>
      </div>

      <div
        className="mt-6 text-center text-[10px] uppercase tracking-wider text-slate-400"
        title={`Build time: ${__APP_BUILD_TIME__}`}
      >
        {__APP_VERSION__}
      </div>
    </div>
  )
}
