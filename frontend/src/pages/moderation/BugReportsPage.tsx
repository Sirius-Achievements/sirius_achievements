import { useEffect, useState } from 'react'

import { bugReportsApi, type BugReport, type BugReportListResponse } from '@/api/bugReports'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { getErrorMessage } from '@/utils/http'

const PAGE_SIZE = 20

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value))
}

function reporterName(report: BugReport) {
  if (!report.user) return 'Гость'
  return `${report.user.first_name} ${report.user.last_name}`.trim() || report.user.email
}

export function BugReportsPage() {
  const [data, setData] = useState<BugReportListResponse | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
                    <div className="font-semibold text-slate-800">#{report.id} · {reporterName(report)}</div>
                    <time className="text-xs text-slate-500">{formatDate(report.created_at)}</time>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">{report.description || 'Без описания'}</p>
                  <p className="mt-2 truncate text-xs text-slate-500">{report.page_url}</p>
                </button>

                {expanded ? (
                  <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs font-medium text-slate-500">Версия</dt><dd className="mt-1 break-words text-slate-800">{report.app_version || '—'}</dd></div>
                    <div><dt className="text-xs font-medium text-slate-500">Сессия Emercom</dt><dd className="mt-1 break-all font-mono text-slate-800">{report.session_id || 'Не передана'}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Пользователь</dt><dd className="mt-1 text-slate-800">{report.user ? `${reporterName(report)} · ${report.user.email}` : 'Анонимный посетитель'}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">User-Agent</dt><dd className="mt-1 break-all text-xs text-slate-700">{report.user_agent || '—'}</dd></div>
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
