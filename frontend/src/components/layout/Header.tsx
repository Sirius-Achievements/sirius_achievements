import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/hooks/useNotifications'
import type { User } from '@/types/user'
import { formatDateTime } from '@/utils/formatDate'
import { buildMediaUrlOrNull } from '@/utils/media'

interface HeaderProps {
  user: User | null
}

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { unreadCount, notifications, markAllRead } = useNotifications()
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const notificationRef = useRef<HTMLDivElement | null>(null)
  const profileRef = useRef<HTMLDivElement | null>(null)

  const avatarUrl = buildMediaUrlOrNull(user?.avatar_path, user?.updated_at)
  const fullName = user ? `${user.first_name} ${user.last_name}`.trim() : 'User'
  const avatarFallback = fullName.charAt(0).toUpperCase() || 'U'
  const isDeleted = user?.status === 'deleted'

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node

      if (notificationRef.current && !notificationRef.current.contains(target)) {
        setNotificationOpen(false)
      }

      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  const handleToggleNotifications = async () => {
    const nextState = !notificationOpen
    setNotificationOpen(nextState)
    setProfileOpen(false)

    if (nextState && unreadCount > 0) {
      await markAllRead()
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <header className="h-14 bg-surface border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 z-20 shrink-0">
      <div className="md:hidden text-lg font-bold text-indigo-600">Sirius.Achievements</div>
      <div className="hidden md:block flex-1" />

      <div className="flex items-center space-x-3">
        <ThemeToggle />

        <div className="relative" ref={notificationRef}>
          <button
            type="button"
            onClick={() => void handleToggleNotifications()}
            className="relative p-2 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            {unreadCount > 0 ? (
              <span className="notification-indicator absolute top-1.5 right-1.5 h-3 w-3 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                {unreadCount}
              </span>
            ) : null}
          </button>

          {notificationOpen ? (
            <div className="absolute right-0 mt-2 w-72 max-w-[90vw] bg-surface rounded-lg shadow-lg border border-slate-200 z-50 overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-500 uppercase">Уведомления</h3>
              </div>
              <div className="max-h-60 overflow-y-auto scrollbar-hide">
                {notifications.length ? (
                  notifications.map((item) => (
                    <div key={item.id} className="block px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">{item.title}</p>
                          <p className="text-xs text-slate-500 mt-1">{item.message}</p>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">{formatDateTime(item.created_at)}</span>
                      </div>
                      {item.link ? (
                        <div className="mt-3 flex justify-end">
                          <a
                            href={item.link}
                            className="inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                          >
                            Перейти
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-sm text-slate-400">Нет новых</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative" ref={profileRef}>
          <button type="button" onClick={() => setProfileOpen((current) => !current)} className="flex items-center focus:outline-none">
            {avatarUrl ? (
              <img className="h-8 w-8 rounded-full object-cover border border-slate-200" src={avatarUrl} alt="Avatar" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-medium text-sm">
                {avatarFallback}
              </div>
            )}
          </button>

          {profileOpen ? (
            <div className="absolute right-0 mt-2 w-48 bg-surface rounded-lg shadow-lg border border-slate-200 py-1 z-50">
              <div className="px-4 py-2 border-b border-slate-100 md:hidden">
                <span className="block text-sm font-medium text-slate-700 truncate">{fullName}</span>
              </div>
              {!isDeleted ? (
                <Link to="/profile" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Профиль
                </Link>
              ) : null}
              <button type="button" onClick={() => void handleLogout()} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                Выйти
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
