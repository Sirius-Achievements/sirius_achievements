import client from '@/api/client'

export type BugReportPayload = {
  description?: string
  page_url: string
  session_id?: string
  app_version?: string
}

export type BugReport = {
  id: number
  description?: string | null
  page_url: string
  session_id?: string | null
  app_version?: string | null
  user_agent?: string | null
  created_at: string
  user?: { id: number; first_name: string; last_name: string; email: string } | null
}

export type BugReportListResponse = {
  reports: BugReport[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export const bugReportsApi = {
  create(payload: BugReportPayload) {
    return client.post('/bug-reports', payload)
  },

  list(params?: { page?: number; page_size?: number; query?: string }) {
    return client.get<BugReportListResponse>('/bug-reports', { params })
  },
}
