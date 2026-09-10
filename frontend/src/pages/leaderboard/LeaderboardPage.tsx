import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  leaderboardApi,
  type CompletedSeason,
  type CompletedSeasonRow,
  type LeaderboardResponse,
  type LeaderboardRow,
} from '@/api/leaderboard'
import { ChipMultiSelect } from '@/components/staff/ChipMultiSelect'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useAuth } from '@/hooks/useAuth'
import { getErrorMessage } from '@/utils/http'
import { courseLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'
import { getTotalPages, paginateItems } from '@/utils/pagination'

const LEADERBOARD_PAGE_SIZE = 20

function normalizeLeaderboardSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function matchesLeaderboardRow(row: LeaderboardRow, query: string) {
  const normalizedQuery = normalizeLeaderboardSearch(query)
  if (!normalizedQuery) {
    return true
  }

  return [
    row.user.first_name,
    row.user.last_name,
    row.user.email,
    `${row.user.first_name} ${row.user.last_name}`,
    `${row.user.last_name} ${row.user.first_name}`,
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .includes(normalizedQuery)
}

function matchesCompletedSeasonRow(row: CompletedSeasonRow, query: string) {
  const normalizedQuery = normalizeLeaderboardSearch(query)
  if (!normalizedQuery) return true
  return [row.user.first_name, row.user.last_name, `${row.user.first_name} ${row.user.last_name}`, `${row.user.last_name} ${row.user.first_name}`]
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .includes(normalizedQuery)
}

function leagueDescription(data: LeaderboardResponse | null, isStaff: boolean) {
  if (!data) return ''
  const timeScope = data.ranking_scope === 'global' ? 'Глобально за всё время' : 'Текущий сезон'
  if (data.current_category && data.current_category !== 'all') {
    return `${timeScope} · направление: ${data.current_category}`
  }
  if (data.current_education_level === 'all' && data.current_course === 0) {
    return `${timeScope} · все студенты`
  }

  const scope = `${data.current_education_level !== 'all' ? data.current_education_level : 'Все уровни'}, ${data.current_course !== 0 ? courseLabel(data.current_course) : 'Все курсы'}${data.current_group !== 'all' ? `, группа ${data.current_group}` : ''}`
  return `${timeScope} · ${isStaff ? 'лига' : 'ваша лига'}: ${scope}`
}

function buildUserLink(row: LeaderboardRow, isStaff: boolean) {
  return isStaff ? `/users/${row.user.id}?from=leaderboard` : `/students/${row.user.id}`
}

function RankHistory({ row }: { row: LeaderboardRow }) {
  if (!row.previous_rank || row.previous_rank === row.rank) return null
  const improved = row.previous_rank > row.rank
  return (
    <span className="text-[10px] text-slate-400" title={row.previous_season || undefined}>
      #{row.previous_rank} → <span className={improved ? 'text-emerald-600 font-semibold' : 'text-slate-600 font-semibold'}>#{row.rank}</span>
    </span>
  )
}

function ScoreBreakdown({ row, align = 'center' }: { row: LeaderboardRow; align?: 'center' | 'right' }) {
  if (!row.points_breakdown?.length) return null
  return (
    <details className={`relative mt-2 text-xs ${align === 'right' ? 'text-right' : 'text-center'}`}>
      <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-indigo-600 select-none">Из чего баллы</summary>
      <div className={`mt-2 rounded-lg border border-slate-200 bg-surface p-2 shadow-sm min-w-[190px] ${align === 'right' ? 'ml-auto' : 'mx-auto'}`}>
        {row.points_breakdown.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4 py-1 text-slate-600">
            <span className="text-left whitespace-normal">{item.label}</span>
            <strong className="text-slate-800">{item.points}</strong>
          </div>
        ))}
      </div>
    </details>
  )
}

