import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { moderationApi } from '@/api/moderation'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { User } from '@/types/user'
import { getErrorMessage } from '@/utils/http'
import { courseLabel, roleLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'
import { getTotalPages, paginateItems } from '@/utils/pagination'

const MODERATION_USERS_PAGE_SIZE = 20

function normalize(text: string) {
  return text.trim().toLocaleLowerCase('ru-RU')
}

function matchesUser(user: User, query: string) {
  const search = normalize(query)
  if (!search) {
    return true
  }

  return [
    user.first_name,
    user.last_name,
    user.email,
    user.education_level ?? '',
    user.course ? String(user.course) : '',
    `${user.first_name} ${user.last_name}`,
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .includes(search)
}

function assignmentRank(user: User, currentUserId?: number) {
  if (!user.reviewed_by_id) return 0
  if (user.reviewed_by_id === currentUserId) return 1
  return 2
}

export function ModerationUsersPage() {
  const { user: currentUser } = useAuth()
  const { pushToast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [query, setQuery] = useState('')
  const [assignmentSort, setAssignmentSort] = useState('free_first')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])

  const load = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data } = await moderationApi.getUsers()
      setUsers(data.users)
      setTotalCount(data.total_count)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить очередь пользователей.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(() => {
      const nextSuggestions = users
        .filter((user) => matchesUser(user, trimmed))
        .slice(0, 5)
        .map((user) => ({
          value: user.email,
          text: `${user.first_name} ${user.last_name} (${user.email})`,
        }))
      setSuggestions(nextSuggestions)
    }, 150)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query, users])

  const filteredUsers = useMemo(() => {
    const nextUsers = users.filter((user) => matchesUser(user, query))

    nextUsers.sort((left, right) => {
      if (assignmentSort === 'mine_first') {
        const mineRank = (user: User) => (user.reviewed_by_id === currentUser?.id ? 0 : user.reviewed_by_id ? 2 : 1)
        const assignmentDiff = mineRank(left) - mineRank(right)
        if (assignmentDiff !== 0) {
          return assignmentDiff
        }
      }

      if (assignmentSort === 'free_first') {
        const assignmentDiff = assignmentRank(left, currentUser?.id) - assignmentRank(right, currentUser?.id)
        if (assignmentDiff !== 0) {
          return assignmentDiff
        }
      }

      if (sortBy === 'oldest') {
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      }

      if (sortBy === 'first_name_asc') {
        return `${left.first_name} ${left.last_name}`.localeCompare(`${right.first_name} ${right.last_name}`, 'ru')
      }

      if (sortBy === 'first_name_desc') {
        return `${right.first_name} ${right.last_name}`.localeCompare(`${left.first_name} ${left.last_name}`, 'ru')
      }

      if (sortBy === 'last_name_asc') {
        return `${left.last_name} ${left.first_name}`.localeCompare(`${right.last_name} ${right.first_name}`, 'ru')
      }

      if (sortBy === 'last_name_desc') {
        return `${right.last_name} ${right.first_name}`.localeCompare(`${left.last_name} ${left.first_name}`, 'ru')
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })

    return nextUsers
  }, [assignmentSort, currentUser?.id, query, sortBy, users])

  const totalPages = useMemo(
    () => getTotalPages(filteredUsers.length, MODERATION_USERS_PAGE_SIZE),
    [filteredUsers.length],
  )

  const paginatedUsers = useMemo(
    () => paginateItems(filteredUsers, page, MODERATION_USERS_PAGE_SIZE),
    [filteredUsers, page],
  )

  useEffect(() => {
    setPage(1)
  }, [assignmentSort, query, sortBy])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const handleTake = async (user: User) => {
    try {
      await moderationApi.takeUser(user.id)
      pushToast({ title: 'Пользователь взят в работу', tone: 'success' })
      await load()
    } catch (takeError) {
      setError(getErrorMessage(takeError, 'Не удалось взять пользователя в работу.'))
    }
  }

  const resetFilters = () => {
    setQuery('')
    setAssignmentSort('free_first')
    setSortBy('newest')
    setSuggestions([])
    setPage(1)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StaffSectionHeader
        kind="users"
        currentView="incoming"
        title="Новые пользователи"
        description={`${totalCount} ожидают проверки`}
      />

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-3">
          <SearchAutocompleteInput
            label="Поиск"
            value={query}
            placeholder="Имя, email или поток..."
            suggestions={suggestions}
            onChange={setQuery}
            onSelectSuggestion={(item) => {
              setQuery(item.value || item.text)
              setSuggestions([])
            }}
            className="min-w-[240px] flex-1"
          />

          <div className="w-full sm:w-[150px]">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Занятость
            </label>
            <select
              value={assignmentSort}
              onChange={(event) => setAssignmentSort(event.target.value)}
              className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
            >
              <option value="free_first">Сначала свободные</option>
              <option value="mine_first">Сначала мои</option>
              <option value="none">Без приоритета</option>
            </select>
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Сортировка
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
            >
              <option value="newest">Новые</option>
              <option value="oldest">Старые</option>
              <option value="first_name_asc">Имя: А-Я</option>
              <option value="first_name_desc">Имя: Я-А</option>
              <option value="last_name_asc">Фамилия: А-Я</option>
              <option value="last_name_desc">Фамилия: Я-А</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="h-[38px] rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Обновить
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="h-[38px] rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Сбросить
            </button>
          </div>
        </form>
      </div>

      {isLoading ? (
        <div className="py-16">
          <LoadingSpinner />
        </div>
      ) : filteredUsers.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-bold">#</th>
                  <th className="px-5 py-3 font-bold">Пользователь</th>
                  <th className="px-5 py-3 font-bold">Роль / обучение</th>
                  <th className="px-5 py-3 font-bold">Регистрация</th>
                  <th className="px-5 py-3 font-bold">Статус</th>
                  <th className="px-5 py-3 font-bold">Модератор</th>
                  <th className="px-5 py-3 text-right font-bold">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginatedUsers.map((user, index) => (
                  <tr key={user.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3 text-xs text-slate-400">{(page - 1) * MODERATION_USERS_PAGE_SIZE + index + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {user.avatar_path ? (
                          <img
                            src={buildMediaUrl(user.avatar_path)}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-full object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 font-medium text-slate-600">
                            {user.first_name.slice(0, 1)}
                          </div>
                        )}
                        <div>
                          <Link
                            to={`/users/${user.id}?from=moderation`}
                            className="block font-medium leading-tight text-slate-800 transition-colors hover:text-indigo-600"
                          >
                            {user.first_name} {user.last_name}
                          </Link>
                          <div className="mt-0.5 text-[10px] text-slate-400">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="mb-1 inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {roleLabel(user.role)}
                      </span>
                      <br />
                      {user.education_level ? (
                        <span className="text-[10px] text-slate-500">
                          {user.education_level} {user.course ? courseLabel(user.course) : ''}
                          {user.study_group ? <><br />{user.study_group}</> : null}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {!user.reviewed_by_id ? (
                        <span className="inline-flex rounded border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-700">
                          Новый
                        </span>
                      ) : user.reviewed_by_id === currentUser?.id ? (
                        <span className="inline-flex rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                          В работе
                        </span>
                      ) : (
                        <span className="inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Занят
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {user.reviewed_by_id === currentUser?.id ? (
                        <div className="font-medium text-slate-700">Вы</div>
                      ) : user.reviewed_by_id ? (
                        <span className="text-slate-400">Другой модератор</span>
                      ) : (
                        <span className="text-slate-400">Ещё не взято</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!user.reviewed_by_id ? (
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            to={`/users/${user.id}?from=moderation`}
                            className="text-xs font-bold text-slate-500 hover:underline"
                          >
                            Профиль
                          </Link>
                          <button
                            type="button"
                            onClick={() => void handleTake(user)}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            Взять в работу
                          </button>
                        </div>
                      ) : user.reviewed_by_id === currentUser?.id ? (
                        <Link to="/my-work?tab=users" className="text-xs font-bold text-indigo-600 hover:underline">
                          Моя работа
                        </Link>
                      ) : (
                        <Link
                          to={`/users/${user.id}?from=moderation`}
                          className="text-xs font-bold text-slate-500 hover:underline"
                        >
                          Просмотр
                        </Link>
                      )}
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
            pageSize={MODERATION_USERS_PAGE_SIZE}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
            <svg className="h-8 w-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-slate-500">
            {query ? 'Поиск не дал результатов в очереди пользователей.' : 'Нет новых заявок на регистрацию.'}
          </p>
        </div>
      )}
    </div>
  )
}
