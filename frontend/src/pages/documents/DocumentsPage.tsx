import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { documentsApi } from '@/api/documents'
import { moderationApi } from '@/api/moderation'
import { ChipMultiSelect } from '@/components/staff/ChipMultiSelect'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Pagination } from '@/components/ui/Pagination'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { Achievement } from '@/types/achievement'
import { AchievementResult } from '@/types/enums'
import { openDocumentPreview } from '@/utils/documentPreview'
import { getErrorMessage } from '@/utils/http'
import { achievementStatusLabel } from '@/utils/labels'

const DOCUMENTS_PAGE_SIZE = 20

function statusLabel(status: string, moderatorId?: number, currentUserId?: number) {
  if (status === 'approved') return 'Одобрено'
  if (status === 'rejected') return 'Отклонено'
  if (status === 'revision') return 'Доработка'
  if (status === 'pending' && !moderatorId) return 'Новый'
  if (status === 'pending' && moderatorId === currentUserId) return 'В работе'
  if (status === 'pending') return 'Принято'
  return status
}

function statusClass(status: string, moderatorId?: number, currentUserId?: number) {
  if (status === 'approved') return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  if (status === 'rejected') return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  if (status === 'revision') return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  if (status === 'pending' && !moderatorId) return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  if (status === 'pending' && moderatorId === currentUserId) return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-slate-100 text-slate-500 border-slate-200'
}

