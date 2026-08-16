import client from '@/api/client'

export type BugReportPayload = {
  description?: string
  page_url: string
  session_id?: string
  app_version?: string
}

export const bugReportsApi = {
  create(payload: BugReportPayload) {
    return client.post('/bug-reports', payload)
  },
}
