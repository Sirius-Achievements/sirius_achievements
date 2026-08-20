import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { moderationApi } from '@/api/moderation'
import { usersApi } from '@/api/users'
import { ChipMultiSelect } from '@/components/staff/ChipMultiSelect'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { User } from '@/types/user'
import { formatDateTime } from '@/utils/formatDate'
import { getErrorMessage } from '@/utils/http'
import { courseLabel, coursesForEducationLevel, roleLabel, userStatusLabel } from '@/utils/labels'

const USERS_PAGE_SIZE = 10

function statusLabel(status: string, reviewedById?: number, currentUserId?: number) {
  if (status === 'active') return 'Активен'
  if (status === 'pending' && !reviewedById) return 'Новый'
  if (status === 'pending' && reviewedById === currentUserId) return 'В работе'
  if (status === 'pending') return 'Принято'
  if (status === 'deleted') return 'Удалён'
  if (status === 'rejected') return 'Отклонён'
  return userStatusLabel(status)
}

function statusClass(status: string, reviewedById?: number, currentUserId?: number) {
  if (status === 'active') return 'bg-green-50 text-green-700 border-green-100'
  if (status === 'pending' && !reviewedById) return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (status === 'pending' && reviewedById === currentUserId) return 'bg-blue-50 text-blue-700 border-blue-200'
  if (status === 'pending') return 'bg-slate-100 text-slate-500 border-slate-200'
  return 'bg-red-50 text-red-700 border-red-100'
}