export function DocumentsPage() {
  const { user: currentUser } = useAuth()
  const { pushToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<Achievement[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [levels, setLevels] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [statusSel, setStatusSel] = useState<string[]>(() => searchParams.get('status') ? [searchParams.get('status')!] : [])
  const [categorySel, setCategorySel] = useState<string[]>(() => searchParams.get('category') ? [searchParams.get('category')!] : [])
  const [levelSel, setLevelSel] = useState<string[]>([])
  const [resultSel, setResultSel] = useState<string[]>([])
  const [categoryLogic, setCategoryLogic] = useState<'or' | 'and'>('or')
  const [levelLogic, setLevelLogic] = useState<'or' | 'and'>('or')
  const [resultLogic, setResultLogic] = useState<'or' | 'and'>('or')
  const [sortBy, setSortBy] = useState('newest')
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('date_from') ?? '')
  const [dateTo, setDateTo] = useState(() => searchParams.get('date_to') ?? '')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Achievement | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const filters = useMemo(
    () => ({
      page,
      query: query || undefined,
      statuses: statusSel.length ? statusSel : undefined,
      categories: categorySel.length ? categorySel : undefined,
      levels: levelSel.length ? levelSel : undefined,
      results: resultSel.length ? resultSel : undefined,
      category_logic: categorySel.length > 1 && categoryLogic === 'and' ? 'and' : undefined,
      level_logic: levelSel.length > 1 && levelLogic === 'and' ? 'and' : undefined,
      result_logic: resultSel.length > 1 && resultLogic === 'and' ? 'and' : undefined,
      sort_by: sortBy,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [categorySel, categoryLogic, dateFrom, dateTo, levelSel, levelLogic, page, query, resultSel, resultLogic, sortBy, statusSel],
  )

  const toggleIn = (setter: Dispatch<SetStateAction<string[]>>) => (value: string) =>
    setter((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]))

  const loadDocuments = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data } = await documentsApi.list(filters)
      setItems(data.achievements)
      setTotalPages(data.total_pages ?? 1)
      setStatuses(data.statuses)
      setCategories(data.categories)
      setLevels(data.levels)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить список документов.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadDocuments()
  }, [filters])

  useEffect(() => {
    setPage(1)
  }, [query, statusSel, categorySel, levelSel, resultSel, sortBy, dateFrom, dateTo])

  useEffect(() => {
    const next = new URLSearchParams()
    if (query) next.set('query', query)
    if (statusSel.length === 1) next.set('status', statusSel[0])
    if (categorySel.length === 1) next.set('category', categorySel[0])
    if (dateFrom) next.set('date_from', dateFrom)
    if (dateTo) next.set('date_to', dateTo)
    setSearchParams(next, { replace: true })
  }, [categorySel, dateFrom, dateTo, query, setSearchParams, statusSel])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const { data } = await documentsApi.search(trimmed)
        setSuggestions(data)
      } catch {
        setSuggestions([])
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const resetFilters = () => {
    setQuery('')
    setStatusSel([])
    setCategorySel([])
    setLevelSel([])
    setResultSel([])
    setSortBy('newest')
    setDateFrom('')
    setDateTo('')
    setSuggestions([])
    setPage(1)
  }

  const handleDownload = async (item: Achievement) => {
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
      link.download = (item.file_path ?? '').split('/').pop() || `${item.title}.bin`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, 'Не удалось скачать документ.'))
    }
  }

  const handleOpenDocument = (item: Achievement) => {
    if (item.file_path) {
      openDocumentPreview(item.id, item.file_path)
      return
    }
    if (item.external_url) {
      window.open(item.external_url, '_blank', 'noopener')
    }
  }

  const handleTake = async (item: Achievement) => {
    try {
      await moderationApi.takeAchievement(item.id)
      pushToast({ title: 'Документ взят в работу', tone: 'success' })
      await loadDocuments()
    } catch (takeError) {
      setError(getErrorMessage(takeError, 'Не удалось взять документ в работу.'))
    }
  }

  const handleDelete = (item: Achievement) => setDeleteTarget(item)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await documentsApi.delete(deleteTarget.id)
      pushToast({ title: 'Документ удалён', tone: 'success' })
      setDeleteTarget(null)
      await loadDocuments()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Не удалось удалить документ.'))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StaffSectionHeader
        kind="documents"
        currentView="all"
        title="Все документы"
        description="Единый поиск по базе достижений."
      />

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-3">
          <SearchAutocompleteInput
            label="Поиск"
            value={query}
            placeholder="Название или описание документа..."
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
              Сортировка
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
            >
              <option value="newest">Новые</option>
              <option value="oldest">Старые</option>
              <option value="title">По названию</option>
            </select>
          </div>

          <label className="w-full sm:w-[160px]">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Дата с</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-600" />
          </label>
          <label className="w-full sm:w-[160px]">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Дата по</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-600" />
          </label>

          <div className="w-full sm:basis-full">
            <ChipMultiSelect
              label="Статус"
              options={statuses}
              selected={statusSel}
              onToggle={toggleIn(setStatusSel)}
              labelFor={achievementStatusLabel}
              onReset={() => setStatusSel([])}
            />
          </div>

          <div className="w-full sm:basis-full">
            <ChipMultiSelect
              label="Категория"
              options={categories}
              selected={categorySel}
              onToggle={toggleIn(setCategorySel)}
              onReset={() => setCategorySel([])}
              logic={categoryLogic}
              onLogicChange={setCategoryLogic}
              andHint="показывать документы студентов, у кого есть все выбранные направления"
            />
          </div>

          <div className="w-full sm:basis-full">
            <ChipMultiSelect
              label="Уровень"
              options={levels}
              selected={levelSel}
              onToggle={toggleIn(setLevelSel)}
              onReset={() => setLevelSel([])}
              logic={levelLogic}
              onLogicChange={setLevelLogic}
              andHint="у студента есть документы всех выбранных уровней"
            />
          </div>

          <div className="w-full sm:basis-full">
            <ChipMultiSelect
              label="Результат"
              options={Object.values(AchievementResult)}
              selected={resultSel}
              onToggle={toggleIn(setResultSel)}
              onReset={() => setResultSel([])}
              logic={resultLogic}
              onLogicChange={setResultLogic}
              andHint="у студента есть документы всех выбранных результатов"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadDocuments()}
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
                    <th className="px-5 py-3 font-bold">Файл</th>
                    <th className="px-5 py-3 font-bold">Название</th>
                    <th className="px-5 py-3 font-bold">Студент</th>
                    <th className="px-5 py-3 font-bold">Категория</th>
                    <th className="px-5 py-3 font-bold">Статус</th>
                    <th className="px-5 py-3 font-bold">Создано</th>
                    <th className="px-5 py-3 text-right font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => handleOpenDocument(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded bg-indigo-50 text-indigo-600 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                          title={item.file_path ? 'Открыть файл' : item.external_url ? 'Открыть ссылку' : 'Нет вложения'}
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                          </svg>
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800">{item.title}</div>
                        {item.description ? (
                          <details className="mt-0.5 max-w-[280px] whitespace-normal text-[11px] text-slate-500">
                            <summary className="cursor-pointer text-indigo-600 hover:underline">Описание</summary>
                            <p className="mt-1 leading-relaxed">{item.description}</p>
                          </details>
                        ) : null}
                        {item.external_url ? (
                          <a
                            href={item.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 block max-w-[280px] truncate text-[11px] text-indigo-600 hover:underline"
                            title={item.external_url}
                          >
                            Ссылка на подтверждение
                          </a>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {item.user ? (
                          <>
                            <Link
                              to={`/users/${item.user.id}?from=documents`}
                              className="transition-colors hover:text-indigo-600"
                            >
                              {item.user.first_name} {item.user.last_name}
                            </Link>
                            <div className="text-[10px] text-slate-400">{item.user.email}</div>
                            <div className="hidden">
                              ID: {item.user.id} • {item.user.email}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        <span className="block">{item.category}</span>
                        <span className="text-slate-400">{item.level}</span>
                        {item.result ? <span className="block text-slate-400">{item.result}</span> : null}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusClass(item.status, item.moderator_id, currentUser?.id)}`}
                        >
                          {statusLabel(item.status, item.moderator_id, currentUser?.id)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => void handleDownload(item)}
                            className="text-slate-400 transition-colors hover:text-indigo-600"
                            title={item.file_path ? 'Скачать' : item.external_url ? 'Открыть ссылку' : 'Нет вложения'}
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              />
                            </svg>
                          </button>
                          {item.status === 'pending' && !item.moderator_id ? (
                            <button
                              type="button"
                              onClick={() => void handleTake(item)}
                              className="text-xs font-bold text-indigo-600 hover:underline"
                            >
                              Взять
                            </button>
                          ) : null}
                          {item.status === 'pending' && item.moderator_id === currentUser?.id ? (
                            <Link
                              to="/my-work?tab=achievements"
                              className="text-xs font-bold text-indigo-600 hover:underline"
                            >
                              Моя работа
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleDelete(item)}
                            className="text-xs font-medium text-slate-400 transition-colors hover:text-red-600"
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination-footer">
              <p className="pagination-summary">
                Страница {page} из {totalPages} · По {DOCUMENTS_PAGE_SIZE} на страницу.
              </p>
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </>
        ) : (
          <div className="py-12 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <p className="text-sm text-slate-500">Документы по текущим фильтрам не найдены.</p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить документ?"
        message={deleteTarget ? <>Документ <strong>«{deleteTarget.title}»</strong> будет удалён. Если он уже участвовал в рейтинге, сервер перенесёт его в архив.</> : null}
        confirmLabel="Удалить"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!deleteBusy) setDeleteTarget(null) }}
      />
    </div>
  )
}
