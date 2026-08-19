import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Chart from 'chart.js/auto'

import client from '@/api/client'
import { publicApi, PublicStudentResponse } from '@/api/public'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { getErrorMessage } from '@/utils/http'
import { courseLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return <div className="min-h-screen flex items-center justify-center"><p className="text-red-500">Ошибка загрузки страницы. Попробуйте обновить.</p></div>
    }
    return this.props.children
  }
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ru-RU')
}


function isPdf(url?: string | null) {
  return /\.pdf$/i.test(url ?? '')
}

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

function StudentProfilePageInner() {
  const { id } = useParams<{ id: string }>()
  const studentId = Number(id)
  const { user: currentUser } = useAuth()
  const isOwnProfile = currentUser?.id === studentId
  const isStaff = currentUser?.role === 'MODERATOR' || currentUser?.role === 'SUPER_ADMIN'
  const canViewDocs = isOwnProfile || isStaff
  const navigate = useNavigate()
  const progressChartRef = useRef<HTMLCanvasElement>(null)
  const radarChartRef = useRef<HTMLCanvasElement>(null)
  const progressInstanceRef = useRef<Chart | null>(null)
  const radarInstanceRef = useRef<Chart | null>(null)
  const [data, setData] = useState<PublicStudentResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!previewUrl) {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl)
        setPreviewBlobUrl(null)
      }
      return
    }
    let revoked = false
    let createdUrl: string | null = null
    setPreviewLoading(true)
    ;(async () => {
      try {
        const resp = await client.get(previewUrl.replace(/^\/api\/v1/, ''), { responseType: 'blob' })
        if (revoked) return
        createdUrl = URL.createObjectURL(resp.data as Blob)
        setPreviewBlobUrl(createdUrl)
      } catch {
        if (!revoked) setPreviewUrl(null)
      } finally {
        if (!revoked) setPreviewLoading(false)
      }
    })()
    return () => {
      revoked = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    const load = async () => {
      if (!Number.isFinite(studentId)) {
        setError('Некорректный идентификатор студента.')
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError(null)
      try {
        const response = await publicApi.getStudent(studentId)
        setData(response.data)
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Не удалось загрузить публичный профиль.'))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [studentId])

  useEffect(() => {
    if (!data) return

    // Progress chart
    if (progressChartRef.current && data.chart_labels?.length) {
      progressInstanceRef.current?.destroy()
      const font = { family: "'Inter', system-ui, sans-serif", size: 10 }
      progressInstanceRef.current = new Chart(progressChartRef.current, {
        type: 'line',
        data: {
          labels: data.chart_labels,
          datasets: [
            {
              label: 'Баллы (накопительно)',
              data: data.chart_cumulative,
              borderColor: '#6366f1',
              backgroundColor: 'rgba(99, 102, 241, 0.06)',
              fill: true,
              borderWidth: 2,
              tension: 0.35,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#6366f1',
              pointBorderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 6,
              yAxisID: 'y',
            },
            {
              label: 'Баллы за месяц',
              data: data.chart_points,
              borderColor: '#a78bfa',
              backgroundColor: 'rgba(167, 139, 250, 0.06)',
              fill: true,
              borderWidth: 1.5,
              borderDash: [5, 3],
              tension: 0.35,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#a78bfa',
              pointBorderWidth: 1.5,
              pointRadius: 2.5,
              pointHoverRadius: 5,
              yAxisID: 'y',
            },
            {
              label: 'Загрузки',
              data: data.chart_uploads,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.06)',
              fill: true,
              borderWidth: 1.5,
              tension: 0.35,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#10b981',
              pointBorderWidth: 1.5,
              pointRadius: 2.5,
              pointHoverRadius: 5,
              yAxisID: 'y1',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { font, usePointStyle: true, pointStyle: 'circle', padding: 16, boxWidth: 8, boxHeight: 8 } },
            tooltip: { backgroundColor: '#1e293b', titleFont: { ...font, weight: 'bold' }, bodyFont: font, padding: 10, cornerRadius: 8, boxPadding: 4 },
          },
          scales: {
            y: { beginAtZero: true, position: 'left', grid: { color: '#f1f5f9' }, ticks: { font, color: '#94a3b8' }, title: { display: true, text: 'Баллы', font: { ...font, size: 9 }, color: '#94a3b8' } },
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font, color: '#10b981', stepSize: 1 }, title: { display: true, text: 'Документы', font: { ...font, size: 9 }, color: '#10b981' } },
            x: { grid: { display: false }, ticks: { font, color: '#64748b' } },
          },
        },
      })
    }

    return () => {
      progressInstanceRef.current?.destroy()
      progressInstanceRef.current = null
    }
  }, [data])

  // Radar chart — rebuild when data or hiddenCats changes
  useEffect(() => {
    if (!radarChartRef.current || !data?.achievements?.length) return
    const pointsMap: Record<string, number> = {}
    for (const cat of RADAR_CATS) pointsMap[cat] = 0
    for (const a of data.achievements) {
      if (a.category && a.category in pointsMap) {
        pointsMap[a.category] = (pointsMap[a.category] ?? 0) + (a.points ?? 0)
      }
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
          data: RADAR_CATS.map((cat) => hiddenCats.has(cat) ? 0 : (pointsMap[cat] ?? 0)),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.16)',
          borderWidth: 2,
          pointBackgroundColor: RADAR_CATS.map((cat, i) => hiddenCats.has(cat) ? 'transparent' : RADAR_COLORS[i].border),
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: RADAR_CATS.map((cat) => hiddenCats.has(cat) ? 0 : 4),
          pointHoverRadius: 5,
        }],
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
            callbacks: { label: (ctx) => ctx.parsed.r > 0 ? ` ${ctx.label}: ${ctx.parsed.r} б.` : '' },
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
  }, [data, hiddenCats])

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/dashboard')
    }
  }

  if (isLoading) return <div className="py-16"><LoadingSpinner /></div>
  if (!data) return null

  const hasChartData = Boolean(data.chart_labels?.length)
  const catStats = data.category_breakdown ?? []
  const topCategories = catStats.slice(0, 4)

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <button type="button" onClick={handleBack} className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-700">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          Назад
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Публичный профиль</span>
          <ThemeToggle />
        </div>
      </div>

      {/* Profile card */}
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 mb-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center">
          <div className="flex-shrink-0">
            {data.student.avatar_path ? (
              <img src={buildMediaUrl(data.student.avatar_path)} alt="Аватар" className="w-20 h-20 rounded-full object-cover border-2 border-slate-200" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                {data.student.first_name[0]}{data.student.last_name[0]}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 text-center xl:text-left">
            <h1 className="text-2xl font-bold text-slate-800">{data.student.first_name} {data.student.last_name}</h1>
            {data.student.study_group ? (
              <p className="text-sm text-slate-400 mt-1">{data.student.study_group}</p>
            ) : null}
            <p className="text-sm text-slate-500 mt-1">
              {data.student.education_level ? `${data.student.education_level}${data.student.course ? `, ${courseLabel(data.student.course)}` : ''}` : ''}
            </p>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-auto xl:min-w-[420px] xl:grid-cols-4">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{data.total_points}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Баллов</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <div className="text-2xl font-bold text-slate-700">{data.total_docs}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Достижений</div>
            </div>
            {data.group_rank ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-center">
                <div className="text-2xl font-bold text-indigo-500">#{data.group_rank}</div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider">
                  В группе{data.group_total ? ` из ${data.group_total}` : ''}
                </div>
              </div>
            ) : null}
            {data.rank ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-center">
                <div className="text-2xl font-bold text-indigo-600">#{data.rank}</div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider">
                  Глобально{data.global_total ? ` из ${data.global_total}` : ''}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <section className="bg-surface rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">Профиль и успеваемость</h3>
            {data.student.session_gpa ? <span className="text-xs font-medium text-indigo-600">Оценка модератора</span> : null}
          </div>
          <div className={`grid gap-4 p-4 ${data.student.session_gpa ? 'xl:grid-cols-[minmax(0,1fr)_260px]' : ''}`}>
            <div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Обучение</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{data.student.education_level || 'Не указано'}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Курс</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{data.student.course ? courseLabel(data.student.course) : 'Не указан'}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Группа</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{data.student.study_group || 'Не указана'}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Категорий</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{catStats.length || 0}</div>
              </div>
            </div>
            {topCategories.length ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">Сильные направления</div>
                <div className="flex flex-wrap gap-2">
                  {topCategories.map((item) => (
                    <span key={item.category} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                      {item.category}
                      <span className="ml-1 text-slate-400">x{item.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            </div>
            {data.student.session_gpa ? (
              <div className="border-t border-slate-100 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Средний балл сессии</div>
                  <div className="mt-1 text-3xl font-bold text-slate-800">{data.student.session_gpa}</div>
                </div>
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-indigo-400">Бонус в рейтинг</div>
                  <div className="mt-1 text-2xl font-bold text-indigo-700">+{data.gpa_bonus}</div>
                </div>
              </div>
              </div>
            ) : null}
          </div>
        </section>

        {(hasChartData || data.achievements?.length) ? (
          <section className="bg-surface rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Аналитика достижений</h3>
              <p className="mt-0.5 text-xs text-slate-400">Динамика баллов и распределение по направлениям</p>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              {hasChartData ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-slate-600">Динамика</h4>
                  <div className="h-56 w-full"><canvas ref={progressChartRef} /></div>
                </div>
              ) : null}
              {data.achievements?.length ? (() => {
            const pointsMap: Record<string, number> = {}
            for (const cat of RADAR_CATS) pointsMap[cat] = 0
            for (const a of data.achievements) {
              if (a.category && a.category in pointsMap) {
                pointsMap[a.category] = (pointsMap[a.category] ?? 0) + (a.points ?? 0)
              }
            }
            const activeCats = RADAR_CATS.filter((c) => pointsMap[c] > 0)
            if (!activeCats.length) return null
            return (
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <h4 className="mb-2 text-xs font-semibold text-slate-600">Портрет</h4>
                <div className="h-56">
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
            </div>
          </section>
        ) : null}

          <div className="bg-surface rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Достижения ({data.total_docs})</h3>
            {data.achievements.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {data.achievements.map((a) => (
                  <div
                    key={a.id}
                    className={`group bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all overflow-hidden ${canViewDocs && a.preview_url ? 'cursor-pointer' : ''}`}
                    onClick={() => canViewDocs && a.preview_url && setPreviewUrl(a.preview_url)}
                  >
                    <div className="p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800 min-h-[2.5rem]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.title}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {a.preview_url && (
                            <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-medium px-1.5 py-0.5">
                              {isPdf(a.preview_url) ? 'PDF' : 'Фото'}
                            </span>
                          )}
                          <div className="inline-flex items-center rounded-full bg-green-500 text-white text-[10px] font-bold px-2 py-1 shadow-sm">
                            +{a.points || 0}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.category ? <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">{a.category}</span> : null}
                        {a.result ? <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">{a.result}</span> : null}
                        {a.level ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{a.level}</span> : null}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">{formatDate(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-8">Нет одобренных достижений</p>
            )}
          </div>
      </div>


      <p className="text-center text-xs text-slate-400 mt-8">Sirius.Achievements &copy; 2026</p>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Просмотр документа</span>
              <div className="flex items-center gap-2">
                {previewBlobUrl ? (
                  <a
                    href={previewBlobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 bg-surface border border-indigo-200 hover:bg-indigo-50 transition-colors"
                  >
                    Открыть в новой вкладке
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPreviewUrl(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 flex items-center justify-center min-h-[400px]">
              {previewLoading || !previewBlobUrl ? (
                <LoadingSpinner />
              ) : isPdf(previewUrl) ? (
                <iframe
                  src={previewBlobUrl}
                  className="w-full h-full min-h-[500px] border-0 bg-surface"
                  title="PDF"
                  allow="fullscreen"
                />
              ) : (
                <img src={previewBlobUrl} alt="Документ" className="max-w-full max-h-full object-contain rounded-lg shadow-sm m-4" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function StudentProfilePage() {
  return (
    <ErrorBoundary>
      <StudentProfilePageInner />
    </ErrorBoundary>
  )
}
