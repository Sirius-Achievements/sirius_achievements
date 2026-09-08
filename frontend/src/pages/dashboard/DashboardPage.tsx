import Chart from 'chart.js/auto'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { dashboardApi, type DashboardStats } from '@/api/dashboard'
import { PointsGuide } from '@/components/points/PointsGuide'
import { StaffDashboardTabs, StaffDashboardWorkspace, type StaffDashboardTab } from '@/components/dashboard/StaffDashboardWorkspace'
import { useAuth } from '@/hooks/useAuth'
import { formatDateTime } from '@/utils/formatDate'
import { getErrorMessage } from '@/utils/http'
import { courseLabel, coursesForEducationLevel, groupsForEducationLevel } from '@/utils/labels'

const PERIODS = ['day', 'week', 'month', 'all'] as const
const RANGE_PERIODS = ['day', 'week', 'month'] as const

type SeasonPickerOption = {
  value: string
  label: string
  description: string
}

function SeasonPicker({ value, options, onChange }: { value: string; options: SeasonPickerOption[]; onChange: (value: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!isOpen) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  return (
    <div ref={rootRef} className="season-picker">
      <button
        type="button"
        className="season-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="min-w-0 text-left">
          <span className="season-picker__value">{selected.label}</span>
          <span className="season-picker__description">{selected.description}</span>
        </span>
        <svg className={`season-picker__chevron ${isOpen ? 'season-picker__chevron--open' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen ? (
        <div className="season-picker__menu" role="listbox" aria-label="Выбор рейтинга">
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`season-picker__option ${isSelected ? 'season-picker__option--selected' : ''}`}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
              >
                <span className="min-w-0">
                  <span className="season-picker__option-label">{option.label}</span>
                  <span className="season-picker__option-description">{option.description}</span>
                </span>
                {isSelected ? (
                  <svg className="season-picker__check" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function normalizePeriod(value: string | null) {
  return PERIODS.includes((value ?? '') as (typeof PERIODS)[number]) ? (value as (typeof PERIODS)[number]) : 'all'
}

function periodDescription(period: string, season: string) {
  const seasonLabel = season === 'global' ? 'Глобальная статистика' : season === 'current' ? 'Текущий сезон' : `Сезон «${season}»`
  const completed = season !== 'global' && season !== 'current'
  if (period === 'day') return `${seasonLabel} · ${completed ? 'последний день сезона' : 'последние 24 часа'}`
  if (period === 'week') return `${seasonLabel} · ${completed ? 'последняя неделя сезона' : 'последние 7 дней'}`
  if (period === 'month') return `${seasonLabel} · ${completed ? 'последний месяц сезона' : 'последние 30 дней'}`
  return `${seasonLabel} · ${season === 'global' ? 'всё время' : 'весь сезон'}`
}

function statusLabel(status: string) {
  if (status === 'approved') return 'Одобрено'
  if (status === 'rejected') return 'Отклонено'
  if (status === 'revision') return 'На доработке'
  return 'Проверка'
}

function statusClass(status: string) {
  if (status === 'approved') return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-200'
  if (status === 'rejected') return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200'
  if (status === 'revision') return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-100 text-yellow-800 border border-yellow-300'
  return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200'
}

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<Chart | null>(null)

  const period = normalizePeriod(searchParams.get('period'))
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const season = searchParams.get('season') ?? 'current'
  const isStaff = user?.role === 'MODERATOR' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isDeletedAccount = user?.status === 'deleted'
  const isRejectedAccount = user?.status === 'rejected'
  const requestedStaffTab = (searchParams.get('tab') ?? 'overview') as StaffDashboardTab
  const allowedStaffTabs: StaffDashboardTab[] = isSuperAdmin
    ? ['overview', 'work', 'export', 'current', 'comparison', 'management', 'system']
    : ['overview', 'work', 'export', 'current', 'comparison']
  const activeStaffTab: StaffDashboardTab = allowedStaffTabs.includes(requestedStaffTab) ? requestedStaffTab : 'overview'
  const statsSeason = isStaff && activeStaffTab === 'current' ? 'current' : season

  const loadDashboard = useCallback(async () => {
    if (isDeletedAccount || isRejectedAccount) {
      setStats(null)
      setError(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const response = await dashboardApi.getStats(period, dateFrom, dateTo, statsSeason)
      setStats(response.data)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить дашборд.'))
    } finally {
      setIsLoading(false)
    }
  }, [dateFrom, dateTo, isDeletedAccount, isRejectedAccount, period, statsSeason])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    const canvas = chartCanvasRef.current
    if (!canvas || !stats) return

    const root = document.documentElement
    const cssVar = (name: string, fallback: string) => getComputedStyle(root).getPropertyValue(name).trim() || fallback
    const dark = () => root.dataset.theme === 'dark'

    const destroy = () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }

    const renderChart = () => {
      destroy()
      if (isStaff && stats.chart_data?.labels?.length && stats.chart_data.counts?.length) {
        chartRef.current = new Chart(canvas.getContext('2d')!, {
          type: 'line',
          data: {
            labels: stats.chart_data.labels,
            datasets: [{
              label: 'Загружено документов',
              data: stats.chart_data.counts,
              borderColor: dark() ? cssVar('--theme-accent-strong', '#d65a43') : cssVar('--theme-accent', '#4f46e5'),
              backgroundColor: dark() ? 'rgba(214, 90, 67, 0.18)' : 'rgba(79, 70, 229, 0.08)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointBackgroundColor: cssVar('--theme-surface', '#ffffff'),
              pointBorderColor: dark() ? cssVar('--theme-accent-strong', '#d65a43') : cssVar('--theme-accent-strong', '#4338ca'),
              pointRadius: 3,
              pointHoverRadius: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (_event, elements) => {
              const index = elements[0]?.index
              const bucketDate = typeof index === 'number' ? stats.chart_data?.dates?.[index] : undefined
              if (!bucketDate) return
              const start = new Date(`${bucketDate}T00:00:00`)
              const end = new Date(start)
              if (period === 'all' && !dateFrom && !dateTo) {
                end.setMonth(end.getMonth() + 1)
                end.setDate(0)
              }
              const toIsoDate = (value: Date) => value.toISOString().slice(0, 10)
              navigate(`/documents?date_from=${bucketDate}&date_to=${toIsoDate(end)}&season=${encodeURIComponent(season)}`)
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                padding: 10,
                cornerRadius: 8,
                backgroundColor: dark() ? 'rgba(13, 17, 19, 0.96)' : 'rgba(15, 23, 42, 0.9)',
              },
            },
            scales: {
              y: { beginAtZero: true, grid: { color: cssVar('--theme-border-soft', '#ebeff6') }, ticks: { color: cssVar('--theme-text-faint', '#94a3b8'), stepSize: 1, font: { size: 11 } } },
              x: { grid: { display: false }, ticks: { color: cssVar('--theme-text-muted', '#64748b'), font: { size: 11 } } },
            },
          },
        })
        return
      }
      if (!isStaff && (stats.my_points ?? 0) > 0 && stats.category_breakdown?.length) {
        const isDarkTheme = dark()
        const segmentCount = stats.category_breakdown.length
        const primaryColor = cssVar('--theme-accent', isDarkTheme ? '#b34230' : '#4cbdcf')
        const translucentPrimary = isDarkTheme ? 'rgba(179, 66, 48, 0.5)' : 'rgba(76, 189, 207, 0.5)'
        const legendTextColor = cssVar('--theme-text-soft', '#556074')
        type ScoreStructureChart = Chart & { $scoreHoverIndex?: number | null }
        const setScoreHover = (chart: Chart, index: number | null, syncSegment = false) => {
          const scoreChart = chart as ScoreStructureChart
          const activeSegment = chart.getActiveElements()[0]?.index ?? null
          if (scoreChart.$scoreHoverIndex === index && (!syncSegment || activeSegment === index)) return

          scoreChart.$scoreHoverIndex = index
          if (syncSegment) {
            chart.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }])
          }
          chart.update('none')
        }

        chartRef.current = new Chart(canvas.getContext('2d')!, {
          type: 'doughnut',
          data: {
            labels: stats.category_breakdown.map((item) => item.category),
            datasets: [{
              data: stats.category_breakdown.map((item) => item.points),
              backgroundColor: Array(segmentCount).fill(translucentPrimary),
              hoverBackgroundColor: Array(segmentCount).fill(primaryColor),
              borderWidth: 2,
              borderColor: cssVar('--theme-surface', '#ffffff'),
              hoverBorderColor: primaryColor,
              hoverOffset: 4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            onHover: (_event, elements, chart) => {
              setScoreHover(chart, elements[0]?.index ?? null)
            },
            plugins: {
              legend: {
                position: 'right',
                onHover: (_event, item, legend) => setScoreHover(legend.chart, item.index ?? null, true),
                onLeave: (_event, _item, legend) => setScoreHover(legend.chart, null, true),
                labels: {
                  usePointStyle: true,
                  boxWidth: 8,
                  color: legendTextColor,
                  font: { size: 11 },
                  generateLabels: (chart) => {
                    const activeIndex = (chart as ScoreStructureChart).$scoreHoverIndex ?? null
                    return (chart.data.labels ?? []).map((label, index) => ({
                      text: Array.isArray(label) ? label.join(' ') : String(label),
                      index,
                      hidden: !chart.getDataVisibility(index),
                      fillStyle: index === activeIndex ? primaryColor : translucentPrimary,
                      strokeStyle: index === activeIndex ? primaryColor : translucentPrimary,
                      fontColor: index === activeIndex ? primaryColor : legendTextColor,
                      lineWidth: index === activeIndex ? 2 : 0,
                      pointStyle: 'circle',
                    }))
                  },
                },
              },
              tooltip: { padding: 12, cornerRadius: 8, backgroundColor: dark() ? 'rgba(13, 17, 19, 0.96)' : 'rgba(15, 23, 42, 0.9)' },
            },
          },
        })
      }
    }

    renderChart()
    const onTheme = () => renderChart()
    document.addEventListener('themechange', onTheme)
    return () => {
      document.removeEventListener('themechange', onTheme)
      destroy()
    }
  }, [dateFrom, dateTo, isStaff, navigate, period, season, stats])

  if (isDeletedAccount || stats?.deleted_account) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="min-h-[50vh] flex flex-col items-center justify-center text-center p-4">
          <div className="bg-surface p-8 rounded-xl border border-red-200 max-w-md w-full shadow-sm">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M5.07 19h13.86A2 2 0 0020.66 16L13.73 4a2 2 0 00-3.46 0L3.34 16A2 2 0 005.07 19z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Аккаунт удалён</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Доступ к функциям ограничен. Напишите в поддержку, если нужно восстановить данные или уточнить статус аккаунта.
            </p>
            <Link
              to="/support"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Написать в поддержку
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (isRejectedAccount) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="flex min-h-[50vh] items-center justify-center p-4 text-center">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-surface p-8 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800">Регистрация отклонена</h2>
            <p className="mt-3 text-sm text-slate-500">Причина модератора:</p>
            <p className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{user?.registration_rejection_reason || 'Причина не указана. Обратитесь в поддержку.'}</p>
            <Link to="/support" className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white">Написать в поддержку</Link>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading && !stats) {
    return <div className="max-w-6xl mx-auto bg-surface rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500 shadow-sm">Загрузка данных…</div>
  }

  if (error && !stats) {
    return <div className="max-w-6xl mx-auto bg-surface rounded-xl border border-red-200 p-6 text-sm text-red-700 shadow-sm">{error}</div>
  }

  if (stats?.pending_review) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="min-h-[50vh] flex flex-col items-center justify-center text-center p-4">
          <div className="bg-surface p-8 rounded-xl border border-yellow-200 max-w-md w-full shadow-sm">
            <div className="w-16 h-16 bg-yellow-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Аккаунт на проверке</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">Спасибо за регистрацию! Ваша учетная запись проходит модерацию. Пожалуйста, подождите одобрения администратором.</p>
            <div className="bg-yellow-50 text-yellow-800 px-4 py-3 rounded-lg text-xs font-medium border border-yellow-100">Доступ к функциям временно ограничен</div>
          </div>
        </div>
      </div>
    )
  }

  const setPeriod = (nextPeriod: (typeof PERIODS)[number]) => {
    const next = new URLSearchParams(searchParams)
    next.set('period', nextPeriod)
    next.delete('date_from')
    next.delete('date_to')
    setSearchParams(next)
  }

  const setDashboardDate = (key: 'date_from' | 'date_to', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (value) next.set('period', 'all')
    setSearchParams(next)
  }

  const setSeason = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'current') next.delete('season')
    else next.set('season', value)
    next.set('period', 'all')
    next.delete('date_from')
    next.delete('date_to')
    setSearchParams(next)
  }

  const setPeriodMode = (mode: 'all' | 'range') => {
    if (mode === 'all') {
      setPeriod('all')
      return
    }
    if (period === 'all' && !dateFrom && !dateTo) setPeriod('month')
  }

  const setStaffTab = (value: StaffDashboardTab) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'overview') next.delete('tab')
    else next.set('tab', value)
    if (value === 'current') next.delete('season')
    setSearchParams(next)
  }

  const staffCards = [
    { label: 'Новых студентов', value: `+${stats?.new_users_count ?? 0}`, trend: stats?.trend?.new_users },
    { label: 'Всего загружено док.', value: `${stats?.total_achievements ?? 0}`, trend: stats?.trend?.documents },
    { label: 'Одобрено модерацией', value: `${stats?.approved_achievements ?? 0}`, trend: stats?.trend?.approved },
  ]
  const studentCards = [
    { label: 'Баллы за период', value: `${stats?.my_points ?? 0}`, accent: true },
    { label: 'Место в потоке', value: (stats?.my_rank ?? 0) > 0 ? `#${stats?.my_rank}` : '-' },
    { label: 'Загружено документов', value: `${stats?.my_docs ?? 0}` },
    { label: 'На проверке', value: `${stats?.pending_achievements ?? 0}` },
  ]
  const hasCustomDates = Boolean(dateFrom || dateTo)
  const periodMode = period === 'all' && !hasCustomDates ? 'all' : 'range'
  const selectedSeasonMeta = season !== 'current' && season !== 'global'
    ? stats?.available_seasons?.find((item) => item.name === season)
    : null
  const dateMin = selectedSeasonMeta?.start_at?.slice(0, 10) ?? stats?.current_season?.start_at?.slice(0, 10)
  const dateMax = selectedSeasonMeta?.ended_at?.slice(0, 10)
  const seasonOptions: SeasonPickerOption[] = [
    { value: 'global', label: 'Глобальный рейтинг', description: 'Все подтверждённые баллы за всё время' },
    { value: 'current', label: 'Текущий сезон', description: 'Результаты активного сезона' },
    ...(stats?.available_seasons ?? []).map((item) => ({
      value: item.name,
      label: `Архив · ${item.name}`,
      description: `Завершённый сезон · ${item.participants} участников`,
    })),
  ]

  if (isStaff && activeStaffTab !== 'overview') {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <StaffDashboardTabs active={activeStaffTab} isSuperAdmin={isSuperAdmin} onSelect={setStaffTab} />
        <StaffDashboardWorkspace active={activeStaffTab} stats={stats} onRefresh={loadDashboard} />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {isStaff ? <StaffDashboardTabs active={activeStaffTab} isSuperAdmin={isSuperAdmin} onSelect={setStaffTab} /> : null}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{isStaff ? 'Обзор статистики' : 'Мой прогресс'}</h2>
          <p className="text-sm text-slate-500 mt-1">{periodDescription(period, season)}</p>
        </div>

        <div className="w-full lg:max-w-[720px] space-y-2">
          <div className="flex min-h-[54px] items-center gap-3 rounded-xl border border-slate-200 bg-surface px-3 py-1.5 shadow-sm">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Рейтинг</span>
            <SeasonPicker value={season} options={seasonOptions} onChange={setSeason} />
          </div>
          <div className="grid min-h-[46px] grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-surface p-1 text-sm font-semibold shadow-sm">
            <button type="button" onClick={() => setPeriodMode('all')} className={`rounded-lg px-3 py-2 transition-colors ${periodMode === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {season === 'global' ? 'Всё время' : 'Весь сезон'}
            </button>
            <button type="button" onClick={() => setPeriodMode('range')} className={`rounded-lg px-3 py-2 transition-colors ${periodMode === 'range' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              По отрезку
            </button>
          </div>
          {periodMode === 'range' ? <>
          <div className="grid min-h-[42px] grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-semibold">
            {RANGE_PERIODS.map((item) => (
              <button key={item} type="button" onClick={() => setPeriod(item)} className={`rounded-lg px-3 py-2 transition-colors ${period === item && !hasCustomDates ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-surface'}`}>
                {{ day: 'День', week: 'Неделя', month: 'Месяц' }[item]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm">
              <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10m-11 9h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v11a2 2 0 002 2z" />
              </svg>
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">С</span>
              <input type="date" min={dateMin} max={dateMax} value={dateFrom} onChange={(event) => setDashboardDate('date_from', event.target.value)} className="w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-slate-700 outline-none" />
            </label>
            <label className="flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm">
              <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10m-11 9h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v11a2 2 0 002 2z" />
              </svg>
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">По</span>
              <input type="date" min={dateMin} max={dateMax} value={dateTo} onChange={(event) => setDashboardDate('date_to', event.target.value)} className="w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-slate-700 outline-none" />
            </label>
          </div>
          {selectedSeasonMeta ? <p className="px-1 text-xs text-slate-500">Отрезки считаются внутри сезона: {new Date(selectedSeasonMeta.start_at).toLocaleDateString('ru-RU')}–{selectedSeasonMeta.ended_at ? new Date(selectedSeasonMeta.ended_at).toLocaleDateString('ru-RU') : 'дата завершения не указана'}.</p> : null}
          </> : null}
        </div>
      </div>

      {error ? <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {!isStaff ? <PointsGuide /> : null}

      {isStaff ? (
        <>
          <PointsGuide />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {staffCards.map((card) => (
              <div key={card.label} className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-indigo-500"></div><p className="text-[10px] text-slate-600 uppercase font-bold tracking-wider">{card.label}</p></div>
                <p className="text-3xl font-semibold text-slate-800">{card.value}</p>
                {typeof card.trend === 'number' ? (
                  <p className={`mt-2 text-xs font-semibold ${card.trend >= 0 ? 'text-indigo-600' : 'text-slate-500'}`}>
                    {card.trend > 0 ? '+' : ''}{card.trend}% к прошлому периоду
                  </p>
                ) : null}
              </div>
            ))}
            <div className="bg-indigo-600 p-5 rounded-xl shadow-sm flex flex-col text-white relative overflow-hidden">
              <div className="absolute -right-4 -top-4 opacity-10"><svg className="w-24 h-24" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 9V5a1 1 0 012 0v4h2.5a.5.5 0 010 1h-3A1.5 1.5 0 019 9z"></path></svg></div>
              <div className="flex items-center gap-2 mb-2 relative z-10"><div className="w-2 h-2 rounded-full bg-surface/60"></div><p className="text-[10px] text-white/90 uppercase font-bold tracking-wider">Ожидают проверки</p></div>
              <div className="flex items-end justify-between gap-3 relative z-10 mt-auto">
                <p className="text-3xl font-bold text-white leading-none">{stats?.pending_achievements ?? 0}</p>
                {(stats?.pending_achievements ?? 0) > 0 ? (
                  <Link to="/moderation/achievements" className="shrink-0 text-[11px] bg-white text-indigo-700 px-2.5 py-1 rounded font-bold hover:bg-indigo-50 transition-colors shadow-sm">
                    Проверить →
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[
              {
                title: 'Пользователи',
                href: '/users',
                items: [
                  ['Всего', stats?.users_stats?.total],
                  ['Активные', stats?.users_stats?.active],
                  ['Ожидают проверки', stats?.users_stats?.pending],
                  ['Удалены', stats?.users_stats?.deleted],
                  ['Студенты', stats?.users_stats?.students],
                  ['Модераторы', stats?.users_stats?.moderators],
                ],
              },
              {
                title: 'Документы',
                href: '/documents',
                items: [
                  ['Всего', stats?.documents_stats?.total],
                  ['На проверке', stats?.documents_stats?.pending],
                  ['Одобрено', stats?.documents_stats?.approved],
                  ['Отклонено', stats?.documents_stats?.rejected],
                  ['На доработке', stats?.documents_stats?.revision],
                  ['Со ссылкой', stats?.documents_stats?.with_link],
                ],
              },
              {
                title: 'Обращения',
                href: '/moderation/support?tab=all',
                items: [
                  ['Всего за период', stats?.support_stats?.total],
                  ['Открытые', stats?.support_stats?.open],
                  ['В работе', stats?.support_stats?.in_progress],
                  ['Закрытые', stats?.support_stats?.closed],
                ],
              },
            ].map((group) => (
              <Link key={group.title} to={group.href} className="block bg-surface rounded-xl border border-slate-200 p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md">
                <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{group.title}</h3><span className="text-xs font-semibold text-indigo-600">Открыть →</span></div>
                <div className="grid grid-cols-2 gap-3">
                  {group.items.map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{label}</div>
                      <div className="mt-1 text-xl font-semibold text-slate-800">{value ?? 0}</div>
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>

          {stats?.recommendations?.length ? (
            <div className="bg-surface rounded-xl border border-slate-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Рекомендации по направлениям</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {stats.recommendations.map((item) => (
                  <div key={item.title} className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 dark:border-indigo-400/30 dark:bg-indigo-500/15">
                    <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">{item.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-indigo-800/75 dark:text-indigo-100/85">{item.message}</div>
                    {item.action_url ? <Link to={item.action_url} className="mt-3 inline-flex text-xs font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-100">{item.action_label ?? 'Перейти'}</Link> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-surface p-5 rounded-xl border border-slate-200 shadow-sm"><h3 className="text-sm font-semibold text-slate-800 mb-4">Динамика загрузки достижений</h3><div className="h-64 w-full"><canvas ref={chartCanvasRef}></canvas></div></div>
            <div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col"><h3 className="text-sm font-semibold text-slate-800 mb-4">Лидеры периода</h3><div className="overflow-y-auto flex-1 pr-2 scrollbar-hide"><div className="space-y-4">{stats?.top_students?.length ? stats.top_students.map((row, index) => <div key={row.id} className="flex items-center justify-between group"><div className="flex items-center"><div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold mr-3">{index + 1}</div><div><Link to={`/users/${row.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600 transition-colors">{row.first_name} {row.last_name.slice(0, 1)}.</Link><div className="text-[10px] text-slate-400">{[row.course ? courseLabel(row.course) : null, row.study_group || null].filter(Boolean).join(' • ') || row.education_level || '—'}</div></div></div><div className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">+{row.points}</div></div>) : <div className="text-center text-slate-400 text-xs py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">Нет начисленных баллов за период</div>}</div></div></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Активность по категориям</h3>
              <div className="space-y-3 mb-5">
                {stats?.category_activity?.length ? (() => {
                  const max = Math.max(...stats.category_activity.map((c) => c.count))
                  return stats.category_activity.map((cat) => (
                    <div key={cat.category}>
                      <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>{cat.category}</span>
                        <span className="text-slate-500">{cat.count} док.{cat.points ? ` · ${cat.points} б.` : ''}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-indigo-500 h-2" style={{ width: `${max > 0 ? (cat.count / max) * 100 : 0}%` }}></div>
                      </div>
                    </div>
                  ))
                })() : <div className="text-center text-slate-400 text-xs py-6">Нет активности за период</div>}
              </div>
            </div>
            <div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Активность по курсам и группам</h3>
              {(() => {
                const allCourses = coursesForEducationLevel('Специалитет')
                const cohorts = stats?.cohorts ?? []
                const courseList = allCourses.map((courseNumber) => {
                  const fromBackend = cohorts.find((c) => c.kind === 'course' && parseInt(c.education_level, 10) === courseNumber)
                  return {
                    ...fromBackend,
                    courseNumber,
                    education_level: courseLabel(courseNumber),
                    kind: 'course' as const,
                    count: fromBackend?.count ?? 0,
                    total: fromBackend?.total ?? 0,
                    pending: fromBackend?.pending ?? 0,
                  }
                })
                return courseList.length ? (
                <div className="space-y-4">
                  {courseList.map((course) => {
                    const courseNumber = course.courseNumber
                    const courseTotal = course.total ?? course.count ?? 0
                    const coursePending = course.pending ?? 0
                    const backendGroups = cohorts.filter((c) => c.kind === 'group' && c.parent_course === courseNumber)
                    const configuredGroupNames = groupsForEducationLevel('Специалитет', courseNumber)
                    const groupChildren = configuredGroupNames.map((name) => {
                      const fromBackend = backendGroups.find((g) => g.education_level === name)
                      return fromBackend ?? { education_level: name, kind: 'group' as const, parent_course: courseNumber, count: 0, total: 0, pending: 0 }
                    })
                    return (
                      <div key={`course-${course.education_level}`} className="border border-slate-200 rounded-lg p-3">
                        <div className="flex justify-between text-xs font-semibold text-slate-800 mb-1.5">
                          <span>{course.education_level}</span>
                          <span className="text-slate-500 font-normal">
                            {courseTotal} док.{coursePending > 0 ? ` · ${coursePending} ожидает` : ''}
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex mb-3">
                          {courseTotal > 0 ? (
                            <>
                              <div className="bg-indigo-500 h-2" style={{ width: `${100 - Math.round((coursePending / courseTotal) * 100)}%` }} />
                              <div className="bg-yellow-400 h-2" style={{ width: `${Math.round((coursePending / courseTotal) * 100)}%` }} />
                            </>
                          ) : null}
                        </div>
                        {groupChildren.length ? (
                          <div className="space-y-2 pl-3 border-l-2 border-slate-100">
                            {groupChildren.map((group) => {
                              const total = group.total ?? group.count ?? 0
                              const pending = group.pending ?? 0
                              const approvedPercent = total > 0 ? 100 - Math.round((pending / total) * 100) : 0
                              const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0
                              return (
                                <div key={`group-${group.education_level}`}>
                                  <div className="flex justify-between text-[11px] font-medium text-slate-700 mb-1">
                                    <span>{group.education_level}</span>
                                    <span className="text-slate-500">
                                      {total} док.{pending > 0 ? ` · ${pending} ожидает` : ''}
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                                    {total > 0 ? (
                                      <>
                                        <div className="bg-indigo-400 h-1.5" style={{ width: `${approvedPercent}%` }} />
                                        <div className="bg-yellow-300 h-1.5" style={{ width: `${pendingPercent}%` }} />
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                ) : (
                  <div className="text-center text-slate-400 text-xs py-8">Нет данных по курсам и группам</div>
                )
              })()}
            </div>
            <div className="lg:col-span-2 bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col"><div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0"><h3 className="text-sm font-semibold text-slate-700">Последние загрузки</h3><Link to="/documents" className="text-[10px] text-indigo-600 font-bold uppercase hover:underline flex items-center">Все документы <svg className="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg></Link></div><div className="overflow-x-auto flex-1"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-surface text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider"><tr><th className="px-5 py-3 font-bold">Название</th><th className="px-5 py-3 font-bold">Студент</th><th className="px-5 py-3 font-bold">Категория</th><th className="px-5 py-3 font-bold text-right">Статус</th></tr></thead><tbody className="divide-y divide-slate-50">{stats?.recent_achievements?.length ? stats.recent_achievements.map((doc) => <tr key={doc.id} className="hover:bg-slate-50 transition-colors"><td className="px-5 py-3"><div className="font-medium text-slate-800">{doc.title}</div><div className="text-[10px] text-slate-400">{formatDateTime(doc.created_at)}</div></td><td className="px-5 py-3 text-slate-600 text-xs">{doc.user ? `${doc.user.first_name} ${doc.user.last_name}` : '—'}</td><td className="px-5 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-medium">{doc.category || '—'}</span></td><td className="px-5 py-3 text-right"><span className={statusClass(doc.status)}>{statusLabel(doc.status)}</span></td></tr>) : <tr><td colSpan={4} className="text-center py-10 text-slate-400 text-xs bg-slate-50/50">Новых документов пока нет</td></tr>}</tbody></table></div></div>
          </div>
        </>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-slate-800">Что требует внимания</h3><p className="mt-1 text-xs text-slate-500">Самые важные следующие действия по вашему профилю.</p></div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">Профиль {stats?.profile_completion ?? 0}%</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(stats?.revision_achievements ?? 0) > 0 ? <Link to="/achievements?status=revision" className="rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-300"><div className="text-sm font-semibold text-slate-800">На доработке: {stats?.revision_achievements}</div><div className="mt-1 text-xs text-slate-500">Откройте комментарий модератора и исправьте документ.</div></Link> : null}
              {(stats?.pending_achievements ?? 0) > 0 ? <Link to="/achievements?status=pending" className="rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-300"><div className="text-sm font-semibold text-slate-800">Ожидают модерации: {stats?.pending_achievements}</div><div className="mt-1 text-xs text-slate-500">Решение появится в истории статуса.</div></Link> : null}
              {(stats?.profile_completion ?? 100) < 100 ? <Link to="/profile" className="rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-300"><div className="text-sm font-semibold text-slate-800">Профиль заполнен на {stats?.profile_completion ?? 0}%</div><div className="mt-1 text-xs text-slate-500">Добавьте недостающие данные и фотографию.</div></Link> : null}
              {(stats?.revision_achievements ?? 0) === 0 && (stats?.pending_achievements ?? 0) === 0 && (stats?.profile_completion ?? 100) >= 100 ? <div className="md:col-span-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Всё в порядке — обязательных действий сейчас нет.</div> : null}
            </div>
          </section>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {studentCards.map((card) => (
              <div key={card.label} className={`${card.accent ? 'bg-indigo-600 text-white shadow-md' : 'bg-surface border border-slate-200 shadow-sm'} p-5 rounded-xl flex flex-col justify-between relative overflow-hidden`}>
                {card.accent ? <div className="absolute -right-4 -bottom-4 opacity-10"><svg className="w-24 h-24" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A12.014 12.014 0 0010 1c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-1.12 14.86a.75.75 0 01-1.36 0l-1.8-4.2a2.25 2.25 0 00-1.24-1.24l-4.2-1.8a.75.75 0 010-1.36l4.2-1.8a2.25 2.25 0 001.24-1.24l1.8-4.2a.75.75 0 011.36 0l1.8 4.2a2.25 2.25 0 001.24 1.24l4.2 1.8a.75.75 0 010 1.36l-4.2 1.8a2.25 2.25 0 00-1.24 1.24l-1.8 4.2z" clipRule="evenodd"></path></svg></div> : null}
                <p className={`text-[10px] uppercase font-bold tracking-wider ${card.accent ? 'text-indigo-200 relative z-10' : 'text-slate-500'}`}>{card.label}</p>
                <p className={`text-4xl font-bold mt-2 ${card.accent ? 'text-white relative z-10' : 'text-slate-800'}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {(stats?.points_to_next_rank ?? 0) > 0 ? (
            <Link to="/leaderboard" className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-surface px-5 py-4 shadow-sm transition hover:border-indigo-300">
              <div><div className="text-sm font-semibold text-slate-800">До {stats?.next_rank}-го места осталось {stats?.points_to_next_rank} баллов</div><div className="mt-1 text-xs text-slate-500">Посмотрите рейтинг и структуру баллов соседних позиций.</div></div><span className="text-sm font-semibold text-indigo-600">Рейтинг →</span>
            </Link>
          ) : null}

          {stats?.recommendations?.length ? (
            <div className="bg-surface rounded-xl border border-slate-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Рекомендации по направлениям</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {stats.recommendations.map((item) => (
                  <div key={item.title} className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 dark:border-indigo-400/30 dark:bg-indigo-500/15">
                    <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">{item.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-indigo-800/75 dark:text-indigo-100/85">{item.message}</div>
                    {item.action_url ? <Link to={item.action_url} className="mt-3 inline-flex text-xs font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-100">{item.action_label ?? 'Перейти'}</Link> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm"><h3 className="text-sm font-semibold text-slate-800 mb-4">Структура баллов</h3><div className="h-48 w-full flex items-center justify-center">{(stats?.my_points ?? 0) > 0 && stats?.category_breakdown?.length ? <canvas ref={chartCanvasRef}></canvas> : <div className="text-center text-slate-400"><p className="text-xs">Нет баллов за период</p>{period === 'all' ? <Link to="/achievements" className="inline-flex mt-3 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-indigo-100 transition-colors">Загрузить достижение</Link> : null}</div>}</div></div>
            <div className="lg:col-span-2 bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col"><div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0"><h3 className="text-sm font-semibold text-slate-700">Последняя активность</h3><Link to="/achievements" className="text-[10px] text-indigo-600 font-bold uppercase hover:underline flex items-center">Все записи <svg className="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg></Link></div><div className="overflow-x-auto flex-1"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-surface text-slate-400 border-b border-slate-100 uppercase text-[10px] tracking-wider"><tr><th className="px-5 py-3 font-bold">Название</th><th className="px-5 py-3 font-bold">Категория</th><th className="px-5 py-3 font-bold text-right">Баллы</th><th className="px-5 py-3 font-bold text-right">Статус</th></tr></thead><tbody className="divide-y divide-slate-50">{stats?.my_recent_docs?.length ? stats.my_recent_docs.map((doc) => <tr key={doc.id} className="hover:bg-slate-50 transition-colors"><td className="px-5 py-3"><div className="font-medium text-slate-800">{doc.title}</div><div className="text-[10px] text-slate-400">{new Date(doc.created_at).toLocaleDateString('ru-RU')}</div></td><td className="px-5 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-medium">{doc.category || '—'}</span></td><td className="px-5 py-3 text-right font-bold text-xs">{(doc.points ?? 0) > 0 ? <span className="text-indigo-600">+{doc.points}</span> : <span className="text-slate-300">—</span>}</td><td className="px-5 py-3 text-right"><span className={statusClass(doc.status)}>{statusLabel(doc.status)}</span></td></tr>) : <tr><td colSpan={4} className="text-center py-10 text-slate-400 text-xs bg-slate-50/50">У вас пока нет загруженных документов.</td></tr>}</tbody></table></div></div>
          </div>
        </>
      )}
    </div>
  )
}
