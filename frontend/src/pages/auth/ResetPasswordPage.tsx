import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { authApi } from '@/api/auth'
import { PasswordRequirements } from '@/components/auth/PasswordRequirements'
import { useToast } from '@/hooks/useToast'
import {
  clearAuthFlow,
  getAuthFlowEmail,
  getAuthFlowToken,
  hasStoredAuthFlow,
  maskEmail,
  saveAuthFlow,
} from '@/utils/authFlow'
import { getErrorMessage } from '@/utils/http'
import { isPasswordStrong } from '@/utils/password'

const EYE_OPEN_PATH = 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'
const EYE_FRAME_PATH =
  'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z'
const EYE_CLOSED_PATH =
  'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const queryFlowToken = searchParams.get('flow') ?? ''
  const storedVerifiedFlowToken = getAuthFlowToken('reset_password_verified')
  const flowToken = useMemo(
    () => queryFlowToken || storedVerifiedFlowToken,
    [queryFlowToken, storedVerifiedFlowToken]
  )
  const flowEmail = getAuthFlowEmail('reset_password_verified') || getAuthFlowEmail('reset_password')
  const hasPendingCodeVerification = hasStoredAuthFlow('reset_password')

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const passwordIsStrong = isPasswordStrong(password)
  const passwordsMatch = password === passwordConfirm

  useEffect(() => {
    if (!flowToken) {
      return
    }

    saveAuthFlow('reset_password_verified', flowToken, {
      email: flowEmail || undefined,
    })
  }, [flowEmail, flowToken])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!passwordIsStrong) {
      setError('Пароль должен соответствовать всем требованиям безопасности.')
      return
    }
    if (!passwordsMatch) {
      setError('Пароли не совпадают.')
      return
    }
    setIsSubmitting(true)

    try {
      await authApi.resetPassword(flowToken, password, passwordConfirm)
      clearAuthFlow('reset_password_verified')
      clearAuthFlow('reset_password')
      pushToast({
        title: 'Пароль обновлён',
        message: 'Все старые сессии завершены. Теперь можно войти с новым паролем.',
        tone: 'success',
      })
      navigate('/login')
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось обновить пароль.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="theme-auth-card w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Новый пароль</h1>
        <p className="mt-1 text-sm text-slate-500">Придумайте надёжный пароль. После сохранения все старые сессии будут завершены.</p>
      </div>

      {!flowToken && hasPendingCodeVerification ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Сначала подтвердите код из письма</p>
          <p className="mt-1 text-sm text-slate-600">
            {flowEmail
              ? `Для ${maskEmail(flowEmail)} уже есть активный шаг подтверждения кода.`
              : 'Шаг подтверждения кода уже начат.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/verify-code')}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Перейти к вводу кода
          </button>
        </div>
      ) : null}

      {!flowToken ? (
        <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
          Токен смены пароля не найден.
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Новый пароль
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 pr-10 text-sm text-slate-800 outline-none transition-all focus:border-indigo-600 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              <svg className={`h-5 w-5 ${showPassword ? 'hidden' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_OPEN_PATH} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_FRAME_PATH} />
              </svg>
              <svg className={`h-5 w-5 ${showPassword ? '' : 'hidden'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_CLOSED_PATH} />
              </svg>
            </button>
          </div>
          <PasswordRequirements password={password} />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Подтвердите пароль
          </label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 pr-10 text-sm text-slate-800 outline-none transition-all focus:border-indigo-600 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={showConfirm ? 'Скрыть пароль' : 'Показать пароль'}
            >
              <svg className={`h-5 w-5 ${showConfirm ? 'hidden' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_OPEN_PATH} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_FRAME_PATH} />
              </svg>
              <svg className={`h-5 w-5 ${showConfirm ? '' : 'hidden'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_CLOSED_PATH} />
              </svg>
            </button>
          </div>
          {passwordConfirm && !passwordsMatch ? (
            <p className="mt-1 text-xs text-red-600">Пароли не совпадают.</p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
          В целях безопасности после смены пароля будут завершены все сеансы на других устройствах.
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !flowToken || !passwordIsStrong || !passwordsMatch}
          className="mt-2 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? 'Сохраняем...' : 'Сохранить пароль'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        <Link to="/login" className="text-indigo-600 font-medium hover:underline">
          Вернуться ко входу
        </Link>
      </div>
    </div>
  )
}
