import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { supportApi } from '@/api/support'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PdfViewer } from '@/components/ui/PdfViewer'
import { SupportChatResponse } from '@/types/support'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/utils/http'

function isPdf(path?: string | null) {
  return /\.pdf$/i.test(path ?? '')
}

function openImageOverlay(src: string) {
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:pointer'
  const bigImg = document.createElement('img')
  bigImg.src = src
  bigImg.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:12px;object-fit:contain'
  overlay.appendChild(bigImg)
  overlay.addEventListener('click', () => overlay.remove())
  document.body.appendChild(overlay)
}

function formatMsgDate(dateStr: string) {
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

function formatFullDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} ${hours}:${minutes}`
}

export function ModerationSupportChatPage() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Number(id)
  const [searchParams] = useSearchParams()
  const from = searchParams.get('from') || 'new'
  const { pushToast } = useToast()
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [chat, setChat] = useState<SupportChatResponse | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sessionDuration, setSessionDuration] = useState('month')
  const [reopenDuration, setReopenDuration] = useState('month')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isTaking, setIsTaking] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isReopening, setIsReopening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({})
  const attachmentUrlsRef = useRef<Record<number, string>>({})
  const [pdfOverlay, setPdfOverlay] = useState<string | null>(null)

  const backHref = `/moderation/support?tab=${from}`

  const load = async () => {
    if (!Number.isFinite(ticketId)) {
      setError('Некорректный идентификатор обращения.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const { data } = await supportApi.getModChat(ticketId)
      setChat(data)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить модераторский чат.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [ticketId])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [chat?.messages])

  useEffect(() => {
    if (!chat?.messages) return
    const msgsWithFile = chat.messages.filter((m) => m.file_path && !(m.id in attachmentUrlsRef.current))
    if (!msgsWithFile.length) return

    void (async () => {
      const entries = await Promise.all(
        msgsWithFile.map(async (m) => {
          try {
            const { data } = await supportApi.getAttachment(m.id)
            const url = URL.createObjectURL(data as Blob)
            return [m.id, url] as [number, string]
          } catch {
            return null
          }
        })
      )
      const newUrls: Record<number, string> = {}
      for (const entry of entries) {
        if (entry) newUrls[entry[0]] = entry[1]
      }
      attachmentUrlsRef.current = { ...attachmentUrlsRef.current, ...newUrls }
      setAttachmentUrls((prev) => ({ ...prev, ...newUrls }))
    })()
  }, [chat?.messages])

  useEffect(() => {
    return () => {
      Object.values(attachmentUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const resizeTextarea = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }

  const handleTake = async () => {
    setIsTaking(true)
    setError(null)
    try {
      const { data } = await supportApi.takeTicket(ticketId)
      setChat((c) => c ? { ...c, ticket: data.ticket, can_take_ticket: false, is_my_ticket: true, can_manage_ticket: true } : c)
      pushToast({ title: 'Обращение взято в работу', tone: 'success' })
    } catch (e) {
      setError(getErrorMessage(e, 'Не удалось взять обращение.'))
    } finally {
      setIsTaking(false)
    }
  }

  const handleClose = async () => {
    setIsClosing(true)
    setError(null)
    try {
      const { data } = await supportApi.closeTicket(ticketId)
      setChat((c) => c ? { ...c, ticket: data.ticket } : c)
      pushToast({ title: 'Обращение закрыто', tone: 'success' })
    } catch (e) {
      setError(getErrorMessage(e, 'Не удалось закрыть обращение.'))
    } finally {
      setIsClosing(false)
    }
  }

  const handleReopen = async () => {
    setIsReopening(true)
    setError(null)
    try {
      const { data } = await supportApi.reopenTicket(ticketId, reopenDuration)
      setChat((c) => c ? { ...c, ticket: data.ticket } : c)
      pushToast({ title: 'Обращение открыто снова', tone: 'success' })
    } catch (e) {
      setError(getErrorMessage(e, 'Не удалось переоткрыть обращение.'))
    } finally {
      setIsReopening(false)
    }
  }

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!text.trim() && !file) return
    setIsSending(true)
    setError(null)
    try {
      const formData = new FormData()
      if (text.trim()) formData.append('text', text)
      if (file) formData.append('file', file)
      formData.append('session_duration', sessionDuration)

      const { data } = await supportApi.sendModMessage(ticketId, formData)
      setChat((c) => c ? { ...c, ticket: data.ticket, messages: [...c.messages, data.message], can_manage_ticket: true, can_take_ticket: false, is_my_ticket: true } : c)
      setText('')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) {
      setError(getErrorMessage(e, 'Не удалось отправить сообщение.'))
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const form = event.currentTarget.closest('form')
      if (form) form.requestSubmit()
    }
  }

  const handleRemoveFile = () => {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }


  if (isLoading) return <div className="py-16"><LoadingSpinner /></div>
  if (!chat) return null

  const st = chat.ticket.status
  const isArchived = Boolean(chat.ticket.archived_at)
  const isReadOnly = isArchived || st === 'archived'
  const isClosed = st === 'closed'

  return (
    <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-4" style={{ height: 'calc(100dvh - 120px)' }}>

      {/* Sidebar */}
      <div className="md:w-80 shrink-0 bg-surface rounded-xl border border-slate-200 p-4 space-y-4 overflow-y-auto md:h-full order-2 md:order-1">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Обращение</p>
          <h3 className="text-sm font-bold text-slate-800">{chat.ticket.subject}</h3>
          <p className="text-[10px] text-slate-400 mt-1">#{chat.ticket.id} · {formatFullDate(chat.ticket.created_at)}</p>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Статус</p>
          {isReadOnly ? (
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">Закрыто</span>
          ) : st === 'open' && !chat.ticket.moderator_id ? (
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-50 text-yellow-700 border border-yellow-200">Открыто</span>
          ) : st === 'in_progress' || chat.ticket.moderator_id ? (
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">Принято в работу</span>
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">Закрыто</span>
          )}
        </div>

        {chat.ticket.user ? (
          <div className="border-t border-slate-100 pt-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Пользователь</p>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-medium text-xs shrink-0">
                {chat.ticket.user.first_name.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <Link to={`/users/${chat.ticket.user.id}?from=support&ticket_id=${chat.ticket.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600 transition-colors block truncate">
                  {chat.ticket.user.first_name} {chat.ticket.user.last_name}
                </Link>
                <p className="text-[10px] text-slate-400">ID: {chat.ticket.user.id}</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 truncate">{chat.ticket.user.email}</p>
          </div>
        ) : null}

        <div className="border-t border-slate-100 pt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Ответственный модератор</p>
          {chat.ticket.moderator ? (
            <>
              <p className="text-sm font-medium text-slate-800">{chat.ticket.moderator.first_name} {chat.ticket.moderator.last_name}</p>
              <p className="text-[10px] text-slate-400 mt-1">{chat.ticket.moderator.email}</p>
              {chat.ticket.assigned_at ? <p className="text-[10px] text-slate-400 mt-1">Взял: {formatFullDate(chat.ticket.assigned_at)}</p> : null}
            </>
          ) : (
            <p className="text-xs text-slate-500">Пока никто не взял это обращение в работу</p>
          )}
        </div>

        <div className="border-t border-slate-100 pt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Статистика</p>
          <p className="text-xs text-slate-600">Сообщений: {chat.messages.length}</p>
          {chat.ticket.updated_at ? <p className="text-[10px] text-slate-400 mt-1">Обновлено: {formatFullDate(chat.ticket.updated_at)}</p> : null}
        </div>

        <div className="border-t border-slate-100 pt-3 space-y-2">
          {isReadOnly ? (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500">
              Закрытое обращение доступно только для просмотра.
            </div>
          ) : chat.can_take_ticket ? (
            <button type="button" onClick={() => void handleTake()} disabled={isTaking} className="w-full text-xs text-indigo-600 font-bold bg-indigo-50 px-3 py-2 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-200">
              {isTaking ? 'Берём...' : 'Взять в работу'}
            </button>
          ) : !chat.can_manage_ticket ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
              Это обращение уже закреплено за другим модератором. Вам доступен только просмотр.
            </div>
          ) : !isClosed ? (
            <button type="button" onClick={() => void handleClose()} disabled={isClosing} className="w-full text-xs text-red-600 font-bold bg-red-50 px-3 py-2 rounded-lg hover:bg-red-100 transition-colors border border-red-200">
              {isClosing ? 'Закрываем...' : 'Закрыть обращение'}
            </button>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Срок сессии</label>
                <select value={reopenDuration} onChange={(e) => setReopenDuration(e.target.value)} className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all">
                  <option value="day">1 день</option>
                  <option value="week">1 неделя</option>
                  <option value="month">1 месяц</option>
                  <option value="unlimited">Без срока</option>
                </select>
              </div>
              <button type="button" onClick={() => void handleReopen()} disabled={isReopening} className="w-full text-xs text-green-600 font-bold bg-green-50 px-3 py-2 rounded-lg hover:bg-green-100 transition-colors border border-green-200">
                {isReopening ? 'Открываем...' : 'Открыть снова'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 order-1 md:order-2">
        <div className="bg-surface rounded-t-xl border border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={backHref} className="text-slate-400 hover:text-indigo-600 transition-colors shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800 truncate">{chat.ticket.subject}</h2>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span>#{chat.ticket.id}</span>
                {chat.ticket.user ? (
                  <>
                    <span>·</span>
                    <span>{chat.ticket.user.first_name} {chat.ticket.user.last_name}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div ref={messagesRef} className="flex-1 overflow-y-auto bg-slate-50 border-x border-slate-200 px-4 py-4 space-y-4">
          {chat.messages.map((msg) => (
            <div key={msg.id} className={`flex ${!msg.is_from_moderator ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] ${msg.is_from_moderator ? 'bg-indigo-600 text-white' : 'bg-surface border border-slate-200 text-slate-800'} rounded-2xl px-4 py-3 shadow-sm`}>
                {!msg.is_from_moderator ? (
                  <div className="text-[10px] font-bold text-slate-500 mb-1">
                    {msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}` : 'Пользователь'}
                  </div>
                ) : null}

                {msg.text ? <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p> : null}

                {msg.file_path ? (
                  <div className="mt-2">
                    {attachmentUrls[msg.id] ? (
                      <div className="space-y-1.5">
                        {isPdf(msg.file_path) ? (
                          <button
                            type="button"
                            onClick={() => setPdfOverlay(attachmentUrls[msg.id])}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface/20 hover:bg-surface/30 transition-colors font-medium"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                            Открыть PDF
                          </button>
                        ) : (
                          <img
                            src={attachmentUrls[msg.id]}
                            alt="Вложение"
                            className="max-w-full rounded-lg max-h-64 object-contain cursor-pointer"
                            onClick={() => openImageOverlay(attachmentUrls[msg.id])}
                          />
                        )}
                        <a
                          href={attachmentUrls[msg.id]}
                          download={msg.file_path.split('/').pop() ?? 'attachment'}
                          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-surface/20 hover:bg-surface/30 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          Скачать
                        </a>
                      </div>
                    ) : (
                      <div className="text-xs opacity-60 py-1">Загрузка вложения…</div>
                    )}
                  </div>
                ) : null}

                <div className={`text-[10px] ${msg.is_from_moderator ? 'text-indigo-200' : 'text-slate-400'} mt-1 text-right`}>
                  {msg.created_at ? formatMsgDate(msg.created_at) : ''}
                </div>
              </div>
            </div>
          ))}
        </div>

        {isReadOnly ? (
          <div className="bg-slate-100 rounded-b-xl border border-slate-200 border-t-0 p-3 shrink-0 flex items-center justify-between">
            <p className="text-sm text-slate-500">Закрытое обращение</p>
          </div>
        ) : !isClosed && chat.can_manage_ticket ? (
          <div className="bg-surface rounded-b-xl border border-slate-200 border-t-0 p-3 shrink-0">
            <form onSubmit={handleSend} className="flex items-end gap-2">
              <label className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center text-slate-400 transition-colors hover:text-indigo-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>

              <div className="flex-1 min-w-0">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => { setText(e.target.value); resizeTextarea() }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Ответ модератора..."
                  className="block min-h-[38px] w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition-all focus:border-indigo-600 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20"
                />
                {file ? (
                  <div className="flex items-center gap-1 mt-0.5 min-w-0">
                    <svg className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    <span className="text-[10px] text-indigo-600 truncate min-w-0 flex-1">{file.name}</span>
                    <button type="button" onClick={handleRemoveFile} className="text-slate-400 hover:text-red-500 transition-colors shrink-0 ml-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="hidden sm:block shrink-0 w-36">
                <select value={sessionDuration} onChange={(e) => setSessionDuration(e.target.value)} className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-800 outline-none transition-all focus:border-indigo-600 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20">
                  <option value="day">1 день</option>
                  <option value="week">1 неделя</option>
                  <option value="month">1 месяц</option>
                  <option value="unlimited">Без срока</option>
                </select>
              </div>

              <button type="submit" disabled={isSending} className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-60">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </form>
          </div>
        ) : !isClosed ? (
          <div className="bg-slate-100 rounded-b-xl border border-slate-200 border-t-0 p-3 shrink-0 flex items-center justify-between">
            <p className="text-sm text-slate-500">Этот чат ведет другой модератор</p>
          </div>
        ) : (
          <div className="bg-slate-100 rounded-b-xl border border-slate-200 border-t-0 p-3 shrink-0 flex items-center justify-between">
            <p className="text-sm text-slate-500">Обращение закрыто</p>
            <span className="text-xs text-slate-400">Используйте блок слева для повторного открытия</span>
          </div>
        )}
      </div>

      {pdfOverlay ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm">
          <div className="relative bg-surface rounded-xl w-full max-w-3xl h-[85dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <span className="text-sm font-bold text-slate-800">Просмотр PDF</span>
              <div className="flex items-center gap-2">
                <a
                  href={pdfOverlay}
                  download="attachment.pdf"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Скачать
                </a>
                <button
                  type="button"
                  onClick={() => setPdfOverlay(null)}
                  className="text-slate-400 hover:text-slate-600 bg-slate-50 p-2 rounded-full"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <PdfViewer src={pdfOverlay} className="flex-1 overflow-auto bg-slate-100" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
