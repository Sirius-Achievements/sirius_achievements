import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'

import { documentsApi } from '@/api/documents'
import { moderationApi } from '@/api/moderation'
import { ChipMultiSelect } from '@/components/staff/ChipMultiSelect'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader'
import { DocumentPreviewImage } from '@/components/ui/DocumentPreviewImage'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { Achievement } from '@/types/achievement'
import { AchievementCategory, AchievementLevel, AchievementResult } from '@/types/enums'
import { isImageFile, isPdfFile, openDocumentPreview } from '@/utils/documentPreview'
import { getErrorMessage } from '@/utils/http'

const MODERATION_ACHIEVEMENTS_PAGE_SIZE = 10

function queueAge(createdAt?: string) {
  if (!createdAt) return '—'
  const hours = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000))
  return hours < 24 ? `${hours} ч.` : `${Math.floor(hours / 24)} дн.`
}

function isQueueOverdue(createdAt?: string) {
  return Boolean(createdAt && Date.now() - new Date(createdAt).getTime() > 48 * 3_600_000)
}

export function ModerationAchievementsPage() {
  const { user: currentUser } = useAuth()
  const { pushToast } = useToast()
  const [items, setItems] = useState<Achievement[]>([])
  const [query, setQuery] = useState('')
  const [categorySel, setCategorySel] = useState<string[]>([])
  const [levelSel, setLevelSel] = useState<string[]>([])
  const [resultSel, setResultSel] = useState<string[]>([])
  const [categoryLogic, setCategoryLogic] = useState<'or' | 'and'>('or')
  const [levelLogic, setLevelLogic] = useState<'or' | 'and'>('or')
  const [resultLogic, setResultLogic] = useState<'or' | 'and'>('or')
  const [sortBy, setSortBy] = useState('oldest')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalPending, setTotalPending] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isPaginating, setIsPaginating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])

  const filters = useMemo(
    () => ({
      page,
      query: query || undefined,
      categories: categorySel.length ? categorySel : undefined,
      levels: levelSel.length ? levelSel : undefined,
      results: resultSel.length ? resultSel : undefined,
      category_logic: categorySel.length > 1 && categoryLogic === 'and' ? 'and' : undefined,
      level_logic: levelSel.length > 1 && levelLogic === 'and' ? 'and' : undefined,
      result_logic: resultSel.length > 1 && resultLogic === 'and' ? 'and' : undefined,
      sort_by: sortBy,
    }),
    [categorySel, categoryLogic, levelSel, levelLogic, page, query, resultSel, resultLogic, sortBy],
  )

  const toggleIn = (setter: Dispatch<SetStateAction<string[]>>) => (value: string) =>
    setter((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]))

  const load = async (initial = false) => {
    if (initial) {
      setIsLoading(true)
    } else {
      setIsPaginating(true)
    }
    setError(null)

    try {
      const { data } = await moderationApi.getAchievements(filters)
      setItems(data.achievements)
      setTotalPending(data.stats.total_pending)
      setTotalPages(data.total_pages)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить очередь достижений.'))
    } finally {
      setIsLoading(false)
      setIsPaginating(false)
    }
  }

  useEffect(() => {
    void load(page === 1 && items.length === 0)
  }, [filters])

  useEffect(() => {
    setPage(1)
  }, [query, categorySel, levelSel, resultSel, sortBy])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const { data } = await moderationApi.getAchievements({
          page: 1,
          query: trimmed,
          categories: categorySel.length ? categorySel : undefined,
          levels: levelSel.length ? levelSel : undefined,
          results: resultSel.length ? resultSel : undefined,
          sort_by: sortBy,
        })
        setSuggestions(
          data.achievements.slice(0, 5).map((item) => ({
            value: item.title,
            text: item.title,
          })),
        )
      } catch {
        setSuggestions([])
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [categorySel, levelSel, query, resultSel, sortBy])

  const handleTake = async (item: Achievement) => {
    try {
      await moderationApi.takeAchievement(item.id)
      pushToast({ title: 'Документ взят в работу', tone: 'success' })
      await load()
    } catch (takeError) {
      setError(getErrorMessage(takeError, 'Не удалось взять документ в работу.'))
    }
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
      link.download = item.file_path?.split('/').pop() || `${item.title}.bin`
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

  const resetFilters = () => {
    setQuery('')
    setCategorySel([])
    setLevelSel([])
    setResultSel([])
    setSortBy('oldest')
    setSuggestions([])
    setPage(1)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StaffSectionHeader
        kind="documents"
        currentView="incoming"
        title="Новые документы"
        description={`${totalPending} ожидают проверки`}
      />

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-3">
          <SearchAutocompleteInput
            label="Поиск"
            value={query}
            placeholder="Название, описание или студент..."
            suggestions={suggestions}
            onChange={setQuery}
            onSelectSuggestion={(item) => {
              setQuery(item.value || item.text)
              setSuggestions([])
            }}
            className="min-w-[240px] flex-1"
          />

          <div className="w-full">
            <ChipMultiSelect label="Категория" options={Object.values(AchievementCategory)} selected={categorySel} onToggle={toggleIn(setCategorySel)} onReset={() => setCategorySel([])} logic={categoryLogic} onLogicChange={setCategoryLogic} andHint="у студента есть документы всех выбранных направлений" />
          </div>

          <div className="w-full">
            <ChipMultiSelect label="Уровень" options={Object.values(AchievementLevel)} selected={levelSel} onToggle={toggleIn(setLevelSel)} onReset={() => setLevelSel([])} logic={levelLogic} onLogicChange={setLevelLogic} andHint="у студента есть документы всех выбранных уровней" />
          </div>

          <div className="w-full">
            <ChipMultiSelect label="Результат" options={Object.values(AchievementResult)} selected={resultSel} onToggle={toggleIn(setResultSel)} onReset={() => setResultSel([])} logic={resultLogic} onLogicChange={setResultLogic} andHint="у студента есть документы всех выбранных результатов" />
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
              <option value="oldest">Сначала старые</option>
              <option value="newest">Сначала новые</option>
              <option value="title">По названию</option>
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
      ) : items.length ? (
        <>
          <div
            className={`relative overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm transition-opacity ${isPaginating ? 'pointer-events-none opacity-60' : ''}`}
          >
            {isPaginating ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/50">
                <LoadingSpinner />
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-bold">Превью</th>
                    <th className="px-5 py-3 font-bold">Документ</th>
                    <th className="px-5 py-3 font-bold">Студент</th>
                    <th className="px-5 py-3 font-bold">Категория</th>
                    <th className="px-5 py-3 font-bold">Дата</th>
                    <th className="px-5 py-3 font-bold">Статус</th>
                    <th className="px-5 py-3 font-bold">Модератор</th>
                    <th className="px-5 py-3 text-right font-bold">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item) => (
                    <tr key={item.id} className={`transition-colors hover:bg-slate-50 ${isQueueOverdue(item.created_at) ? 'bg-red-50/50' : ''}`}>
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          className="group flex h-14 w-12 items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-slate-50"
                          onClick={() => handleOpenDocument(item)}
                          title={item.file_path ? 'Открыть файл' : item.external_url ? 'Открыть ссылку' : 'Нет вложения'}
                        >
                          {item.file_path && isImageFile(item.file_path) ? (
                            <DocumentPreviewImage
                              documentId={item.id}
                              alt={item.title}
                              className="h-full w-full object-cover"
                            />
                          ) : item.file_path && isPdfFile(item.file_path) ? (
                            <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                              />
                            </svg>
                          ) : item.external_url ? (
                            <svg className="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 015.656 5.656l-3 3a4 4 0 01-5.656-5.656M10.172 13.828a4 4 0 01-5.656-5.656l3-3a4 4 0 015.656 5.656" />
                            </svg>
                          ) : (
                            <span className="text-[8px] text-slate-400">—</span>
                          )}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="max-w-[220px]">
                          <div className="truncate text-sm font-medium text-slate-800" title={item.title}>
                            {item.title}
                          </div>
                          {item.description ? (
                            <details className="mt-0.5 whitespace-normal text-[10px] text-slate-400">
                              <summary className="cursor-pointer text-indigo-600 hover:underline">Описание</summary>
                              <p className="mt-1 leading-relaxed">{item.description}</p>
                            </details>
                          ) : null}
                          {item.external_url ? (
                            <a
                              href={item.external_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 block truncate text-[10px] text-indigo-600 hover:underline"
                              title={item.external_url}
                            >
                              Ссылка на подтверждение
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {item.user ? (
                          <>
                            <Link
                              to={`/users/${item.user.id}?from=moderation-achievements`}
                              className="transition-colors hover:text-indigo-600"
                            >
                              {item.user.first_name} {item.user.last_name}
                            </Link>
                            <div className="text-[10px] text-slate-400">{item.user.email}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex w-fit rounded border border-indigo-100/50 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-700">
                            {item.category || '—'}
                          </span>
                          <span className="inline-flex w-fit rounded border border-slate-200/50 bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                            {item.level || '—'}
                          </span>
                          {item.result ? (
                            <span className="inline-flex w-fit rounded border border-amber-200/70 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                              {item.result}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
                        {item.created_at ? new Date(item.created_at).toLocaleDateString('ru-RU') : '—'}
                        <div className={`mt-1 text-[10px] font-medium ${isQueueOverdue(item.created_at) ? 'text-red-600' : 'text-slate-400'}`}>
                          В очереди {queueAge(item.created_at)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {!item.moderator_id ? (
                          <span className="inline-flex rounded border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-700">
                            Новый
                          </span>
                        ) : item.moderator_id === currentUser?.id ? (
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
                        {item.moderator_id === currentUser?.id ? (
                          <div className="font-medium text-slate-700">Вы</div>
                        ) : item.moderator_id ? (
                          <span className="text-slate-400">Другой модератор</span>
                        ) : (
                          <span className="text-slate-400">Ещё не взято</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDownload(item)}
                            className="text-xs text-slate-500 transition-colors hover:text-slate-700"
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
                          {!item.moderator_id ? (
                            <button
                              type="button"
                              onClick={() => void handleTake(item)}
                              className="text-xs font-bold text-indigo-600 hover:underline"
                            >
                              Взять и открыть
                            </button>
                          ) : item.moderator_id === currentUser?.id ? (
                            <Link
                              to="/my-work?tab=achievements"
                              className="text-xs font-bold text-indigo-600 hover:underline"
                            >
                              Моя работа
                            </Link>
                          ) : (
                            <span className="text-xs text-slate-400">Занят</span>
                          )}
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
              pageSize={MODERATION_ACHIEVEMENTS_PAGE_SIZE}
            />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
            <svg className="h-8 w-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-slate-500">
            {query ? 'Поиск не дал результатов среди новых документов.' : 'Нет новых документов для модерации.'}
          </p>
        </div>
      )}
    </div>
  )
}
