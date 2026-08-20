import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useInboxCounts } from '@/hooks/useInboxCounts'
import type { User } from '@/types/user'

interface MobileNavProps {
  user: User | null
}

export function MobileNav({ user }: MobileNavProps) {
  const location = useLocation()
  const inboxCounts = useInboxCounts(user)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isStaff = user?.role === 'MODERATOR' || user?.role === 'SUPER_ADMIN'
  const isActive = user?.status === 'active'
  const isDeleted = user?.status === 'deleted'
  const showStudentAchievements = Boolean(user && isActive && !isStaff)
  const showStudentSupport = Boolean(user && !isStaff)

  const Badge = ({ value }: { value?: number }) => value ? (
    <span className="absolute right-3 top-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[9px] font-semibold leading-none text-white shadow-sm ring-2 ring-surface">
      {value > 99 ? '99+' : value}
    </span>
  ) : null

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname, location.search])

  return (
    <>
      <nav className="md:hidden fixed bottom-0 w-full bg-surface border-t border-slate-200 z-50 flex justify-around items-center h-[64px] px-2 pb-safe">
        <Link
          to="/dashboard"
          className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
            location.pathname.includes('/dashboard') ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
          <span className="text-[10px] font-medium">Главная</span>
        </Link>

        {showStudentAchievements ? (
          <Link
            to="/achievements"
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              location.pathname.includes('/achievements') && !location.pathname.includes('/moderation')
                ? 'text-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-[10px] font-medium">Мои док.</span>
          </Link>
        ) : null}

        {isActive ? (
          <Link
            to="/leaderboard"
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              location.pathname.includes('/leaderboard') ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-[10px] font-medium">Рейтинг</span>
          </Link>
        ) : null}

        {showStudentSupport ? (
          <Link
            to="/support"
            className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 ${
              location.pathname.includes('/support') && !location.pathname.includes('/moderation')
                ? 'text-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Badge value={inboxCounts?.support_unread} />
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <span className="text-[10px] font-medium">Поддержка</span>
          </Link>
        ) : null}

        {!isDeleted ? (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="relative flex flex-col items-center justify-center w-full h-full space-y-1 text-slate-400 hover:text-slate-600 focus:outline-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="text-[10px] font-medium">Ещё</span>
          </button>
        ) : null}
      </nav>

      {mobileMenuOpen && !isDeleted ? (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: 'var(--color-overlay)' }}
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute bottom-0 w-full bg-surface rounded-t-2xl px-4 py-6 max-h-[80vh] overflow-y-auto scrollbar-hide pb-10">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-slate-800 text-lg">Меню</h3>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400 p-2 bg-slate-50 rounded-full">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-1">
              {isStaff ? (
                <>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2 pl-2">Администрирование</p>
                  <Link to="/users" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Все пользователи
                  </Link>
                  <Link to="/documents" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Все документы
                  </Link>
                  <Link to="/moderation/support?tab=all" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Все обращения
                  </Link>

                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2 pl-2">Моя работа</p>
                  <Link to="/my-work?tab=users" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Мои пользователи
                  </Link>
                  <Link to="/my-work?tab=achievements" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Мои документы
                  </Link>
                  <Link to="/moderation/support?tab=chats" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Мои чаты
                  </Link>

                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2 pl-2">Входящие</p>
                  <Link to="/moderation/users" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Новые пользователи {inboxCounts?.pending_users ? `(${inboxCounts.pending_users})` : ''}
                  </Link>
                  <Link to="/moderation/achievements" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Новые документы {inboxCounts?.pending_achievements ? `(${inboxCounts.pending_achievements})` : ''}
                  </Link>
                  <Link to="/moderation/support" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Новые обращения {inboxCounts?.new_support ? `(${inboxCounts.new_support})` : ''}
                  </Link>
                  {user?.role === 'SUPER_ADMIN' ? (
                    <Link to="/moderation/bug-reports" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                      Баг-репорты {inboxCounts?.bug_reports ? `(${inboxCounts.bug_reports})` : ''}
                    </Link>
                  ) : null}
                </>
              ) : null}

              {!isDeleted ? (
                <>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2 pl-2">Аккаунт</p>
                  <Link to="/profile" className="block py-3 px-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700">
                    Настройки профиля
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
