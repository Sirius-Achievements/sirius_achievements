import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useInboxCounts } from '@/hooks/useInboxCounts'
import type { User } from '@/types/user'

interface SidebarProps {
  user: User | null
}

function useStoredSection(key: string, initialValue: boolean) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === 'true' || stored === 'false') {
        return stored === 'true'
      }
    } catch {
      return initialValue
    }

    return initialValue
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, open ? 'true' : 'false')
    } catch {
      return
    }
  }, [key, open])

  return [open, setOpen] as const
}

export function Sidebar({ user }: SidebarProps) {
  const location = useLocation()
  const inboxCounts = useInboxCounts(user)
  const isStaff = user?.role === 'MODERATOR' || user?.role === 'SUPER_ADMIN'
  const isActive = user?.status === 'active'
  const showStudentAchievements = Boolean(user && isActive && !isStaff)
  const showStudentSupport = Boolean(user && !isStaff)
  const [sidebarAllOpen, setSidebarAllOpen] = useStoredSection('sidebar_all', true)
  const [sidebarMyWorkOpen, setSidebarMyWorkOpen] = useStoredSection('sidebar_mywork', true)
  const [sidebarIncomingOpen, setSidebarIncomingOpen] = useStoredSection('sidebar_incoming', true)
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredSection('sidebar_collapsed', false)

  const isUsersPage = location.pathname === '/users' || location.pathname.startsWith('/users/')
  const isDocumentsPage = location.pathname.includes('/documents')
  const isAllSupportPage = location.pathname.includes('/moderation/support') && location.search.includes('tab=all')
  const isMyWorkPage = location.pathname.includes('/my-work')
  const isChatsPage = location.pathname.includes('/moderation/support') && location.search.includes('tab=chats')
  const isModerationUsersPage = location.pathname.includes('/moderation/users')
  const isModerationAchievementsPage = location.pathname.includes('/moderation/achievements')
  const isModerationSupportPage =
    location.pathname.includes('/moderation/support') &&
    !location.search.includes('tab=all') &&
    !location.search.includes('tab=chats')
  const isBugReportsPage = location.pathname === '/moderation/bug-reports'

  const Badge = ({ value }: { value?: number }) => value ? (
    <span className="sidebar-count-badge inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[10px] font-semibold leading-none text-white shadow-sm ring-2 ring-surface">
      {value > 99 ? '99+' : value}
    </span>
  ) : null

  return (
    <aside className={`sidebar-desktop hidden md:flex flex-col bg-surface border-r border-slate-200 z-40 ${sidebarCollapsed ? 'sidebar-desktop--collapsed' : ''}`}>
      <div className={`flex items-center h-14 border-b border-slate-100 shrink-0 ${sidebarCollapsed ? 'justify-center' : 'justify-between px-3'}`}>
        <Link to="/dashboard" className="sidebar-brand-title text-lg font-bold text-indigo-600 tracking-tight">
          Sirius.Achievements
        </Link>
        <button
          type="button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          className="sidebar-collapse-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-indigo-600"
          aria-label={sidebarCollapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню'}
          title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          <svg className={`h-4 w-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <nav className={`flex-1 space-y-1 overflow-y-auto scrollbar-hide ${sidebarCollapsed ? 'p-3' : 'p-4'}`}>
        <Link
          to="/dashboard"
          title={sidebarCollapsed ? 'Дашборд' : undefined}
          className={`sidebar-primary-link flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 ${
            location.pathname.includes('/dashboard') ? 'text-indigo-600' : 'text-slate-700'
          }`}
        >
          <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
          <span className="sidebar-label">Дашборд</span>
        </Link>

        {showStudentAchievements ? (
          <Link
            to="/achievements"
            title={sidebarCollapsed ? 'Мои достижения' : undefined}
            className={`sidebar-primary-link flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 ${
              location.pathname.includes('/achievements') && !location.pathname.includes('/moderation')
                ? 'text-indigo-600'
                : 'text-slate-700'
            }`}
          >
            <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="sidebar-label">Мои достижения</span>
          </Link>
        ) : null}

        {isActive ? (
          <Link
            to="/leaderboard"
            title={sidebarCollapsed ? 'Рейтинг' : undefined}
            className={`sidebar-primary-link flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 ${
              location.pathname.includes('/leaderboard') ? 'text-indigo-600' : 'text-slate-700'
            }`}
          >
            <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
              />
            </svg>
            <span className="sidebar-label">Рейтинг</span>
          </Link>
        ) : null}

        {showStudentSupport ? (
          <Link
            to="/support"
            title={sidebarCollapsed ? 'Поддержка' : undefined}
            className={`sidebar-primary-link flex items-center justify-between gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 ${
              location.pathname.includes('/support') && !location.pathname.includes('/moderation')
                ? 'text-indigo-600'
                : 'text-slate-700'
            }`}
          >
            <span className="flex min-w-0 items-center">
              <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <span className="sidebar-label">Поддержка</span>
            </span>
            <Badge value={inboxCounts?.support_unread} />
          </Link>
        ) : null}

        {isStaff ? (
          <>
            <div className="sidebar-admin-label mt-6 mb-2 pt-4 border-t border-slate-100">
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Админ</p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => sidebarCollapsed ? setSidebarCollapsed(false) : setSidebarAllOpen((current) => !current)}
                className="sidebar-section-button flex items-center justify-between w-full px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 text-slate-700"
                title={sidebarCollapsed ? 'Все записи' : undefined}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="sidebar-label">Все записи</span>
                </div>
                <svg
                  className={`sidebar-chevron w-4 h-4 text-slate-400 transition-transform duration-200 ${sidebarAllOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {sidebarAllOpen ? (
                <div className="sidebar-subnav pl-10 pr-2 space-y-1 mt-1">
                  <Link
                    to="/users"
                    className={`flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isUsersPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Все пользователи
                  </Link>
                  <Link
                    to="/documents"
                    className={`flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isDocumentsPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Все документы
                  </Link>
                  <Link
                    to="/moderation/support?tab=all"
                    className={`flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isAllSupportPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Все обращения
                  </Link>
                </div>
              ) : null}
            </div>

            <div>
              <button
                type="button"
                onClick={() => sidebarCollapsed ? setSidebarCollapsed(false) : setSidebarMyWorkOpen((current) => !current)}
                className="sidebar-section-button flex items-center justify-between w-full px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 text-slate-700"
                title={sidebarCollapsed ? 'Моя работа' : undefined}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                    />
                  </svg>
                  <span className="sidebar-label">Моя работа</span>
                </div>
                <svg
                  className={`sidebar-chevron w-4 h-4 text-slate-400 transition-transform duration-200 ${sidebarMyWorkOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {sidebarMyWorkOpen ? (
                <div className="sidebar-subnav pl-10 pr-2 space-y-1 mt-1">
                  <Link
                    to="/my-work?tab=users"
                    className={`flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isMyWorkPage && !location.search.includes('tab=achievements')
                        ? 'text-indigo-600 font-medium'
                        : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Мои пользователи
                  </Link>
                  <Link
                    to="/my-work?tab=achievements"
                    className={`flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isMyWorkPage && location.search.includes('tab=achievements')
                        ? 'text-indigo-600 font-medium'
                        : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Мои документы
                  </Link>
                  <Link
                    to="/moderation/support?tab=chats"
                    className={`flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isChatsPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Мои чаты
                  </Link>
                </div>
              ) : null}
            </div>

            <div>
              <button
                type="button"
                onClick={() => sidebarCollapsed ? setSidebarCollapsed(false) : setSidebarIncomingOpen((current) => !current)}
                className="sidebar-section-button flex items-center justify-between w-full px-3 py-2 text-sm font-medium rounded-md transition-colors hover:bg-slate-50 hover:text-indigo-600 text-slate-700"
                title={sidebarCollapsed ? 'Входящие' : undefined}
              >
                <div className="flex items-center">
                  <svg className="sidebar-primary-icon w-5 h-5 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                    />
                  </svg>
                  <span className="sidebar-label">Входящие</span>
                </div>
                <svg
                  className={`sidebar-chevron w-4 h-4 text-slate-400 transition-transform duration-200 ${sidebarIncomingOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {sidebarIncomingOpen ? (
                <div className="sidebar-subnav pl-10 pr-2 space-y-1 mt-1">
                  <Link
                    to="/moderation/users"
                    className={`flex items-center justify-between gap-3 px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isModerationUsersPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Новые пользователи
                    <Badge value={inboxCounts?.pending_users} />
                  </Link>
                  <Link
                    to="/moderation/achievements"
                    className={`flex items-center justify-between gap-3 px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isModerationAchievementsPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Новые документы
                    <Badge value={inboxCounts?.pending_achievements} />
                  </Link>
                  <Link
                    to="/moderation/support"
                    className={`flex items-center justify-between gap-3 px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isModerationSupportPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                  >
                    Новые обращения
                    <Badge value={inboxCounts?.new_support} />
                  </Link>
                  {user?.role === 'SUPER_ADMIN' ? (
                    <Link
                      to="/moderation/bug-reports"
                      className={`flex items-center justify-between gap-3 px-2 py-1.5 text-sm rounded-md transition-colors ${
                        isBugReportsPage ? 'text-indigo-600 font-medium' : 'text-slate-500 hover:text-indigo-600'
                      }`}
                    >
                      Баг-репорты
                      <Badge value={inboxCounts?.bug_reports} />
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </nav>
    </aside>
  )
}
