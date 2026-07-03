import { useEffect, useMemo, useState } from 'react'

import { reportsApi, type ScopeStudent } from '@/api/reports'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { usersApi } from '@/api/users'
import { AchievementCategory } from '@/types/enums'
import { coursesForEducationLevel, groupsForEducationLevel } from '@/utils/labels'

const EDUCATION_LEVELS = ['Специалитет']

const REPORT_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'moderation', label: 'Очередь модерации', hint: 'Документы, ожидающие проверки модератором' },
  { value: 'documents', label: 'Документы', hint: 'Полный реестр документов с фильтрами по статусам' },
  { value: 'categories', label: 'По направлениям', hint: 'Сводка по категориям и уровням достижений' },
  { value: 'leaderboard', label: 'Рейтинг', hint: 'Рейтинг студентов с баллами и количеством документов' },
  { value: 'students', label: 'По студентам', hint: 'Выгрузка по студентам, курсам и группам' },
  { value: 'groups', label: 'По группам', hint: 'Агрегированная статистика по группам' },
  { value: 'streams', label: 'По потокам', hint: 'Агрегированная статистика по потокам' },
  { value: 'aggregate', label: 'Агрегированная', hint: 'Сводная статистика по группам и направлениям' },
  { value: 'support', label: 'Обращения', hint: 'Обращения поддержки за выбранный период' },
]

// Which controls each report type exposes.
type TypeConfig = { period: boolean; status?: 'achievement' | 'support'; category: boolean }
const TYPE_CONFIG: Record<string, TypeConfig> = {
  moderation: { period: true, category: true },
  documents: { period: true, status: 'achievement', category: true },
  categories: { period: true, category: true },
  groups: { period: true, category: true },
  streams: { period: true, category: true },
  aggregate: { period: true, category: true },
  leaderboard: { period: false, category: false },
  students: { period: false, category: false },
  support: { period: true, status: 'support', category: false },
}

const ACHIEVEMENT_STATUSES: Array<[string, string]> = [
  ['all', 'Все статусы'],
  ['pending', 'На проверке'],
  ['approved', 'Одобрено'],
  ['rejected', 'Отклонено'],
  ['revision', 'На доработке'],
  ['archived', 'Архив'],
]
const SUPPORT_STATUSES: Array<[string, string]> = [
  ['all', 'Все обращения'],
  ['open', 'Открытые'],
  ['in_progress', 'В работе'],
  ['closed', 'Закрытые'],
  ['archived', 'Архив'],
]

const CATEGORY_OPTIONS = Object.values(AchievementCategory)

const PERIOD_PRESETS: Array<[string, string]> = [
  ['all', 'Всё время'],
  ['day', 'Последние 24 часа'],
  ['week', 'Последние 7 дней'],
  ['month', 'Последние 30 дней'],
]

const inputClass =
  'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none transition-all disabled:opacity-50'
const labelClass = 'block text-[10px] font-bold text-slate-500 uppercase mb-1 tracking-wider'

