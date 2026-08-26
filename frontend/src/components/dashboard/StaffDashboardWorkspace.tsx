import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { seasonsApi, type Season, type SeasonComparison, type SeasonCreatePayload, type SeasonSubmissionException, type SystemHealth } from '@/api/seasons'
import { usersApi } from '@/api/users'
import type { DashboardStats } from '@/api/dashboard'
import { ReportExportPanel } from '@/components/staff/ReportExportPanel'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { getErrorMessage } from '@/utils/http'

export type StaffDashboardTab = 'overview' | 'work' | 'export' | 'current' | 'comparison' | 'management' | 'system'

const SHARED_TABS: Array<[StaffDashboardTab, string]> = [
  ['overview', 'Обзор'],
  ['work', 'Рабочая область'],
  ['export', 'Экспорт'],
  ['current', 'Текущий сезон'],
  ['comparison', 'Сравнение сезонов'],
]

const ADMIN_TABS: Array<[StaffDashboardTab, string]> = [
  ['management', 'Управление сезоном'],
  ['system', 'Система'],
]

export function StaffDashboardTabs({ active, isSuperAdmin, onSelect }: {
  active: StaffDashboardTab
  isSuperAdmin: boolean
  onSelect: (tab: StaffDashboardTab) => void
}) {
  const tabs = isSuperAdmin ? [...SHARED_TABS, ...ADMIN_TABS] : SHARED_TABS
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-surface p-1 shadow-sm" aria-label="Разделы дашборда">
      {tabs.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelect(value)}
          className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-semibold transition ${active === value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

function formatDuration(seconds = 0) {
  if (!seconds) return '—'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} мин.`
  return `${(seconds / 3600).toFixed(seconds < 36_000 ? 1 : 0)} ч.`
}

function statusLabel(status: string) {
  return ({ draft: 'Черновик', scheduled: 'Запланирован', active: 'Приём открыт', moderation: 'Модерация', published: 'Опубликован', archived: 'Архив' } as Record<string, string>)[status] ?? status
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'Не задано'
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function StaffDashboardWorkspace({ active, stats, onRefresh }: {
  active: Exclude<StaffDashboardTab, 'overview'>
  stats: DashboardStats | null
  onRefresh: () => Promise<void> | void
}) {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [comparison, setComparison] = useState<SeasonComparison[]>([])
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editingSeason, setEditingSeason] = useState<Season | null>(null)
  const [finalizeTarget, setFinalizeTarget] = useState<Season | null>(null)
  const [finalizeName, setFinalizeName] = useState('')
  const [extensionTarget, setExtensionTarget] = useState<Season | null>(null)
  const [extensions, setExtensions] = useState<SeasonSubmissionException[]>([])
  const [extensionQuery, setExtensionQuery] = useState('')
  const [extensionSuggestions, setExtensionSuggestions] = useState<SearchSuggestionItem[]>([])
  const [extensionStudent, setExtensionStudent] = useState<{ id: number; label: string } | null>(null)
  const [extensionExpiresAt, setExtensionExpiresAt] = useState('')
  const [extensionReason, setExtensionReason] = useState('')
  const [form, setForm] = useState({
    name: '',
    start_at: '',
    submissions_open_at: '',
    submissions_close_at: '',
    moderation_close_at: '',
    scoring_rules_version: 'v1',
  })

  const loadSeasons = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [listResponse, comparisonResponse] = await Promise.all([
        seasonsApi.list(),
        seasonsApi.comparison(),
      ])
      setSeasons(listResponse.data.seasons)
      setComparison(comparisonResponse.data.seasons)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить данные сезонов.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSeasons()
  }, [])

  useEffect(() => {
    if (active !== 'system') return
    setError(null)
    void seasonsApi.systemHealth()
      .then((response) => setSystemHealth(response.data))
      .catch((healthError) => setError(getErrorMessage(healthError, 'Не удалось проверить сервисы.')))
  }, [active])

  useEffect(() => {
    const query = extensionQuery.trim()
    if (!extensionTarget || extensionStudent || query.length < 2) {
      setExtensionSuggestions([])
      return
    }
    let mounted = true
    const timeout = window.setTimeout(() => {
      void usersApi.search(query, 8, 'STUDENT')
        .then((response) => {
          if (mounted) setExtensionSuggestions(response.data.filter((item) => item.id != null))
        })
        .catch(() => {
          if (mounted) setExtensionSuggestions([])
        })
    }, 250)
    return () => {
      mounted = false
      window.clearTimeout(timeout)
    }
  }, [extensionQuery, extensionStudent, extensionTarget])

  const liveSeason = useMemo(() => seasons.find((item) => ['active', 'moderation'].includes(item.status)) ?? null, [seasons])

  const runAction = async (season: Season, action: 'activate' | 'close' | 'finalize' | 'archive') => {
    setBusyId(season.id)
    setError(null)
    try {
      if (action === 'activate') await seasonsApi.activate(season.id)
      if (action === 'close') await seasonsApi.closeSubmissions(season.id)
      if (action === 'finalize') await seasonsApi.finalize(season.id)
      if (action === 'archive') await seasonsApi.archive(season.id)
      await loadSeasons()
      await onRefresh()
    } catch (actionError) {
      setError(getErrorMessage(actionError, 'Операцию с сезоном выполнить не удалось.'))
    } finally {
      setBusyId(null)
    }
  }

  const resetSeasonForm = () => {
    setEditingSeason(null)
    setForm({ name: '', start_at: '', submissions_open_at: '', submissions_close_at: '', moderation_close_at: '', scoring_rules_version: 'v1' })
  }

  const beginSeasonEdit = (season: Season) => {
    setEditingSeason(season)
    setForm({
      name: season.name,
      start_at: toDateTimeLocal(season.start_at),
      submissions_open_at: toDateTimeLocal(season.submissions_open_at),
      submissions_close_at: toDateTimeLocal(season.submissions_close_at),
      moderation_close_at: toDateTimeLocal(season.moderation_close_at),
      scoring_rules_version: season.scoring_rules_version,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const createSeason = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const payload: SeasonCreatePayload = {
        ...form,
        start_at: new Date(form.start_at).toISOString(),
        submissions_open_at: new Date(form.submissions_open_at).toISOString(),
        submissions_close_at: new Date(form.submissions_close_at).toISOString(),
        moderation_close_at: new Date(form.moderation_close_at).toISOString(),
      }
      if (editingSeason) await seasonsApi.update(editingSeason.id, payload)
      else await seasonsApi.create(payload)
      resetSeasonForm()
      await loadSeasons()
    } catch (createError) {
      setError(getErrorMessage(createError, editingSeason ? 'Не удалось сохранить сезон. Проверьте даты.' : 'Не удалось создать сезон. Проверьте даты.'))
    }
  }

  const openExtensions = async (season: Season) => {
    setExtensionTarget(season)
    setExtensionQuery('')
    setExtensionSuggestions([])
    setExtensionStudent(null)
    setExtensionExpiresAt('')
    setExtensionReason('')
    setError(null)
    try {
      const response = await seasonsApi.listExceptions(season.id)
      setExtensions(response.data.exceptions)
    } catch (loadError) {
      setExtensions([])
      setError(getErrorMessage(loadError, 'Не удалось загрузить индивидуальные сроки.'))
    }
  }

  const saveExtension = async (event: FormEvent) => {
    event.preventDefault()
    if (!extensionTarget || !extensionStudent) return
    setBusyId(extensionTarget.id)
    setError(null)
    try {
      await seasonsApi.grantException(extensionTarget.id, {
        user_id: extensionStudent.id,
        expires_at: new Date(extensionExpiresAt).toISOString(),
        reason: extensionReason.trim(),
      })
      await openExtensions(extensionTarget)
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Не удалось сохранить индивидуальный срок.'))
    } finally {
      setBusyId(null)
    }
  }

  const revokeExtension = async (item: SeasonSubmissionException) => {
    if (!extensionTarget) return
    setBusyId(item.id)
    setError(null)
    try {
      await seasonsApi.revokeException(extensionTarget.id, item.id)
      const response = await seasonsApi.listExceptions(extensionTarget.id)
      setExtensions(response.data.exceptions)
    } catch (revokeError) {
      setError(getErrorMessage(revokeError, 'Не удалось отменить индивидуальный срок.'))
    } finally {
      setBusyId(null)
    }
  }

  if (active === 'work') {
    const queue = stats?.staff_queue
    return <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><h2 className="text-xl font-bold text-slate-800">Рабочая область</h2><p className="mt-1 text-sm text-slate-500">Только документы активного сезона, требующие реакции команды.</p></div>
          <div className="flex flex-wrap gap-2">
            {queue?.continue_achievement_id ? <Link to={`/moderation/achievements?document=${queue.continue_achievement_id}`} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white">Продолжить проверку</Link> : null}
            <Link to="/moderation/achievements" className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-indigo-600">Открыть очередь →</Link>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ['Просрочено', queue?.overdue ?? 0, 'Старше 48 часов', '/moderation/achievements?age=overdue'],
          ['Закреплено за мной', queue?.mine ?? 0, 'Моя текущая нагрузка', '/my-work?tab=achievements'],
          ['Свободно', queue?.free ?? 0, 'Ещё не взяты в работу', '/moderation/achievements?assignment=free'],
          ['На доработке', queue?.revision ?? 0, 'Ждём исправления студента', '/documents?status=revision&season=current'],
        ].map(([label, value, hint, href]) => <Link key={label} to={String(href)} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-indigo-300 hover:bg-indigo-50/50"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-800">{value}</div><div className="mt-1 text-xs text-slate-500">{hint}</div></Link>)}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-slate-200 px-4 py-3"><div className="text-xs text-slate-500">Поступило сегодня</div><div className="mt-1 text-xl font-bold text-slate-800">{queue?.received_today ?? 0}</div></div><div className="rounded-lg border border-slate-200 px-4 py-3"><div className="text-xs text-slate-500">Проверено сегодня</div><div className="mt-1 text-xl font-bold text-slate-800">{queue?.reviewed_today ?? 0}</div></div><div className="rounded-lg border border-slate-200 px-4 py-3"><div className="text-xs text-slate-500">Среднее время проверки</div><div className="mt-1 text-xl font-bold text-slate-800">{formatDuration(queue?.average_review_seconds)}</div></div></div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">{(['groups', 'categories'] as const).map((key) => {
        const rows = stats?.moderation_load?.[key] ?? []
        const maxCount = Math.max(1, ...rows.map((row) => row.count))
        return <section key={key} className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-800">Нагрузка по {key === 'groups' ? 'группам' : 'категориям'}</h3><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Текущий сезон</span></div><div className="mt-4 space-y-3">{rows.length ? rows.map((row) => <div key={row.label}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="truncate font-medium text-slate-700">{row.label}</span><span className="shrink-0 font-semibold text-slate-600">{row.count} док.</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${(row.count / maxCount) * 100}%` }} /></div></div>) : <div className="rounded-lg bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">В очереди текущего сезона пока нет документов.</div>}</div></section>
      })}</div>
    </div>
  }

  if (active === 'export') {
    return <div className="space-y-4"><div><h2 className="text-xl font-bold text-slate-800">Экспорт статистики</h2><p className="mt-1 text-sm text-slate-500">Сформируйте выгрузку документов, обращений, рейтинга или пользователей с нужными фильтрами.</p></div><ReportExportPanel /></div>
  }

  if (isLoading && !seasons.length) return <div className="rounded-xl border border-slate-200 bg-surface p-10 text-center text-sm text-slate-500">Загружаем сезоны…</div>

  if (active === 'current') {
    return (
      <div className="space-y-6">
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Текущий сезон</div>
              <h2 className="mt-1 text-xl font-bold text-slate-800">{stats?.current_season?.name ?? 'Активного сезона нет'}</h2>
              <p className="mt-1 text-sm text-slate-500">Статус: {statusLabel(stats?.current_season?.status ?? '—')} · правила {stats?.current_season?.scoring_rules_version ?? '—'}</p>
            </div>
            <Link to="/leaderboard" className="rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-xs font-semibold text-white">Открыть рейтинг</Link>
          </div>
          {stats?.current_season ? <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-500">Начало</div><div className="mt-1 text-sm font-semibold text-slate-800">{formatDate(stats.current_season.start_at)}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-500">Приём до</div><div className="mt-1 text-sm font-semibold text-slate-800">{formatDate(stats.current_season.submissions_close_at)}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-500">Модерация до</div><div className="mt-1 text-sm font-semibold text-slate-800">{formatDate(stats.current_season.moderation_close_at)}</div></div>
          </div> : null}
        </section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Участников', stats?.current_season?.participants ?? 0],
            ['Документов', stats?.current_season?.documents ?? 0],
            ['Подтверждено', stats?.current_season?.approved ?? 0],
            ['Ожидает решения', stats?.current_season?.pending ?? 0],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm"><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-2 text-3xl font-bold text-slate-800">{value}</div></div>)}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Лидеры сезона</h3>
            <div className="mt-4 space-y-3">{stats?.top_students?.length ? stats.top_students.map((student, index) => <Link key={student.id} to={`/users/${student.id}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-sm font-medium text-slate-800">#{index + 1} · {student.first_name} {student.last_name}</span><span className="font-semibold text-indigo-600">{student.points} б.</span></Link>) : <div className="text-sm text-slate-500">Пока нет начисленных баллов.</div>}</div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Направления</h3>
            <div className="mt-4 space-y-3">{stats?.category_activity?.map((item) => <div key={item.category} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-sm text-slate-700">{item.category}</span><span className="text-xs font-semibold text-slate-600">{item.count} док. · {item.points} б.</span></div>)}</div>
          </section>
        </div>
      </div>
    )
  }

  if (active === 'comparison') {
    const maxDocuments = Math.max(1, ...comparison.map((item) => item.documents ?? 0))
    return <div className="space-y-4">
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <div><h2 className="text-xl font-bold text-slate-800">Сравнение сезонов</h2><p className="mt-1 text-sm text-slate-500">Участие, загрузки, доля подтверждений и суммарные баллы. Архив не меняет текущую очередь.</p></div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Сезон</th><th className="px-5 py-3">Участники</th><th className="px-5 py-3">Документы</th><th className="px-5 py-3">Подтверждено</th><th className="px-5 py-3">Баллы</th></tr></thead><tbody className="divide-y divide-slate-100">{comparison.map((item) => <tr key={item.id}><td className="px-5 py-4"><div className="font-semibold text-slate-800">{item.name}</div><div className="mt-1 text-xs text-slate-500">{statusLabel(item.status)}</div></td><td className="px-5 py-4 font-semibold text-slate-700">{item.participants ?? 0}</td><td className="px-5 py-4"><div className="font-semibold text-slate-700">{item.documents ?? 0}</div><div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-500" style={{ width: `${((item.documents ?? 0) / maxDocuments) * 100}%` }} /></div></td><td className="px-5 py-4"><span className="font-semibold text-slate-700">{item.approved ?? 0}</span><span className="ml-2 text-xs text-slate-500">{item.approval_rate}%</span></td><td className="px-5 py-4 font-semibold text-indigo-600">{item.points}</td></tr>)}</tbody></table></div>
        {!comparison.length ? <div className="p-10 text-center text-sm text-slate-500">Для сравнения нужен хотя бы один созданный сезон.</div> : null}
      </div>
    </div>
  }

  if (active === 'management') {
    return <div className="space-y-6">
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
          <div><h2 className="text-lg font-bold text-slate-800">{editingSeason ? `Редактирование: ${editingSeason.name}` : 'Создать следующий сезон'}</h2><p className="mt-1 text-xs text-slate-500">{editingSeason ? 'Название и сроки можно менять до публикации результатов.' : 'Сначала создаётся черновик. Одновременно активным может быть только один сезон.'}</p></div>
          {editingSeason ? <button type="button" onClick={resetSeasonForm} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Отменить редактирование</button> : null}
        </div>
        <form onSubmit={createSeason} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">Название<input required value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
          {([['start_at', 'Начало сезона'], ['submissions_open_at', 'Открытие приёма'], ['submissions_close_at', 'Закрытие приёма'], ['moderation_close_at', 'Окончание модерации']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input type="datetime-local" required value={form[key]} onChange={(e) => setForm((v) => ({ ...v, [key]: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>)}
          <label className="text-xs font-semibold text-slate-600">Версия правил начисления<input required value={form.scoring_rules_version} onChange={(e) => setForm((v) => ({ ...v, scoring_rules_version: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /><span className="mt-1 block font-normal leading-relaxed text-slate-500">Техническая метка формулы и коэффициентов, например v1. Она позволяет воспроизвести расчёт архивного рейтинга.</span></label>
          <div className="flex items-end"><button type="submit" className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">{editingSeason ? 'Сохранить изменения' : 'Создать черновик'}</button></div>
        </form>
      </section>
      <section className="space-y-3">
        <div><h2 className="text-lg font-bold text-slate-800">Все сезоны</h2><p className="text-xs text-slate-500">После публикации сезон становится неизменяемым, а его результаты фиксируются.</p></div>
        {seasons.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-800">{item.name}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{statusLabel(item.status)}</span></div><div className="mt-2 text-xs text-slate-500">{formatDate(item.start_at)} → приём до {formatDate(item.submissions_close_at)} → модерация до {formatDate(item.moderation_close_at)}</div><div className="mt-1 text-xs text-slate-500">{item.participants ?? 0} участников · {item.documents ?? 0} документов · {item.pending ?? 0} ожидает</div></div><div className="flex flex-wrap gap-2">
          {!['published', 'archived'].includes(item.status) ? <button type="button" onClick={() => beginSeasonEdit(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Редактировать</button> : null}
          {['active', 'moderation'].includes(item.status) ? <button type="button" onClick={() => void openExtensions(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-indigo-600">Индивидуальные сроки</button> : null}
          {item.status === 'draft' ? <button disabled={busyId === item.id || Boolean(liveSeason)} onClick={() => void runAction(item, 'activate')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Активировать</button> : null}
          {item.status === 'active' ? <button disabled={busyId === item.id} onClick={() => void runAction(item, 'close')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Закрыть приём</button> : null}
          {item.status === 'moderation' ? <button disabled={busyId === item.id} onClick={() => { setFinalizeTarget(item); setFinalizeName('') }} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Опубликовать результаты</button> : null}
          {item.status === 'published' ? <button disabled={busyId === item.id} onClick={() => void runAction(item, 'archive')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Переместить в архив</button> : null}
        </div></div></article>)}
      </section>
      {finalizeTarget ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4"><div className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-2xl"><h3 className="text-lg font-bold text-slate-800">Опубликовать «{finalizeTarget.name}»?</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">После публикации рейтинг и тематические места будут зафиксированы. Нерешённые документы не попадут в результаты, а архив сезона не будет влиять на новую очередь.</p><label className="mt-4 block text-xs font-semibold text-slate-600">Введите название сезона для подтверждения<input value={finalizeName} onChange={(e) => setFinalizeName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label><div className="mt-5 flex justify-end gap-2"><button onClick={() => setFinalizeTarget(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Отмена</button><button disabled={finalizeName !== finalizeTarget.name || busyId === finalizeTarget.id} onClick={() => void runAction(finalizeTarget, 'finalize').then(() => setFinalizeTarget(null))} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Зафиксировать и опубликовать</button></div></div></div> : null}
      {extensionTarget ? <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4"><div className="my-8 w-full max-w-3xl rounded-xl bg-surface p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-800">Индивидуальные сроки</h3><p className="mt-1 text-sm text-slate-500">{extensionTarget.name} · выбранный студент сможет загрузить документ после общего закрытия приёма.</p></div><button type="button" onClick={() => setExtensionTarget(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">Закрыть</button></div>
        <form onSubmit={saveExtension} className="mt-5 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <div className="md:col-span-2">{extensionStudent ? <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-surface px-3 py-2.5"><div><div className="text-sm font-semibold text-slate-800">{extensionStudent.label}</div><div className="text-xs text-slate-500">Студент выбран</div></div><button type="button" onClick={() => { setExtensionStudent(null); setExtensionQuery('') }} className="text-xs font-semibold text-indigo-600">Изменить</button></div> : <SearchAutocompleteInput label="Студент" value={extensionQuery} placeholder="Введите имя, фамилию или email" suggestions={extensionSuggestions} onChange={setExtensionQuery} onSelectSuggestion={(item) => { if (item.id == null) return; setExtensionStudent({ id: item.id, label: item.text }); setExtensionQuery(item.text); setExtensionSuggestions([]) }} />}</div>
          <label className="text-xs font-semibold text-slate-600">Разрешить загрузку до<input type="datetime-local" required value={extensionExpiresAt} onChange={(event) => setExtensionExpiresAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-surface px-3 py-2.5 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Причина<input required minLength={5} value={extensionReason} onChange={(event) => setExtensionReason(event.target.value)} placeholder="Например, подтверждённая техническая проблема" className="mt-1 w-full rounded-lg border border-slate-200 bg-surface px-3 py-2.5 text-sm" /></label>
          <div className="md:col-span-2"><button disabled={!extensionStudent || busyId === extensionTarget.id} type="submit" className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Сохранить индивидуальный срок</button></div>
        </form>
        <div className="mt-6"><h4 className="text-sm font-semibold text-slate-800">Назначенные сроки</h4><div className="mt-3 space-y-2">{extensions.length ? extensions.map((item) => <div key={item.id} className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 sm:flex-row sm:items-center"><div><div className="text-sm font-semibold text-slate-800">{item.user_name}</div><div className="text-xs text-slate-500">{item.user_email} · до {formatDate(item.expires_at)}</div><div className="mt-1 text-xs text-slate-600">{item.reason}</div></div><button type="button" disabled={busyId === item.id} onClick={() => void revokeExtension(item)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40">Отменить срок</button></div>) : <div className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">Индивидуальные сроки ещё не назначены.</div>}</div></div>
      </div></div> : null}
    </div>
  }

  const serviceLabels: Record<string, string> = { api: 'API', database: 'База данных', redis: 'Redis', minio: 'Хранилище файлов', llm: 'Локальная LLM', ocr: 'OCR', epoch: 'Epoch / Emercom' }
  const serviceStatusLabels = { ok: 'Работает', auth: 'Доступен, нужна авторизация', down: 'Недоступен' } as const
  return <div className="space-y-6">
    <div><h2 className="text-xl font-bold text-slate-800">Система</h2><p className="mt-1 text-sm text-slate-500">Фактическая доступность сервисов на момент проверки.</p></div>
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(systemHealth?.services ?? {}).map(([key, service]) => <div key={key} className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm"><div className="text-xs font-bold uppercase text-slate-500">{serviceLabels[key] ?? key}</div><div className="mt-2 text-lg font-semibold text-slate-800">{serviceStatusLabels[service.status]}</div>{service.http_status ? <div className="mt-1 text-xs text-slate-500">HTTP {service.http_status}</div> : null}</div>)}</div>
    {!systemHealth ? <div className="rounded-xl border border-slate-200 bg-surface p-8 text-center text-sm text-slate-500">Проверяем сервисы…</div> : null}
    {systemHealth ? <section className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm"><h3 className="text-sm font-semibold text-slate-800">Диагностика</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-4"><div className="text-xs text-slate-500">Открытые баг-репорты</div><div className="mt-1 text-2xl font-bold text-slate-800">{systemHealth.diagnostics.open_bug_reports}</div></div><div className="rounded-lg bg-slate-50 p-4"><div className="text-xs text-slate-500">С привязанной сессией Epoch</div><div className="mt-1 text-2xl font-bold text-slate-800">{systemHealth.diagnostics.reports_with_session}</div></div></div></section> : null}
    <div className="flex flex-wrap gap-3"><Link to="/moderation/bug-reports" className="rounded-lg border border-slate-200 bg-surface px-4 py-2.5 text-sm font-semibold text-slate-700">Баг-репорты</Link><Link to="/users" className="rounded-lg border border-slate-200 bg-surface px-4 py-2.5 text-sm font-semibold text-slate-700">Проверить AI-поиск</Link></div>
  </div>
}
