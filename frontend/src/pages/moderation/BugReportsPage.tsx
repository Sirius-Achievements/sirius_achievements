import { useEffect, useMemo, useState } from 'react'

import { bugReportsApi, type BugReport, type BugReportListResponse } from '@/api/bugReports'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/utils/http'

const PAGE_SIZE = 20
const EMERCOM_CONSOLE_URL = 'https://emercom.online/m-185383cf3e/console'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value))
}

function reporterName(report: BugReport) {
  if (!report.user) return 'Гость'
  return `${report.user.first_name} ${report.user.last_name}`.trim() || report.user.email
}

function compactDevice(userAgent?: string | null) {
  if (!userAgent) return 'Не определено'
  const browser = userAgent.includes('Edg/') ? 'Edge' : userAgent.includes('Chrome/') ? 'Chrome' : userAgent.includes('Firefox/') ? 'Firefox' : userAgent.includes('Safari/') ? 'Safari' : 'Браузер'
  const device = /Android|iPhone|iPad/i.test(userAgent) ? 'мобильное устройство' : /Macintosh/i.test(userAgent) ? 'macOS' : /Windows/i.test(userAgent) ? 'Windows' : /Linux/i.test(userAgent) ? 'Linux' : 'устройство'
  return `${browser} · ${device}`
}

function elapsedLabel(value?: number | null) {
  if (value == null) return '—'
  const seconds = Math.floor(value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} от начала записи вкладки`
}

export function BugReportsPage() {
  const { pushToast } = useToast()
  const [data, setData] = useState<BugReportListResponse | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<number | null>(null)

  const similarCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const report of data?.reports ?? []) {
      if (report.fingerprint) counts.set(report.fingerprint, (counts.get(report.fingerprint) ?? 0) + 1)
    }
    return counts
  }, [data])

  const closeSimilar = async (report: BugReport) => {
    setClosingId(report.id)
    try {
      const response = await bugReportsApi.closeSimilar(report.id)
      setData((current) => current ? {
        ...current,
        reports: current.reports.map((item) => item.fingerprint && item.fingerprint === report.fingerprint ? { ...item, status: 'closed' } : item.id === report.id ? { ...item, status: 'closed' } : item),
      } : current)
      pushToast({ title: 'Репорты закрыты', message: `Закрыто похожих: ${response.data.closed_count}`, tone: 'success' })
    } catch (closeError) {
      setError(getErrorMessage(closeError, 'Не удалось закрыть похожие репорты.'))
    } finally {
      setClosingId(null)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await bugReportsApi.list({ page, page_size: PAGE_SIZE, query: query.trim() || undefined })
        setData(response.data)
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Не удалось загрузить баг-репорты.'))
      } finally {
        setIsLoading(false)
      }
    }, query ? 250 : 0)

    return () => window.clearTimeout(timeoutId)
  }, [page, query])

  useEffect(() => {
    setPage(1)
  }, [query])

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Диагностика</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-800">Баг-репорты</h2>
        <p className="mt-1 text-sm text-slate-500">Сообщения пользователей и контекст для сопоставления с сессией Emercom.</p>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Поиск по описанию, странице, сессии или версии"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />

      {isLoading ? <LoadingSpinner /> : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {!isLoading && !error && data?.reports.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Репортов пока нет.</p>
      ) : null}

      {!isLoading && !error ? (
        <div className="space-y-3">
          {data?.reports.map((report) => {
            const expanded = expandedId === report.id
            return (
              <article key={report.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <button type="button" onClick={() => setExpandedId(expanded ? null : report.id)} className="w-full text-left">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                      <span>#{report.id} · {reporterName(report)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${report.status === 'closed' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-700'}`}>{report.status === 'closed' ? 'Закрыт' : 'Открыт'}</span>
                      {report.fingerprint && (similarCounts.get(report.fingerprint) ?? 0) > 1 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">Похожих на странице: {similarCounts.get(report.fingerprint)}</span> : null}
                    </div>
                    <time className="text-xs text-slate-500">{formatDate(report.created_at)}</time>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">{report.description || 'Без описания'}</p>
                  <p className="mt-2 truncate text-xs text-slate-500">{report.page_url}</p>
                </button>

                {expanded ? (
                  <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs font-medium text-slate-500">Версия</dt><dd className="mt-1 break-words text-slate-800">{report.app_version || '—'} {report.app_version === __APP_VERSION__ ? <span className="text-xs text-indigo-600">· текущая</span> : <span className="text-xs text-amber-600">· проверить на текущей {__APP_VERSION__}</span>}</dd></div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Сессия Emercom</dt>
                      <dd className="mt-1 break-all font-mono text-slate-800">{report.session_id || 'Не передана'}</dd>
                      {report.session_id ? (
                        <div className="mt-2 flex flex-wrap gap-3">
                          <a href={`${EMERCOM_CONSOLE_URL}/replay/${encodeURIComponent(report.session_id)}?site=sa`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">Открыть реплей <span aria-hidden="true">↗</span></a>
                          <button type="button" onClick={() => void navigator.clipboard.writeText(report.session_id || '')} className="text-xs font-semibold text-slate-500 hover:text-indigo-600">Скопировать ID</button>
                        </div>
                      ) : null}
                    </div>
                    <div><dt className="text-xs font-medium text-slate-500">Момент отправки</dt><dd className="mt-1 text-slate-800">{elapsedLabel(report.session_elapsed_ms)}</dd></div>
                    <div><dt className="text-xs font-medium text-slate-500">Среда</dt><dd className="mt-1 text-slate-800">{compactDevice(report.user_agent)}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Пользователь</dt><dd className="mt-1 text-slate-800">{report.user ? `${reporterName(report)} · ${report.user.email}` : 'Анонимный посетитель'}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Ошибки консоли</dt><dd className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">{report.console_summary || 'Зафиксированных ошибок нет.'}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Сетевые ошибки</dt><dd className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">{report.network_summary || 'Зафиксированных ошибок загрузки нет.'}</dd></div>
                    <div className="sm:col-span-2 flex justify-end">
                      <button type="button" onClick={() => void closeSimilar(report)} disabled={report.status === 'closed' || closingId === report.id} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{closingId === report.id ? 'Закрываем…' : 'Закрыть все похожие репорты'}</button>
                    </div>
                  </dl>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}

      {data ? <PaginationFooter currentPage={data.page} totalPages={data.total_pages} pageSize={PAGE_SIZE} onPageChange={setPage} summary={`Всего репортов: ${data.total}.`} /> : null}
    </div>
  )
}
