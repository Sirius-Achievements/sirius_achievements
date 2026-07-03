import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { achievementsApi } from '@/api/achievements'
import { documentsApi } from '@/api/documents'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useToast } from '@/hooks/useToast'
import { Achievement } from '@/types/achievement'
import {
  AchievementCategory,
  AchievementLevel,
  AchievementResult,
  AchievementStatus,
} from '@/types/enums'
import { openDocumentPreview } from '@/utils/documentPreview'
import { formatDateTime } from '@/utils/formatDate'
import { getErrorMessage } from '@/utils/http'

interface SuggestionItem {
  value: string
  text: string
}

interface AchievementFormState {
  title: string
  description: string
  category: string
  level: string
  result: string
  file: File | null
  external_url: string
}

const MAX_FILE_SIZE = 10 * 1024 * 1024
const FILE_ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.pptx,.xlsx'
const ACHIEVEMENTS_PAGE_SIZE = 10

function getDefaultForm(): AchievementFormState {
  return {
    title: '',
    description: '',
    category: Object.values(AchievementCategory)[0] ?? '',
    level: Object.values(AchievementLevel)[0] ?? '',
    result: Object.values(AchievementResult)[0] ?? '',
    file: null,
    external_url: '',
  }
}

function statusLabel(status: string) {
  switch (status) {
    case AchievementStatus.APPROVED:
      return 'Одобрено'
    case AchievementStatus.PENDING:
      return 'На проверке'
    case AchievementStatus.REJECTED:
      return 'Отклонено'
    case AchievementStatus.REVISION:
      return 'На доработке'
    case AchievementStatus.ARCHIVED:
      return 'Архив'
    default:
      return status
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case AchievementStatus.APPROVED:
      return 'bg-green-50 text-green-700 border border-green-200'
    case AchievementStatus.REJECTED:
      return 'bg-red-50 text-red-700 border border-red-200'
    case AchievementStatus.REVISION:
      return 'bg-yellow-100 text-yellow-800 border border-yellow-300'
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200'
  }
}

function resultClass(result?: string | null) {
  switch (result) {
    case AchievementResult.WINNER:
      return 'text-yellow-600'
    case AchievementResult.PRIZEWINNER:
      return 'text-indigo-600'
    default:
      return 'text-slate-500'
  }
}

function emitPreview(item: Achievement) {
  if (item.file_path) {
    openDocumentPreview(item.id, item.file_path)
    return
  }
  if (item.external_url) {
    window.open(item.external_url, '_blank', 'noopener')
  }
}

async function downloadOwnDocument(item: Achievement) {
  const response = await documentsApi.download(item.id)
  const header = response.headers['content-type']
  const contentType = typeof header === 'string' ? header : 'application/octet-stream'
  const blob = response.data instanceof Blob ? response.data : new Blob([response.data as BlobPart], { type: contentType })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = (item.file_path ?? '').split('/').pop() || `${item.title}.bin`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}

