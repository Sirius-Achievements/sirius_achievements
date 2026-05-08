import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { documentsApi } from '@/api/documents'
import { moderationApi } from '@/api/moderation'
import { myWorkApi, type MyWorkResponse } from '@/api/myWork'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader'
import { DocumentPreviewImage } from '@/components/ui/DocumentPreviewImage'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useToast } from '@/hooks/useToast'
import type { Achievement } from '@/types/achievement'
import { AchievementCategory, AchievementLevel, AchievementResult } from '@/types/enums'
import type { User } from '@/types/user'
import { isImageFile, isPdfFile, openDocumentPreview } from '@/utils/documentPreview'
import { formatDateTime } from '@/utils/formatDate'
import { getErrorMessage } from '@/utils/http'
import { roleLabel } from '@/utils/labels'
import { buildMediaUrl } from '@/utils/media'
import { getTotalPages, paginateItems } from '@/utils/pagination'

type WorkTab = 'users' | 'achievements'
type DecisionStatus = 'revision' | 'rejected'
const MY_WORK_PAGE_SIZE = 10

const successActionClass =
  'inline-flex items-center justify-center rounded-md bg-green-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-green-700'

const dangerActionClass =
  'inline-flex items-center justify-center rounded-md border border-red-100 bg-red-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-700 shadow-sm transition-colors hover:bg-red-100'

const neutralActionClass =
  'inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-sm transition-colors hover:bg-slate-100'

