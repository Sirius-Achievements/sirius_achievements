import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { authApi } from '@/api/auth'
import {
  clearAuthFlow,
  getAuthFlowEmail,
  getAuthFlowRemainingSeconds,
  hasStoredAuthFlow,
  maskEmail,
  saveAuthFlow,
} from '@/utils/authFlow'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/utils/http'

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()

  const hasPendingResetFlow = hasStoredAuthFlow('reset_password')
  const hasVerifiedResetFlow = hasStoredAuthFlow('reset_password_verified')
  const pendingResetEmail = getAuthFlowEmail('reset_password') || getAuthFlowEmail('reset_password_verified')
  const pendingResetTimeLeft = getAuthFlowRemainingSeconds('reset_password')
  const initialEmail = useMemo(
    () => searchParams.get('email')?.trim() || pendingResetEmail || '',
    [pendingResetEmail, searchParams]
  )

  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [restartRequested, setRestartRequested] = useState(false)
  const [restartConfirmed, setRestartConfirmed] = useState(false)
  const hasActiveFlow = !restartConfirmed && (hasPendingResetFlow || hasVerifiedResetFlow)

  const handleRestart = () => {
    clearAuthFlow('reset_password')
    clearAuthFlow('reset_password_verified')
    setRestartConfirmed(true)
    setRestartRequested(false)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const normalizedEmail = email.trim()
      const { data } = await authApi.forgotPassword(normalizedEmail)
      if (data.flow_token) {
        saveAuthFlow('reset_password', data.flow_token, {
          email: normalizedEmail,
          resendAvailableAt: Date.now() + (data.retry_after ?? 60) * 1000,
        })
        navigate(`/verify-code?flow=${encodeURIComponent(data.flow_token)}`)
      } else {
        pushToast({
          title: 'Письмо отправлено',
          message: data.message ?? 'Если аккаунт существует, код уже в почте.',
          tone: 'info',
        })
      }
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось запустить восстановление пароля.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="theme-auth-card w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Забыли пароль?</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
          Введите ваш email, и мы отправим код для сброса.
        </p>
      </div>

      {!restartConfirmed && hasVerifiedResetFlow ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Код уже подтверждён</p>
          <p className="mt-1 text-sm text-slate-600">
            {pendingResetEmail
              ? `Для ${maskEmail(pendingResetEmail)} можно сразу задать новый пароль.`
              : 'Можно сразу перейти к установке нового пароля.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/reset-password')}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Перейти к новому паролю
          </button>
        </div>
      ) : null}

      {!restartConfirmed && !hasVerifiedResetFlow && hasPendingResetFlow ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Код для сброса уже отправлен</p>
          <p className="mt-1 text-sm text-slate-600">
            {pendingResetEmail ? `Код отправлен на ${maskEmail(pendingResetEmail)}. ` : 'Код для сброса уже отправлен. '}
            {pendingResetTimeLeft > 0
              ? `Повторная отправка будет доступна через ${pendingResetTimeLeft} сек.`
              : 'Можно сразу перейти к вводу кода.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/verify-code')}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Продолжить ввод кода
          </button>
        </div>
      ) : null}

      {hasActiveFlow ? (
        <div className="mb-5 text-center">
          {!restartRequested ? (
            <button
              type="button"
              onClick={() => setRestartRequested(true)}
              className="text-xs text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-700"
            >
              Начать восстановление заново
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
              <p className="text-sm font-semibold text-slate-800">Отменить текущий процесс?</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Текущий код перестанет использоваться в интерфейсе. Новый код потребуется запросить повторно.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={handleRestart} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white">
                  Да, начать заново
                </button>
                <button type="button" onClick={() => setRestartRequested(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg text-center">
          {error}
        </div>
      ) : null}

      {!hasActiveFlow ? <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            Email адрес
          </label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          {isSubmitting ? 'Отправляем...' : 'Отправить код'}
        </button>
      </form> : null}

      <div className="mt-6 text-center text-sm text-slate-500">
        <Link
          to="/login"
          className="text-indigo-600 font-medium hover:underline inline-flex items-center justify-center"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Вернуться ко входу
        </Link>
      </div>
    </div>
  )
}
