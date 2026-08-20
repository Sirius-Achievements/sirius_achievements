import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { authApi } from '@/api/auth'
import {
  clearAuthFlow,
  getAuthFlowEmail,
  getAuthFlowRemainingSeconds,
  getAuthFlowToken,
  isFlowTokenExpired,
  maskEmail,
  saveAuthFlow,
} from '@/utils/authFlow'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/utils/http'

export function VerifyEmailPage() {
  const navigate = useNavigate()
  const { applyAuth } = useAuth()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const queryFlowToken = searchParams.get('flow') ?? ''
  const storedFlowToken = getAuthFlowToken('verify_email')
  const rawFlowToken = useMemo(() => queryFlowToken || storedFlowToken, [queryFlowToken, storedFlowToken])
  const flowExpired = Boolean(rawFlowToken && isFlowTokenExpired(rawFlowToken))
  const flowToken = flowExpired ? '' : rawFlowToken
  const flowEmail = getAuthFlowEmail('verify_email')

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRequestingFreshCode, setIsRequestingFreshCode] = useState(false)
  const [timeLeft, setTimeLeft] = useState(() => getAuthFlowRemainingSeconds('verify_email'))

  useEffect(() => {
    if (!flowToken) {
      return
    }

    saveAuthFlow('verify_email', flowToken, {
      email: flowEmail || undefined,
      resendAvailableAt: Date.now() + timeLeft * 1000,
    })
  }, [flowEmail, flowToken, timeLeft])

  useEffect(() => {
    if (!flowToken) {
      setTimeLeft(0)
      return
    }

    const syncTimer = () => setTimeLeft(getAuthFlowRemainingSeconds('verify_email'))
    syncTimer()
    const timer = window.setInterval(syncTimer, 1000)

    return () => window.clearInterval(timer)
  }, [flowToken])

  const canResend = timeLeft <= 0

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const { data } = await authApi.verifyEmail(flowToken, code)
      clearAuthFlow('verify_email')
      applyAuth(data)
      pushToast({ title: 'Email подтверждён', tone: 'success' })
      navigate('/dashboard')
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось подтвердить email.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async () => {
    try {
      const { data } = await authApi.resendVerifyEmail(flowToken)
      const nextToken = data.flow_token || flowToken

      saveAuthFlow('verify_email', nextToken, {
        email: flowEmail || undefined,
        resendAvailableAt: Date.now() + (data.retry_after ?? 60) * 1000,
      })

      setTimeLeft(data.retry_after ?? 60)
      navigate(`/verify-email?flow=${encodeURIComponent(nextToken)}`, { replace: true })
      pushToast({ title: 'Код отправлен повторно', tone: 'info' })
    } catch (resendError) {
      setError(getErrorMessage(resendError, 'Не удалось отправить код повторно.'))
    }
  }

  const handleRequestFreshCode = async () => {
    if (!flowEmail) {
      navigate('/register')
      return
    }

    setError(null)
    setIsRequestingFreshCode(true)
    try {
      const { data } = await authApi.restartVerifyEmail(flowEmail)
      if (!data.flow_token) {
        throw new Error('Новый процесс подтверждения не создан.')
      }
      saveAuthFlow('verify_email', data.flow_token, {
        email: flowEmail,
        resendAvailableAt: Date.now() + (data.retry_after ?? 60) * 1000,
      })
      setCode('')
      setTimeLeft(data.retry_after ?? 60)
      navigate(`/verify-email?flow=${encodeURIComponent(data.flow_token)}`, { replace: true })
      pushToast({ title: 'Новый код отправлен', message: `Проверьте ${maskEmail(flowEmail)}`, tone: 'info' })
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Не удалось получить новый код.'))
    } finally {
      setIsRequestingFreshCode(false)
    }
  }

  return (
    <div className="theme-auth-card w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
      <div className="text-center mb-6">
        <div className="w-14 h-14 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Подтверждение email</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
          {flowEmail
            ? `Код отправлен на ${maskEmail(flowEmail)}. Проверьте папку «Спам», если письма нет во входящих.`
            : 'Код отправлен на вашу почту. Проверьте папку «Спам». '}
        </p>
      </div>

      {flowExpired ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Срок действия кода истёк</p>
          <p className="mt-1 text-sm text-slate-600">Получите новый код — старая форма больше не активна.</p>
          <button
            type="button"
            onClick={() => void handleRequestFreshCode()}
            disabled={isRequestingFreshCode}
            className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isRequestingFreshCode ? 'Отправляем...' : 'Получить новый код'}
          </button>
        </div>
      ) : !flowToken ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Шаг подтверждения не найден</p>
          <p className="mt-1 text-sm text-slate-600">
            Сначала завершите регистрацию, чтобы получить новый код.
          </p>
          <Link to="/register" className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Вернуться к регистрации
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg text-center">
          {error}
        </div>
      ) : null}

      {flowToken ? <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            placeholder="------"
            maxLength={6}
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            className="w-full px-4 py-3 text-center text-3xl tracking-[0.4em] font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !flowToken}
          className="w-full bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          {isSubmitting ? 'Подтверждаем...' : 'Подтвердить'}
        </button>
      </form> : null}

      {flowToken ? <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={!canResend || !flowToken}
          className={`text-xs font-medium transition-colors ${
            canResend ? 'text-indigo-600 hover:text-indigo-800 cursor-pointer' : 'text-slate-400 cursor-not-allowed'
          }`}
        >
          Отправить код повторно {!canResend ? `(${timeLeft})` : ''}
        </button>
      </div> : null}

      <div className="mt-4 text-center">
        <Link to="/login" className="text-xs text-slate-400 hover:text-indigo-600 transition-colors">
          Уже подтвердили? Войти
        </Link>
      </div>
    </div>
  )
}
