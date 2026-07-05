import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { authApi } from '@/api/auth'
import { useToast } from '@/hooks/useToast'
import { EducationLevel } from '@/types/enums'
import { getAuthFlowEmail, getAuthFlowRemainingSeconds, hasStoredAuthFlow, saveAuthFlow } from '@/utils/authFlow'
import { getErrorMessage } from '@/utils/http'
import { courseLabel, coursesForEducationLevel, groupsForEducationLevel } from '@/utils/labels'

function stripEmoji(value: string): string {
  return value.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s{2,}/g, ' ')
}

const EYE_CLOSED_PATH =
  'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21'

export function RegisterPage() {
  const navigate = useNavigate()
  const { pushToast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    education_level: '',
    course: '',
    group: '',
    password: '',
    password_confirm: '',
  })

  const hasPendingVerifyFlow = hasStoredAuthFlow('verify_email')
  const pendingVerifyEmail = getAuthFlowEmail('verify_email')
  const pendingVerifyTimeLeft = getAuthFlowRemainingSeconds('verify_email')

  const courseOptions = useMemo(() => coursesForEducationLevel(form.education_level), [form.education_level])
  const groups = useMemo(
    () => groupsForEducationLevel(form.education_level, form.course),
    [form.course, form.education_level],
  )

  const hasLength = form.password.length >= 8
  const hasUpper = /[A-ZА-Я]/.test(form.password)
  const hasNumber = /[0-9]/.test(form.password)
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]+/.test(form.password)
  const strengthScore = [hasLength, hasUpper, hasNumber, hasSpecial].filter(Boolean).length
  const strengthPercent = strengthScore * 25
  const strengthColor =
    strengthScore <= 1 ? 'bg-red-500' : strengthScore <= 3 ? 'bg-yellow-500' : 'bg-green-500'

  const handleChange = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    const sanitized = (key === 'first_name' || key === 'last_name') ? stripEmoji(value as string) as (typeof form)[K] : value
    setForm((current) => ({ ...current, [key]: sanitized }))
  }

  const handleEducationChange = (value: string) => {
    setForm((current) => ({
      ...current,
      education_level: value,
      course: '',
      group: '',
    }))
  }

  const handleCourseChange = (value: string) => {
    setForm((current) => ({
      ...current,
      course: value,
      group: '',
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (strengthScore < 4) {
      setError('Пароль должен соответствовать всем требованиям безопасности.')
      return
    }

    setIsSubmitting(true)

    try {
      const email = form.email.trim()
      const { data } = await authApi.register({
        ...form,
        email,
        education_level: form.education_level as EducationLevel,
        course: Number(form.course),
      })

      if (data.flow_token) {
        saveAuthFlow('verify_email', data.flow_token, {
          email,
          resendAvailableAt: Date.now() + (data.retry_after ?? 60) * 1000,
        })

        pushToast({
          title: 'Код отправлен',
          message: 'Подтвердите email, чтобы завершить регистрацию.',
          tone: 'success',
        })
        navigate(`/verify-email?flow=${encodeURIComponent(data.flow_token)}`)
      } else {
        pushToast({
          title: 'Регистрация завершена',
          message: data.message ?? 'Проверьте почту для подтверждения аккаунта.',
          tone: 'info',
        })
      }
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось создать аккаунт.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="theme-auth-card w-full max-w-md bg-surface rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">
      <div className="text-center mb-4">
        <h1 className="text-xl font-bold text-slate-800 tracking-tight">Создать аккаунт</h1>
        <p className="text-sm text-slate-500 mt-0.5">Присоединяйтесь к платформе</p>
      </div>

      {hasPendingVerifyFlow ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-slate-800">Подтверждение регистрации уже начато</p>
          <p className="mt-1 text-sm text-slate-600">
            {pendingVerifyEmail
              ? `Код отправлен на ${pendingVerifyEmail}. `
              : 'Код подтверждения уже отправлен. '}
            {pendingVerifyTimeLeft > 0
              ? `Повторная отправка будет доступна через ${pendingVerifyTimeLeft} сек.`
              : 'Можно сразу перейти к вводу кода.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/verify-email')}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Продолжить ввод кода
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg text-center">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Имя
            </label>
            <input
              type="text"
              name="first_name"
              required
              value={form.first_name}
              onChange={(event) => handleChange('first_name', event.target.value)}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Фамилия
            </label>
            <input
              type="text"
              name="last_name"
              required
              value={form.last_name}
              onChange={(event) => handleChange('last_name', event.target.value)}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            value={form.email}
            onChange={(event) => handleChange('email', event.target.value)}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Обучение
            </label>
            <select
              name="education_level"
              value={form.education_level}
              onChange={(event) => handleEducationChange(event.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
            >
              <option value="" disabled>
                Выберите...
              </option>
              {Object.values(EducationLevel).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Курс
            </label>
            <select
              name="course"
              value={form.course}
              onChange={(event) => handleCourseChange(event.target.value)}
              disabled={!form.education_level}
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Курс...
              </option>
              {courseOptions.map((item) => (
                <option key={item} value={item}>
                  {courseLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Группа
            </label>
            <select
              name="group"
              value={form.group}
              onChange={(event) => handleChange('group', event.target.value)}
              disabled={!form.education_level || !form.course}
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Группа...
              </option>
              {groups.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Пароль
          </label>
          <div className="relative mb-2">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              id="regPassword"
              value={form.password}
              onChange={(event) => handleChange('password', event.target.value)}
              required
              className="w-full px-4 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_CLOSED_PATH} />
              </svg>
            </button>
          </div>

          <div className="h-1.5 w-full bg-slate-100 rounded-full mb-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ease-out ${strengthColor}`}
              style={{ width: `${strengthPercent}%` }}
            />
          </div>

          <ul className="grid grid-cols-2 gap-x-2 text-[11px] text-slate-500">
            <li className={`flex items-center ${hasLength ? 'text-green-600 font-medium' : ''}`}>
              {hasLength ? (
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="mr-1.5 opacity-50">•</span>
              )}
              8+ символов
            </li>
            <li className={`flex items-center ${hasUpper ? 'text-green-600 font-medium' : ''}`}>
              {hasUpper ? (
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="mr-1.5 opacity-50">•</span>
              )}
              Заглавная буква
            </li>
            <li className={`flex items-center ${hasNumber ? 'text-green-600 font-medium' : ''}`}>
              {hasNumber ? (
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="mr-1.5 opacity-50">•</span>
              )}
              Цифра
            </li>
            <li className={`flex items-center ${hasSpecial ? 'text-green-600 font-medium' : ''}`}>
              {hasSpecial ? (
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="mr-1.5 opacity-50">•</span>
              )}
              Спецсимвол
            </li>
          </ul>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Подтвердите пароль
          </label>
          <div className="relative">
            <input
              type={showPasswordConfirm ? 'text' : 'password'}
              name="password_confirm"
              id="regPasswordConfirm"
              value={form.password_confirm}
              onChange={(event) => handleChange('password_confirm', event.target.value)}
              required
              className="w-full px-4 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShowPasswordConfirm((current) => !current)}
              aria-label={showPasswordConfirm ? 'Скрыть пароль' : 'Показать пароль'}
            >
              <svg
                className={`w-5 h-5 eye-open ${showPasswordConfirm ? 'hidden' : ''}`}
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
                className={`w-5 h-5 eye-closed ${showPasswordConfirm ? '' : 'hidden'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={EYE_CLOSED_PATH} />
              </svg>
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || strengthScore < 4}
          className={`mt-3 w-full rounded-lg py-2 text-sm font-medium shadow-sm transition-colors ${
            isSubmitting || strengthScore < 4
              ? 'cursor-not-allowed bg-slate-300 text-slate-500'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {isSubmitting ? 'Регистрируем...' : 'Зарегистрироваться'}
        </button>
      </form>

      <p className="mt-3 text-center text-[11px] text-slate-400">
        Нажимая «Зарегистрироваться», вы соглашаетесь с{' '}
        <Link to="/privacy" className="text-indigo-600 hover:underline">
          Политикой конфиденциальности
        </Link>
      </p>

      <div className="mt-3 text-center text-sm text-slate-500">
        Уже есть аккаунт?{' '}
        <Link to="/login" className="text-indigo-600 font-medium hover:underline">
          Войти
        </Link>
      </div>
    </div>
  )
}