function normalizeTab(value: string | null): WorkTab {
  return value === 'achievements' ? 'achievements' : 'users'
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function matchesUser(user: User, query: string) {
  const search = normalizeSearch(query)
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

function matchesAchievement(item: Achievement, query: string) {
  const search = normalizeSearch(query)
  if (!search) {
    return true
  }

  return [
    item.title,
    item.description ?? '',
    item.category ?? '',
    item.level ?? '',
    item.user?.first_name ?? '',
    item.user?.last_name ?? '',
    item.user?.email ?? '',
    item.user ? `${item.user.first_name} ${item.user.last_name}` : '',
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .includes(search)
}

export function MyWorkPage() {
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<MyWorkResponse | null>(null)
  const [query, setQuery] = useState('')
  const [userSortBy, setUserSortBy] = useState('newest')
  const [achievementSortBy, setAchievementSortBy] = useState('oldest')
  const [achievementCategory, setAchievementCategory] = useState('')
  const [achievementLevel, setAchievementLevel] = useState('')
  const [achievementResult, setAchievementResult] = useState('')
  const [page, setPage] = useState(1)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decisionTarget, setDecisionTarget] = useState<Achievement | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false)
  const [editTarget, setEditTarget] = useState<Achievement | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editLevel, setEditLevel] = useState('')
  const [editResult, setEditResult] = useState('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)

  const tab = normalizeTab(searchParams.get('tab'))
  const users = data?.users ?? []
  const achievements = data?.achievements ?? []

  useEffect(() => {
    setQuery('')
    setSuggestions([])
    setPage(1)
  }, [tab])

  const load = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await myWorkApi.get()
      setData(response.data)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить список задач в работе.'))
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
      if (tab === 'users') {
        setSuggestions(
          users
            .filter((user) => matchesUser(user, trimmed))
            .slice(0, 5)
            .map((user) => ({
              value: user.email,
              text: `${user.first_name} ${user.last_name} (${user.email})`,
            })),
        )
        return
      }

      setSuggestions(
        achievements
          .filter((item) => matchesAchievement(item, trimmed))
          .slice(0, 5)
          .map((item) => ({
            value: item.title,
            text: item.title,
          })),
      )
    }, 150)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [achievements, query, tab, users])

  const filteredUsers = useMemo(() => {
    const nextUsers = users.filter((user) => matchesUser(user, query))

    nextUsers.sort((left, right) => {
      if (userSortBy === 'oldest') {
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      }

      if (userSortBy === 'first_name_asc') {
        return `${left.first_name} ${left.last_name}`.localeCompare(`${right.first_name} ${right.last_name}`, 'ru')
      }

      if (userSortBy === 'first_name_desc') {
        return `${right.first_name} ${right.last_name}`.localeCompare(`${left.first_name} ${left.last_name}`, 'ru')
      }

      if (userSortBy === 'last_name_asc') {
        return `${left.last_name} ${left.first_name}`.localeCompare(`${right.last_name} ${right.first_name}`, 'ru')
      }

      if (userSortBy === 'last_name_desc') {
        return `${right.last_name} ${right.first_name}`.localeCompare(`${left.last_name} ${left.first_name}`, 'ru')
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })

    return nextUsers
  }, [query, userSortBy, users])

  const filteredAchievements = useMemo(() => {
    const nextAchievements = achievements.filter(
      (item) =>
        matchesAchievement(item, query) &&
        (!achievementCategory || item.category === achievementCategory) &&
        (!achievementLevel || item.level === achievementLevel) &&
        (!achievementResult || item.result === achievementResult),
    )

    nextAchievements.sort((left, right) => {
      if (achievementSortBy === 'newest') {
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      }

      if (achievementSortBy === 'title') {
        return left.title.localeCompare(right.title, 'ru')
      }

      if (achievementSortBy === 'points_desc') {
        return Number(right.projected_points ?? 0) - Number(left.projected_points ?? 0)
      }

      return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    })

    return nextAchievements
  }, [achievementCategory, achievementLevel, achievementResult, achievementSortBy, achievements, query])

  const usersTotalPages = useMemo(
    () => getTotalPages(filteredUsers.length, MY_WORK_PAGE_SIZE),
    [filteredUsers.length],
  )
  const achievementsTotalPages = useMemo(
    () => getTotalPages(filteredAchievements.length, MY_WORK_PAGE_SIZE),
    [filteredAchievements.length],
  )
  const paginatedUsers = useMemo(
    () => paginateItems(filteredUsers, page, MY_WORK_PAGE_SIZE),
    [filteredUsers, page],
  )
  const paginatedAchievements = useMemo(
    () => paginateItems(filteredAchievements, page, MY_WORK_PAGE_SIZE),
    [filteredAchievements, page],
  )
  const currentTotalPages = tab === 'users' ? usersTotalPages : achievementsTotalPages

  useEffect(() => {
    setPage(1)
  }, [achievementCategory, achievementLevel, achievementResult, achievementSortBy, query, tab, userSortBy])

  useEffect(() => {
    if (page > currentTotalPages) {
      setPage(currentTotalPages)
    }
  }, [currentTotalPages, page])

  const closeDecisionModal = () => {
    setDecisionTarget(null)
    setDecisionReason('')
    setIsSubmittingDecision(false)
  }

  const openEditModal = (item: Achievement) => {
    setEditTarget(item)
    setEditTitle(item.title)
    setEditDescription(item.description ?? '')
    setEditCategory(item.category ?? '')
    setEditLevel(item.level ?? '')
    setEditResult(item.result ?? AchievementResult.PARTICIPANT)
    setIsSubmittingEdit(false)
  }

  const closeEditModal = () => {
    setEditTarget(null)
    setEditTitle('')
    setEditDescription('')
    setEditCategory('')
    setEditLevel('')
    setEditResult(AchievementResult.PARTICIPANT)
    setIsSubmittingEdit(false)
  }

  const handleApproveUser = async (user: User) => {
    try {
      await moderationApi.approveUser(user.id)
      pushToast({
        title: 'Пользователь одобрен',
        message: `${user.first_name} ${user.last_name}`,
        tone: 'success',
      })
      await load()
    } catch (approveError) {
      setError(getErrorMessage(approveError, 'Не удалось одобрить пользователя.'))
    }
  }

  const handleRejectUser = async (user: User) => {
    const confirmed = window.confirm(
      `Отклонить пользователя ${user.first_name} ${user.last_name}? Это действие необратимо.`,
    )

    if (!confirmed) {
      return
    }

    try {
      await moderationApi.rejectUser(user.id)
      pushToast({
        title: 'Пользователь отклонён',
        message: `${user.first_name} ${user.last_name}`,
        tone: 'success',
      })
      await load()
    } catch (rejectError) {
      setError(getErrorMessage(rejectError, 'Не удалось отклонить пользователя.'))
    }
  }

  const handleReleaseUser = async (user: User) => {
    try {
      await moderationApi.releaseUser(user.id)
      pushToast({
        title: 'Пользователь снят с вас',
        message: `${user.first_name} ${user.last_name}`,
        tone: 'success',
      })
      await load()
    } catch (releaseError) {
      setError(getErrorMessage(releaseError, 'Не удалось освободить пользователя.'))
    }
  }

  const handleApproveAchievement = async (item: Achievement) => {
    try {
      await moderationApi.updateAchievement(item.id, 'approved')
      pushToast({
        title: 'Документ одобрен',
        message: item.title,
        tone: 'success',
      })
      await load()
    } catch (approveError) {
      setError(getErrorMessage(approveError, 'Не удалось одобрить документ.'))
    }
  }

  const handleSaveAchievementMetadata = async () => {
    if (!editTarget) {
      return
    }

    const normalizedTitle = editTitle.trim()
    const normalizedDescription = editDescription.trim()

    if (!normalizedTitle) {
      setError('Укажите название документа.')
      return
    }

    setIsSubmittingEdit(true)
    setError(null)

    try {
      await moderationApi.updateAchievementMetadata(editTarget.id, {
        title: normalizedTitle,
        description: normalizedDescription || undefined,
        category: editCategory || undefined,
        level: editLevel || undefined,
        result: editResult || AchievementResult.PARTICIPANT,
      })
      pushToast({
        title: 'Данные документа обновлены',
        message: normalizedTitle,
        tone: 'success',
      })
      closeEditModal()
      await load()
    } catch (editError) {
      setError(getErrorMessage(editError, 'Не удалось обновить название или описание документа.'))
      setIsSubmittingEdit(false)
    }
  }

  const handleAchievementDecision = async (status: DecisionStatus) => {
    if (!decisionTarget) {
      return
    }

    if (!decisionReason.trim()) {
      setError('Укажите причину или комментарий для студента.')
      return
    }

    setIsSubmittingDecision(true)
    setError(null)

    try {
      await moderationApi.updateAchievement(decisionTarget.id, status, decisionReason.trim())
      pushToast({
        title: status === 'revision' ? 'Документ отправлен на доработку' : 'Документ отклонён',
        message: decisionTarget.title,
        tone: 'success',
      })
      closeDecisionModal()
      await load()
    } catch (decisionError) {
      setError(getErrorMessage(decisionError, 'Не удалось обновить статус документа.'))
      setIsSubmittingDecision(false)
    }
  }

  const handleReleaseAchievement = async (item: Achievement) => {
    try {
      await moderationApi.releaseAchievement(item.id)
      pushToast({
        title: 'Документ снят с вас',
        message: item.title,
        tone: 'success',
      })
      await load()
    } catch (releaseError) {
      setError(getErrorMessage(releaseError, 'Не удалось освободить документ.'))
    }
  }

  const handleDownloadAchievement = async (item: Achievement) => {
    if (!item.file_path && item.external_url) {
      window.open(item.external_url, '_blank', 'noopener')
      return
    }
    if (!item.file_path) {
      setError('У этого документа нет прикреплённого файла.')
      return
    }

    try {
      const response = await documentsApi.download(item.id)
      const contentTypeHeader = response.headers['content-type']
      const contentType =
        typeof contentTypeHeader === 'string' ? contentTypeHeader : 'application/octet-stream'
      const blob =
        response.data instanceof Blob
          ? response.data
          : new Blob([response.data], {
              type: contentType,
            })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = item.file_path?.split('/').pop() || `${item.title}.bin`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, 'Не удалось скачать документ.'))
    }
  }

  const currentTitle = tab === 'users' ? 'Мои пользователи' : 'Мои документы'
  const currentDescription =
    tab === 'users'
      ? `Закреплённые за вами заявки: ${data?.total_users ?? 0}.`
      : `Документы, которые сейчас находятся у вас в работе: ${data?.total_achievements ?? 0}.`

  const resetFilters = () => {
    setQuery('')
    setSuggestions([])
    setPage(1)
    if (tab === 'users') {
      setUserSortBy('newest')
      return
    }

    setAchievementSortBy('oldest')
    setAchievementCategory('')
    setAchievementLevel('')
    setAchievementResult('')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <StaffSectionHeader
        kind={tab === 'users' ? 'users' : 'documents'}
        currentView="my"
        title={currentTitle}
        description={currentDescription}
      />

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-3">
          <SearchAutocompleteInput
            label="Поиск"
            value={query}
            placeholder={tab === 'users' ? 'Имя, email или поток...' : 'Название, описание или студент...'}
            suggestions={suggestions}
            onChange={setQuery}
            onSelectSuggestion={(item) => {
              setQuery(item.value || item.text)
              setSuggestions([])
            }}
            className="min-w-[240px] flex-1"
          />

          <div className="w-full sm:w-[180px]">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Сортировка
            </label>
            {tab === 'users' ? (
              <select
                value={userSortBy}
                onChange={(event) => setUserSortBy(event.target.value)}
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
              >
                <option value="newest">Новые</option>
                <option value="oldest">Старые</option>
                <option value="first_name_asc">Имя: А-Я</option>
                <option value="first_name_desc">Имя: Я-А</option>
                <option value="last_name_asc">Фамилия: А-Я</option>
                <option value="last_name_desc">Фамилия: Я-А</option>
              </select>
            ) : (
              <select
                value={achievementSortBy}
                onChange={(event) => setAchievementSortBy(event.target.value)}
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
              >
                <option value="oldest">Сначала старые</option>
                <option value="newest">Сначала новые</option>
                <option value="title">По названию</option>
                <option value="points_desc">По баллам</option>
              </select>
            )}
          </div>

          {tab === 'achievements' ? (
            <>
              <div className="w-full sm:w-[140px]">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Категория
                </label>
                <select
                  value={achievementCategory}
                  onChange={(event) => setAchievementCategory(event.target.value)}
                  className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
                >
                  <option value="">Все</option>
                  {Object.values(AchievementCategory).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div className="w-full sm:w-[140px]">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Уровень
                </label>
                <select
                  value={achievementLevel}
                  onChange={(event) => setAchievementLevel(event.target.value)}
                  className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
                >
                  <option value="">Все</option>
                  {Object.values(AchievementLevel).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div className="w-full sm:w-[140px]">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Результат
                </label>
                <select
                  value={achievementResult}
                  onChange={(event) => setAchievementResult(event.target.value)}
                  className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
                >
                  <option value="">Все</option>
                  {Object.values(AchievementResult).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

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
        <div className="rounded-xl border border-slate-200 bg-surface py-16">
          <LoadingSpinner />
        </div>
      ) : tab === 'users' ? (
        filteredUsers.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Пользователи в работе</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Всего: {filteredUsers.length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-bold">ID</th>
                    <th className="px-5 py-3 font-bold">Пользователь</th>
                    <th className="px-5 py-3 font-bold">Роль / обучение</th>
                    <th className="px-5 py-3 font-bold">Регистрация</th>
                    <th className="px-5 py-3 text-right font-bold">Действия</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {paginatedUsers.map((user) => (
                    <tr key={user.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-3 text-xs text-slate-400">{user.id}</td>
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
                              to={`/users/${user.id}?from=my-work`}
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
                            {user.education_level} {user.course ? `${user.course} курс` : ''}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Link
                            to={`/users/${user.id}?from=my-work`}
                            className="mr-1 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-800"
                          >
                            Профиль
                          </Link>
                          <button type="button" onClick={() => void handleApproveUser(user)} className={successActionClass}>
                            Принять
                          </button>
                          <button type="button" onClick={() => void handleRejectUser(user)} className={dangerActionClass}>
                            Отклонить
                          </button>
                          <button type="button" onClick={() => void handleReleaseUser(user)} className={neutralActionClass}>
                            Снять
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationFooter
              currentPage={page}
              totalPages={usersTotalPages}
              onPageChange={setPage}
              pageSize={MY_WORK_PAGE_SIZE}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            </div>
            <p className="text-sm text-slate-500">
              {query ? 'По текущему поиску закреплённые пользователи не найдены.' : 'У вас пока нет закреплённых пользователей.'}
            </p>
            <Link
              to="/moderation/users"
              className="mt-3 inline-block text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-800"
            >
              Перейти к новым пользователям
            </Link>
          </div>
        )
      ) : filteredAchievements.length ? (
        <div className="space-y-3">
          {paginatedAchievements.map((item) => (
            <div
              key={item.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-surface p-4 transition-colors hover:border-slate-300"
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex flex-1 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (item.file_path) {
                        openDocumentPreview(item.id, item.file_path)
                      } else if (item.external_url) {
                        window.open(item.external_url, '_blank', 'noopener')
                      }
                    }}
                    className="relative flex h-24 w-20 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-slate-50 sm:h-28 sm:w-28"
                    title={item.file_path ? 'Открыть превью' : item.external_url || ''}
                  >
                    {item.file_path && isImageFile(item.file_path) ? (
                      <DocumentPreviewImage documentId={item.id} alt={item.title} className="h-full w-full object-cover" />
                    ) : item.file_path && isPdfFile(item.file_path) ? (
                      <>
                        <svg className="mb-1 h-6 w-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                          />
                        </svg>
                        <span className="text-[9px] font-bold uppercase text-slate-500">PDF</span>
                      </>
                    ) : item.external_url ? (
                      <>
                        <svg className="mb-1 h-6 w-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 015.656 5.656l-3 3a4 4 0 01-5.656-5.656M10.172 13.828a4 4 0 01-5.656-5.656l3-3a4 4 0 015.656 5.656" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase text-indigo-500">Ссылка</span>
                      </>
                    ) : (
                      <span className="px-1 text-center text-[9px] font-bold uppercase text-slate-400">Без вложения</span>
                    )}
                  </button>

                  <div className="flex min-w-0 flex-1 flex-col py-0.5">
                    <h3 className="mb-1.5 line-clamp-2 text-sm font-bold leading-tight text-slate-800" title={item.title}>
                      {item.title}
                    </h3>

                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span className="rounded border border-indigo-100/50 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-700">
                        {item.category || 'Без категории'}
                      </span>
                      <span className="rounded border border-slate-200/50 bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                        {item.level || 'Без уровня'}
                      </span>
                      {item.result ? (
                        <span className="rounded border border-amber-200/70 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                          {item.result}
                        </span>
                      ) : null}
                    </div>

                    {item.description ? (
                      <details className="mb-2 text-xs text-slate-600">
                        <summary className="cursor-pointer text-indigo-600 hover:underline">Описание</summary>
                        <p className="mt-1 leading-relaxed">{item.description}</p>
                      </details>
                    ) : null}

                    {item.external_url ? (
                      <a
                        href={item.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-1.5 truncate text-[11px] text-indigo-600 hover:underline"
                        title={item.external_url}
                      >
                        {item.external_url}
                      </a>
                    ) : null}

                    <div className="mb-1.5 flex items-center gap-1.5">
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[8px] font-bold text-slate-600">
                        {item.user?.first_name?.slice(0, 1) || '?'}
                      </div>
                      <span className="truncate text-xs font-medium text-slate-700">
                        {item.user ? `${item.user.first_name} ${item.user.last_name}` : 'Без автора'}
                      </span>
                    </div>

                    <div className="mt-auto flex items-end justify-between gap-3">
                      <span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">
                        {formatDateTime(item.created_at)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 border-t border-slate-100 pt-3 sm:w-36 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                  <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0">
                  <button
                    type="button"
                    onClick={() => void handleApproveAchievement(item)}
                    className="flex min-w-[136px] flex-none flex-col items-center justify-center rounded-lg bg-green-600 px-2 py-2 text-xs font-medium leading-tight text-white shadow-sm transition-colors hover:bg-green-700 sm:min-w-0 sm:w-full sm:py-2.5"
                  >
                    <span>Одобрить</span>
                    {typeof item.projected_points === 'number' ? (
                      <span className="mt-0.5 text-[9px] font-normal opacity-90">+{item.projected_points} баллов</span>
                    ) : null}
                  </button>

                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    className="flex min-w-[136px] flex-none items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-surface px-2 py-2 text-xs font-medium text-indigo-600 shadow-sm transition-colors hover:bg-indigo-50 sm:min-w-0 sm:w-full sm:py-2.5"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L12 15l-4 1 1-4 9.586-9.586z"
                      />
                    </svg>
                    <span>Редактировать</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDecisionTarget(item)
                      setDecisionReason(item.rejection_reason ?? '')
                    }}
                    className="flex min-w-[136px] flex-none flex-col items-center justify-center rounded-lg border border-slate-200 bg-surface px-2 py-2 text-xs font-medium leading-tight text-slate-600 shadow-sm transition-colors hover:bg-slate-50 sm:min-w-0 sm:w-full sm:py-2.5"
                  >
                    <span>Отклонить /</span>
                    <span>Вернуть</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleReleaseAchievement(item)}
                    className="flex min-w-[136px] flex-none items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:bg-slate-100 sm:min-w-0 sm:w-full"
                  >
                    Снять
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDownloadAchievement(item)}
                    className="flex min-w-[136px] flex-none items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-100 sm:min-w-0 sm:w-full"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    <span>{item.file_path ? 'Скачать' : item.external_url ? 'Открыть ссылку' : 'Нет вложения'}</span>
                  </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <PaginationFooter
            currentPage={page}
            totalPages={achievementsTotalPages}
            onPageChange={setPage}
            pageSize={MY_WORK_PAGE_SIZE}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <p className="text-sm text-slate-500">
            {query ? 'По текущему поиску закреплённые документы не найдены.' : 'У вас пока нет закреплённых документов.'}
          </p>
          <Link
            to="/moderation/achievements"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-800"
          >
            Перейти к новым документам
          </Link>
        </div>
      )}

      {editTarget ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
          onClick={closeEditModal}
        >
          <div
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Редактирование документа</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Исправьте название, описание, категорию, уровень или результат перед одобрением.
                </p>
              </div>
              <button type="button" onClick={closeEditModal} className="text-slate-400 hover:text-slate-600">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 bg-slate-50 p-4">
              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Название <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  disabled={isSubmittingEdit}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:bg-surface focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Название документа"
                />
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Описание
                </label>
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={4}
                  disabled={isSubmittingEdit}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:bg-surface focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Короткое описание документа"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Категория
                  </label>
                  <select
                    value={editCategory}
                    onChange={(event) => setEditCategory(event.target.value)}
                    disabled={isSubmittingEdit}
                    className="h-[38px] w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {Object.values(AchievementCategory).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Уровень
                  </label>
                  <select
                    value={editLevel}
                    onChange={(event) => setEditLevel(event.target.value)}
                    disabled={isSubmittingEdit}
                    className="h-[38px] w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {Object.values(AchievementLevel).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Результат
                </label>
                <select
                  value={editResult}
                  onChange={(event) => setEditResult(event.target.value)}
                  disabled={isSubmittingEdit}
                  className="h-[38px] w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                >
                  {Object.values(AchievementResult).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 bg-surface p-4 sm:flex-row">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={isSubmittingEdit}
                className="w-full rounded-lg border border-slate-200 bg-surface px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Отмена
              </button>

              <button
                type="button"
                onClick={() => void handleSaveAchievementMetadata()}
                disabled={isSubmittingEdit}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmittingEdit ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {decisionTarget ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
          onClick={closeDecisionModal}
        >
          <div
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Решение по документу</h3>
                <p className="mt-1 text-xs text-slate-400">{decisionTarget.title}</p>
              </div>
              <button type="button" onClick={closeDecisionModal} className="text-slate-400 hover:text-slate-600">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-slate-50 p-4">
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Причина или комментарий для студента <span className="text-red-500">*</span>
              </label>
              <textarea
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                rows={4}
                disabled={isSubmittingDecision}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:bg-surface focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Например: размытое фото, загрузите документ заново."
              />
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-surface p-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleAchievementDecision('revision')}
                disabled={isSubmittingDecision}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5 text-sm font-medium text-yellow-700 transition-colors hover:bg-yellow-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                На доработку
              </button>

              <button
                type="button"
                onClick={() => void handleAchievementDecision('rejected')}
                disabled={isSubmittingDecision}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                Полный отказ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
