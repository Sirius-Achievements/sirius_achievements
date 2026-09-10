import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart, registerables } from 'chart.js'
import Cropper, { DEFAULT_TEMPLATE } from 'cropperjs'
import { profileApi, type ProfileResponse } from '@/api/profile'
import { usersApi } from '@/api/users'
import { PasswordRequirements } from '@/components/auth/PasswordRequirements'
import { SeasonHallOfFame } from '@/components/profile/SeasonHallOfFame'
import { DocumentPreviewImage } from '@/components/ui/DocumentPreviewImage'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useToast } from '@/hooks/useToast'
import { UserRole } from '@/types/enums'
import { isImageFile, isPdfFile } from '@/utils/documentPreview'
import { getErrorMessage } from '@/utils/http'
import { courseLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'
import { getChartThemeColors } from '@/utils/chartTheme'
import { createAchievementPortraitPlugin } from '@/utils/achievementPortrait'

Chart.register(...registerables)

const AVATAR_CROPPER_TEMPLATE = DEFAULT_TEMPLATE.replace(
  '<cropper-selection initial-coverage="0.5" movable resizable>',
  '<cropper-selection initial-coverage="0.75" aspect-ratio="1" movable resizable>',
)

function stripEmoji(value: string): string {
  return value.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s{2,}/g, ' ')
}

type ProfileTab = 'overview' | 'documents' | 'analytics' | 'settings' | 'security'

