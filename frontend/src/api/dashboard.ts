import client from './client'

export interface DashboardStats {
  deleted_account?: boolean
  pending_review?: boolean
  date_from?: string
  date_to?: string
  new_users_count?: number
  pending_achievements?: number
  approved_achievements?: number
  total_achievements?: number
  top_students?: Array<{
    id: number
    first_name: string
    last_name: string
    education_level?: string | null
    course?: number | null
    study_group?: string | null
    points: number
  }>
  recent_achievements?: Array<{
    id: number
    title: string
    status: string
    created_at: string
    category?: string
    user?: { first_name: string; last_name: string }
  }>
  chart_data?: { labels: string[]; counts: number[]; points?: number[]; dates?: string[] }
  cohorts?: Array<{
    education_level: string
    kind?: 'course' | 'group'
    parent_course?: number | null
    count: number
    total?: number
    pending?: number
    approved?: number
  }>
  my_points?: number
  gpa_bonus?: number
  my_docs?: number
  my_rank?: number
  next_rank?: number
  points_to_next_rank?: number
  profile_completion?: number
  my_recent_docs?: Array<{
    id: number
    title: string
    status: string
    created_at: string
    category?: string
    points?: number
  }>
  category_breakdown?: Array<{ category: string; points: number }>
  category_activity?: Array<{ category: string; count: number; points: number }>
  rejected_achievements?: number
  revision_achievements?: number
  staff_queue?: { free: number; mine: number; overdue: number }
  trend?: { new_users: number; documents: number; approved: number } | null
  users_stats?: {
    total: number
    active: number
    pending: number
    deleted: number
    rejected: number
    students: number
    moderators: number
  }
  documents_stats?: {
    total: number
    pending: number
    approved: number
    rejected: number
    revision: number
    with_file: number
    with_link: number
  }
  support_stats?: {
    total: number
    open: number
    in_progress: number
    closed: number
  }
  recommendations?: Array<{ title: string; message: string; action_label?: string; action_url?: string }>
}

export interface InboxCounts {
  pending_users?: number
  pending_achievements?: number
  new_support?: number
  bug_reports?: number
  support_unread?: number
  total: number
  generated_at?: string
}

export interface InboxCountsParams {
  users_seen_at?: string
  achievements_seen_at?: string
  support_seen_at?: string
}

export const dashboardApi = {
  getStats(period?: string, dateFrom?: string, dateTo?: string) {
    return client.get<DashboardStats>('/dashboard', { params: { period, date_from: dateFrom || undefined, date_to: dateTo || undefined } })
  },

  getInboxCounts(params?: InboxCountsParams) {
    return client.get<InboxCounts>('/dashboard/inbox-counts', { params })
  },
}