export function LeaderboardPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'global' | 'current' | 'history'>('global')
  const [seasons, setSeasons] = useState<CompletedSeason[]>([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [seasonRows, setSeasonRows] = useState<CompletedSeasonRow[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)

  const isStaff = user?.role === 'MODERATOR' || user?.role === 'SUPER_ADMIN'
  const educationLevel = searchParams.get('education_level') ?? undefined
  const course = searchParams.get('course') ?? undefined
  const categories = searchParams.getAll('categories')
  const categoryLogic = (searchParams.get('category_logic') as 'or' | 'and') ?? 'or'
  const group = searchParams.get('group') ?? undefined
  const isGlobal = searchParams.get('scope') === 'global'
  const categoriesKey = categories.join(',')

  const filters = useMemo(
    () => ({
      education_level: educationLevel,
      course,
      categories: categories.length ? categories : undefined,
      category_logic: categories.length > 1 && categoryLogic === 'and' ? 'and' : undefined,
      group,
      scope: isGlobal ? 'global' : undefined,
      season: viewMode === 'global' ? 'global' : 'current',
    }),
    // categoriesKey captures the array contents for memo stability
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoriesKey, categoryLogic, course, educationLevel, group, isGlobal, viewMode]
  )

  const setScope = (global: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (global) next.set('scope', 'global')
    else next.delete('scope')
    setSearchParams(next)
    setPage(1)
  }

  const toggleCategory = (value: string) => {
    const next = new URLSearchParams(searchParams)
    const current = next.getAll('categories')
    next.delete('categories')
    const updated = current.includes(value) ? current.filter((c) => c !== value) : [...current, value]
    updated.forEach((c) => next.append('categories', c))
    if (updated.length < 2) next.delete('category_logic')
    setSearchParams(next)
    setPage(1)
  }

  const setCategoryLogic = (logic: 'or' | 'and') => {
    const next = new URLSearchParams(searchParams)
    if (logic === 'and') next.set('category_logic', 'and')
    else next.delete('category_logic')
    setSearchParams(next)
    setPage(1)
  }

  const resetCategories = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('categories')
    next.delete('category_logic')
    setSearchParams(next)
    setPage(1)
  }

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await leaderboardApi.get(filters)
        setData(response.data)
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Не удалось загрузить рейтинг.'))
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [filters])

  useEffect(() => {
    const loadSeasons = async () => {
      try {
        const response = await leaderboardApi.getSeasons(filters)
        setSeasons(response.data.seasons)
        setSelectedSeason((current) => current && response.data.seasons.some((item) => item.name === current)
          ? current
          : response.data.seasons[0]?.name ?? '')
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Не удалось загрузить историю сезонов.'))
      }
    }
    void loadSeasons()
  }, [filters])

  useEffect(() => {
    if (viewMode !== 'history' || !selectedSeason) {
      setSeasonRows([])
      return
    }
    const loadSeason = async () => {
      setIsHistoryLoading(true)
      try {
        const response = await leaderboardApi.getSeason(selectedSeason, filters)
        setSeasonRows(response.data.leaderboard)
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Не удалось загрузить завершённый сезон.'))
      } finally {
        setIsHistoryLoading(false)
      }
    }
    void loadSeason()
  }, [filters, selectedSeason, viewMode])

  const filteredLeaderboard = useMemo(
    () => (data?.leaderboard ?? []).filter((row) => matchesLeaderboardRow(row, searchQuery)),
    [data?.leaderboard, searchQuery],
  )
  const podium = filteredLeaderboard.slice(0, 3)
  const rest = filteredLeaderboard.slice(3)
  const totalPages = getTotalPages(rest.length, LEADERBOARD_PAGE_SIZE)
  const paginatedRest = paginateItems(rest, page, LEADERBOARD_PAGE_SIZE)
  const filteredSeasonRows = useMemo(
    () => seasonRows.filter((row) => matchesCompletedSeasonRow(row, searchQuery)),
    [seasonRows, searchQuery],
  )
  const historyTotalPages = getTotalPages(filteredSeasonRows.length, LEADERBOARD_PAGE_SIZE)
  const paginatedSeasonRows = paginateItems(filteredSeasonRows, page, LEADERBOARD_PAGE_SIZE)
  const activeTotalPages = viewMode === 'history' ? historyTotalPages : totalPages

  useEffect(() => {
    setPage(1)
  }, [filters, searchQuery, selectedSeason, viewMode])

  useEffect(() => {
    if (page > activeTotalPages) {
      setPage(activeTotalPages)
    }
  }, [activeTotalPages, page])

  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(() => {
      const source = viewMode === 'history' ? seasonRows : (data?.leaderboard ?? [])
      setSuggestions(
        source
          .filter((row) => viewMode === 'history' ? matchesCompletedSeasonRow(row as CompletedSeasonRow, trimmed) : matchesLeaderboardRow(row as LeaderboardRow, trimmed))
          .slice(0, 5)
          .map((row) => ({
            value: `${row.user.first_name} ${row.user.last_name}`,
            text: `${row.user.first_name} ${row.user.last_name}`,
          })),
      )
    }, 150)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [data?.leaderboard, searchQuery, seasonRows, viewMode])

  useEffect(() => {
    if (!data || searchParams.get('focus_me') !== '1') return

    const myIndex = filteredLeaderboard.findIndex((row) => row.is_me)
    const clearParam = () => {
      const next = new URLSearchParams(searchParams)
      next.delete('focus_me')
      setSearchParams(next, { replace: true })
    }
    if (myIndex === -1) {
      clearParam()
      return
    }

    if (myIndex >= 3) {
      const targetPage = Math.floor((myIndex - 3) / LEADERBOARD_PAGE_SIZE) + 1
      if (page !== targetPage) {
        setPage(targetPage)
        return
      }
    }

    const target = document.querySelector<HTMLElement>('[data-leaderboard-self="true"]')
    if (!target) {
      clearParam()
      return
    }

    const restore = {
      boxShadow: target.style.boxShadow,
      transform: target.style.transform,
      backgroundColor: target.style.backgroundColor,
      borderColor: target.style.borderColor,
      position: target.style.position,
      zIndex: target.style.zIndex,
    }

    const applyHighlight = () => {
      target.style.boxShadow = '0 0 0 3px var(--theme-accent, #4f46e5), 0 18px 36px rgba(15, 23, 42, 0.18)'
      target.style.transform = 'translateY(-2px)'
      target.style.backgroundColor = 'var(--theme-accent-soft, #eef2ff)'
      target.style.borderColor = 'var(--theme-accent, #4f46e5)'
      target.style.position = 'relative'
      target.style.zIndex = '1'

      window.setTimeout(() => {
        target.style.boxShadow = restore.boxShadow
        target.style.transform = restore.transform
        target.style.backgroundColor = restore.backgroundColor
        target.style.borderColor = restore.borderColor
        target.style.position = restore.position
        target.style.zIndex = restore.zIndex
      }, 3600)
    }

    window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      window.setTimeout(applyHighlight, 250)
    }, 120)

    clearParam()
  }, [data, filteredLeaderboard, page, searchParams, setSearchParams])

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (!value || value === 'all' || value === '0') next.delete(key)
    else next.set(key, value)

    if (key === 'education_level') {
      next.delete('course')
      next.delete('group')
    }

    setSearchParams(next)
    setPage(1)
  }

  const handleExport = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    try {
      const response = await leaderboardApi.exportCsv(filters)
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }))
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = 'leaderboard_export.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, 'Не удалось выгрузить CSV.'))
    }
  }

  const courseOptions = data?.current_education_level && data.current_education_level !== 'all'
    ? Array.from({ length: data.course_mapping[data.current_education_level] ?? 0 }, (_, index) => String(index + 1))
    : []
  const groupOptions = data?.current_education_level && data.current_education_level !== 'all'
    ? data.current_course
      ? data.course_group_mapping?.[data.current_education_level]?.[data.current_course] ?? data.group_mapping[data.current_education_level] ?? []
      : data.group_mapping[data.current_education_level] ?? []
    : []
  const focusUrl = (() => {
    const next = new URLSearchParams(searchParams)
    next.set('focus_me', '1')
    return `?${next.toString()}`
  })()

  if (viewMode === 'history') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Завершённые сезоны</h2>
            <p className="text-sm text-slate-500 mt-1">Зафиксированные позиции и баллы не меняются вместе с текущим рейтингом.</p>
          </div>
          <button type="button" onClick={() => setViewMode('global')} className="px-4 py-2.5 rounded-lg border border-slate-200 bg-surface text-sm font-semibold text-slate-600 hover:text-indigo-600">
            Вернуться к рейтингу
          </button>
        </div>

        {error ? <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="bg-surface rounded-xl border border-slate-200 p-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Сезон</label>
          <select value={selectedSeason} onChange={(event) => setSelectedSeason(event.target.value)} className="w-full sm:max-w-md px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none">
            {!seasons.length ? <option value="">Завершённых сезонов пока нет</option> : null}
            {seasons.map((season) => (
              <option key={season.name} value={season.name}>{season.name} · {season.participants} участников</option>
            ))}
          </select>
        </div>

        <div className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4">
          <SearchAutocompleteInput
            label="Поиск участника"
            value={searchQuery}
            placeholder="Имя или фамилия..."
            suggestions={suggestions}
            onChange={setSearchQuery}
            onSelectSuggestion={(item) => { setSearchQuery(item.value || item.text); setSuggestions([]) }}
          />
          <ChipMultiSelect
            label="Направление"
            options={data?.categories ?? []}
            selected={categories}
            onToggle={toggleCategory}
            onReset={resetCategories}
            logic={categoryLogic}
            onLogicChange={setCategoryLogic}
            andHint="оставить участников, у которых есть баллы во всех выбранных направлениях"
          />
          {isStaff ? <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Обучение<select value={data?.current_education_level || 'all'} onChange={(event) => updateFilter('education_level', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700"><option value="all">Все уровни</option>{data?.education_levels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Курс<select value={String(data?.current_course ?? 0)} onChange={(event) => updateFilter('course', event.target.value)} disabled={(data?.current_education_level || 'all') === 'all'} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 disabled:opacity-50"><option value="0">Все курсы</option>{courseOptions.map((item) => <option key={item} value={item}>{courseLabel(item)}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Группа<select value={data?.current_group || 'all'} onChange={(event) => updateFilter('group', event.target.value)} disabled={(data?.current_education_level || 'all') === 'all'} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-700 disabled:opacity-50"><option value="all">Все группы</option>{groupOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div> : null}
          <p className="text-xs text-slate-500">Места пересчитываются внутри выбранной группы и направлений; исходный итог сезона остаётся неизменным.</p>
        </div>

        <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden">
          {isHistoryLoading ? <div className="p-12 text-center text-sm text-slate-500">Загрузка сезона…</div> : null}
          {!isHistoryLoading && filteredSeasonRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr><th className="px-5 py-3">Место</th><th className="px-5 py-3">Студент</th><th className="px-5 py-3 text-right">Баллы</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedSeasonRows.map((row) => (
                    <tr key={row.user.id} className={row.is_me ? 'bg-indigo-50/50' : ''}>
                      <td className="px-5 py-3 font-semibold text-slate-500">#{row.rank}</td>
                      <td className="px-5 py-3">
                        <Link to={isStaff ? `/users/${row.user.id}?from=leaderboard` : `/students/${row.user.id}`} className="font-medium text-slate-800 hover:text-indigo-600">
                          {row.user.first_name} {row.user.last_name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-slate-800">{row.total_points} б.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!isHistoryLoading && !filteredSeasonRows.length ? <div className="p-12 text-center text-sm text-slate-500">По выбранным фильтрам участников нет.</div> : null}
          <PaginationFooter currentPage={page} totalPages={historyTotalPages} pageSize={LEADERBOARD_PAGE_SIZE} onPageChange={setPage} className="border-t border-slate-100 px-5 py-4" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6" data-focus-me={searchParams.get('focus_me') === '1' ? 'true' : 'false'}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Рейтинг студентов</h2>
          <p className="text-sm text-slate-500 mt-1">{leagueDescription(data, isStaff)}</p>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {!isStaff ? (
            <>
              <div className="bg-surface border border-slate-200 rounded-xl p-4 flex items-center gap-6 shadow-sm w-full md:w-auto">
                <div className="text-center flex-1 md:flex-none md:px-4">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Место в лиге</div>
                  <div className="text-2xl font-bold text-indigo-600">{(data?.my_rank ?? 0) > 0 ? `#${data?.my_rank}` : '-'}</div>
                </div>
                <div className="w-px h-8 bg-slate-200"></div>
                <div className="text-center flex-1 md:flex-none md:px-4">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">Баллы</div>
                  <div className="text-2xl font-bold text-slate-800">{data?.my_points ?? 0}</div>
                </div>
              </div>
              {(data?.my_rank ?? 0) > 0 ? (
                <a id="find-me-btn" href={focusUrl} onClick={(event) => { event.preventDefault(); const next = new URLSearchParams(searchParams); next.set('focus_me', '1'); setSearchParams(next) }} className="flex-1 md:flex-none inline-flex items-center justify-center bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border border-indigo-200">
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Найти меня
                </a>
              ) : null}
            </>
          ) : (
            <>
              <a href={data?.export_url || '/api/v1/leaderboard/export'} onClick={handleExport} className="flex-1 md:flex-none inline-flex items-center justify-center bg-green-50 text-green-700 hover:bg-green-100 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors border border-green-200">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Экспорт CSV
              </a>
              {user?.role === 'SUPER_ADMIN' ? (
                <Link to="/dashboard?tab=management" className="flex-1 md:flex-none inline-flex items-center justify-center bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors shadow-sm">
                  Управление сезоном
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setViewMode('global')} className={`px-4 py-2 rounded-lg text-xs font-bold ${viewMode === 'global' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-surface text-slate-600 hover:text-indigo-600'}`}>Глобальный рейтинг</button>
        <button type="button" onClick={() => setViewMode('current')} className={`px-4 py-2 rounded-lg text-xs font-bold ${viewMode === 'current' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-surface text-slate-600 hover:text-indigo-600'}`}>Текущий сезон</button>
        <button type="button" onClick={() => setViewMode('history')} className="px-4 py-2 rounded-lg border border-slate-200 bg-surface text-slate-600 hover:text-indigo-600 text-xs font-bold">Завершённые сезоны{seasons.length ? ` · ${seasons.length}` : ''}</button>
      </div>
      {isStaff ? <p className="-mt-4 text-xs text-slate-400">CSV выгружается с учётом выбранных ниже уровня обучения, курса, группы и направлений.</p> : null}

      {error ? <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="bg-surface p-4 rounded-xl border border-slate-200">
        <form action="/sirius.achievements/leaderboard" method="GET" className="flex flex-wrap gap-4 items-end">
          <SearchAutocompleteInput
            label="Поиск"
            value={searchQuery}
            placeholder="Имя или фамилия..."
            suggestions={suggestions}
            onChange={setSearchQuery}
            onSelectSuggestion={(item) => {
              setSearchQuery(item.value || item.text)
              setSuggestions([])
            }}
            className="min-w-[240px] flex-1"
          />
          <div className="w-full">
            <ChipMultiSelect
              label="Направление"
              options={data?.categories ?? []}
              selected={categories}
              onToggle={toggleCategory}
              onReset={resetCategories}
              logic={categoryLogic}
              onLogicChange={setCategoryLogic}
              andHint="в рейтинге только те, у кого есть все выбранные направления"
            />
          </div>

          {!isStaff ? (
            <div className="w-full">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Охват</label>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                <button type="button" onClick={() => setScope(false)} className={`px-3 py-1.5 rounded-md transition-colors ${!isGlobal ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                  Мой поток
                </button>
                <button type="button" onClick={() => setScope(true)} className={`px-3 py-1.5 rounded-md transition-colors ${isGlobal ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                  Глобально
                </button>
              </div>
            </div>
          ) : null}

          {isStaff ? (
            <>
              <div className="w-full sm:w-[170px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Обучение</label>
                <select value={data?.current_education_level || 'all'} onChange={(event) => updateFilter('education_level', event.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px] transition-all cursor-pointer">
                  <option value="all">Все уровни</option>
                  {data?.education_levels.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="w-full sm:w-[120px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Курс</label>
                <select value={String(data?.current_course ?? 0)} onChange={(event) => updateFilter('course', event.target.value)} disabled={(data?.current_education_level || 'all') === 'all'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <option value="0">Все курсы</option>
                  {courseOptions.map((item) => <option key={item} value={item}>{courseLabel(item)}</option>)}
                </select>
              </div>
            </>
          ) : null}

          <div className="w-full sm:w-[120px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Группа</label>
            <select value={data?.current_group || 'all'} onChange={(event) => updateFilter('group', event.target.value)} disabled={(data?.current_education_level || 'all') === 'all'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <option value="all">Все группы</option>
              {groupOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </form>
      </div>

      {isLoading ? <div className="bg-surface rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-500">Загрузка рейтинга…</div> : null}

      {!isLoading && podium.length ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-4">
          {podium[1] ? (
            <div data-leaderboard-self={podium[1].is_me ? 'true' : undefined} className="order-2 md:order-1 bg-surface rounded-xl border border-slate-200 p-6 flex flex-col items-center relative transition-all duration-500">
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 w-8 h-8 bg-surface border border-slate-200 text-slate-500 rounded-full flex items-center justify-center text-xs font-bold shadow-sm">2</div>
              <div className="mt-2 mb-3">{podium[1].user.avatar_path ? <img src={buildMediaUrl(podium[1].user.avatar_path)} className="w-16 h-16 rounded-full object-cover border border-slate-200" /> : <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-xl font-medium text-slate-400 border border-slate-100">{podium[1].user.first_name.slice(0, 1)}</div>}</div>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center"><Link to={buildUserLink(podium[1], isStaff)} className="font-semibold text-slate-800 text-sm hover:text-indigo-600">{podium[1].user.first_name} {podium[1].user.last_name}</Link><div className="inline-flex bg-slate-50 text-slate-600 text-xs font-medium px-3 py-1 rounded-md border border-slate-100">{podium[1].total_points} баллов</div></div>
              <RankHistory row={podium[1]} />
              <ScoreBreakdown row={podium[1]} />
            </div>
          ) : <div className="hidden md:block"></div>}

          <div data-leaderboard-self={podium[0]?.is_me ? 'true' : undefined} className="order-1 md:order-2 bg-surface rounded-xl shadow-sm p-6 flex flex-col items-center relative transition-all duration-500" style={{ borderTop: '4px solid var(--theme-accent, #4f46e5)' }}>
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 w-8 h-8 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md" style={{ background: 'var(--theme-accent, #4f46e5)' }}>1</div>
            <div className="mt-2 mb-3">{podium[0]?.user.avatar_path ? <img src={buildMediaUrl(podium[0].user.avatar_path)} className="w-20 h-20 rounded-full object-cover border border-slate-200" /> : <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center text-2xl font-bold text-indigo-600 border border-indigo-100">{podium[0]?.user.first_name.slice(0, 1)}</div>}</div>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center"><Link to={buildUserLink(podium[0], isStaff)} className="font-bold text-slate-900 text-base hover:text-indigo-600">{podium[0]?.user.first_name} {podium[0]?.user.last_name}</Link><div className="inline-flex text-sm font-bold px-4 py-1.5 rounded-md" style={{ background: 'var(--theme-accent-soft, #eef2ff)', color: 'var(--theme-accent-strong, #4338ca)', border: '1px solid var(--theme-border-soft, #ebeff6)' }}>{podium[0]?.total_points ?? 0} баллов</div></div>
            {podium[0] ? <><RankHistory row={podium[0]} /><ScoreBreakdown row={podium[0]} /></> : null}
          </div>

          {podium[2] ? (
            <div data-leaderboard-self={podium[2].is_me ? 'true' : undefined} className="order-3 bg-surface rounded-xl border border-slate-200 p-6 flex flex-col items-center relative transition-all duration-500">
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 w-8 h-8 bg-surface border border-slate-200 text-slate-500 rounded-full flex items-center justify-center text-xs font-bold shadow-sm">3</div>
              <div className="mt-2 mb-3">{podium[2].user.avatar_path ? <img src={buildMediaUrl(podium[2].user.avatar_path)} className="w-16 h-16 rounded-full object-cover border border-slate-200" /> : <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-xl font-medium text-slate-400 border border-slate-100">{podium[2].user.first_name.slice(0, 1)}</div>}</div>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center"><Link to={buildUserLink(podium[2], isStaff)} className="font-semibold text-slate-800 text-sm hover:text-indigo-600">{podium[2].user.first_name} {podium[2].user.last_name}</Link><div className="inline-flex bg-slate-50 text-slate-600 text-xs font-medium px-3 py-1 rounded-md border border-slate-100">{podium[2].total_points} баллов</div></div>
              <RankHistory row={podium[2]} />
              <ScoreBreakdown row={podium[2]} />
            </div>
          ) : <div className="hidden md:block"></div>}
        </div>
      ) : null}

      {!isLoading && rest.length ? (
        <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Остальные участники</h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Всего в лиге: {data?.leaderboard.length ?? 0}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <tbody className="divide-y divide-slate-100">
                {paginatedRest.map((row) => (
                  <tr key={row.user.id} data-leaderboard-self={row.is_me ? 'true' : undefined} className={`transition-all duration-500 ${row.is_me ? 'bg-indigo-50/50 hover:bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-3 w-12 text-center"><span className={`text-sm font-medium ${row.is_me ? 'text-indigo-600' : 'text-slate-400'}`}>{row.rank}</span></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {row.user.avatar_path ? <img src={buildMediaUrl(row.user.avatar_path)} className="w-8 h-8 rounded-full object-cover border border-slate-200" /> : <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-medium text-xs">{row.user.first_name.slice(0, 1)}</div>}
                        <div>
                          <Link to={buildUserLink(row, isStaff)} className={`text-sm font-medium text-slate-800 hover:text-indigo-600 transition-colors ${row.is_me ? 'text-indigo-700' : ''}`}>
                            {row.user.first_name} {row.user.last_name}
                            {row.is_me ? <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">Вы</span> : null}
                          </Link>
                          <div className="text-[10px] text-slate-400">{row.user.education_level || ''} {row.user.course ? courseLabel(row.user.course) : ''} {row.user.study_group ? `• ${row.user.study_group}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right align-top">
                      <span className={`text-sm font-bold ${row.is_me ? 'text-indigo-600' : 'text-slate-700'}`}>{row.total_points}</span><span className="text-xs text-slate-400 ml-1">б.</span>
                      <div><RankHistory row={row} /></div>
                      <ScoreBreakdown row={row} align="right" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationFooter
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={LEADERBOARD_PAGE_SIZE}
          />
        </div>
      ) : null}

      {!isLoading && !filteredLeaderboard.length ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-slate-200">
          <p className="text-sm text-slate-500">В этой лиге пока никто не набрал баллов.</p>
        </div>
      ) : null}
    </div>
  )
}
