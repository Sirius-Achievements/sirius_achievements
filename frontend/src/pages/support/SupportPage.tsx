import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { supportApi } from '@/api/support'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useToast } from '@/hooks/useToast'
import { type SupportTicket } from '@/types/support'
import { formatDateTime } from '@/utils/formatDate'
import { getErrorMessage } from '@/utils/http'
import { getTotalPages, paginateItems } from '@/utils/pagination'
import { MAX_SUPPORT_FILE_SIZE, SUPPORT_FILE_ACCEPT, validateSupportFile } from '@/utils/supportFiles'

const SUPPORT_PAGE_SIZE = 10

function statusPill(ticket: SupportTicket) {
  if (ticket.archived_at || ticket.status === 'closed') {
    return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200'
  }
  if (ticket.status === 'open') {
    return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-50 text-yellow-700 border border-yellow-200'
  }
  if (ticket.status === 'in_progress') {
    return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200'
  }
  return 'inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200'
}

function statusLabel(ticket: SupportTicket) {
  if (ticket.archived_at || ticket.status === 'closed') return 'Закрыто'
  if (ticket.status === 'open') return 'Открыто'
  if (ticket.status === 'in_progress') return 'В работе'
  return 'Закрыто'
}

export function SupportPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { pushToast } = useToast()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('technical')
  const [similarTickets, setSimilarTickets] = useState<SupportTicket[]>([])
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const view = searchParams.get('view') === 'closed' ? 'closed' : 'active'

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await supportApi.list(view)
        setTickets(response.data.tickets)
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Не удалось загрузить обращения.'))
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [view])

  useEffect(() => {
    if (!isModalOpen || subject.trim().length < 3) {
      setSimilarTickets([])
      return
    }
    const timeout = window.setTimeout(async () => {
      try {
        const response = await supportApi.similar(subject.trim())
        setSimilarTickets(response.data.tickets)
      } catch {
        setSimilarTickets([])
      }
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [isModalOpen, subject])

  useEffect(() => {
    setPage(1)
  }, [view])

  useEffect(() => {
    if (!isModalOpen) return

    document.body.classList.add('overflow-hidden')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('overflow-hidden')
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isModalOpen])

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const setListView = (nextView: 'active' | 'closed') => {
    const next = new URLSearchParams(searchParams)
    next.set('view', nextView)
    setSearchParams(next)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSubject('')
    setCategory('technical')
    setSimilarTickets([])
    setMessage('')
    setFile(null)
    setFileError(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setFileError(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    if (!nextFile) {
      setFile(null)
      return
    }
    const validationError = validateSupportFile(nextFile)
    if (validationError) {
      setFileError(validationError)
      event.target.value = ''
      setFile(null)
      return
    }
    setFile(nextFile)
    if (nextFile.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(nextFile))
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (file) {
      const validationError = validateSupportFile(file)
      if (validationError) {
        setFileError(validationError)
        return
      }
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('subject', subject)
      formData.append('message', message)
      formData.append('category', category)
      if (file) {
        formData.append('file', file)
      }
      const response = await supportApi.create(formData)
      pushToast({ title: 'Обращение отправлено', message: 'Чат поддержки открыт.', tone: 'success' })
      const ticketId = response.data.ticket.id
      closeModal()
      navigate(`/support/${ticketId}`)
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Не удалось создать обращение.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalPages = useMemo(() => getTotalPages(tickets.length, SUPPORT_PAGE_SIZE), [tickets.length])
  const paginatedTickets = useMemo(() => paginateItems(tickets, page, SUPPORT_PAGE_SIZE), [page, tickets])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  return (
    <>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Поддержка</h2>
            <p className="text-sm text-slate-500 mt-1">Создайте обращение или продолжите диалог</p>
          </div>
          <button
            type="button"
            data-open-ticket-modal
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            Новое обращение
          </button>
        </div>

        <div className="bg-surface rounded-xl border border-slate-200 p-2 inline-flex gap-1">
          <a href="?view=active" onClick={(event) => { event.preventDefault(); setListView('active') }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view !== 'closed' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            Активные
          </a>
          <a href="?view=closed" onClick={(event) => { event.preventDefault(); setListView('closed') }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'closed' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            Закрытые
          </a>
        </div>

        {error ? <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div> : null}

        {isLoading ? (
          <div className="bg-surface rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-500">Загрузка обращений…</div>
        ) : tickets.length ? (
          <div className="space-y-3">
            {paginatedTickets.map((ticket) => (
              <Link key={ticket.id} to={`/support/${ticket.id}`} className="block bg-surface rounded-xl border border-slate-200 p-4 hover:border-indigo-200 hover:shadow-sm transition-all group">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors truncate">{ticket.subject}</h3>
                      {(ticket.student_unread_count ?? 0) > 0 ? <span className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">{ticket.student_unread_count}</span> : null}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                      <span>#{ticket.id}</span>
                      <span>{formatDateTime(ticket.created_at)}</span>
                      <span>{ticket.messages_count ?? ticket.messages?.length ?? 0} сообщений</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <span className={statusPill(ticket)}>{statusLabel(ticket)}</span>
                  </div>
                </div>
              </Link>
            ))}
            <PaginationFooter
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={SUPPORT_PAGE_SIZE}
            />
          </div>
        ) : (
          <div className="bg-surface rounded-xl border border-slate-200 p-12 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
            </div>
            <p className="text-sm text-slate-500 mb-4">У вас пока нет обращений</p>
            <button type="button" data-open-ticket-modal onClick={() => setIsModalOpen(true)} className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
              Создать обращение
            </button>
          </div>
        )}
      </div>

      <div
        id="newTicketModal"
        className={`${isModalOpen ? 'fixed' : 'hidden'} inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeModal()
          }
        }}
      >
        <div className="bg-surface rounded-xl shadow-lg w-full max-w-md overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800">Новое обращение</h3>
            <button type="button" data-close-ticket-modal onClick={closeModal} className="text-slate-400 hover:text-slate-600 bg-slate-50 p-2 rounded-full">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <form id="newTicketForm" onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Категория</label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-none">
                <option value="technical">Техническая проблема</option>
                <option value="documents">Документы</option>
                <option value="rating">Рейтинг</option>
                <option value="account">Аккаунт</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Тема обращения</label>
              <input
                type="text"
                name="subject"
                required
                maxLength={255}
                placeholder="Опишите проблему кратко..."
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
              />
            </div>

            {similarTickets.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">Похожие обращения уже существуют</p>
                <div className="mt-2 space-y-1">
                  {similarTickets.map((ticket) => <Link key={ticket.id} to={`/support/${ticket.id}`} onClick={closeModal} className="block truncate text-xs text-amber-700 hover:underline">#{ticket.id} · {ticket.subject}</Link>)}
                </div>
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Сообщение</label>
              <textarea
                name="message"
                required
                rows={4}
                placeholder="Подробно опишите вашу проблему..."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all resize-none"
              ></textarea>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Прикрепить файл (необязательно)</label>
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                accept={SUPPORT_FILE_ACCEPT}
                onChange={handleFileChange}
                className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100"
              />
              <p className="text-[10px] text-slate-400 mt-1">JPG, PNG, WEBP, PDF, DOC или DOCX. Макс. {MAX_SUPPORT_FILE_SIZE / 1024 / 1024} МБ</p>
              {fileError ? <p className="text-xs text-red-600 mt-1 font-medium">{fileError}</p> : null}

              {previewUrl ? (
                <div className="mt-3 space-y-2">
                  <div className="bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center" style={{ maxHeight: 300 }}>
                    <img src={previewUrl} className="max-w-full max-h-[300px] object-contain rounded-lg" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (previewUrl) URL.revokeObjectURL(previewUrl)
                      setPreviewUrl(null)
                      setFile(null)
                      setFileError(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Удалить
                  </button>
                </div>
              ) : null}
            </div>

            <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-70">
              {isSubmitting ? 'Отправляем…' : 'Отправить'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
