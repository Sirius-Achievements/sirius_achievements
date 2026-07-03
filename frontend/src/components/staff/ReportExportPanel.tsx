import { useEffect, useMemo, useState } from 'react'

import { reportsApi, type ScopeStudent } from '@/api/reports'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { usersApi } from '@/api/users'
import { AchievementCategory } from '@/types/enums'
import { coursesForEducationLevel, groupsForEducationLevel } from '@/utils/labels'

const EDUCATION_LEVELS = ['Специалитет']

// Top-level "what are we exporting".
type ReportObject = 'documents' | 'support' | 'leaderboard' | 'students'
const OBJECTS: Array<{ value: ReportObject; label: string; hint: string }> = [
  { value: 'documents', label: 'Документы', hint: 'Реестр достижений и сводки по ним' },
  { value: 'support', label: 'Обращения', hint: 'Обращения поддержки за период' },
  { value: 'leaderboard', label: 'Рейтинг', hint: 'Рейтинг студентов по баллам' },
  { value: 'students', label: 'Люди', hint: 'Выгрузка по студентам' },
]

// The "разрез" (grouping) inside an object → the backend report_type it maps to.
type Slice = { value: string; label: string; backend: string }
const SLICES: Record<ReportObject, Slice[]> = {
  documents: [
    { value: 'list', label: 'Список', backend: 'documents' },
    { value: 'groups', label: 'По группам', backend: 'groups' },
    { value: 'streams', label: 'По потокам', backend: 'streams' },
    { value: 'categories', label: 'По направлениям', backend: 'categories' },
  ],
  support: [{ value: 'list', label: 'Список', backend: 'support' }],
  leaderboard: [{ value: 'list', label: 'Рейтинг', backend: 'leaderboard' }],
  students: [{ value: 'list', label: 'Список', backend: 'students' }],
}

const ACHIEVEMENT_STATUSES: Array<[string, string]> = [
  ['all', 'Все статусы'],
  ['pending', 'На проверке'],
  ['approved', 'Одобрено'],
  ['rejected', 'Отклонено'],
  ['revision', 'На доработке'],
]
const SUPPORT_STATUSES: Array<[string, string]> = [
  ['all', 'Все обращения'],
  ['open', 'Открытые'],
  ['in_progress', 'В работе'],
  ['closed', 'Закрытые'],
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

function controlsFor(object: ReportObject, slice: string) {
  const isDocList = object === 'documents' && slice === 'list'
  return {
    period: object === 'documents' || object === 'support',
    status: object === 'support' ? 'support' : isDocList ? 'achievement' : null,
    // Category (multi) applies to documents (all slices) and to ranking/people
    // where it means "points earned in the selected directions".
    category: object === 'documents' || object === 'leaderboard' || object === 'students',
  } as const
}

export function ReportExportPanel() {
  const [reportObject, setReportObject] = useState<ReportObject>('documents')
  const [slice, setSlice] = useState('list')

  const [periodMode, setPeriodMode] = useState<'quick' | 'custom'>('quick')
  const [period, setPeriod] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [educationLevel, setEducationLevel] = useState('all')
  const [course, setCourse] = useState('0')
  const [group, setGroup] = useState('all')

  const [status, setStatus] = useState('all')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])

  const [studentMode, setStudentMode] = useState<'scope' | 'specific'>('scope')
  const [scopeList, setScopeList] = useState<ScopeStudent[]>([])
  const [scopeLoading, setScopeLoading] = useState(false)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  const [specificQuery, setSpecificQuery] = useState('')
  const [specificStudents, setSpecificStudents] = useState<Array<{ id: number; label: string }>>([])
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])

  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')

  const slices = SLICES[reportObject]
  const backendType = slices.find((s) => s.value === slice)?.backend ?? slices[0].backend
  const config = controlsFor(reportObject, slice)

  const courseOptions = educationLevel !== 'all' ? coursesForEducationLevel(educationLevel) : []
  const groupOptions =
    educationLevel !== 'all'
      ? course !== '0'
        ? groupsForEducationLevel(educationLevel, course)
        : groupsForEducationLevel(educationLevel)
      : []

  // Reset slice + type-specific filters when the object changes.
  useEffect(() => {
    setSlice(SLICES[reportObject][0].value)
    setStatus('all')
  }, [reportObject])

  useEffect(() => {
    setStatus('all')
  }, [slice])

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
        setExcludedIds(new Set())
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

  const toggleCategory = (value: string) => {
    setSelectedCategories((current) =>
      current.includes(value) ? current.filter((c) => c !== value) : [...current, value],
    )
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
    if (config.category) selectedCategories.forEach((c) => p.append('categories', c))

    if (studentMode === 'specific') {
      specificStudents.forEach((s) => p.append('student_ids', String(s.id)))
    } else {
      if (educationLevel !== 'all') p.set('education_level', educationLevel)
      if (course !== '0') p.set('course', course)
      if (group !== 'all') p.set('group', group)
      if (excludedIds.size > 0) {
        scopeList.filter((s) => !excludedIds.has(s.id)).forEach((s) => p.append('student_ids', String(s.id)))
      }
    }
    return p
  }, [config, periodMode, period, dateFrom, dateTo, status, selectedCategories, studentMode, specificStudents, educationLevel, course, group, excludedIds, scopeList])

  const handleDownload = async () => {
    setError('')
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
      const response = await reportsApi.exportCsv(backendType, params)
      const blob = new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${backendType}_report.csv`
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

  const activeHint = OBJECTS.find((o) => o.value === reportObject)?.hint ?? ''

  return (
    <div className="bg-surface p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Экспорт отчётов (CSV)</h3>
      </div>

      {/* Object tabs */}
      <div className="mb-4">
        <label className={labelClass}>Что выгружаем</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-surface p-1">
          {OBJECTS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setReportObject(o.value)}
              className={`rounded-lg px-3 py-2 text-center text-xs font-semibold transition-colors ${reportObject === o.value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Slice (разрез) — only when the object has more than one */}
      {slices.length > 1 ? (
        <div className="mb-4">
          <label className={labelClass}>Разрез</label>
          <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {slices.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSlice(s.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${slice === s.value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Status (single) */}
      {config.status ? (
        <div className="mb-4 max-w-xs">
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

      {/* Category (multi, combinable) */}
      {config.category ? (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className={labelClass + ' mb-0'}>Направления {selectedCategories.length > 0 ? `(${selectedCategories.length})` : '— все'}</label>
            {selectedCategories.length > 0 ? (
              <button type="button" onClick={() => setSelectedCategories([])} className="text-[11px] font-semibold text-slate-500 hover:underline">
                Сбросить
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map((c) => {
              const active = selectedCategories.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300'}`}
                >
                  {active ? (
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                  {c}
                </button>
              )
            })}
          </div>
          {(reportObject === 'leaderboard' || reportObject === 'students') && selectedCategories.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-slate-400">Баллы и рейтинг считаются только по выбранным направлениям.</p>
          ) : null}
        </div>
      ) : null}

      {/* Period toggle */}
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
                      <button type="button" onClick={() => setExcludedIds(new Set(scopeList.map((s) => s.id)))} className="text-slate-500 hover:underline">
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