export function ReportExportPanel() {
  const [reportType, setReportType] = useState('moderation')

  const [periodMode, setPeriodMode] = useState<'quick' | 'custom'>('quick')
  const [period, setPeriod] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [educationLevel, setEducationLevel] = useState('all')
  const [course, setCourse] = useState('0')
  const [group, setGroup] = useState('all')

  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')

  const [studentMode, setStudentMode] = useState<'scope' | 'specific'>('scope')
  const [scopeList, setScopeList] = useState<ScopeStudent[]>([])
  const [scopeLoading, setScopeLoading] = useState(false)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  const [specificQuery, setSpecificQuery] = useState('')
  const [specificStudents, setSpecificStudents] = useState<Array<{ id: number; label: string }>>([])
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])

  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')

  const config = TYPE_CONFIG[reportType] ?? { period: true, category: false }

  const courseOptions = educationLevel !== 'all' ? coursesForEducationLevel(educationLevel) : []
  const groupOptions =
    educationLevel !== 'all'
      ? course !== '0'
        ? groupsForEducationLevel(educationLevel, course)
        : groupsForEducationLevel(educationLevel)
      : []

  // Reset status/category when they no longer apply to the chosen type.
  useEffect(() => {
    setStatus('all')
    setCategory('all')
  }, [reportType])

  // Load the scope student list when in "Охват" mode and a level is chosen.
  useEffect(() => {
    if (studentMode !== 'scope' || educationLevel === 'all') {
      setScopeList([])
      setExcludedIds(new Set())
      return
    }
    let active = true
    setScopeLoading(true)
    reportsApi
      .scopeStudents({
        education_level: educationLevel,
        course: course !== '0' ? course : undefined,
        group: group !== 'all' ? group : undefined,
      })
      .then((res) => {
        if (!active) return
        setScopeList(res.data.students)
        setExcludedIds(new Set()) // fresh scope → everyone included by default
      })
      .catch(() => {
        if (active) setScopeList([])
      })
      .finally(() => {
        if (active) setScopeLoading(false)
      })
    return () => {
      active = false
    }
  }, [studentMode, educationLevel, course, group])

  // Autocomplete for the "Точечно" mode.
  useEffect(() => {
    const trimmed = specificQuery.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      return
    }
    const chosen = new Set(specificStudents.map((s) => s.id))
    let active = true
    usersApi
      .search(trimmed, 8)
      .then((res) => {
        if (active) setSuggestions(res.data.filter((item) => item.id != null && !chosen.has(item.id)))
      })
      .catch(() => {
        if (active) setSuggestions([])
      })
    return () => {
      active = false
    }
  }, [specificQuery, specificStudents])

  const includedCount = scopeList.length - excludedIds.size

  const statusOptions = config.status === 'support' ? SUPPORT_STATUSES : ACHIEVEMENT_STATUSES

  const toggleExcluded = (id: number) => {
    setExcludedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const params = useMemo(() => {
    const p = new URLSearchParams()

    if (config.period) {
      if (periodMode === 'quick') {
        if (period !== 'all') p.set('period', period)
      } else {
        if (dateFrom) p.set('date_from', dateFrom)
        if (dateTo) p.set('date_to', dateTo)
      }
    }

    if (config.status && status !== 'all') p.set('status', status)
    if (config.category && category !== 'all') p.set('category', category)

    if (studentMode === 'specific') {
      // Concrete people, regardless of stream/course scope.
      specificStudents.forEach((s) => p.append('student_ids', String(s.id)))
    } else {
      // Scope mode: level/course/group scope the report; only send explicit ids
      // when the user has deselected somebody from the loaded list.
      if (educationLevel !== 'all') p.set('education_level', educationLevel)
      if (course !== '0') p.set('course', course)
      if (group !== 'all') p.set('group', group)
      if (excludedIds.size > 0) {
        scopeList
          .filter((s) => !excludedIds.has(s.id))
          .forEach((s) => p.append('student_ids', String(s.id)))
      }
    }
    return p
  }, [config, periodMode, period, dateFrom, dateTo, status, category, studentMode, specificStudents, educationLevel, course, group, excludedIds, scopeList])

  const handleDownload = async () => {
    setError('')
    // Guard: scope mode with everyone deselected would produce an empty file.
    if (studentMode === 'scope' && scopeList.length > 0 && includedCount === 0) {
      setError('Выберите хотя бы одного студента или переключитесь на «Все».')
      return
    }
    if (studentMode === 'specific' && specificStudents.length === 0) {
      setError('Добавьте хотя бы одного студента через поиск.')
      return
    }
    setIsExporting(true)
    try {
      const response = await reportsApi.exportCsv(reportType, params)
      const blob = new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${reportType}_report.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      setError('Не удалось сформировать отчёт. Попробуйте ещё раз.')
    } finally {
      setIsExporting(false)
    }
  }

  const activeHint = REPORT_TYPES.find((t) => t.value === reportType)?.hint ?? ''

  return (
    <div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Экспорт отчётов (CSV)</h3>
      </div>

      {/* Report type */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={labelClass}>Тип отчёта</label>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)} className={inputClass}>
            {REPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Type-specific: status */}
        {config.status ? (
          <div>
            <label className={labelClass}>{config.status === 'support' ? 'Состояние обращений' : 'Статус документов'}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Type-specific: category */}
        {config.category ? (
          <div>
            <label className={labelClass}>Направление</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="all">Все направления</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* Period — only for types that use it */}
      {config.period ? (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <label className={labelClass + ' mb-0'}>Период</label>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setPeriodMode('quick')}
                className={`px-3 py-1 rounded-md transition-colors ${periodMode === 'quick' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Быстрый
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('custom')}
                className={`px-3 py-1 rounded-md transition-colors ${periodMode === 'custom' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Свой период
              </button>
            </div>
          </div>
          {periodMode === 'quick' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-surface p-1">
              {PERIOD_PRESETS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPeriod(value)}
                  className={`rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors ${period === value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Дата с</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Дата по</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Students: scope vs specific */}
      <div className="mb-4 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center gap-2 mb-3">
          <label className={labelClass + ' mb-0'}>Кого включить</label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setStudentMode('scope')}
              className={`px-3 py-1 rounded-md transition-colors ${studentMode === 'scope' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              По охвату
            </button>
            <button
              type="button"
              onClick={() => setStudentMode('specific')}
              className={`px-3 py-1 rounded-md transition-colors ${studentMode === 'specific' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Точечно
            </button>
          </div>
        </div>

        {studentMode === 'scope' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Уровень обучения</label>
                <select
                  value={educationLevel}
                  onChange={(e) => {
                    setEducationLevel(e.target.value)
                    setCourse('0')
                    setGroup('all')
                  }}
                  className={inputClass}
                >
                  <option value="all">Все направления</option>
                  {EDUCATION_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Курс</label>
                <select
                  value={course}
                  onChange={(e) => {
                    setCourse(e.target.value)
                    setGroup('all')
                  }}
                  disabled={educationLevel === 'all'}
                  className={inputClass}
                >
                  <option value="0">Все курсы</option>
                  {courseOptions.map((c) => (
                    <option key={c} value={c}>
                      {c} курс
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Группа</label>
                <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={educationLevel === 'all'} className={inputClass}>
                  <option value="all">Все группы</option>
                  {groupOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {educationLevel !== 'all' ? (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-600">
                    {scopeLoading ? 'Загрузка…' : `Выбрано ${includedCount} из ${scopeList.length}`}
                  </span>
                  {scopeList.length > 0 ? (
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <button type="button" onClick={() => setExcludedIds(new Set())} className="text-indigo-600 hover:underline">
                        Выбрать всех
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={() => setExcludedIds(new Set(scopeList.map((s) => s.id)))}
                        className="text-slate-500 hover:underline"
                      >
                        Снять всех
                      </button>
                    </div>
                  ) : null}
                </div>
                {scopeList.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                    {scopeList.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!excludedIds.has(s.id)}
                          onChange={() => toggleExcluded(s.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-slate-700">
                          {s.last_name} {s.first_name}
                        </span>
                        <span className="ml-auto text-[11px] text-slate-400">
                          {[s.course ? `${s.course} курс` : null, s.study_group].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : !scopeLoading ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                    Нет студентов под выбранный охват
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-slate-400">
                Выберите уровень обучения, чтобы отметить конкретных студентов галочками. Иначе отчёт охватит всех доступных.
              </p>
            )}
          </>
        ) : (
          <>
            <SearchAutocompleteInput
              label="Поиск студентов"
              value={specificQuery}
              placeholder="Имя, фамилия или email…"
              suggestions={suggestions}
              onChange={setSpecificQuery}
              onSelectSuggestion={(item) => {
                if (item.id == null) return
                setSpecificStudents((cur) => (cur.some((s) => s.id === item.id) ? cur : [...cur, { id: item.id!, label: item.text }]))
                setSpecificQuery('')
                setSuggestions([])
              }}
            />
            {specificStudents.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {specificStudents.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700"
                  >
                    {s.label}
                    <button
                      type="button"
                      onClick={() => setSpecificStudents((cur) => cur.filter((item) => item.id !== s.id))}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                      aria-label="Убрать"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">Точечный режим: в отчёт попадут только выбранные здесь люди, без привязки к потоку.</p>
            )}
          </>
        )}
      </div>

      {error ? <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div> : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={isExporting}
          className="inline-flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-60"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          {isExporting ? 'Готовим…' : 'Скачать CSV'}
        </button>
        <p className="text-[10px] text-slate-400">{activeHint}</p>
      </div>
    </div>
  )
}