export function UsersPage() {
  const location = useLocation()
  const { user: currentUser } = useAuth()
  const { pushToast } = useToast()
  const [items, setItems] = useState<User[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [educationLevels, setEducationLevels] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [roleSel, setRoleSel] = useState<string[]>([])
  const [statusSel, setStatusSel] = useState<string[]>([])
  const [eduSel, setEduSel] = useState<string[]>([])
  const [courseSel, setCourseSel] = useState<string[]>([])
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    'stream',
    'status',
    'moderator',
    'created',
  ])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])
  const [aiMode, setAiMode] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [aiActiveDescription, setAiActiveDescription] = useState<string | null>(null)
  const [aiSearchMode, setAiSearchMode] = useState<'ai' | 'fallback' | null>(null)

  const filters = useMemo(
    () => ({
      page,
      query: query || undefined,
      roles: roleSel.length ? roleSel : undefined,
      statuses: statusSel.length ? statusSel : undefined,
      education_levels: eduSel.length ? eduSel : undefined,
      courses: courseSel.length ? courseSel : undefined,
      sort_by: sortBy,
    }),
    [courseSel, eduSel, page, query, roleSel, sortBy, statusSel],
  )

  const toggleIn = (setter: Dispatch<SetStateAction<string[]>>) => (value: string) =>
    setter((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]))

  const courseOptions = Array.from(
    new Set((eduSel.length ? eduSel : educationLevels).flatMap((l) => coursesForEducationLevel(l))),
  )
    .sort((a, b) => a - b)
    .map(String)

  const loadUsers = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data } = await usersApi.list(filters)
      setItems(data.users)
      setRoles(data.roles)
      setStatuses(data.statuses)
      setEducationLevels(data.education_levels)
      setTotalPages(data.total_pages)
      setTotalItems(data.total_items)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить список пользователей.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (aiMode) return
    void loadUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, aiMode])

  useEffect(() => {
    setPage(1)
  }, [query, roleSel, statusSel, eduSel, courseSel, sortBy])

  const runAiSearch = async () => {
    const trimmed = aiDescription.trim()
    if (!trimmed) return

    setIsLoading(true)
    setError(null)

    try {
      const { data } = await usersApi.smartSearch(trimmed, {
        education_levels: eduSel.length ? eduSel : undefined,
        courses: courseSel.length ? courseSel : undefined,
        statuses: statusSel.length ? statusSel : undefined,
      })
      setItems(data.users)
      setRoles(data.roles)
      setStatuses(data.statuses)
      setEducationLevels(data.education_levels)
      setTotalPages(data.total_pages)
      setTotalItems(data.total_items)
      setAiActiveDescription(trimmed)
      setAiSearchMode(data.search_mode ?? 'ai')
    } catch (aiError) {
      setError(getErrorMessage(aiError, 'AI-поиск временно недоступен.'))
    } finally {
      setIsLoading(false)
    }
  }

  const toggleAiMode = () => {
    setAiMode((prev) => {
      const next = !prev
      if (!next) {
        setAiActiveDescription(null)
        setAiDescription('')
        setAiSearchMode(null)
      }
      return next
    })
  }

  // Drop selected courses that are no longer offered by the chosen education levels.
  useEffect(() => {
    setCourseSel((cur) => cur.filter((c) => courseOptions.includes(c)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eduSel])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const { data } = await usersApi.search(trimmed)
        setSuggestions(data)
      } catch {
        setSuggestions([])
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query])

  const resetFilters = () => {
    setQuery('')
    setRoleSel([])
    setStatusSel([])
    setEduSel([])
    setCourseSel([])
    setSortBy('newest')
    setSuggestions([])
    setAiMode(false)
    setAiDescription('')
    setAiActiveDescription(null)
    setAiSearchMode(null)
    setPage(1)
  }

  const profileTarget = (id: number) =>
    `/users/${id}?from=users&return=${encodeURIComponent(`${location.pathname}${location.search}`)}`

  const exportUsers = (rows: User[]) => {
    if (!rows.length) return
    const escapeCell = (value: unknown) => `"${String(value ?? '').split('"').join('""')}"`
    const lines = [
      ['ID', 'Имя', 'Фамилия', 'Email', 'Обучение', 'Курс', 'Группа', 'Роль', 'Статус'],
      ...rows.map((item) => [
        item.id,
        item.first_name,
        item.last_name,
        item.email,
        item.education_level ?? '',
        item.course ?? '',
        item.study_group ?? '',
        roleLabel(item.role),
        statusLabel(item.status, item.reviewed_by_id, currentUser?.id),
      ]),
    ]
    const csv = `\uFEFF${lines.map((line) => line.map(escapeCell).join(';')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `users-selection-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleColumn = (column: string) => {
    setVisibleColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    )
  }

  const handleTake = async (targetUser: User) => {
    try {
      await moderationApi.takeUser(targetUser.id)
      pushToast({ title: 'Пользователь взят в работу', tone: 'success' })
      await loadUsers()
    } catch (takeError) {
      setError(getErrorMessage(takeError, 'Не удалось взять пользователя в работу.'))
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [restoreBusyId, setRestoreBusyId] = useState<number | null>(null)

  const handleDelete = (targetUser: User) => {
    setDeleteTarget(targetUser)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await usersApi.delete(deleteTarget.id)
      pushToast({ title: 'Пользователь удалён', tone: 'success' })
      setDeleteTarget(null)
      await loadUsers()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Не удалось удалить пользователя.'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleRestore = async (targetUser: User) => {
    setRestoreBusyId(targetUser.id)
    setError(null)

    try {
      await usersApi.restore(targetUser.id)
      pushToast({ title: 'Аккаунт восстановлен', tone: 'success' })
      await loadUsers()
    } catch (restoreError) {
      setError(getErrorMessage(restoreError, 'Не удалось восстановить пользователя.'))
    } finally {
      setRestoreBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StaffSectionHeader
        kind="users"
        currentView="all"
        title="Все пользователи"
        description="Полный список аккаунтов с единым поиском и административными фильтрами."
      />

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (aiMode) void runAiSearch()
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-[240px] flex-1">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {aiMode ? 'ИИ-поиск по описанию' : 'Поиск'}
              </label>
              <button
                type="button"
                onClick={toggleAiMode}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  aiMode
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                ИИ-поиск
              </button>
            </div>

            {aiMode ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiDescription}
                  onChange={(event) => setAiDescription(event.target.value)}
                  placeholder="Опишите, кого ищете: например, победители олимпиад по математике..."
                  className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
                />
                <button
                  type="submit"
                  disabled={!aiDescription.trim() || isLoading}
                  className="h-[38px] shrink-0 rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Найти
                </button>
              </div>
            ) : (
              <SearchAutocompleteInput
                label=""
                value={query}
                placeholder="Имя, email или телефон..."
                suggestions={suggestions}
                onChange={setQuery}
                onSelectSuggestion={(item) => {
                  setQuery(item.value || item.text)
                  setSuggestions([])
                }}
              />
            )}
            {aiMode ? (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Локальная LLM проанализирует профили и достижения студентов по вашему описанию. Поиск может занять до минуты.
              </p>
            ) : null}
          </div>

          {!aiMode ? (
            <div className="w-full sm:w-[150px]">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Сортировка
              </label>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
              >
                <option value="newest">Сначала новые</option>
                <option value="oldest">Сначала старые</option>
                <option value="first_name_asc">По имени (А-Я)</option>
                <option value="first_name_desc">По имени (Я-А)</option>
                <option value="last_name_asc">По фамилии (А-Я)</option>
                <option value="last_name_desc">По фамилии (Я-А)</option>
              </select>
            </div>
          ) : null}

          {!aiMode ? (
            <div className="w-full">
              <ChipMultiSelect label="Роль" options={roles} selected={roleSel} onToggle={toggleIn(setRoleSel)} labelFor={roleLabel} onReset={() => setRoleSel([])} />
            </div>
          ) : null}

          <div className="w-full">
            <ChipMultiSelect label="Обучение" options={educationLevels} selected={eduSel} onToggle={toggleIn(setEduSel)} onReset={() => setEduSel([])} />
          </div>

          {courseOptions.length > 0 ? (
            <div className="w-full">
              <ChipMultiSelect label="Курс" options={courseOptions} selected={courseSel} onToggle={toggleIn(setCourseSel)} labelFor={(c) => courseLabel(c)} onReset={() => setCourseSel([])} />
            </div>
          ) : null}

          <div className="w-full">
            <ChipMultiSelect label="Статус" options={statuses} selected={statusSel} onToggle={toggleIn(setStatusSel)} labelFor={userStatusLabel} onReset={() => setStatusSel([])} />
          </div>

          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => void (aiMode ? runAiSearch() : loadUsers())}
              disabled={aiMode && !aiDescription.trim()}
              className="h-[38px] flex-1 rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            >
              Обновить
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="h-[38px] flex-1 rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 sm:flex-none"
            >
              Сбросить
            </button>
          </div>
        </form>
      </div>

      {aiActiveDescription ? (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-700">
          ИИ-поиск по запросу «{aiActiveDescription}»: найдено {items.length}{' '}
          {items.length === 1 ? 'студент' : 'студентов'}.
          {aiSearchMode === 'fallback' ? ' Локальная нейросеть не запущена, поэтому использован быстрый поиск по данным профиля и подтверждённым достижениям.' : ''}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-surface px-4 py-3">
        <div className="text-sm text-slate-600">
          Найдено: <strong className="text-slate-900">{aiMode ? items.length : totalItems}</strong>
          {selectedIds.length ? <span className="ml-2">· выбрано {selectedIds.length}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <details className="relative">
            <summary className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-slate-600">
              Колонки
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-48 space-y-2 rounded-xl border border-slate-200 bg-surface p-3 shadow-lg">
              {[
                ['stream', 'Поток'],
                ['status', 'Статус'],
                ['moderator', 'Модератор'],
                ['created', 'Создано'],
              ].map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={visibleColumns.includes(key)} onChange={() => toggleColumn(key)} />
                  {label}
                </label>
              ))}
            </div>
          </details>
          <button
            type="button"
            onClick={() => exportUsers(selectedIds.length ? items.filter((item) => selectedIds.includes(item.id)) : items)}
            disabled={!items.length}
            className="rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 disabled:opacity-50"
          >
            {selectedIds.length ? 'Экспортировать выбранных' : 'Экспортировать текущую выборку'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
        {isLoading ? (
          <div className="py-16">
            <LoadingSpinner />
          </div>
        ) : items.length ? (
          <>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Выбрать всех на странице"
                      checked={items.length > 0 && items.every((item) => selectedIds.includes(item.id))}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, ...items.map((item) => item.id)]))
                            : current.filter((id) => !items.some((item) => item.id === id)),
                        )
                      }
                    />
                  </th>
                  <th className="px-5 py-3 font-bold">#</th>
                  <th className="px-5 py-3 font-bold">Пользователь</th>
                  {visibleColumns.includes('stream') ? <th className="px-5 py-3 font-bold">Поток</th> : null}
                  {visibleColumns.includes('status') ? <th className="px-5 py-3 font-bold">Статус</th> : null}
                  {visibleColumns.includes('moderator') ? <th className="px-5 py-3 font-bold">Модератор</th> : null}
                  {visibleColumns.includes('created') ? <th className="px-5 py-3 font-bold">Создано</th> : null}
                  <th className="px-5 py-3 text-right font-bold">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((item, index) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${item.first_name} ${item.last_name}`}
                        checked={selectedIds.includes(item.id)}
                        onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                      />
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">{(page - 1) * USERS_PAGE_SIZE + index + 1}</td>
                    <td className="px-5 py-3">
                      <Link
                        to={profileTarget(item.id)}
                        className="block font-medium text-slate-800 transition-colors hover:text-indigo-600"
                      >
                        {item.first_name} {item.last_name}
                      </Link>
                      <div className="text-[10px] text-slate-400">{item.email}</div>
                      {aiMode && item.match_reason ? (
                        <div className="mt-1 max-w-[320px] whitespace-normal rounded-md bg-indigo-50 px-2 py-1 text-[10px] text-indigo-700">
                          Почему найден: {item.match_reason}
                        </div>
                      ) : null}
                    </td>
                    {visibleColumns.includes('stream') ? <td className="px-5 py-3">
                      {item.education_level ? (
                        <>
                          <span className="block text-xs text-slate-700">{item.education_level}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {item.course ? courseLabel(item.course) : '—'}
                          </span>
                          {item.study_group ? <span className="block text-[10px] text-slate-400">{item.study_group}</span> : null}
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td> : null}
                    {visibleColumns.includes('status') ? <td className="px-5 py-3">
                      <span className="mb-1 inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {roleLabel(item.role)}
                      </span>
                      <br />
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusClass(item.status, item.reviewed_by_id, currentUser?.id)}`}
                      >
                        {statusLabel(item.status, item.reviewed_by_id, currentUser?.id)}
                      </span>
                    </td> : null}
                    {visibleColumns.includes('moderator') ? <td className="px-5 py-3 text-xs text-slate-500">
                      {item.status === 'pending' && item.reviewed_by_id ? (
                        item.reviewed_by_id === currentUser?.id ? (
                          <div className="font-medium text-slate-700">Вы</div>
                        ) : (
                          <span className="text-slate-400">Другой модератор</span>
                        )
                      ) : item.status === 'pending' ? (
                        <span className="text-slate-400">Свободно</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td> : null}
                    {visibleColumns.includes('created') ? <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(item.created_at)}</td> : null}
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {item.status === 'deleted' ? (
                          <button
                            type="button"
                            onClick={() => void handleRestore(item)}
                            disabled={restoreBusyId === item.id}
                            className="text-xs font-bold text-green-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {restoreBusyId === item.id ? 'Восстановление...' : 'Восстановить'}
                          </button>
                        ) : null}
                        {item.status === 'pending' && !item.reviewed_by_id ? (
                          <button
                            type="button"
                            onClick={() => void handleTake(item)}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            Взять
                          </button>
                        ) : null}
                        {item.status === 'pending' && item.reviewed_by_id === currentUser?.id ? (
                          <Link to="/my-work?tab=users" className="text-xs font-bold text-indigo-600 hover:underline">
                            Моя работа
                          </Link>
                        ) : null}
                        <Link
                          to={profileTarget(item.id)}
                          className="text-xs font-medium text-slate-500 transition-colors hover:text-indigo-600"
                        >
                          Профиль
                        </Link>
                        {item.status !== 'deleted' ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="cursor-pointer text-xs font-medium text-slate-400 transition-colors hover:text-red-600"
                          >
                            Удалить
                          </button>
                        ) : null}
                      </div>
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
            pageSize={USERS_PAGE_SIZE}
          />
          </>
        ) : (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-500">Пользователи по текущим фильтрам не найдены.</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить пользователя?"
        message={
          deleteTarget ? (
            <>
              Аккаунт <strong>{deleteTarget.first_name} {deleteTarget.last_name}</strong> будет перенесён в статус «Удалён». Его можно будет восстановить из списка пользователей.
            </>
          ) : null
        }
        confirmLabel="Удалить"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!deleteBusy) setDeleteTarget(null) }}
      />
    </div>
  )
}
