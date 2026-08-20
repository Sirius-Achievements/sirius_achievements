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
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/utils/http'

export function VerifyCodePage() {
  const navigate = useNavigate()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const queryFlowToken = searchParams.get('flow') ?? ''
  const storedFlowToken = getAuthFlowToken('reset_password')
  const rawFlowToken = useMemo(() => queryFlowToken || storedFlowToken, [queryFlowToken, storedFlowToken])
  const flowExpired = Boolean(rawFlowToken && isFlowTokenExpired(rawFlowToken))
  const flowToken = flowExpired ? '' : rawFlowToken
  const flowEmail = getAuthFlowEmail('reset_password')

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRequestingFreshCode, setIsRequestingFreshCode] = useState(false)
  const [timeLeft, setTimeLeft] = useState(() => getAuthFlowRemainingSeconds('reset_password'))

  useEffect(() => {
    if (!flowToken) {
      return
    }

    saveAuthFlow('reset_password', flowToken, {
      email: flowEmail || undefined,
      resendAvailableAt: Date.now() + timeLeft * 1000,
    })
  }, [flowEmail, flowToken, timeLeft])

  useEffect(() => {
    if (!flowToken) {
      setTimeLeft(0)
      return
    }

    const syncTimer = () => setTimeLeft(getAuthFlowRemainingSeconds('reset_password'))
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
      const { data } = await authApi.verifyCode(flowToken, code)
      if (data.verified && data.verified_token) {
        clearAuthFlow('reset_password')
        saveAuthFlow('reset_password_verified', data.verified_token, {
          email: flowEmail || undefined,
        })
        pushToast({ title: 'Код подтверждён', tone: 'success' })
        navigate(`/reset-password?flow=${encodeURIComponent(data.verified_token)}`)
      }
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Код не подошёл.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async () => {
    try {
      const { data } = await authApi.resendCode(flowToken)
      const nextToken = data.flow_token || flowToken

      saveAuthFlow('reset_password', nextToken, {
        email: flowEmail || undefined,
        resendAvailableAt: Date.now() + (data.retry_after ?? 60) * 1000,
      })

      setTimeLeft(data.retry_after ?? 60)
      navigate(`/verify-code?flow=${encodeURIComponent(nextToken)}`, { replace: true })
      pushToast({ title: 'Код отправлен повторно', tone: 'info' })
    } catch (resendError) {
      setError(getErrorMessage(resendError, 'Не удалось отправить код повторно.'))
    }
  }

  const handleRequestFreshCode = async () => {
    if (!flowEmail) {
      navigate('/forgot-password')
      return
    }

    setError(null)
    setIsRequestingFreshCode(true)
    try {
      const { data } = await authApi.forgotPassword(flowEmail)
      if (!data.flow_token) {
        throw new Error('Новый процесс восстановления не создан.')
      }
      saveAuthFlow('reset_password', data.flow_token, {
        email: flowEmail,
        resendAvailableAt: Date.now() + (data.retry_after ?? 60) * 1000,
      })
      setCode('')
      setTimeLeft(data.retry_after ?? 60)
      navigate(`/verify-code?flow=${encodeURIComponent(data.flow_token)}`, { replace: true })
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
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Проверка кода</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
          {flowEmail
            ? `Код отправлен на ${maskEmail(flowEmail)}. Проверьте папку «Спам», если письма нет во входящих.`
            : 'Код отправлен на вашу почту. Письмо может быть в папке «Спам». '}
        </p>
      </div>

      {flowExpired ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Срок действия кода истёк</p>
          <p className="mt-1 text-sm text-slate-600">
            Неактивную форму мы скрыли. Получите новый код и продолжите восстановление.
          </p>
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
            Сначала запросите код для восстановления пароля, чтобы продолжить.
          </p>
          <Link to="/forgot-password" className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Запросить новый код
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
          {isSubmitting ? 'Проверяем...' : 'Подтвердить'}
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
    </div>
  )
}