function validateFile(file: File) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Файл слишком большой (${formatFileSize(file.size)}). Максимум: 10 МБ.`)
  }
}

export function AchievementsPage() {
  const { pushToast } = useToast()
  const [items, setItems] = useState<Achievement[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [result, setResult] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState<AchievementFormState>(getDefaultForm)
  const [createFileText, setCreateFileText] = useState('')
  const createFileInputRef = useRef<HTMLInputElement | null>(null)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [reviseModalOpen, setReviseModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Achievement | null>(null)
  const [reviseTitle, setReviseTitle] = useState('')
  const [reviseDesc, setReviseDesc] = useState('')
  const [reviseFile, setReviseFile] = useState<File | null>(null)
  const [reviseFileText, setReviseFileText] = useState('')
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Achievement | null>(null)

  const filters = useMemo(
    () => ({
      page,
      query: query || undefined,
      status: status || undefined,
      category: category || undefined,
      level: level || undefined,
      result: result || undefined,
      sort_by: sortBy,
    }),
    [category, level, page, query, result, sortBy, status]
  )

  const loadItems = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data } = await achievementsApi.list(filters)
      setItems(data.achievements)
      setTotalPages(data.total_pages)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить достижения.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [filters])

  useEffect(() => {
    setPage(1)
  }, [query, status, category, level, result, sortBy])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 1) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const { data } = await achievementsApi.search(trimmed)
        setSuggestions(data)
      } catch {
        setSuggestions([])
      }
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query])

  const resetCreateForm = () => {
    setCreateForm(getDefaultForm())
    setCreateFileText('')
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    resetCreateForm()
  }

  const closeReviseModal = () => {
    setReviseModalOpen(false)
    setEditingItem(null)
    setReviseTitle('')
    setReviseDesc('')
    setReviseFile(null)
    setReviseFileText('')
  }

  const handleCreateFileChange = (file: File | null) => {
    if (!file) {
      setCreateForm((current) => ({ ...current, file: null }))
      setCreateFileText('')
      return
    }

    try {
      validateFile(file)
      setCreateForm((current) => ({ ...current, file }))
      setCreateFileText(`${file.name} · ${formatFileSize(file.size)}`)
    } catch (fileError) {
      setError(getErrorMessage(fileError, 'Не удалось выбрать файл.'))
      setCreateForm((current) => ({ ...current, file: null }))
      setCreateFileText('')
    }
  }

  const handleReviseFileChange = (file: File | null) => {
    if (!file) {
      setReviseFile(null)
      setReviseFileText('')
      return
    }

    try {
      validateFile(file)
      setReviseFile(file)
      setReviseFileText(file.name)
    } catch (fileError) {
      setError(getErrorMessage(fileError, 'Не удалось выбрать файл.'))
      setReviseFile(null)
      setReviseFileText('')
    }
  }

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmittingCreate(true)
    setError(null)

    try {
      const trimmedUrl = createForm.external_url.trim()
      if (!createForm.file && !trimmedUrl) {
        throw new Error('Прикрепите файл или укажите ссылку.')
      }
      if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
        throw new Error('Ссылка должна начинаться с http:// или https://')
      }

      const formData = new FormData()
      formData.append('title', createForm.title)
      formData.append('description', createForm.description)
      formData.append('category', createForm.category)
      formData.append('level', createForm.level)
      formData.append('result', createForm.result)
      if (createForm.file) {
        formData.append('file', createForm.file)
      }
      if (trimmedUrl) {
        formData.append('external_url', trimmedUrl)
      }

      await achievementsApi.create(formData)
      pushToast({
        title: 'Документ добавлен',
        message: 'Новое достижение отправлено на проверку.',
        tone: 'success',
      })
      closeCreateModal()
      setPage(1)
      await loadItems()
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось сохранить достижение.'))
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const startRevision = (item: Achievement) => {
    setEditingItem(item)
    setReviseTitle(item.title)
    setReviseDesc(item.description ?? '')
    setReviseFile(null)
    setReviseFileText('')
    setReviseModalOpen(true)
  }

  const handleRevisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingItem) return

    setIsSubmittingRevision(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('title', reviseTitle)
      formData.append('description', reviseDesc)
      if (reviseFile) {
        formData.append('file', reviseFile)
      }

      await achievementsApi.revise(editingItem.id, formData)
      pushToast({
        title: 'Доработка отправлена',
        message: 'Документ снова передан на модерацию.',
        tone: 'success',
      })
      closeReviseModal()
      await loadItems()
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось отправить доработку.'))
    } finally {
      setIsSubmittingRevision(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return

    try {
      await achievementsApi.delete(deleteTarget.id)
      pushToast({
        title: 'Документ удалён',
        message: `Документ «${deleteTarget.title}» удалён.`,
        tone: 'success',
      })
      setDeleteTarget(null)
      await loadItems()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Не удалось удалить документ.'))
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Мои достижения</h2>
          <p className="text-sm text-slate-500">История загрузок и статусы проверки</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="w-full sm:w-auto bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center shadow-sm"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Добавить
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
      ) : null}

      <div className="bg-surface p-4 sm:p-5 rounded-xl border border-slate-200 shadow-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setPage(1)
            void loadItems()
          }}
          className="flex flex-wrap gap-3 items-end"
        >
          <div className="flex-grow min-w-[200px] relative">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Поиск</label>
            <div className="relative">
              <div className="absolute left-3 top-2.5 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => window.setTimeout(() => setSuggestions([]), 150)}
                placeholder="Название..."
                autoComplete="off"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none text-sm text-slate-800 transition-all h-[38px]"
              />
            </div>
            {suggestions.length ? (
              <ul className="absolute z-50 w-full bg-surface border border-slate-200 rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto">
                {suggestions.map((item) => (
                  <li
                    key={`${item.value}-${item.text}`}
                    onMouseDown={() => {
                      setQuery(item.value || item.text)
                      setSuggestions([])
                    }}
                    className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm text-slate-700 border-b border-slate-100 last:border-0"
                  >
                    {item.text || item.value}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="w-[calc(50%-0.375rem)] sm:w-[130px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Статус</label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px]"
            >
              <option value="">Все статусы</option>
              {Object.values(AchievementStatus)
                .filter((item) => item !== AchievementStatus.ARCHIVED)
                .map((item) => (
                  <option key={item} value={item}>
                    {statusLabel(item)}
                  </option>
                ))}
            </select>
          </div>

          <div className="w-[calc(50%-0.375rem)] sm:w-[130px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Вид</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px]"
            >
              <option value="">Все виды</option>
              {Object.values(AchievementCategory).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-[140px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Уровень</label>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px]"
            >
              <option value="">Все уровни</option>
              {Object.values(AchievementLevel).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-[140px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Результат</label>
            <select
              value={result}
              onChange={(event) => setResult(event.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px]"
            >
              <option value="">Все результаты</option>
              {Object.values(AchievementResult).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-[160px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Сортировка</label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:bg-surface focus:border-indigo-600 outline-none h-[38px]"
            >
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="title">По названию</option>
            </select>
          </div>

          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="submit"
              className="flex-1 sm:flex-none px-6 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center h-[38px]"
            >
              Найти
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setStatus('')
                setCategory('')
                setLevel('')
                setResult('')
                setSortBy('newest')
                setPage(1)
                setSuggestions([])
              }}
              className="w-[38px] flex-shrink-0 bg-surface border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center h-[38px]"
              title="Сбросить"
            >
              ✕
            </button>
          </div>
        </form>
      </div>

      <div className="bg-surface rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="py-16">
            <LoadingSpinner />
          </div>
        ) : items.length ? (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 w-12 text-center">Файл</th>
                    <th className="px-5 py-3">Название</th>
                    <th className="px-5 py-3">Инфо</th>
                    <th className="px-5 py-3">Статус</th>
                    <th className="px-5 py-3">Баллы</th>
                    <th className="px-5 py-3 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        item.status === AchievementStatus.REVISION ? 'bg-yellow-50/30' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-5 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => emitPreview(item)}
                            title="Просмотр"
                            className="inline-flex w-8 h-8 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors items-center justify-center"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
                          </button>
                          {item.file_path ? (
                            <button
                              type="button"
                              onClick={() =>
                                void downloadOwnDocument(item).catch(() =>
                                  pushToast({ title: 'Не удалось скачать документ', tone: 'error' }),
                                )
                              }
                              title="Скачать"
                              className="inline-flex w-8 h-8 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800 transition-colors items-center justify-center"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m5 6H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2z" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800">{item.title}</div>
                        {item.description ? (
                          <details className="mt-0.5 max-w-xs whitespace-normal text-[11px] text-slate-500">
                            <summary className="cursor-pointer text-indigo-600 hover:underline">Описание</summary>
                            <p className="mt-1 leading-relaxed">{item.description}</p>
                          </details>
                        ) : null}
                        {item.external_url ? (
                          <a
                            href={item.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 block max-w-xs truncate text-[11px] text-indigo-600 hover:underline"
                            title={item.external_url}
                          >
                            Ссылка на подтверждение
                          </a>
                        ) : null}
                        {item.rejection_reason ? (
                          <div
                            className={`text-[10px] mt-0.5 break-words whitespace-normal max-w-xs ${
                              item.status === AchievementStatus.REVISION
                                ? 'text-yellow-700 font-medium'
                                : 'text-red-500'
                            }`}
                          >
                            <span className="font-bold">Комментарий:</span> {item.rejection_reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-slate-600 text-xs">
                        <span className="block font-medium">{item.category}</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">{item.level}</span>
                        {item.result ? (
                          <span className={`text-[10px] font-bold ${resultClass(item.result)}`}> • {item.result}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass(
                            item.status
                          )}`}
                        >
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td
                        className={`px-5 py-3 font-bold ${
                          item.points > 0 ? 'text-indigo-600' : 'text-slate-400'
                        }`}
                      >
                        {item.points}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {item.status === AchievementStatus.REVISION ? (
                          <button
                            type="button"
                            onClick={() => startRevision(item)}
                            className="inline-flex items-center text-xs font-bold bg-yellow-500 text-white hover:bg-yellow-600 px-3 py-1.5 rounded transition-colors shadow-sm mr-2"
                          >
                            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                              />
                            </svg>
                            Исправить
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          className="text-xs font-medium text-slate-400 hover:text-red-600 transition-colors p-1"
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-slate-100">
              {items.map((item) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{item.title}</div>
                      {item.description ? (
                        <details className="mt-1 text-xs text-slate-500">
                          <summary className="cursor-pointer text-indigo-600 hover:underline">Описание</summary>
                          <p className="mt-1 leading-relaxed">{item.description}</p>
                        </details>
                      ) : null}
                      {item.external_url ? (
                        <a
                          href={item.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block truncate text-xs text-indigo-600 hover:underline"
                        >
                          Ссылка на подтверждение
                        </a>
                      ) : null}
                      <div className="text-xs text-slate-500 mt-1">
                        {item.category} • {item.level}
                        {item.result ? ` • ${item.result}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">{formatDateTime(item.created_at)}</div>
                    </div>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass(
                        item.status
                      )}`}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  {item.rejection_reason ? (
                    <div
                      className={`text-[11px] mt-2 ${
                        item.status === AchievementStatus.REVISION ? 'text-yellow-700 font-medium' : 'text-red-500'
                      }`}
                    >
                      Комментарий: {item.rejection_reason}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mt-3">
                    <div className={`font-bold ${item.points > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                      {item.points} баллов
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => emitPreview(item)}
                        className="inline-flex w-8 h-8 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors items-center justify-center"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                      {item.status === AchievementStatus.REVISION ? (
                        <button
                          type="button"
                          onClick={() => startRevision(item)}
                          className="inline-flex items-center text-xs font-bold bg-yellow-500 text-white hover:bg-yellow-600 px-3 py-1.5 rounded transition-colors shadow-sm"
                        >
                          Исправить
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="text-xs font-medium text-slate-400 hover:text-red-600 transition-colors"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-16 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-50 mb-3 text-slate-400">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-600">У вас пока нет достижений.</p>
            <p className="text-xs text-slate-400 mt-1">Нажмите «Добавить», чтобы загрузить первый документ.</p>
          </div>
        )}
      </div>

      <PaginationFooter
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={ACHIEVEMENTS_PAGE_SIZE}
        className="rounded-xl border border-slate-200 bg-surface"
      />

      {showCreateModal ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div
            className="bg-surface rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Добавить достижение</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Заполните данные и загрузите подтверждающий документ.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-slate-600 bg-surface p-1.5 rounded-md shadow-sm border border-slate-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="overflow-y-auto">
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Название
                  </label>
                  <input
                    type="text"
                    value={createForm.title}
                    onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
                    required
                    placeholder="Например: Победитель олимпиады..."
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-400"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Категория
                    </label>
                    <select
                      value={createForm.category}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, category: event.target.value }))
                      }
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                    >
                      {Object.values(AchievementCategory).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Уровень
                    </label>
                    <select
                      value={createForm.level}
                      onChange={(event) => setCreateForm((current) => ({ ...current, level: event.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                    >
                      {Object.values(AchievementLevel).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Результат
                    </label>
                    <select
                      value={createForm.result}
                      onChange={(event) => setCreateForm((current) => ({ ...current, result: event.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                    >
                      {Object.values(AchievementResult).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Описание (необязательно)
                  </label>
                  <textarea
                    value={createForm.description}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, description: event.target.value }))
                    }
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Документ (Фото или PDF)
                  </label>
                  <input
                    ref={createFileInputRef}
                    type="file"
                    accept={FILE_ACCEPT}
                    onChange={(event) => handleCreateFileChange(event.target.files?.[0] ?? null)}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 transition-colors cursor-pointer border border-slate-200 rounded-lg bg-slate-50 p-1"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">JPG, PNG, WebP, GIF, PDF, DOC, DOCX, PPTX, XLSX до 10 МБ</p>
                  {createFileText ? (
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-green-600 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="truncate">{createFileText}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleCreateFileChange(null)
                          if (createFileInputRef.current) createFileInputRef.current.value = ''
                        }}
                        className="shrink-0 text-[11px] font-semibold text-red-600 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-50 transition-colors"
                      >
                        Удалить
                      </button>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Или ссылка на документ
                  </label>
                  <input
                    type="url"
                    value={createForm.external_url}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, external_url: event.target.value }))
                    }
                    placeholder="https://..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Укажите ссылку на грамоту или страницу подтверждения участия, если нет файла. Можно указать и то, и другое — главное чтобы было заполнено хотя бы одно поле.
                  </p>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col-reverse sm:flex-row justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="w-full sm:w-auto px-6 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 text-center transition-colors bg-surface"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className={`w-full sm:w-auto px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors ${
                    isSubmittingCreate ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmittingCreate ? 'Загрузка...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
          <button type="button" onClick={closeCreateModal} className="fixed inset-0 -z-10" aria-label="Закрыть" />
        </div>
      ) : null}

      {reviseModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div
            className="bg-surface rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Исправить документ</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Измените данные и загрузите новый файл</p>
              </div>
              <button
                type="button"
                onClick={closeReviseModal}
                className="text-slate-400 hover:text-slate-600 bg-surface p-1.5 rounded-md shadow-sm border border-slate-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleRevisionSubmit} className="flex flex-col">
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Название
                  </label>
                  <input
                    type="text"
                    value={reviseTitle}
                    onChange={(event) => setReviseTitle(event.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Описание
                  </label>
                  <textarea
                    value={reviseDesc}
                    onChange={(event) => setReviseDesc(event.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all resize-none"
                  />
                </div>

                <div className="w-full relative border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center hover:bg-slate-50 hover:border-indigo-400 transition-colors group cursor-pointer">
                  <input
                    type="file"
                    accept={FILE_ACCEPT}
                    onChange={(event) => handleReviseFileChange(event.target.files?.[0] ?? null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-slate-700">Новый файл (необязательно)</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Оставьте пустым, чтобы сохранить текущий</p>
                  <p className="mt-2 text-xs font-bold text-indigo-600 break-all text-center px-4">{reviseFileText}</p>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button
                  type="button"
                  onClick={closeReviseModal}
                  className="flex-1 px-4 py-2.5 bg-surface border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRevision}
                  className={`flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm ${
                    isSubmittingRevision ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmittingRevision ? 'Отправляем...' : 'Отправить'}
                </button>
              </div>
            </form>
          </div>
          <button type="button" onClick={closeReviseModal} className="fixed inset-0 -z-10" aria-label="Закрыть" />
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
            aria-hidden="true"
          />
          <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center border border-slate-100">
            <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-red-100 mb-4">
              <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Удалить документ?</h3>
            <p className="text-sm text-slate-500 mb-6">
              Документ «{deleteTarget.title}» будет удалён навсегда. Отменить это действие нельзя.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteConfirm()}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors shadow-sm shadow-red-600/30"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
