import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Chart from 'chart.js/auto'

import { documentsApi } from '@/api/documents'
import { usersApi } from '@/api/users'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { AchievementStatus } from '@/types/enums'
import { UserDetailResponse, UserNote } from '@/types/user'
import { openDocumentPreview } from '@/utils/documentPreview'
import { getErrorMessage } from '@/utils/http'
import { courseLabel, coursesForEducationLevel, groupsForEducationLevel, roleLabel, userStatusLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'

const RADAR_CATS = ['Спорт', 'Наука', 'Искусство', 'Волонтёрство', 'Хакатон', 'Патриотизм', 'Проекты', 'Другое']
const RADAR_COLORS = [
  { border: '#6366f1', bg: 'rgba(99,102,241,0.18)' },
  { border: '#3b82f6', bg: 'rgba(59,130,246,0.18)' },
  { border: '#ec4899', bg: 'rgba(236,72,153,0.18)' },
  { border: '#10b981', bg: 'rgba(16,185,129,0.18)' },
  { border: '#f59e0b', bg: 'rgba(245,158,11,0.18)' },
  { border: '#ef4444', bg: 'rgba(239,68,68,0.18)' },
  { border: '#8b5cf6', bg: 'rgba(139,92,246,0.18)' },
  { border: '#64748b', bg: 'rgba(100,116,139,0.18)' },
]

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
  if (status === 'approved') return 'bg-green-50 text-green-700 border-green-200'
  if (status === 'pending') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (status === 'revision') return 'bg-yellow-100 text-yellow-800 border-yellow-300'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-slate-100 text-slate-500 border-slate-200'
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const userId = Number(id)
  const { user: currentUser } = useAuth()
  const location = useLocation()
  const { pushToast } = useToast()
  const chartRef = useRef<HTMLCanvasElement | null>(null)
  const chartInstanceRef = useRef<Chart | null>(null)
  const radarChartRef = useRef<HTMLCanvasElement | null>(null)
  const radarInstanceRef = useRef<Chart | null>(null)
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
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

  const backUrl = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const from = params.get('from')
    if (from === 'documents') return '/documents'
    if (from === 'moderation') return '/moderation/users'
    if (from === 'leaderboard') return '/leaderboard'
    if (from === 'support') {
      const ticketId = params.get('ticket_id')
      return ticketId ? `/moderation/support/${ticketId}` : '/moderation/support'
    }
    return '/users'
  }, [location.search])

  const isGuestOrPending = detail ? detail.user.role === 'GUEST' || detail.user.status === 'pending' : false
  const isAdminViewer = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'MODERATOR'
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
      const [detailResponse, resumeResponse, notesResponse] = await Promise.all([
        usersApi.get(userId),
        usersApi.checkResume(userId),
        usersApi.listNotes(userId),
      ])
      setDetail(detailResponse.data)
      setRole(detailResponse.data.user.role)
      setEducationLevel(detailResponse.data.user.education_level ?? '')
      setModeratorCourses(detailResponse.data.user.moderator_courses ?? [])
      setModeratorGroups(detailResponse.data.user.moderator_groups ?? [])
      setGpa(detailResponse.data.user.session_gpa ?? '')
      setResumeText(resumeResponse.data.resume ?? detailResponse.data.user.resume_text ?? '')
      setCanGenerateResume(resumeResponse.data.can_generate)
      setResumeReason(resumeResponse.data.reason ?? null)
      setNotes(notesResponse.data.notes)
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

    chartInstanceRef.current?.destroy()
    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: detail.chart_labels,
        datasets: [
          {
            label: 'Баллы',
            data: detail.chart_points,
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79, 70, 229, 0.08)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#4f46e5',
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: 'Документов',
            data: detail.chart_counts,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.06)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#10b981',
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 11 }, usePointStyle: true, padding: 16 } }, tooltip: { padding: 10, cornerRadius: 8 } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#94a3b8', stepSize: 1 } },
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748b' } },
        },
      },
    })

    return () => {
      chartInstanceRef.current?.destroy()
      chartInstanceRef.current = null
    }
  }, [detail])

  useEffect(() => {
    if (!radarChartRef.current || !detail?.achievements?.length) return
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
        datasets: RADAR_CATS.map((cat, i) => {
          const val = pointsMap[cat] ?? 0
          const color = RADAR_COLORS[i]
          return {
            label: cat,
            data: RADAR_CATS.map((c) => (c === cat ? val : 0)),
            borderColor: val > 0 ? color.border : 'transparent',
            backgroundColor: val > 0 ? color.bg : 'transparent',
            borderWidth: 2,
            pointBackgroundColor: val > 0 ? color.border : 'transparent',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: val > 0 ? 4 : 0,
            hidden: hiddenCats.has(cat),
          }
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            titleFont: { ...font, weight: 'bold' as const },
            bodyFont: font,
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: (ctx) => ctx.parsed.r > 0 ? ` ${ctx.dataset.label}: ${ctx.parsed.r} б.` : '' },
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            ticks: { font, color: '#94a3b8', backdropColor: 'transparent', stepSize: Math.max(1, Math.ceil(maxVal / 4)) },
            pointLabels: { font: { ...font, size: 11 }, color: '#475569' },
            grid: { color: '#e2e8f0' },
            angleLines: { color: '#e2e8f0' },
          },
        },
      },
    })
    return () => {
      radarInstanceRef.current?.destroy()
      radarInstanceRef.current = null
    }
  }, [detail, hiddenCats])

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
    if (!window.confirm('Удалить заметку?')) return
    try {
      await usersApi.deleteNote(userId, noteId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
      pushToast({ title: 'Заметка удалена', tone: 'success' })
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось удалить заметку.'))
    }
  }

  const handleDeleteUser = async () => {
    if (!detail || !window.confirm(`Перенести пользователя ${detail.user.first_name} ${detail.user.last_name} в удалённые?`)) return
    try {
      await usersApi.delete(userId)
      pushToast({ title: 'Пользователь удалён', tone: 'success' })
      await load()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Не удалось удалить пользователя.'))
    }
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
    if (!window.confirm(`Удалить документ «${title}»?`)) return
    try {
      await documentsApi.delete(documentId)
      pushToast({ title: 'Документ удалён', tone: 'success' })
      await load()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Не удалось удалить документ.'))
    }
  }

  if (isLoading) return <div className="py-16"><LoadingSpinner /></div>
  if (!detail) return null

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
          {isAdminViewer ? <button type="button" onClick={() => setSupportModalOpen(true)} className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-surface border border-slate-200 px-3 py-1.5 rounded-lg">Написать</button> : null}
          <button type="button" onClick={() => void handleExportPdf()} className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-surface border border-slate-200 px-3 py-1.5 rounded-lg">{isExportingPdf ? 'PDF...' : 'PDF'}</button>
          <Link to={backUrl} className="text-sm text-slate-500 hover:text-indigo-600 flex items-center transition-colors">Назад</Link>
        </div>
      </div>

      {error ? <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div> : null}

      <div className="grid grid-cols-1 gap-6">
        <div className={`flex flex-col gap-6 ${isGuestOrPending && !isAdminViewer ? 'max-w-xl mx-auto w-full' : ''}`}>
          <div className="bg-surface rounded-xl border border-slate-200 p-6 text-center flex flex-col items-center shadow-sm">
            <div className="h-28 w-28 mb-4 relative">
              {detail.user.avatar_path ? <img className="h-28 w-28 rounded-full object-cover border border-slate-200" src={buildMediaUrl(detail.user.avatar_path)} alt="Avatar" /> : <div className="h-28 w-28 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 text-3xl font-bold">{detail.user.first_name.slice(0, 1)}{detail.user.last_name.slice(0, 1)}</div>}
            </div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">{detail.user.first_name} {detail.user.last_name}</h1>
            <p className="text-[10px] text-slate-400 mb-1">ID: {detail.user.id}</p>
            <p className="text-xs text-slate-500 mb-4">{detail.user.email}</p>
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-slate-100 text-slate-600 border border-slate-200">{roleLabel(detail.user.role)}</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${detail.user.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : detail.user.status === 'deleted' || detail.user.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>{userStatusLabel(detail.user.status)}</span>
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
                        {moderatorCourseOptions.map((course) => (
                          <label key={course} className="inline-flex items-center gap-1.5 rounded border border-indigo-200 bg-surface px-2.5 py-1.5 text-xs text-slate-700">
                            <input type="checkbox" checked={moderatorCourses.includes(course)} onChange={() => toggleModeratorCourse(course)} />
                            {courseLabel(course)}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider mb-1.5">Группы</div>
                      <div className="flex flex-wrap gap-2">
                        {moderatorGroupOptions.map((group) => (
                          <label key={group} className="inline-flex items-center gap-1.5 rounded border border-indigo-200 bg-surface px-2.5 py-1.5 text-xs text-slate-700">
                            <input type="checkbox" checked={moderatorGroups.includes(group)} onChange={() => toggleModeratorGroup(group)} />
                            {group}
                          </label>
                        ))}
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
            <div className="p-5 space-y-3 text-sm">
              {detail.user.education_level ? <div className="flex justify-between items-center pb-2 border-b border-slate-50"><span className="text-slate-500 text-xs">Обучение / Зона</span><span className="font-medium text-slate-800">{detail.user.education_level}</span></div> : null}
              {detail.user.role === 'MODERATOR' ? <div className="flex justify-between items-center pb-2 border-b border-slate-50 gap-4"><span className="text-slate-500 text-xs">Курсы модерации</span><span className="font-medium text-slate-800 text-right">{detail.user.moderator_courses?.length ? detail.user.moderator_courses.map((item) => courseLabel(item)).join(', ') : 'Все'}</span></div> : null}
              {detail.user.role === 'MODERATOR' ? <div className="flex justify-between items-center pb-2 border-b border-slate-50 gap-4"><span className="text-slate-500 text-xs">Группы модерации</span><span className="font-medium text-slate-800 text-right">{detail.user.moderator_groups?.length ? detail.user.moderator_groups.join(', ') : 'Все'}</span></div> : null}
              <div className="flex justify-between items-center pb-2 border-b border-slate-50"><span className="text-slate-500 text-xs">Курс</span><span className="font-medium text-slate-800">{detail.user.course ? courseLabel(detail.user.course) : 'Не указан'}</span></div>
              {detail.user.study_group ? <div className="flex justify-between items-center pb-2 border-b border-slate-50"><span className="text-slate-500 text-xs">Группа</span><span className="font-medium text-slate-800">{detail.user.study_group}</span></div> : null}
              <div className="flex justify-between items-center pb-2 border-b border-slate-50"><span className="text-slate-500 text-xs">Телефон</span><span className="font-medium text-slate-800">{detail.user.phone_number || 'Не указан'}</span></div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-50"><span className="text-slate-500 text-xs">Регистрация</span><span className="font-medium text-slate-800">{detail.user.created_at ? new Date(detail.user.created_at).toLocaleDateString('ru-RU') : 'Дата не указана'}</span></div>
            </div>
          </div>

          {isAdminViewer && detail.user.role === 'STUDENT' ? <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm"><div className="px-5 py-3 border-b border-slate-100"><h3 className="text-sm font-bold text-slate-700">Средний балл сессии</h3></div><div className="p-5"><div className="flex gap-2"><input type="text" value={gpa} onChange={(event) => setGpa(event.target.value)} placeholder="4.5" className="flex-1 px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all" /><button type="button" onClick={() => void handleGpaSave()} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors" disabled={isSavingGpa}>Сохранить</button></div><p className="text-[10px] text-slate-400 mt-1.5">Оценка от 2.0 до 5.0, конвертируется в бонусные баллы рейтинга</p></div></div> : null}
        </div>

        {!isGuestOrPending || isAdminViewer ? <div className="space-y-6">
          {!isGuestOrPending ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Документов в текущем сезоне</div><div className="text-2xl font-semibold text-slate-800 mt-1">{detail.total_docs}</div></div>{detail.rank ? <div className="bg-surface p-5 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm"><div><div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Текущее место</div><div className="text-2xl font-bold text-indigo-600 mt-1">#{detail.rank}</div></div><div className="w-px h-8 bg-slate-200" /><div className="text-right"><div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Баллы</div><div className="text-2xl font-bold text-indigo-600 mt-1">{detail.total_points}</div></div></div> : null}</div> : null}

          <div className="bg-indigo-50/60 p-5 sm:p-6 rounded-xl border border-indigo-100 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div><h3 className="text-base font-bold text-indigo-900">AI-сводка профиля</h3><p className="text-xs text-indigo-700/70 mt-1">Формируется автоматически на основе подтверждённых достижений студента.</p></div>
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-100/70 px-3 py-1 text-[11px] font-semibold text-indigo-700 whitespace-nowrap">Скоро — в разработке</span>
            </div>
            {resumeText ? <div className="bg-surface border border-indigo-100/80 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed shadow-sm">{resumeText}</div> : <div className="text-center py-6 bg-surface/50 border border-indigo-100 border-dashed rounded-lg text-indigo-400 text-xs mt-2">Резюме будет формироваться автоматически. Функция скоро появится.</div>}
          </div>

          {detail.season_history.length ? <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden text-white shadow-md relative"><div className="px-5 py-3 border-b border-slate-700/50 flex justify-between items-center relative z-10"><h3 className="text-sm font-bold text-white">Зал славы (Архив сезонов)</h3></div><div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">{detail.season_history.map((item) => <div key={item.id} className="bg-surface/10 rounded-lg p-4 flex justify-between items-center border border-white/5 hover:bg-surface/20 transition-colors"><div><div className="text-xs font-bold text-slate-200">{item.season_name}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-semibold">Место: <span className="text-white text-sm">#{item.rank}</span></div></div><div className="text-xl font-black text-yellow-400">{item.points} <span className="text-[10px] font-normal text-slate-400">б.</span></div></div>)}</div></div> : null}

          <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-700">Документы текущего сезона</h3>
              {detail.user.status === 'deleted' ? (
                <button type="button" onClick={() => void handleRestoreUser()} disabled={isRestoringUser} className="text-xs font-medium text-green-600 hover:text-green-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60">
                  {isRestoringUser ? 'Восстановление...' : 'Восстановить пользователя'}
                </button>
              ) : (
                <button type="button" onClick={() => void handleDeleteUser()} className="text-xs font-medium text-slate-400 hover:text-red-600 transition-colors">
                  Удалить пользователя
                </button>
              )}
            </div>
            {detail.achievements.length ? (
              <ul className="divide-y divide-slate-100">
                {detail.achievements.map((item) => (
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
          </div>

          {detail.user.role === 'STUDENT' ? <div className="bg-surface rounded-xl border border-slate-200 p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Динамика достижений</h3>{detail.chart_labels.length ? <div className="h-48"><canvas ref={chartRef} /></div> : <div className="text-center py-8 text-sm text-slate-400">Нет одобренных достижений для отображения графика</div>}</div> : null}

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

          {detail.user.role === 'STUDENT' && detail.achievements.length ? (() => {
            const pointsMap: Record<string, number> = {}
            for (const cat of RADAR_CATS) pointsMap[cat] = 0
            for (const a of detail.achievements) {
              const cat = a.category as string
              if (cat in pointsMap) pointsMap[cat] = (pointsMap[cat] ?? 0) + (a.points ?? 0)
            }
            const activeCats = RADAR_CATS.filter((c) => pointsMap[c] > 0)
            if (!activeCats.length) return null
            return (
              <div className="bg-surface rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Портрет достижений</h3>
                <div className="h-64">
                  <canvas ref={radarChartRef} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {activeCats.map((cat) => {
                    const idx = RADAR_CATS.indexOf(cat)
                    const color = RADAR_COLORS[idx]
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
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isHidden ? '#cbd5e1' : color.border }} />
                        {cat}
                        <span className="text-[10px] font-semibold ml-0.5" style={{ color: isHidden ? '#94a3b8' : color.border }}>
                          {pointsMap[cat]} б.
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })() : null}
        </div> : null}
      </div>

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
