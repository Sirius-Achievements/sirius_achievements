import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Chart from 'chart.js/auto'

import { documentsApi } from '@/api/documents'
import { usersApi } from '@/api/users'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useToast } from '@/hooks/useToast'
import { AchievementStatus } from '@/types/enums'
import { UserDetailResponse, UserNote } from '@/types/user'
import { openDocumentPreview } from '@/utils/documentPreview'
import { getErrorMessage } from '@/utils/http'
import { courseLabel, coursesForEducationLevel, groupsForEducationLevel, roleLabel, userStatusLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'
import { getChartThemeColors } from '@/utils/chartTheme'

const RADAR_CATS = ['Спорт', 'Наука', 'Искусство', 'Волонтёрство', 'Хакатон', 'Патриотизм', 'Проекты', 'Другое']
function achievementStatusLabel(status: string) {
  switch (status) {
    case AchievementStatus.APPROVED:
      return 'Одобрено'
    case AchievementStatus.PENDING:
      return 'На проверке'
    case AchievementStatus.REJECTED:
      return 'Отклонено'
    case AchievementStatus.REVISION:
      return 'На доработке'
    default:
      return status
  }
}

function statusClass(status: string) {
  if (['approved', 'pending', 'revision', 'rejected'].includes(status)) return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  return 'bg-indigo-50 text-indigo-600 border-indigo-100'
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const userId = Number(id)
  const { user: currentUser } = useAuth()
  const { theme } = useTheme()
  const chartColors = getChartThemeColors(theme)
  const location = useLocation()
  const { pushToast } = useToast()
  const chartRef = useRef<HTMLCanvasElement | null>(null)
  const chartInstanceRef = useRef<Chart | null>(null)
  const radarChartRef = useRef<HTMLCanvasElement | null>(null)
  const radarInstanceRef = useRef<Chart | null>(null)
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'analytics' | 'notes' | 'history'>('overview')
  const [detail, setDetail] = useState<UserDetailResponse | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [canGenerateResume, setCanGenerateResume] = useState(false)
  const [resumeReason, setResumeReason] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [educationLevel, setEducationLevel] = useState('')
  const [moderatorCourses, setModeratorCourses] = useState<number[]>([])
  const [moderatorGroups, setModeratorGroups] = useState<string[]>([])
  const [gpa, setGpa] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingRole, setIsSavingRole] = useState(false)
  const [isSavingGpa, setIsSavingGpa] = useState(false)
  const [documentsPage, setDocumentsPage] = useState(1)
  const [isRestoringUser, setIsRestoringUser] = useState(false)
  const [supportModalOpen, setSupportModalOpen] = useState(false)
  const [supportSubject, setSupportSubject] = useState('Сообщение от модератора')
  const [supportText, setSupportText] = useState('')
  const [supportFile, setSupportFile] = useState<File | null>(null)
  const supportFileInputRef = useRef<HTMLInputElement | null>(null)
  const [isSendingSupportMessage, setIsSendingSupportMessage] = useState(false)
  const [isGeneratingResume, setIsGeneratingResume] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<UserNote[]>([])
  const [noteText, setNoteText] = useState('')
  const [noteFile, setNoteFile] = useState<File | null>(null)
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [notePreview, setNotePreview] = useState<{ url: string; type: 'pdf' | 'image'; noteId: number } | null>(null)
  const [notePreviewLoading, setNotePreviewLoading] = useState(false)
  const noteFileInputRef = useRef<HTMLInputElement>(null)
  const notePreviewUrlRef = useRef<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ kind: 'note' | 'user' | 'document'; id?: number; title: string } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const backUrl = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const explicitReturn = params.get('return')
    if (explicitReturn?.startsWith('/')) return explicitReturn
    const from = params.get('from')
    if (from === 'documents') return '/documents'
    if (from === 'moderation') return '/moderation/users'
    if (from === 'moderation-achievements') return '/moderation/achievements'
    if (from === 'leaderboard') return '/leaderboard'
    if (from === 'support') {
      const ticketId = params.get('ticket_id')
      return ticketId ? `/moderation/support/${ticketId}` : '/moderation/support'
    }
    return '/users'
  }, [location.search])

  const isGuestOrPending = detail ? detail.user.role === 'GUEST' || detail.user.status === 'pending' : false
  const isAdminViewer = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'MODERATOR'
  const targetIsStaff = detail ? detail.user.role === 'MODERATOR' || detail.user.role === 'SUPER_ADMIN' : false
  // A moderator may view other staff read-only, but not manage them.
  const readOnlyStaff = currentUser?.role === 'MODERATOR' && targetIsStaff
  const moderatorCourseOptions = coursesForEducationLevel(educationLevel || 'Специалитет')
  const moderatorGroupOptions = moderatorCourseOptions.flatMap((course) => groupsForEducationLevel(educationLevel || 'Специалитет', course))

  const toggleModeratorCourse = (course: number) => {
    setModeratorCourses((current) => {
      const next = current.includes(course) ? current.filter((item) => item !== course) : [...current, course].sort()
      setModeratorGroups((groups) => groups.filter((group) => {
        if (!next.length) return true
        return next.some((selectedCourse) => groupsForEducationLevel(educationLevel || 'Специалитет', selectedCourse).includes(group))
      }))
      return next
    })
  }

  const toggleModeratorGroup = (group: string) => {
    setModeratorGroups((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group])
  }

  const load = async () => {
    if (!Number.isFinite(userId)) {
      setError('Некорректный идентификатор пользователя.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const detailResponse = await usersApi.get(userId)
      setDetail(detailResponse.data)
      setDocumentsPage(1)
      setRole(detailResponse.data.user.role)
      setEducationLevel(detailResponse.data.user.education_level ?? '')
      setModeratorCourses(detailResponse.data.user.moderator_courses ?? [])
      setModeratorGroups(detailResponse.data.user.moderator_groups ?? [])
      setGpa(detailResponse.data.user.session_gpa ?? '')
      // Resume checks and staff notes are student-only: the backend returns 404
      // for staff subjects, so load them best-effort and never fail the card.
      const [resumeResponse, notesResponse] = await Promise.all([
        usersApi.checkResume(userId).catch(() => null),
        usersApi.listNotes(userId).catch(() => null),
      ])
      setResumeText(resumeResponse?.data.resume ?? detailResponse.data.user.resume_text ?? '')
      setCanGenerateResume(resumeResponse?.data.can_generate ?? false)
      setResumeReason(resumeResponse?.data.reason ?? null)
      setNotes(notesResponse?.data.notes ?? [])
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить карточку пользователя.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [userId])

  useEffect(() => {
    if (!detail || !chartRef.current || !detail.chart_labels.length) return

    const colors = getChartThemeColors(theme)

    chartInstanceRef.current?.destroy()
    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: detail.chart_labels,
        datasets: [
          {
            label: 'Баллы',
            data: detail.chart_points,
            borderColor: colors.accent,
            backgroundColor: colors.accentSoft,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointBackgroundColor: colors.pointBackground,
            pointBorderColor: colors.accent,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: 'Документов',
            data: detail.chart_counts,
            borderColor: colors.accentStrong,
            backgroundColor: colors.accentStrongSoft,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointBackgroundColor: colors.pointBackground,
            pointBorderColor: colors.accentStrong,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 11 }, color: colors.textMuted, usePointStyle: true, padding: 16 } }, tooltip: { padding: 10, cornerRadius: 8, backgroundColor: colors.tooltip } },
        scales: {
          y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { font: { size: 11 }, color: colors.textFaint, stepSize: 1 } },
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: colors.textMuted } },
        },
      },
    })

    return () => {
      chartInstanceRef.current?.destroy()
      chartInstanceRef.current = null
    }
  }, [activeTab, detail, isLoading, theme])

  useEffect(() => {
    if (!radarChartRef.current || !detail?.achievements?.length) return
    const colors = getChartThemeColors(theme)
    const pointsMap: Record<string, number> = {}
    for (const cat of RADAR_CATS) pointsMap[cat] = 0
    for (const a of detail.achievements) {
      const cat = a.category as string
      if (cat in pointsMap) pointsMap[cat] = (pointsMap[cat] ?? 0) + (a.points ?? 0)
    }
    if (!RADAR_CATS.some((c) => (pointsMap[c] ?? 0) > 0)) return
    const maxVal = Math.max(...RADAR_CATS.map((c) => pointsMap[c] ?? 0))
    const font = { family: "'Inter', system-ui, sans-serif", size: 10 }
    radarInstanceRef.current?.destroy()
    radarInstanceRef.current = new Chart(radarChartRef.current, {
      type: 'radar',
      data: {
        labels: RADAR_CATS,
        datasets: [{
          label: 'Достижения',
          data: RADAR_CATS.map((cat) => {
            const value = pointsMap[cat] ?? 0
            return hiddenCats.has(cat) || value <= 0 ? null : value
          }),
          borderColor: colors.accent,
          backgroundColor: colors.accentSoft,
          fill: true,
          spanGaps: true,
          tension: 0,
          borderWidth: 2,
          pointBackgroundColor: colors.accentStrong,
          pointBorderColor: colors.pointBackground,
          pointBorderWidth: 1,
          pointRadius: RADAR_CATS.map((cat) => !hiddenCats.has(cat) && (pointsMap[cat] ?? 0) > 0 ? 3 : 0),
          pointHoverRadius: RADAR_CATS.map((cat) => !hiddenCats.has(cat) && (pointsMap[cat] ?? 0) > 0 ? 5 : 0),
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
            callbacks: { label: (ctx) => ctx.parsed.r > 0 ? ` ${ctx.label}: ${ctx.parsed.r} б.` : '' },
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
  }, [activeTab, detail, hiddenCats, isLoading, theme])

  const handleRoleSave = async () => {
    setIsSavingRole(true)
    setError(null)
    try {
      const { data } = await usersApi.updateRole(
        userId,
        role,
        educationLevel || undefined,
        role === 'MODERATOR' ? moderatorCourses : undefined,
        role === 'MODERATOR' ? moderatorGroups : undefined,
      )
      setDetail((current) => (current ? { ...current, user: data.user } : current))
      pushToast({ title: 'Роль обновлена', tone: 'success' })
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Не удалось обновить роль пользователя.'))
    } finally {
      setIsSavingRole(false)
    }
  }

  const handleGpaSave = async () => {
    setIsSavingGpa(true)
    setError(null)
    try {
      const { data } = await usersApi.setGpa(userId, gpa)
      setDetail((current) => current ? { ...current, user: data.user, gpa_bonus: data.bonus } : current)
      setGpa(data.gpa)
      pushToast({ title: 'Средний балл обновлён', tone: 'success' })
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Не удалось сохранить GPA.'))
    } finally {
      setIsSavingGpa(false)
    }
  }

  const handleGenerateResume = async () => {
    setIsGeneratingResume(true)
    setError(null)
    try {
      const { data } = await usersApi.generateResume(userId)
      const generatedUser = data.user
      if (generatedUser) {
        setDetail((current) => current ? { ...current, user: generatedUser } : current)
      }
      setResumeText(data.resume ?? '')
      setCanGenerateResume(data.can_generate)
      setResumeReason(data.reason ?? null)
      pushToast({ title: 'AI-сводка обновлена', tone: 'success' })
    } catch (generationError) {
      setError(getErrorMessage(generationError, 'Не удалось сгенерировать сводку.'))
    } finally {
      setIsGeneratingResume(false)
    }
  }

  const handleExportPdf = async () => {
    setIsExportingPdf(true)
    try {
      const response = await usersApi.exportPdf(userId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `report_${detail?.user.last_name || 'user'}_${detail?.user.first_name || userId}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    } catch (exportError) {
      setError(getErrorMessage(exportError, 'Не удалось выгрузить PDF.'))
    } finally {
      setIsExportingPdf(false)
    }
  }

  const closeNotePreview = () => {
    if (notePreviewUrlRef.current) {
      URL.revokeObjectURL(notePreviewUrlRef.current)
      notePreviewUrlRef.current = null
    }
    setNotePreview(null)
  }

  const handleOpenNotePreview = async (note: UserNote) => {
    if (notePreviewLoading) return
    setNotePreviewLoading(true)
    try {
      const response = await usersApi.getNoteFile(userId, note.id)
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
      if (notePreviewUrlRef.current) URL.revokeObjectURL(notePreviewUrlRef.current)
      const url = URL.createObjectURL(blob)
      notePreviewUrlRef.current = url
      const isPdf = blob.type === 'application/pdf' || /\.pdf/i.test(note.file_path ?? '')
      setNotePreview({ url, type: isPdf ? 'pdf' : 'image', noteId: note.id })
    } catch {
      setError('Не удалось загрузить файл заметки.')
    } finally {
      setNotePreviewLoading(false)
    }
  }

  const handleDownloadNoteFile = async (note: UserNote) => {
    try {
      const response = await usersApi.getNoteFile(userId, note.id)
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = note.file_path ? note.file_path.split('.').pop() ?? 'bin' : 'bin'
      a.download = `note_${note.id}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Не удалось скачать файл.')
    }
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setIsAddingNote(true)
    try {
      const { data } = await usersApi.createNote(userId, noteText.trim(), noteFile ?? undefined)
      setNotes((prev) => [data.note, ...prev])
      setNoteText('')
      setNoteFile(null)
      if (noteFileInputRef.current) noteFileInputRef.current.value = ''
      pushToast({ title: 'Заметка добавлена', tone: 'success' })
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось добавить заметку.'))
    } finally {
      setIsAddingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    setConfirmTarget({ kind: 'note', id: noteId, title: 'служебную заметку' })
  }

  const handleDeleteUser = async () => {
    if (!detail) return
    setConfirmTarget({ kind: 'user', title: `${detail.user.first_name} ${detail.user.last_name}` })
  }

  const handleSendSupportMessage = async () => {
    if (!supportText.trim()) {
      setError('Введите текст сообщения.')
      return
    }

    setIsSendingSupportMessage(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('subject', supportSubject.trim() || 'Сообщение от модератора')
      formData.append('text', supportText.trim())
      if (supportFile) formData.append('file', supportFile)
      await usersApi.sendSupportMessage(userId, formData)
      setSupportModalOpen(false)
      setSupportSubject('Сообщение от модератора')
      setSupportText('')
      setSupportFile(null)
      pushToast({ title: 'Сообщение отправлено', message: 'У пользователя появилось обращение в поддержке.', tone: 'success' })
    } catch (sendError) {
      setError(getErrorMessage(sendError, 'Не удалось отправить сообщение пользователю.'))
    } finally {
      setIsSendingSupportMessage(false)
    }
  }

  const handleRestoreUser = async () => {
    if (!detail) return

    setIsRestoringUser(true)
    setError(null)
    try {
      const { data } = await usersApi.restore(userId)
      setDetail((current) => (current ? { ...current, user: data.user } : current))
      pushToast({ title: 'Аккаунт восстановлен', tone: 'success' })
    } catch (restoreError) {
      setError(getErrorMessage(restoreError, 'Не удалось восстановить пользователя.'))
    } finally {
      setIsRestoringUser(false)
    }
  }

  const handleDeleteDocument = async (documentId: number, title: string) => {
    setConfirmTarget({ kind: 'document', id: documentId, title })
  }

  const runConfirmedAction = async () => {
    if (!confirmTarget) return
    setConfirmBusy(true)
    try {
      if (confirmTarget.kind === 'note' && confirmTarget.id) {
        await usersApi.deleteNote(userId, confirmTarget.id)
        setNotes((previous) => previous.filter((note) => note.id !== confirmTarget.id))
        pushToast({ title: 'Заметка удалена', tone: 'success' })
      } else if (confirmTarget.kind === 'user') {
        await usersApi.delete(userId)
        pushToast({ title: 'Пользователь перенесён в удалённые', tone: 'success' })
        await load()
      } else if (confirmTarget.kind === 'document' && confirmTarget.id) {
        await documentsApi.delete(confirmTarget.id)
        pushToast({ title: 'Документ удалён', tone: 'success' })
        await load()
      }
      setConfirmTarget(null)
    } catch (actionError) {
      setError(getErrorMessage(actionError, 'Не удалось выполнить действие.'))
    } finally {
      setConfirmBusy(false)
    }
  }

  if (isLoading) return <div className="py-16"><LoadingSpinner /></div>
  if (!detail) return null

  const documentsPerPage = 8
  const documentsTotalPages = Math.max(1, Math.ceil(detail.achievements.length / documentsPerPage))
  const safeDocumentsPage = Math.min(documentsPage, documentsTotalPages)
  const visibleDocuments = detail.achievements.slice((safeDocumentsPage - 1) * documentsPerPage, safeDocumentsPage * documentsPerPage)
  const documentPageButtons = Array.from({ length: documentsTotalPages }, (_, index) => index + 1)
    .filter((page) => page <= 2 || page >= documentsTotalPages - 1 || Math.abs(page - safeDocumentsPage) <= 1)
  const parsedGpa = Number.parseFloat(gpa.replace(',', '.'))
  const gpaPreview = Number.isFinite(parsedGpa)
    ? parsedGpa < 3
      ? 0
      : parsedGpa < 4
        ? Math.floor((parsedGpa - 3) * 15)
        : parsedGpa < 4.5
          ? 15 + Math.floor((parsedGpa - 4) * 20)
          : 25 + Math.floor((parsedGpa - 4.5) * 10)
    : 0

  const studentPortrait = detail.user.role === 'STUDENT' && detail.achievements.length ? (() => {
    const pointsMap: Record<string, number> = {}
    for (const cat of RADAR_CATS) pointsMap[cat] = 0
    for (const achievement of detail.achievements) {
      const category = achievement.category as string
      if (category in pointsMap) pointsMap[category] = (pointsMap[category] ?? 0) + (achievement.points ?? 0)
    }
    const activeCats = RADAR_CATS.filter((category) => pointsMap[category] > 0)
    if (!activeCats.length) return null
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <h4 className="mb-2 text-xs font-semibold text-slate-600">Портрет</h4>
        <div className="h-56"><canvas ref={radarChartRef} /></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {activeCats.map((category) => {
            const isHidden = hiddenCats.has(category)
            return (
              <button key={category} type="button" onClick={() => setHiddenCats((previous) => {
                const next = new Set(previous)
                if (next.has(category)) next.delete(category)
                else next.add(category)
                return next
              })} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${isHidden ? 'opacity-40 bg-slate-50 border-slate-200 text-slate-400' : 'bg-surface border-slate-200 text-slate-700'}`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isHidden ? chartColors.textFaint : chartColors.accent }} />
                {category}
                <span className="text-[10px] font-semibold ml-0.5" style={{ color: isHidden ? chartColors.textFaint : chartColors.accentStrong }}>{pointsMap[category]} б.</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  })() : null

  const openUserDocument = (item: UserDetailResponse['achievements'][number]) => {
    if (item.file_path) {
      openDocumentPreview(item.id, item.file_path)
      return
    }
    if (item.external_url) {
      window.open(item.external_url, '_blank', 'noopener')
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-surface px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Карточка пользователя</h2>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {detail.user.role === 'STUDENT' && detail.user.status === 'active' ? <Link to={`/students/${detail.user.id}`} className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-surface border border-slate-200 px-3 py-1.5 rounded-lg">Публичный профиль</Link> : null}
          {isAdminViewer && !readOnlyStaff ? <button type="button" onClick={() => setSupportModalOpen(true)} className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-surface border border-slate-200 px-3 py-1.5 rounded-lg">Написать</button> : null}
          <button type="button" onClick={() => void handleExportPdf()} className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-surface border border-slate-200 px-3 py-1.5 rounded-lg">{isExportingPdf ? 'PDF...' : 'PDF'}</button>
          {isAdminViewer && !readOnlyStaff ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg border border-slate-200 bg-surface px-3 py-1.5 text-sm text-slate-500" aria-label="Дополнительные действия">•••</summary>
              <div className="absolute right-0 z-20 mt-2 min-w-52 rounded-xl border border-slate-200 bg-surface p-2 shadow-lg">
                {detail.user.status === 'deleted' ? (
                  <button type="button" onClick={() => void handleRestoreUser()} disabled={isRestoringUser} className="w-full rounded-lg px-3 py-2 text-left text-sm text-indigo-600 hover:bg-indigo-50 disabled:opacity-60">{isRestoringUser ? 'Восстановление...' : 'Восстановить пользователя'}</button>
                ) : (
                  <button type="button" onClick={() => void handleDeleteUser()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">Перенести пользователя в удалённые</button>
                )}
              </div>
            </details>
          ) : null}
          <Link to={backUrl} className="text-sm text-slate-500 hover:text-indigo-600 flex items-center transition-colors">Назад</Link>
        </div>
      </div>

      {error ? <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div> : null}

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-surface p-1" aria-label="Разделы карточки">
        {[
          ['overview', 'Обзор'],
          ['documents', `Документы (${detail.total_docs})`],
          ['analytics', 'Аналитика'],
          ['notes', `Служебные заметки (${notes.length})`],
          ['history', 'История действий'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-5">
        {activeTab === 'overview' ? <div className={`grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] ${isGuestOrPending && !isAdminViewer ? 'max-w-4xl mx-auto w-full' : ''}`}>
          <div className="bg-surface rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center shadow-sm">
            <div className="h-20 w-20 mb-3 relative">
              {detail.user.avatar_path ? <img className="h-20 w-20 rounded-full object-cover border border-slate-200" src={buildMediaUrl(detail.user.avatar_path)} alt="Avatar" /> : <div className="h-20 w-20 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 text-2xl font-bold">{detail.user.first_name.slice(0, 1)}{detail.user.last_name.slice(0, 1)}</div>}
            </div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">{detail.user.first_name} {detail.user.last_name}</h1>
            <p className="text-[10px] text-slate-400 mb-1">ID: {detail.user.id}</p>
            <p className="text-xs text-slate-500 mb-3">{detail.user.email}</p>
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-slate-100 text-slate-600 border border-slate-200">{roleLabel(detail.user.role)}</span>
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border bg-indigo-50 text-indigo-700 border-indigo-200">{userStatusLabel(detail.user.status)}</span>
            </div>

            {currentUser?.role === 'SUPER_ADMIN' && currentUser.id !== detail.user.id ? (
              <div className="w-full pt-4 border-t border-slate-100">
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1.5 text-left">Изменить роль</label>
                <div className="flex gap-2">
                  <select value={role} onChange={(event) => setRole(event.target.value)} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all">
                    {detail.roles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}
                  </select>
                  <button type="button" onClick={() => void handleRoleSave()} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors" disabled={isSavingRole}>OK</button>
                </div>
                {role === 'MODERATOR' ? (
                  <div className="mt-3 text-left bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 space-y-3">
                    <div>
                      <label className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider block mb-1.5">Зона проверки модератора</label>
                      <select value={educationLevel} onChange={(event) => { setEducationLevel(event.target.value); setModeratorCourses([]); setModeratorGroups([]) }} className="w-full px-3 py-2 bg-surface border border-indigo-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-600/20 outline-none transition-all">
                        <option value="">Все группы специалитета</option>
                        {detail.education_levels.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider mb-1.5">Курсы</div>
                      <div className="flex flex-wrap gap-2">
                        {moderatorCourseOptions.map((course) => {
                          const active = moderatorCourses.includes(course)
                          return (
                            <button
                              key={course}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleModeratorCourse(course)}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-indigo-200 bg-surface text-slate-700 hover:border-indigo-400'}`}
                            >
                              {active ? (
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                              ) : null}
                              {courseLabel(course)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider mb-1.5">Группы</div>
                      <div className="flex flex-wrap gap-2">
                        {moderatorGroupOptions.map((group) => {
                          const active = moderatorGroups.includes(group)
                          return (
                            <button
                              key={group}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleModeratorGroup(group)}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-indigo-200 bg-surface text-slate-700 hover:border-indigo-400'}`}
                            >
                              {active ? (
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                              ) : null}
                              {group}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-1.5 text-[10px] text-indigo-700/70">Если курс или группа не выбраны, модератор видит все значения внутри выбранной зоны.</p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50"><h3 className="text-sm font-bold text-slate-700">Информация</h3></div>
            <div className="grid grid-cols-2 gap-3 p-4 text-sm">
              {detail.user.education_level ? <div className="min-w-0"><span className="block text-slate-500 text-[11px]">Обучение / зона</span><span className="block truncate font-medium text-slate-800">{detail.user.education_level}</span></div> : null}
              {detail.user.role === 'MODERATOR' ? <div className="min-w-0"><span className="block text-slate-500 text-[11px]">Курсы модерации</span><span className="block truncate font-medium text-slate-800">{detail.user.moderator_courses?.length ? detail.user.moderator_courses.map((item) => courseLabel(item)).join(', ') : 'Все'}</span></div> : null}
              {detail.user.role === 'MODERATOR' ? <div className="min-w-0"><span className="block text-slate-500 text-[11px]">Группы модерации</span><span className="block truncate font-medium text-slate-800">{detail.user.moderator_groups?.length ? detail.user.moderator_groups.join(', ') : 'Все'}</span></div> : null}
              <div><span className="block text-slate-500 text-[11px]">Курс</span><span className="font-medium text-slate-800">{detail.user.course ? courseLabel(detail.user.course) : 'Не указан'}</span></div>
              <div><span className="block text-slate-500 text-[11px]">Группа</span><span className="font-medium text-slate-800">{detail.user.study_group || 'Не указана'}</span></div>
              <div><span className="block text-slate-500 text-[11px]">Телефон</span><span className="block truncate font-medium text-slate-800">{detail.user.phone_number || 'Не указан'}</span></div>
              <div><span className="block text-slate-500 text-[11px]">Регистрация</span><span className="font-medium text-slate-800">{detail.user.created_at ? new Date(detail.user.created_at).toLocaleDateString('ru-RU') : 'Дата не указана'}</span></div>
            </div>
            {isAdminViewer && detail.user.role === 'STUDENT' ? <div className="border-t border-slate-100 bg-slate-50/50 p-4"><div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-700">Средний балл сессии</h3><span className="text-[10px] text-slate-400">Влияет на рейтинг</span></div><div className="flex gap-2"><input type="text" value={gpa} onChange={(event) => setGpa(event.target.value)} placeholder="4.5" className="min-w-0 flex-1 px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all" /><button type="button" onClick={() => void handleGpaSave()} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors" disabled={isSavingGpa}>Сохранить</button></div><p className="text-[10px] text-slate-400 mt-1.5">Предварительный бонус: <strong className="text-indigo-600">+{gpaPreview} баллов</strong> · оценка от 2.0 до 5.0</p></div> : null}
          </div>
        </div> : null}

        {!isGuestOrPending || isAdminViewer ? <div className="space-y-5">
          {activeTab === 'overview' && !isGuestOrPending ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Документов в текущем сезоне</div><div className="text-2xl font-semibold text-slate-800 mt-1">{detail.total_docs}</div></div>{detail.rank ? <div className="bg-surface p-5 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm"><div><div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Текущее место</div><div className="text-2xl font-bold text-indigo-600 mt-1">#{detail.rank}</div></div><div className="w-px h-8 bg-slate-200" /><div className="text-right"><div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Баллы</div><div className="text-2xl font-bold text-indigo-600 mt-1">{detail.total_points}</div></div></div> : null}</div> : null}

          {activeTab === 'overview' ? <div className="bg-indigo-50/60 p-5 sm:p-6 rounded-xl border border-indigo-100 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div><h3 className="text-base font-bold text-indigo-900">AI-сводка профиля</h3><p className="text-xs text-indigo-700/70 mt-1">Формируется автоматически на основе подтверждённых достижений студента.</p></div>
              <button
                type="button"
                onClick={() => void handleGenerateResume()}
                disabled={isGeneratingResume || !canGenerateResume}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {isGeneratingResume ? 'Генерируем...' : resumeText ? 'Обновить' : 'Сгенерировать'}
              </button>
            </div>
            {detail.user.resume_generated_at ? <p className="mb-3 text-[11px] text-indigo-700/70">Последнее создание: {new Date(detail.user.resume_generated_at).toLocaleString('ru-RU')} · источник: подтверждённые достижения, баллы и данные обучения</p> : null}
            {resumeText ? <div className="bg-surface border border-indigo-100/80 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed shadow-sm">{resumeText}</div> : <div className="text-center py-6 bg-surface/50 border border-indigo-100 border-dashed rounded-lg text-indigo-400 text-xs mt-2">Резюме ещё не сформировано.</div>}
            {!canGenerateResume && resumeReason ? <p className="mt-2 text-[11px] text-indigo-400">{resumeReason}</p> : null}
          </div> : null}

          {activeTab === 'documents' && detail.season_history.length ? <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden text-white shadow-md relative"><div className="px-5 py-3 border-b border-slate-700/50 flex justify-between items-center relative z-10"><h3 className="text-sm font-bold text-white">Зал славы (Архив сезонов)</h3></div><div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">{detail.season_history.map((item) => <div key={item.id} className="bg-surface/10 rounded-lg p-4 flex justify-between items-center border border-white/5 hover:bg-surface/20 transition-colors"><div><div className="text-xs font-bold text-slate-200">{item.season_name}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-semibold">Место: <span className="text-white text-sm">#{item.rank}</span></div></div><div className="text-xl font-black text-yellow-400">{item.points} <span className="text-[10px] font-normal text-slate-400">б.</span></div></div>)}</div></div> : null}

          {activeTab === 'documents' ? <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-700">Документы текущего сезона</h3>
            </div>
            {detail.achievements.length ? (
              <ul className="divide-y divide-slate-100">
                {visibleDocuments.map((item) => (
                  <li key={item.id} className="p-4 hover:bg-slate-50 flex items-center justify-between transition-colors">
                    <div className="flex items-center flex-1 min-w-0 pr-4">
                      <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 mr-4 shrink-0 border border-indigo-100">
                        <button type="button" onClick={() => openUserDocument(item)} title={item.file_path ? 'Открыть файл' : item.external_url ? 'Открыть ссылку' : 'Нет вложения'}>
                          {item.external_url && !item.file_path ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 015.656 5.656l-3 3a4 4 0 01-5.656-5.656M10.172 13.828a4 4 0 01-5.656-5.656l3-3a4 4 0 015.656 5.656" /></svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          )}
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
                        {item.description ? (
                          <details className="mt-0.5 text-xs text-slate-500">
                            <summary className="cursor-pointer text-indigo-600 hover:underline">Описание</summary>
                            <p className="mt-1 leading-relaxed">{item.description}</p>
                          </details>
                        ) : null}
                        {item.external_url ? (
                          <a
                            href={item.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 block max-w-md truncate text-xs text-indigo-600 hover:underline"
                            title={item.external_url}
                          >
                            Ссылка на подтверждение
                          </a>
                        ) : null}
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center">
                          <span className="mr-2">{item.created_at ? new Date(item.created_at).toLocaleDateString('ru-RU') : 'Дата не указана'}</span>
                          {item.rejection_reason ? <span className="text-red-500 truncate max-w-[200px]">• {item.rejection_reason}</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`hidden sm:inline-flex px-2 py-0.5 text-[10px] rounded font-medium border ${statusClass(item.status)}`}>{achievementStatusLabel(item.status)}</span>
                      <button type="button" onClick={() => void handleDeleteDocument(item.id, item.title)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Удалить">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-10 text-center flex flex-col items-center">
                <p className="text-sm text-slate-500">Достижений пока нет.</p>
              </div>
            )}
            {documentsTotalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                <span className="text-xs text-slate-400">Страница {safeDocumentsPage} из {documentsTotalPages}</span>
                <div className="flex items-center gap-1">
                  {documentPageButtons.map((page, index) => <span key={page} className="contents">{index > 0 && page - documentPageButtons[index - 1] > 1 ? <span className="px-1 text-xs text-slate-400">…</span> : null}<button type="button" onClick={() => setDocumentsPage(page)} aria-current={page === safeDocumentsPage ? 'page' : undefined} className={`min-w-8 rounded-md px-2 py-1 text-xs font-medium transition-colors ${page === safeDocumentsPage ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>{page}</button></span>)}
                </div>
              </div>
            ) : null}
          </div> : null}

          {activeTab === 'analytics' && detail.user.role === 'STUDENT' ? <section className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm"><div className="border-b border-slate-100 px-5 py-3"><h3 className="text-sm font-semibold text-slate-700">Аналитика достижений</h3><p className="mt-0.5 text-xs text-slate-400">Динамика баллов и распределение по направлениям</p></div><div className="grid gap-4 p-4 lg:grid-cols-2"><div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><h4 className="mb-2 text-xs font-semibold text-slate-600">Динамика</h4>{detail.chart_labels.length ? <div className="h-56"><canvas ref={chartRef} /></div> : <div className="flex h-56 items-center justify-center text-center text-sm text-slate-400">Нет одобренных достижений для отображения графика</div>}</div>{studentPortrait}</div></section> : null}

          {activeTab === 'notes' && detail.user.role === 'STUDENT' ? (
          <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              <h3 className="text-sm font-bold text-slate-700">Служебные заметки</h3>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 uppercase tracking-wider">
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                Только для сотрудников
              </span>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Опишите нарушение или причину заметки..."
                  rows={3}
                  className="w-full px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none resize-none transition-all"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 cursor-pointer px-3 py-1.5 bg-surface border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    {noteFile ? <span className="max-w-[140px] truncate text-indigo-600 font-medium">{noteFile.name}</span> : 'Прикрепить файл'}
                    <input ref={noteFileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xlsx,.pptx" onChange={(e) => setNoteFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {noteFile && (
                    <button type="button" onClick={() => { setNoteFile(null); if (noteFileInputRef.current) noteFileInputRef.current.value = '' }} className="text-xs text-slate-400 hover:text-red-500 transition-colors">
                      Убрать
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleAddNote()}
                    disabled={isAddingNote || !noteText.trim()}
                    className="ml-auto px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAddingNote ? 'Сохранение...' : 'Добавить заметку'}
                  </button>
                </div>
              </div>

              {notes.length > 0 ? (
                <ul className="divide-y divide-slate-100 -mx-5">
                  {notes.map((note) => (
                    <li key={note.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{note.text}</p>
                      <div className="mt-2 flex items-center gap-3 flex-wrap">
                        {note.has_file && (
                          <>
                            <button type="button" onClick={() => void handleOpenNotePreview(note)} disabled={notePreviewLoading} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors disabled:opacity-50">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                              {notePreviewLoading ? 'Загрузка...' : 'Просмотр'}
                            </button>
                            <button type="button" onClick={() => void handleDownloadNoteFile(note)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                              Скачать
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => void handleDeleteNote(note.id)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors ml-auto">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          Удалить
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{note.author ? `${note.author.first_name} ${note.author.last_name}` : 'Неизвестно'}</span>
                        <span>·</span>
                        <span>{note.created_at ? new Date(note.created_at).toLocaleString('ru-RU') : ''}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 text-center py-2">Заметок пока нет</p>
              )}
            </div>
          </div>
          ) : null}

          {activeTab === 'history' ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <h3 className="text-sm font-bold text-slate-700">История действий</h3>
                <p className="mt-0.5 text-xs text-slate-400">Изменения роли, GPA, статуса и другие административные действия.</p>
              </div>
              {detail.audit_log.length ? (
                <ul className="divide-y divide-slate-100">
                  {detail.audit_log.map((entry) => (
                    <li key={entry.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[180px_1fr_auto]">
                      <span className="font-medium text-slate-700">{entry.actor}</span>
                      <span className="text-slate-600">{entry.action}{entry.details ? ` · ${entry.details}` : ''}</span>
                      <span className="text-xs text-slate-400">{entry.created_at ? new Date(entry.created_at).toLocaleString('ru-RU') : '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="p-10 text-center text-sm text-slate-400">История пока пуста.</div>}
            </section>
          ) : null}

        </div> : null}
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget?.kind === 'user' ? 'Перенести пользователя в удалённые?' : 'Подтвердите удаление'}
        message={confirmTarget ? (
          confirmTarget.kind === 'user'
            ? <>Аккаунт <strong>{confirmTarget.title}</strong> будет деактивирован и останется доступен для восстановления.</>
            : <>Удалить {confirmTarget.kind === 'document' ? 'документ' : ''} <strong>{confirmTarget.kind === 'document' ? `«${confirmTarget.title}»` : confirmTarget.title}</strong>?</>
        ) : null}
        confirmLabel={confirmTarget?.kind === 'user' ? 'Перенести' : 'Удалить'}
        tone="danger"
        busy={confirmBusy}
        onConfirm={() => void runConfirmedAction()}
        onCancel={() => { if (!confirmBusy) setConfirmTarget(null) }}
      />

      {notePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeNotePreview}>
          <div className="relative w-full max-w-3xl max-h-[90vh] bg-surface dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Файл заметки</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { const a = document.createElement('a'); a.href = notePreview.url; a.download = `note_${notePreview.noteId}.${notePreview.type === 'pdf' ? 'pdf' : 'bin'}`; document.body.appendChild(a); a.click(); a.remove() }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 bg-surface dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Скачать
                </button>
                <button type="button" onClick={closeNotePreview} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900 flex items-center justify-center min-h-[400px]">
              {notePreview.type === 'pdf' ? (
                <iframe src={notePreview.url} className="w-full h-full min-h-[500px] border-0 bg-surface" title="PDF" allow="fullscreen" />
              ) : (
                <img src={notePreview.url} alt="Файл" className="max-w-full max-h-full object-contain rounded-lg shadow-sm m-4" />
              )}
            </div>
          </div>
        </div>
      )}

      {supportModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4" onClick={() => setSupportModalOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-surface border border-slate-200 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-slate-800">Сообщение пользователю</h3>
              <button type="button" onClick={() => setSupportModalOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Тема</label>
                <input value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-600 focus:bg-surface" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Сообщение</label>
                <textarea value={supportText} onChange={(event) => setSupportText(event.target.value)} rows={5} className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-600 focus:bg-surface" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Файл</label>
                <input
                  ref={supportFileInputRef}
                  type="file"
                  onChange={(event) => setSupportFile(event.target.files?.[0] ?? null)}
                  className="hidden"
                />
                {supportFile ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span className="truncate">{supportFile.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSupportFile(null)
                        if (supportFileInputRef.current) supportFileInputRef.current.value = ''
                      }}
                      className="shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Удалить
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => supportFileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    Прикрепить файл
                  </button>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setSupportModalOpen(false)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200">Отмена</button>
                <button type="button" onClick={() => void handleSendSupportMessage()} disabled={isSendingSupportMessage} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{isSendingSupportMessage ? 'Отправка...' : 'Отправить'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
