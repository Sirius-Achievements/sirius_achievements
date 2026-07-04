import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { supportApi } from '@/api/support'
import { ChipMultiSelect } from '@/components/staff/ChipMultiSelect'
import { SearchAutocompleteInput, type SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PaginationFooter } from '@/components/ui/PaginationFooter'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { SupportListResponse, SupportTicket } from '@/types/support'
import { getErrorMessage } from '@/utils/http'

type SupportTab = 'new' | 'chats' | 'all'
const MODERATION_SUPPORT_PAGE_SIZE = 20

function normalizeSupportTab(value: string | null): SupportTab {
  if (value === 'chats' || value === 'all') {
    return value
  }

  return 'new'
}

function ticketStatusBadge(ticket: SupportTicket, tab: SupportTab) {
  const status = ticket.status
  const isArchived = Boolean(ticket.archived_at)

  if (tab === 'new') {
    if (status === 'open' && !ticket.moderator_id) {
      return (
        <span className="inline-flex rounded border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-700">
          Новое
        </span>
      )
    }

    return (
      <span className="inline-flex rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
        Принято
      </span>
    )
  }

  if (isArchived || status === 'archived') {
    return (
      <span className="inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Закрыто
      </span>
    )
  }

  if (status === 'closed') {
    return (
      <span className="inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Закрыто
      </span>
    )
  }

  if (status === 'open' && !ticket.moderator_id) {
    return (
      <span className="inline-flex rounded border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-700">
        Открыто
      </span>
    )
  }

  if (status === 'in_progress' || ticket.moderator_id) {
    return (
      <span className="inline-flex rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
        {tab === 'chats' ? 'В работе' : 'Принято'}
      </span>
    )
  }

  return (
    <span className="inline-flex rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
      Закрыто
    </span>
  )
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const value = new Date(dateStr)
  const day = String(value.getDate()).padStart(2, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const year = value.getFullYear()
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} ${hours}:${minutes}`
}

function getSortOrderLabels(sortBy: string) {
  if (sortBy === 'subject') {
    return { asc: 'Тема: А-Я', desc: 'Тема: Я-А' }
  }
  if (sortBy === 'status') {
    return { asc: 'Статус: А-Я', desc: 'Статус: Я-А' }
  }
  if (sortBy === 'id') {
    return { asc: 'ID: сначала меньшие', desc: 'ID: сначала большие' }
  }
  return { asc: 'Сначала старые', desc: 'Сначала новые' }
}

export function ModerationSupportPage() {
  const { user: currentUser } = useAuth()
  const { pushToast } = useToast()
  const [searchParams] = useSearchParams()
  const tab = normalizeSupportTab(searchParams.get('tab'))
  const [data, setData] = useState<SupportListResponse | null>(null)
  const [query, setQuery] = useState('')
  const [statusSel, setStatusSel] = useState<string[]>([])
  const [statusLogic, setStatusLogic] = useState<'or' | 'and'>('or')
  const [sortBy, setSortBy] = useState(tab === 'chats' ? 'updated_at' : 'created_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([])

  useEffect(() => {
    setQuery('')
    setStatusSel([])
    setStatusLogic('or')
    setPage(1)
    setSortOrder('desc')
    setSortBy(tab === 'chats' ? 'updated_at' : 'created_at')
    setSuggestions([])
  }, [tab])

  const toggleStatus = (value: string) =>
    setStatusSel((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]))

  const params = useMemo(
    () => ({
      page,
      statuses: statusSel.length ? statusSel : undefined,
      status_logic: statusSel.length > 1 && statusLogic === 'and' ? 'and' : undefined,
      query: query || undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
    }),
    [page, query, sortBy, sortOrder, statusSel, statusLogic],
  )

  const load = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response =
        tab === 'new'
          ? await supportApi.getNewTickets({
              page,
              query: query || undefined,
              sort_by: sortBy,
              sort_order: sortOrder,
            })
          : tab === 'chats'
            ? await supportApi.getMyChats(params)
            : await supportApi.getAllTickets(params)

      setData(response.data)
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Не удалось загрузить обращения.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [page, params, query, sortBy, sortOrder, statusSel, tab])

  useEffect(() => {
    const totalPages = data?.total_pages ?? 1
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [data?.total_pages, page])

  useEffect(() => {
    setPage(1)
  }, [query, statusSel, statusLogic, sortBy, sortOrder])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const response =
          tab === 'new'
            ? await supportApi.getNewTickets({
                page: 1,
                query: trimmed,
                sort_by: sortBy,
                sort_order: sortOrder,
              })
            : tab === 'chats'
              ? await supportApi.getMyChats({
                  page: 1,
                  query: trimmed,
                  status: status || undefined,
                  sort_by: sortBy,
                  sort_order: sortOrder,
                })
              : await supportApi.getAllTickets({
                  page: 1,
                  query: trimmed,
                  status: status || undefined,
                  sort_by: sortBy,
                  sort_order: sortOrder,
                })

        setSuggestions(
          (response.data.tickets ?? []).slice(0, 5).map((ticket) => ({
            value: ticket.subject,
            text: `#${ticket.id} — ${ticket.subject}`,
          })),
        )
      } catch {
        setSuggestions([])
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query, sortBy, sortOrder, status, tab])

  const handleTake = async (ticket: SupportTicket) => {
    try {
      await supportApi.takeTicket(ticket.id)
      pushToast({ title: 'Обращение взято в работу', tone: 'success' })
      await load()
    } catch (takeError) {
      setError(getErrorMessage(takeError, 'Не удалось взять обращение в работу.'))
    }
  }

  const resetFilters = () => {
    setQuery('')
    setStatusSel([])
    setSortOrder('desc')
    setSortBy(tab === 'chats' ? 'updated_at' : 'created_at')
    setSuggestions([])
    setPage(1)
  }

  const tickets = data?.tickets ?? []
  const total = data?.total ?? 0
  const sortOrderLabels = getSortOrderLabels(sortBy)
  const currentView = tab === 'new' ? 'incoming' : tab === 'chats' ? 'my' : 'all'
  const title =
    tab === 'new' ? 'Новые обращения' : tab === 'chats' ? 'Мои чаты поддержки' : 'Все обращения'
  const description =
    tab === 'new'
      ? `${total} активных обращения в общей очереди.`
      : tab === 'chats'
        ? `Закреплённые за вами обращения: ${total}.`
        : `Общий список обращений с фильтрами и единым поиском: ${total}.`

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StaffSectionHeader kind="support" currentView={currentView} title={title} description={description} />

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-3">
          <SearchAutocompleteInput
            label="Поиск"
            value={query}
            placeholder="Тема, студент или email..."
            suggestions={suggestions}
            onChange={setQuery}
            onSelectSuggestion={(item) => {
              setQuery(item.value || item.text)
              setSuggestions([])
            }}
            className="min-w-[240px] flex-1"
          />

          <div className="w-full sm:w-[170px]">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Критерий
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
            >
              {tab === 'new' ? (
                <>
                  <option value="created_at">По дате создания</option>
                  <option value="updated_at">По обновлению</option>
                  <option value="subject">По теме</option>
                </>
              ) : tab === 'chats' ? (
                <>
                  <option value="updated_at">По обновлению</option>
                  <option value="created_at">По дате создания</option>
                  <option value="subject">По теме</option>
                </>
              ) : (
                <>
                  <option value="created_at">По дате создания</option>
                  <option value="updated_at">По обновлению</option>
                  <option value="status">По статусу</option>
                  <option value="subject">По теме</option>
                </>
              )}
            </select>
          </div>

          <div className="w-full sm:w-[140px]">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Направление</label>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-600 focus:bg-surface"
            >
              <option value="desc">{sortOrderLabels.desc}</option>
              <option value="asc">{sortOrderLabels.asc}</option>
            </select>
          </div>

          {tab !== 'new' ? (
            <div className="w-full">
              <ChipMultiSelect
                label="Состояние"
                options={['open', 'in_progress', 'closed']}
                selected={statusSel}
                onToggle={toggleStatus}
                labelFor={(s) => ({ open: 'Открытые', in_progress: 'В работе', closed: 'Закрытые' })[s] ?? s}
                onReset={() => setStatusSel([])}
                logic={statusLogic}
                onLogicChange={setStatusLogic}
                andHint="у студента есть обращения во всех выбранных состояниях"
              />
            </div>
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
        <div className="py-16">
          <LoadingSpinner />
        </div>
      ) : tickets.length ? (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-bold">#</th>
                    <th className="px-5 py-3 font-bold">Тема</th>
                    <th className="px-5 py-3 font-bold">Студент</th>
                    <th className="px-5 py-3 font-bold">Статус</th>
                    {tab !== 'chats' ? <th className="px-5 py-3 font-bold">Модератор</th> : null}
                    <th className="px-5 py-3 font-bold">Сообщений</th>
                    {tab === 'all' ? <th className="px-5 py-3 font-bold">Создано</th> : null}
                    <th className="px-5 py-3 font-bold">Обновлено</th>
                    <th className="px-5 py-3 text-right font-bold">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {tickets.map((ticket, index) => (
                    <tr key={ticket.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-3 text-xs text-slate-400">{(page - 1) * MODERATION_SUPPORT_PAGE_SIZE + index + 1}</td>
                      <td className="px-5 py-3">
                        <Link
                          to={`/moderation/support/${ticket.id}?from=${tab}`}
                          className="font-medium text-slate-800 transition-colors hover:text-indigo-600"
                        >
                          {ticket.subject}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {ticket.user ? (
                          <>
                            <Link to={`/users/${ticket.user.id}`} className="transition-colors hover:text-indigo-600">
                              {ticket.user.first_name} {ticket.user.last_name}
                            </Link>
                            <div className="text-[10px] text-slate-400">{ticket.user.email}</div>
                            <div className="hidden">
                              ID: {ticket.user.id} • {ticket.user.email}
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">{ticketStatusBadge(ticket, tab)}</td>
                      {tab !== 'chats' ? (
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {ticket.moderator ? (
                            <>
                              <div className="font-medium text-slate-700">
                                {ticket.moderator.first_name} {ticket.moderator.last_name}
                              </div>
                              <div className="text-[10px] text-slate-400">{ticket.moderator.email}</div>
                            </>
                          ) : (
                            <span className="text-slate-400">{tab === 'new' ? 'Ещё не взято' : 'Свободно'}</span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-5 py-3 text-xs text-slate-500">{ticket.messages_count ?? 0}</td>
                      {tab === 'all' ? (
                        <td className="px-5 py-3 text-xs text-slate-500">{formatDate(ticket.created_at)}</td>
                      ) : null}
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {formatDate(ticket.updated_at || ticket.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {tab === 'chats' ? (
                          <Link
                            to={`/moderation/support/${ticket.id}?from=chats`}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            Открыть чат
                          </Link>
                        ) : !ticket.moderator_id ? (
                          <button
                            type="button"
                            onClick={() => void handleTake(ticket)}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            Взять в работу
                          </button>
                        ) : ticket.moderator_id === currentUser?.id ? (
                          <Link
                            to={`/moderation/support/${ticket.id}?from=chats`}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            Мой чат
                          </Link>
                        ) : (
                          <Link
                            to={`/moderation/support/${ticket.id}?from=${tab}`}
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
              totalPages={data?.total_pages ?? 1}
              onPageChange={setPage}
              pageSize={MODERATION_SUPPORT_PAGE_SIZE}
            />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center">
          {tab === 'new' ? (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
                <svg className="h-8 w-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-slate-500">
                {query ? 'Поиск не дал результатов среди новых обращений.' : 'Нет активных обращений.'}
              </p>
            </>
          ) : tab === 'chats' ? (
            <p className="text-sm text-slate-500">
              {query ? 'По текущему поиску ваши чаты не найдены.' : 'У вас пока нет закреплённых обращений.'}
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              {query ? 'По текущему поиску обращения не найдены.' : 'Обращений не найдено.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
