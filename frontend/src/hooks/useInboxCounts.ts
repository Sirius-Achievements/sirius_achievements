import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { dashboardApi, type InboxCounts } from '@/api/dashboard'
import type { User } from '@/types/user'

const VIEWED_COUNT_KEYS = {
  users: 'inbox_viewed_count_users',
  achievements: 'inbox_viewed_count_achievements',
  support: 'inbox_viewed_count_support',
  bug_reports: 'inbox_viewed_count_bug_reports',
  support_unread: 'inbox_viewed_count_support_unread',
} as const

function readViewed(key: keyof typeof VIEWED_COUNT_KEYS): number {
  try {
    const raw = localStorage.getItem(VIEWED_COUNT_KEYS[key])
    if (!raw) return 0
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

function writeViewed(key: keyof typeof VIEWED_COUNT_KEYS, value: number) {
  try {
    localStorage.setItem(VIEWED_COUNT_KEYS[key], String(Math.max(0, Math.floor(value))))
  } catch {
    // no-op
  }
}

function adjust(rawCount: number | undefined, viewed: number): number {
  return Math.max(0, Number(rawCount ?? 0) - viewed)
}

function applyClientFilter(counts: InboxCounts, pathname: string, isStaff: boolean, isSuperAdmin: boolean): InboxCounts {
  if (!isStaff) {
    const viewed = readViewed('support_unread')
    const supportUnread = adjust(counts.support_unread, viewed)
    return { ...counts, support_unread: supportUnread, total: supportUnread }
  }

  const pendingUsers = adjust(counts.pending_users, readViewed('users'))
  const pendingAchievements = adjust(counts.pending_achievements, readViewed('achievements'))
  const newSupport = adjust(counts.new_support, readViewed('support'))
  const bugReports = isSuperAdmin ? adjust(counts.bug_reports, readViewed('bug_reports')) : 0
  const next = {
    ...counts,
    pending_users: pendingUsers,
    pending_achievements: pendingAchievements,
    new_support: newSupport,
    bug_reports: bugReports,
    total: pendingUsers + pendingAchievements + newSupport + bugReports,
  }

  if (pathname === '/moderation/users') next.pending_users = 0
  if (pathname === '/moderation/achievements') next.pending_achievements = 0
  if (pathname.startsWith('/moderation/support')) next.new_support = 0
  if (pathname === '/moderation/bug-reports') next.bug_reports = 0
  next.total = next.pending_users + next.pending_achievements + next.new_support + (next.bug_reports ?? 0)
  return next
}

function commitVisit(rawCounts: InboxCounts, pathname: string, isStaff: boolean, isSuperAdmin: boolean) {
  if (isStaff) {
    if (pathname === '/moderation/users') {
      writeViewed('users', Number(rawCounts.pending_users ?? 0))
    }
    if (pathname === '/moderation/achievements') {
      writeViewed('achievements', Number(rawCounts.pending_achievements ?? 0))
    }
    if (pathname.startsWith('/moderation/support')) {
      writeViewed('support', Number(rawCounts.new_support ?? 0))
    }
    if (pathname === '/moderation/bug-reports' && isSuperAdmin) {
      writeViewed('bug_reports', Number(rawCounts.bug_reports ?? 0))
    }
    return
  }
  if (pathname.startsWith('/support')) {
    writeViewed('support_unread', Number(rawCounts.support_unread ?? 0))
  }
}

export function useInboxCounts(user: User | null) {
  const location = useLocation()
  const [counts, setCounts] = useState<InboxCounts | null>(null)
  const isStaff = user?.role === 'MODERATOR' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  useEffect(() => {
    if (!user || user.status === 'deleted') {
      setCounts(null)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const response = await dashboardApi.getInboxCounts()
        if (cancelled) return
        commitVisit(response.data, location.pathname, isStaff, isSuperAdmin)
        setCounts(applyClientFilter(response.data, location.pathname, isStaff, isSuperAdmin))
      } catch {
        if (!cancelled) setCounts(null)
      }
    }

    void load()
    const timerId = window.setInterval(load, 30000)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [location.pathname, location.search, user?.id, user?.role, user?.status, isStaff, isSuperAdmin])

  return counts
}