function docStatusBadge(status: string, points?: number) {
  switch (status) {
    case 'approved':
      return (
        <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-green-500 text-white shadow-sm">
          {points ?? 0} б.
        </span>
      )
    case 'revision':
      return (
        <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-yellow-500 text-white shadow-sm">
          Доработка
        </span>
      )
    case 'rejected':
      return (
        <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500 text-white shadow-sm">
          Отклонено
        </span>
      )
    default:
      return (
        <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-500 text-white shadow-sm">
          Проверка
        </span>
      )
  }
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, refreshProfile, logout, setCurrentUser } = useAuth()
  const { theme } = useTheme()
  const chartColors = getChartThemeColors(theme)
  const { pushToast } = useToast()

  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => user?.role === UserRole.STUDENT ? 'overview' : 'settings')

  // Profile form
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [publicVisibility, setPublicVisibility] = useState<Record<string, boolean>>({})
  const initialProfileRef = useRef({ firstName: '', lastName: '', phoneNumber: '', publicVisibility: '{}' })
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Avatar + cropper
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const imageToCropRef = useRef<HTMLImageElement>(null)
  const cropperRef = useRef<Cropper | null>(null)
  const avatarBlobUrlRef = useRef<string | null>(null)
  const cropSourceUrlRef = useRef<string | null>(null)
  const [showCropModal, setShowCropModal] = useState(false)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null)
  const [isCropperReady, setIsCropperReady] = useState(false)
  const [croppedFile, setCroppedFile] = useState<File | null>(null)

  // AI Resume
  const [isGeneratingResume, setIsGeneratingResume] = useState(false)
  const [resumeText, setResumeText] = useState('')
  const [canGenerate, setCanGenerate] = useState(false)
  const [generateReason, setGenerateReason] = useState('')

  // Password change
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [passwordFlowId, setPasswordFlowId] = useState('')
  const [passwordVerifiedFlowId, setPasswordVerifiedFlowId] = useState('')
  const [passwordCode, setPasswordCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  // Charts
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstanceRef = useRef<Chart | null>(null)
  const radarChartRef = useRef<HTMLCanvasElement>(null)
  const radarInstanceRef = useRef<Chart | null>(null)
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
  const [analyticsSeason, setAnalyticsSeason] = useState('current')

  const isStudent = user?.role === UserRole.STUDENT

  const revokeAvatarBlobUrl = useCallback(() => {
    if (avatarBlobUrlRef.current) {
      URL.revokeObjectURL(avatarBlobUrlRef.current)
      avatarBlobUrlRef.current = null
    }
  }, [])

  const revokeCropSourceUrl = useCallback(() => {
    if (cropSourceUrlRef.current) {
      URL.revokeObjectURL(cropSourceUrlRef.current)
      cropSourceUrlRef.current = null
    }
  }, [])

  const closeCropModal = useCallback(() => {
    setShowCropModal(false)
    setCropSourceUrl(null)
    setIsCropperReady(false)
    revokeCropSourceUrl()
  }, [revokeCropSourceUrl])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await profileApi.get(analyticsSeason)
      setProfile(data)
      setFirstName(data.user.first_name)
      setLastName(data.user.last_name)
      setPhoneNumber(data.user.phone_number ?? '')
      setPublicVisibility(data.public_visibility ?? {})
      initialProfileRef.current = {
        firstName: data.user.first_name,
        lastName: data.user.last_name,
        phoneNumber: data.user.phone_number ?? '',
        publicVisibility: JSON.stringify(data.public_visibility ?? {}),
      }
      revokeAvatarBlobUrl()
      setAvatarPreviewUrl(data.user.avatar_path ? buildMediaUrl(data.user.avatar_path, `${Date.now()}`) : null)
      setResumeText(data.user.resume_text ?? '')
      setCanGenerate(data.can_generate)
      setGenerateReason(data.generate_reason ?? '')
    } catch (e) {
      setError(getErrorMessage(e, 'Не удалось загрузить профиль.'))
    } finally {
      setIsLoading(false)
    }
  }, [analyticsSeason, revokeAvatarBlobUrl])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return () => {
      revokeAvatarBlobUrl()
      revokeCropSourceUrl()
    }
  }, [revokeAvatarBlobUrl, revokeCropSourceUrl])

  const hasUnsavedProfileChanges = Boolean(
    croppedFile
    || firstName !== initialProfileRef.current.firstName
    || lastName !== initialProfileRef.current.lastName
    || phoneNumber !== initialProfileRef.current.phoneNumber
    || JSON.stringify(publicVisibility) !== initialProfileRef.current.publicVisibility
  )

  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedProfileChanges) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeave)
    return () => window.removeEventListener('beforeunload', warnBeforeLeave)
  }, [hasUnsavedProfileChanges])

  // Chart init
  useEffect(() => {
    if (!profile || !profile.has_chart_data || activeTab !== 'analytics' || !chartRef.current || !isStudent) return
    if (chartInstanceRef.current) chartInstanceRef.current.destroy()

    const font = { family: "'Inter', system-ui, sans-serif", size: 11 }
    const colors = getChartThemeColors(theme)
    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: profile.chart_labels,
        datasets: [
          {
            label: 'Баллы (накопительно)',
            data: profile.chart_cumulative,
            borderColor: colors.accent,
            backgroundColor: colors.accentSoft,
            fill: true,
            borderWidth: 2.5,
            tension: 0.35,
            pointBackgroundColor: colors.pointBackground,
            pointBorderColor: colors.accent,
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
            yAxisID: 'y',
          },
          {
            label: 'Баллы за месяц',
            data: profile.chart_points,
            borderColor: colors.accentStrong,
            backgroundColor: colors.accentStrongSoft,
            fill: true,
            borderWidth: 2,
            borderDash: [5, 3],
            tension: 0.35,
            pointBackgroundColor: colors.pointBackground,
            pointBorderColor: colors.accentStrong,
            pointBorderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            yAxisID: 'y',
          },
          {
            label: 'Загрузки',
            data: profile.chart_uploads,
            borderColor: colors.accentMuted,
            backgroundColor: colors.accentMutedSoft,
            fill: true,
            borderWidth: 2,
            tension: 0.35,
            pointBackgroundColor: colors.pointBackground,
            pointBorderColor: colors.accentMuted,
            pointBorderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font, color: colors.textMuted, usePointStyle: true, pointStyle: 'circle', padding: 20, boxWidth: 8, boxHeight: 8 },
          },
          tooltip: {
            backgroundColor: colors.tooltip,
            titleFont: { ...font, weight: 'bold' },
            bodyFont: font,
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            boxPadding: 4,
            callbacks: {
              label: (ctx) => {
                if (ctx.datasetIndex === 2) return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y + ' шт.'
                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y + ' б.'
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            position: 'left',
            grid: { color: colors.grid },
            ticks: { font, color: colors.textFaint },
            title: { display: true, text: 'Баллы', font: { ...font, size: 10 }, color: colors.textFaint },
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { font, color: colors.accentMuted, stepSize: 1 },
            title: { display: true, text: 'Документы', font: { ...font, size: 10 }, color: colors.accentMuted },
          },
          x: {
            grid: { display: false },
            ticks: { font, color: colors.textMuted },
          },
        },
      },
    })

    return () => {
      chartInstanceRef.current?.destroy()
      chartInstanceRef.current = null
    }
  }, [activeTab, profile, isStudent, theme])

  // Radar chart by category (approved docs) — one dataset per category, toggle support
  const RADAR_CATS = ['Спорт', 'Наука', 'Искусство', 'Волонтёрство', 'Хакатон', 'Патриотизм', 'Проекты', 'Другое']
  useEffect(() => {
    if (!profile || !isStudent || activeTab !== 'analytics' || !radarChartRef.current) return
    const pointsMap: Record<string, number> = {}
    for (const cat of RADAR_CATS) pointsMap[cat] = 0
    for (const doc of profile.analytics_docs ?? []) {
      if (doc.category && doc.category in pointsMap) {
        pointsMap[doc.category] = (pointsMap[doc.category] ?? 0) + (doc.points ?? 0)
      }
    }
    const font = { family: "'Inter', system-ui, sans-serif", size: 10 }
    const maxVal = Math.max(1, ...RADAR_CATS.map((c) => pointsMap[c] ?? 0))
    const colors = getChartThemeColors(theme)
    const renderedValues = RADAR_CATS.map((cat) => hiddenCats.has(cat) ? 0 : (pointsMap[cat] ?? 0))

    radarInstanceRef.current?.destroy()
    radarInstanceRef.current = new Chart(radarChartRef.current, {
      type: 'radar',
      plugins: [createAchievementPortraitPlugin(renderedValues, { border: colors.accent, background: colors.accentSoft })],
      data: {
        labels: RADAR_CATS,
        datasets: [{
          label: 'Достижения',
          data: renderedValues,
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          fill: false,
          showLine: false,
          spanGaps: false,
          tension: 0,
          borderWidth: 0,
          pointBackgroundColor: colors.accentStrong,
          pointBorderColor: colors.pointBackground,
          pointBorderWidth: 1,
          // Zero vertices overlap into one stable centre marker.  Keep it
          // visible even when the corresponding chips are disabled.
          pointRadius: RADAR_CATS.map(() => 3),
          pointHoverRadius: RADAR_CATS.map(() => 5),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.tooltip,
            titleFont: { ...font, weight: 'bold' as const },
            bodyFont: font,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.r
                return v > 0 ? ` ${ctx.label}: ${v} б.` : ''
              },
            },
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            ticks: { font, color: colors.textFaint, backdropColor: 'transparent', stepSize: Math.max(1, Math.ceil(maxVal / 4)) },
            pointLabels: { font: { ...font, size: 11 }, color: colors.textMuted },
            grid: { color: colors.grid },
            angleLines: { color: colors.grid },
          },
        },
      },
    })
    return () => {
      radarInstanceRef.current?.destroy()
      radarInstanceRef.current = null
    }
  }, [activeTab, profile, isStudent, hiddenCats, theme])

  // Cropper init when modal opens
  useEffect(() => {
    if (!showCropModal || !imageToCropRef.current || !cropSourceUrl) return
    const image = imageToCropRef.current
    let inst: Cropper | null = null
    const initCropper = () => {
      inst?.destroy()
      inst = new Cropper(image, { template: AVATAR_CROPPER_TEMPLATE })
      cropperRef.current = inst
      requestAnimationFrame(() => setIsCropperReady(Boolean(inst?.getCropperSelection())))
    }

    setIsCropperReady(false)
    if (image.complete && image.naturalWidth > 0) {
      initCropper()
    } else {
      image.addEventListener('load', initCropper, { once: true })
    }

    return () => {
      image.removeEventListener('load', initCropper)
      inst?.destroy()
      cropperRef.current = null
      setIsCropperReady(false)
    }
  }, [cropSourceUrl, showCropModal])

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
    if (!allowedTypes.includes(file.type)) {
      pushToast({ title: 'Разрешены JPG, PNG, WEBP.', tone: 'error' })
      e.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      pushToast({ title: 'Файл слишком большой (до 2 МБ).', tone: 'error' })
      e.target.value = ''
      return
    }
    const url = URL.createObjectURL(file)
    revokeCropSourceUrl()
    cropSourceUrlRef.current = url
    setCropSourceUrl(url)
    setIsCropperReady(false)
    setShowCropModal(true)
    e.target.value = ''
  }

  const handleCropSave = async () => {
    const cropper = cropperRef.current
    if (!cropper) return
    const selection = cropper.getCropperSelection()
    if (!selection) return
    const canvas = await selection.$toCanvas({ width: 800, height: 800 })
    canvas.toBlob((blob: Blob | null) => {
      if (!blob) return
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      const previewUrl = URL.createObjectURL(blob)
      revokeAvatarBlobUrl()
      avatarBlobUrlRef.current = previewUrl
      setCroppedFile(file)
      setAvatarPreviewUrl(previewUrl)
      closeCropModal()
    }, 'image/jpeg')
  }

  const handleProfileSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSavingProfile(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('first_name', firstName)
      formData.append('last_name', lastName)
      formData.append('phone_number', phoneNumber)
      formData.append('public_visibility', JSON.stringify(publicVisibility))
      if (croppedFile) formData.append('avatar', croppedFile)
      const { data } = await profileApi.update(formData)
      setCurrentUser(data.user)
      setProfile((current) => (current ? { ...current, user: data.user } : current))
      revokeAvatarBlobUrl()
      setAvatarPreviewUrl(data.user.avatar_path ? buildMediaUrl(data.user.avatar_path, `${Date.now()}`) : null)
      await refreshProfile()
      setCroppedFile(null)
      pushToast({ title: 'Профиль обновлён', tone: 'success' })
      await load()
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось обновить профиль.'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleGenerateResume = async () => {
    if (!user) return
    setIsGeneratingResume(true)
    try {
      const { data } = await usersApi.generateResume(user.id)
      if (data.resume) {
        setResumeText(data.resume)
        pushToast({ title: 'Резюме успешно обновлено', tone: 'success' })
      }
      await load()
      if (data.can_generate !== undefined) {
        setCanGenerate(data.can_generate)
        setGenerateReason(data.reason ?? '')
      }
    } catch (err) {
      pushToast({ title: getErrorMessage(err, 'Ошибка при генерации резюме'), tone: 'error' })
    } finally {
      setIsGeneratingResume(false)
    }
  }

  const startResendCooldown = () => {
    setResendCooldown(60)
    const timer = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const handleSendPasswordCode = async () => {
    setIsSendingCode(true)
    setError(null)
    try {
      const { data } = await profileApi.sendPasswordCode()
      setPasswordFlowId(data.flow_id)
      setPasswordVerifiedFlowId('')
      setPasswordCode('')
      setNewPassword('')
      setConfirmPassword('')
      startResendCooldown()
      pushToast({ title: 'Код отправлен', message: 'Проверьте почту.', tone: 'success' })
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось отправить код.'))
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleVerifyPasswordCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsVerifyingCode(true)
    setError(null)
    try {
      const { data } = await profileApi.verifyPasswordCode(passwordFlowId, passwordCode)
      setPasswordVerifiedFlowId(data.flow_id)
      pushToast({ title: 'Код подтверждён', tone: 'success' })
    } catch (err) {
      setError(getErrorMessage(err, 'Неверный код.'))
    } finally {
      setIsVerifyingCode(false)
    }
  }

  const handleResendPasswordCode = async () => {
    setIsSendingCode(true)
    try {
      const { data } = await profileApi.resendPasswordCode(passwordFlowId)
      setPasswordFlowId(data.flow_id)
      startResendCooldown()
      pushToast({ title: 'Код отправлен повторно', tone: 'success' })
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось отправить код повторно.'))
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsResettingPassword(true)
    setError(null)
    try {
      await profileApi.resetPassword(passwordVerifiedFlowId, newPassword, confirmPassword)
      await logout()
      pushToast({ title: 'Пароль изменён', message: 'Войдите снова.', tone: 'success' })
      navigate('/login')
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось изменить пароль.'))
    } finally {
      setIsResettingPassword(false)
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-16">
        <LoadingSpinner />
      </div>
    )
  }

  if (!profile) return null

  const docs = profile.my_docs ?? []

  return (
    <>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center gap-3 justify-between">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Мой профиль</h2>
          {isStudent && (
            <a
              href={`/students/${user?.id}`}
              onClick={(e) => {
                e.preventDefault()
                navigate(`/students/${user?.id}`)
              }}
              className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-surface border border-slate-200 px-3 py-1.5 rounded-lg"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Публичный профиль
            </a>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 overflow-x-auto">
          <div className="flex w-max gap-1 rounded-lg bg-slate-100 p-1">
            {(isStudent ? [
              ['overview', 'Обзор'],
              ['documents', 'Документы'],
              ['analytics', 'Аналитика'],
              ['settings', 'Настройки'],
              ['security', 'Безопасность'],
            ] : [
              ['settings', 'Настройки'],
              ['security', 'Безопасность'],
            ]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as ProfileTab)}
                className={`whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${activeTab === key ? 'bg-surface text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'overview' && isStudent ? (
          <div className="mb-6 rounded-xl border border-slate-200 bg-surface p-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-semibold text-slate-700">Профиль заполнен</span>
              <strong className="text-indigo-600">{profile.profile_completion}%</strong>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${profile.profile_completion}%` }} />
            </div>
            {profile.profile_completion < 100 ? <p className="mt-2 text-xs text-slate-400">Добавьте телефон, фотографию и недостающие учебные данные, чтобы профиль был полным.</p> : null}
          </div>
        ) : null}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        {activeTab === 'overview' && isStudent && profile.season_history?.length ? (
          <SeasonHallOfFame items={profile.season_history} className="mb-6" />
        ) : null}

        <div className={`bg-surface rounded-xl border border-slate-200 overflow-hidden ${activeTab === 'documents' || activeTab === 'analytics' ? 'hidden' : ''}`}>
          {/* ===== PROFILE TAB ===== */}
          {(activeTab === 'overview' || activeTab === 'settings') && (
            <div className="p-5 sm:p-6">
              {/* Student cohort banner */}
              {isStudent && activeTab === 'overview' && (
                <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Ваш учебный поток</p>
                    <p className="text-sm font-medium text-slate-800">
                      {profile.user.education_level ?? 'Не указано'}
                      {profile.user.course && (
                        <>
                          <span className="mx-1 text-slate-300">&bull;</span>{courseLabel(profile.user.course)}
                        </>
                      )}
                      {profile.user.study_group && (
                        <>
                          <span className="mx-1 text-slate-300">&bull;</span>{profile.user.study_group}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="h-10 w-10 bg-surface rounded-full flex items-center justify-center border border-slate-100 shadow-sm">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14v7" />
                    </svg>
                  </div>
                </div>
              )}

              {/* GPA cards */}
              {isStudent && activeTab === 'overview' && (
                <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-surface border border-slate-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Оценка модератора</p>
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-bold text-slate-800">{profile.user.session_gpa || '—'}</span>
                      {profile.user.session_gpa && <span className="text-xs text-slate-400 mb-1">из 5.0</span>}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Средний балл сессии, который влияет на рейтинг</p>
                  </div>
                  <div
                    className="border rounded-xl p-4"
                    style={{ backgroundColor: 'var(--theme-accent-soft)', borderColor: 'var(--theme-accent)' }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-accent)' }}>Бонус в рейтинг</p>
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-bold" style={{ color: 'var(--theme-accent-strong)' }}>
                        {profile.gpa_bonus ? `+${profile.gpa_bonus}` : '0'}
                      </span>
                      <span className="text-xs mb-1" style={{ color: 'var(--theme-accent)' }}>баллов</span>
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--theme-accent)' }}>Бонус автоматически считается из оценки модератора</p>
                  </div>
                </div>
              )}

              {/* Profile form */}
              {activeTab === 'settings' ? <form onSubmit={handleProfileSave} className="space-y-5">
                <div className="flex items-center space-x-5 pb-4 border-b border-slate-100">
                  <div className="shrink-0 relative">
                    {avatarPreviewUrl ? (
                      <img className="h-20 w-20 object-cover rounded-full border border-slate-200" src={avatarPreviewUrl} alt="" />
                    ) : (
                      <div className="h-20 w-20 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-medium text-xl">
                        {profile.user.first_name?.[0] ?? '?'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="inline-block bg-surface border border-slate-200 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors">
                      Загрузить фото
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarChange}
                      />
                    </label>
                    <p className="text-[10px] text-slate-400 mt-1">JPG, PNG до 2 МБ</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Имя</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(stripEmoji(e.target.value))}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Фамилия</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(stripEmoji(e.target.value))}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Email</label>
                  <input
                    type="email"
                    value={profile.user.email}
                    disabled
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Телефон (Опционально)</label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+7 (999) 123-45-67"
                    pattern="[\d\s\+\-\(\)]{0,20}"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                  />
                </div>
                {isStudent ? (
                  <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Что видно в публичном профиле</legend>
                    <p className="mb-3 text-xs text-slate-400">Имя, уровень обучения, курс и учебная группа видны всегда. Остальные блоки настраиваются отдельно.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        ['avatar', 'Фотография'],
                        ['score', 'Баллы и позиция в рейтинге'],
                        ['hall_of_fame', 'Зал славы и прошлые сезоны'],
                        ['gpa', 'Средний балл и бонус'],
                        ['analytics', 'Графики и направления'],
                        ['achievements', 'Портрет достижений'],
                        ['resume', 'AI-сводка'],
                      ].map(([key, label]) => (
                        <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-700">
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            checked={publicVisibility[key] ?? true}
                            onChange={(event) => setPublicVisibility((current) => ({ ...current, [key]: event.target.checked }))}
                            className="theme-accent-checkbox h-4 w-4"
                          />
                        </label>
                      ))}
                    </div>
                    {publicVisibility.analytics !== false && publicVisibility.score === false ? (
                      <p className="mt-3 rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs text-slate-500">Графики останутся видимыми, но значения баллов будут заменены нулями.</p>
                    ) : null}
                  </fieldset>
                ) : null}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="w-full sm:w-auto bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    {isSavingProfile ? 'Сохраняем...' : hasUnsavedProfileChanges ? 'Сохранить изменения' : 'Сохранено'}
                  </button>
                  {hasUnsavedProfileChanges ? <span className="ml-3 text-xs font-medium text-amber-600">Есть несохранённые изменения</span> : null}
                </div>
              </form> : null}

              {/* AI Resume block (students only) */}
              {isStudent && activeTab === 'overview' && (
                <div className="mt-8 pt-6 border-t border-slate-100">
                  <div className="bg-indigo-50/60 p-5 rounded-xl border border-indigo-100 shadow-sm">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                      <div>
                        <h3 className="text-base font-bold text-indigo-900 flex items-center gap-2">
                          AI-Сводка профиля
                        </h3>
                        <p className="text-xs text-indigo-700/70 mt-1">Автоматический анализ всех подтвержденных достижений нейросетью.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleGenerateResume()}
                        disabled={isGeneratingResume || !canGenerate}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                      >
                        {isGeneratingResume ? 'Генерируем...' : resumeText ? 'Обновить' : 'Сгенерировать'}
                      </button>
                    </div>

                    {resumeText ? (
                      <div className="bg-surface border border-indigo-100/80 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed shadow-sm">
                        {resumeText}
                      </div>
                    ) : (
                      <div className="text-center py-6 bg-surface/50 border border-indigo-100 border-dashed rounded-lg text-indigo-400 text-xs mt-2">
                        Резюме ещё не сформировано. Нажмите «Сгенерировать», чтобы создать сводку на основе подтверждённых достижений.
                      </div>
                    )}
                    {profile.user.resume_generated_at ? (
                      <p className="mt-2 text-[11px] text-slate-400">Последняя генерация: {new Date(profile.user.resume_generated_at).toLocaleString('ru-RU')}</p>
                    ) : null}
                    {profile.resume_versions?.length ? (
                      <details className="mt-3 rounded-lg border border-slate-200 bg-surface p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-600">История версий · {profile.resume_versions.length}</summary>
                        <div className="mt-3 space-y-3">
                          {profile.resume_versions.map((version, index) => (
                            <details key={version.id} className="rounded-lg bg-slate-50 p-3">
                              <summary className="cursor-pointer text-xs text-slate-600">
                                {index === 0 ? 'Текущая' : `Версия ${profile.resume_versions.length - index}`} · {version.created_at ? new Date(version.created_at).toLocaleString('ru-RU') : 'дата неизвестна'} · {version.source_documents_count} док.
                              </summary>
                              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{version.text}</p>
                            </details>
                          ))}
                        </div>
                      </details>
                    ) : null}
                    {!canGenerate && generateReason ? (
                      <p className="mt-2 text-[11px] text-indigo-400">{generateReason}</p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== SECURITY TAB ===== */}
          {activeTab === 'security' && (
            <div className="p-5 sm:p-6">
              <div className="space-y-4">
                {!passwordFlowId ? (
                  <>
                    <p className="text-sm text-slate-600">
                      Для смены пароля мы отправим код подтверждения на вашу почту{' '}
                      <span className="font-medium text-slate-800">{profile.user.email}</span>.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleSendPasswordCode()}
                      disabled={isSendingCode}
                      className="w-full sm:w-auto bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {isSendingCode ? 'Отправляем...' : 'Сменить пароль'}
                    </button>
                  </>
                ) : !passwordVerifiedFlowId ? (
                  <form onSubmit={handleVerifyPasswordCode} className="space-y-4">
                    <p className="text-sm text-slate-600">Введите код из письма:</p>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Код подтверждения</label>
                      <input
                        type="text"
                        value={passwordCode}
                        onChange={(e) => setPasswordCode(e.target.value)}
                        required
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={isVerifyingCode}
                        className="w-full sm:w-auto bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                      >
                        {isVerifyingCode ? 'Проверяем...' : 'Подтвердить'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResendPasswordCode()}
                        disabled={isSendingCode || resendCooldown > 0}
                        className="w-full sm:w-auto bg-surface border border-slate-200 text-slate-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        {resendCooldown > 0 ? `Повторно (${resendCooldown}с)` : 'Отправить повторно'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Новый пароль</label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          minLength={8}
                          className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                        />
                        <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showNewPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                          )}
                        </button>
                      </div>
                      <PasswordRequirements password={newPassword} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Подтвердите пароль</label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          minLength={8}
                          className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                        />
                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showConfirmPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                      После сохранения все ранее открытые сессии будут завершены. Потребуется войти снова на каждом устройстве.
                    </div>
                    <button
                      type="submit"
                      disabled={isResettingPassword}
                      className="w-full sm:w-auto bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {isResettingPassword ? 'Меняем...' : 'Сменить пароль'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== MY DOCS GRID ===== */}
      {activeTab === 'documents' && docs.length > 0 && (
        <div className="max-w-5xl mx-auto mt-6">
          <div className="bg-surface rounded-xl border border-slate-200 p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Мои документы</h3>
              <a
                href={`/achievements`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/achievements')
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Все &rarr;
              </a>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {docs.slice(0, 6).map((doc) => (
                <a
                  key={doc.id}
                  href={`/achievements`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate('/achievements')
                  }}
                  className="group block bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all overflow-hidden"
                >
                  <div className="h-28 w-full bg-slate-100 flex items-center justify-center overflow-hidden relative">
                    {isImageFile(doc.file_path) ? (
                      <DocumentPreviewImage
                        documentId={doc.id}
                        alt={doc.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : isPdfFile(doc.file_path) ? (
                      <div className="flex flex-col items-center gap-1">
                        <svg className="w-10 h-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4z" />
                        </svg>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">PDF</span>
                      </div>
                    ) : (
                      <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <div className="absolute top-2 right-2">
                      {docStatusBadge(doc.status, doc.points)}
                    </div>
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-medium text-slate-800 truncate">{doc.title}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {doc.category}
                      {doc.result ? ` · ${doc.result}` : ''}
                    </p>
                  </div>
                </a>
              ))}
            </div>
            {docs.length > 6 && (
              <div className="mt-3 text-center">
                <a
                  href={`/achievements`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate('/achievements')
                  }}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Показать все {docs.length} документов
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'documents' && docs.length === 0 ? (
        <div className="mx-auto mt-6 max-w-5xl rounded-xl border border-slate-200 bg-surface px-5 py-12 text-center text-sm text-slate-400">
          У вас пока нет загруженных документов.
        </div>
      ) : null}

      {/* ===== DYNAMICS CHART (students only) ===== */}
      {activeTab === 'analytics' && isStudent && (
        <div className="max-w-5xl mx-auto mt-6">
          <div className="bg-surface rounded-xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Динамика достижений</h3>
              <select value={analyticsSeason} onChange={(event) => setAnalyticsSeason(event.target.value)} className="rounded-lg border border-slate-200 bg-surface px-3 py-1.5 text-xs text-slate-700 outline-none">
                <option value="current">Текущий сезон</option>
                <option value="last2">Последние 2 сезона</option>
                <option value="all">Все сезоны</option>
                {profile.available_seasons.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {profile.user.session_gpa && (
                <span className="text-xs text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full">
                  GPA: <span className="font-semibold text-slate-700">{profile.user.session_gpa}</span> &middot; бонус +{profile.gpa_bonus}
                </span>
              )}
            </div>
            {profile.has_chart_data ? (
              <div className="h-64">
                <canvas ref={chartRef} />
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-slate-400">Пока нет данных для отображения графика</div>
            )}
          </div>
        </div>
      )}

      {/* ===== RADAR CHART (students only) ===== */}
      {activeTab === 'analytics' && isStudent && (() => {
        const pointsMap: Record<string, number> = {}
        for (const cat of RADAR_CATS) pointsMap[cat] = 0
        for (const doc of profile.analytics_docs ?? []) {
          if (doc.category && doc.category in pointsMap) {
            pointsMap[doc.category] = (pointsMap[doc.category] ?? 0) + (doc.points ?? 0)
          }
        }
        const activeCats = RADAR_CATS
        return (
          <div className="max-w-5xl mx-auto mt-6">
            <div className="bg-surface rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Портрет достижений</h3>
              <div className="h-64 sm:h-72">
                <canvas ref={radarChartRef} />
              </div>
              {activeCats.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {activeCats.map((cat) => {
                    const isHidden = hiddenCats.has(cat)
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setHiddenCats((prev) => {
                          const next = new Set(prev)
                          if (next.has(cat)) next.delete(cat)
                          else next.add(cat)
                          return next
                        })}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${isHidden ? 'opacity-40 bg-slate-50 border-slate-200 text-slate-400' : 'bg-surface border-slate-200 text-slate-700'}`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isHidden ? chartColors.textFaint : chartColors.accent }} />
                        {cat}
                        <span className="text-[10px] font-semibold ml-0.5" style={{ color: isHidden ? chartColors.textFaint : chartColors.accentStrong }}>
                          {pointsMap[cat]} б.
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ===== CROP MODAL ===== */}
      {showCropModal && (
        <div className="fixed inset-0 z-[80] overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen p-4 text-center">
            <div
              className="fixed inset-0 bg-slate-900 bg-opacity-70 backdrop-blur-sm transition-opacity"
              onClick={closeCropModal}
            />
            <div className="relative bg-surface rounded-xl text-left overflow-hidden shadow-sm transform transition-all w-full max-w-lg flex flex-col">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800">Фото профиля</h3>
              </div>
              <div className="p-4 bg-slate-50">
                <div className="relative w-full h-64 bg-slate-200 rounded-lg overflow-hidden">
                  <img ref={imageToCropRef} src={cropSourceUrl ?? ''} className="max-w-full h-full object-contain" alt="" />
                </div>
              </div>
              <div className="p-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={closeCropModal}
                  className="flex-1 px-4 py-2 bg-surface border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleCropSave}
                  disabled={!isCropperReady}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
