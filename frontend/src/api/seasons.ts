import client from './client'

export interface Season {
  id: number
  name: string
  slug: string
  status: 'draft' | 'scheduled' | 'active' | 'moderation' | 'published' | 'archived'
  start_at: string
  submissions_open_at: string
  submissions_close_at?: string | null
  moderation_close_at?: string | null
  results_published_at?: string | null
  finalized_at?: string | null
  archived_at?: string | null
  scoring_rules_version: string
  documents?: number
  participants?: number
  approved?: number
  pending?: number
}

export interface SeasonComparison extends Season {
  approval_rate: number
  points: number
}

export interface SeasonCreatePayload {
  name: string
  start_at: string
  submissions_open_at: string
  submissions_close_at: string
  moderation_close_at: string
  scoring_rules_version: string
}

export interface SeasonSubmissionException {
  id: number
  season_id: number
  user_id: number
  user_name: string
  user_email: string
  expires_at: string
  reason: string
  active: boolean
}

export interface SystemHealth {
  checked_at: string
  services: Record<string, { status: 'ok' | 'auth' | 'down'; http_status?: number | null }>
  diagnostics: {
    open_bug_reports: number
    reports_with_session: number
  }
}

export const seasonsApi = {
  list() {
    return client.get<{ live_season_id: number | null; seasons: Season[] }>('/seasons')
  },
  current() {
    return client.get<{ season: Season | null; can_submit: boolean; message?: string | null }>('/seasons/current')
  },
  comparison() {
    return client.get<{ seasons: SeasonComparison[] }>('/seasons/comparison')
  },
  systemHealth() {
    return client.get<SystemHealth>('/seasons/system-health')
  },
  create(payload: SeasonCreatePayload) {
    return client.post<{ season: Season }>('/seasons', payload)
  },
  update(id: number, payload: SeasonCreatePayload) {
    return client.patch<{ season: Season }>(`/seasons/${id}`, payload)
  },
  activate(id: number) {
    return client.post<{ season: Season }>(`/seasons/${id}/activate`)
  },
  closeSubmissions(id: number) {
    return client.post<{ season: Season }>(`/seasons/${id}/close-submissions`)
  },
  finalize(id: number) {
    return client.post<{ season: Season; participants: number; not_counted: number }>(`/seasons/${id}/finalize`)
  },
  archive(id: number) {
    return client.post<{ season: Season }>(`/seasons/${id}/archive`)
  },
  listExceptions(id: number) {
    return client.get<{ exceptions: SeasonSubmissionException[] }>(`/seasons/${id}/exceptions`)
  },
  grantException(id: number, payload: { user_id: number; expires_at: string; reason: string }) {
    return client.post<{ exception: SeasonSubmissionException }>(`/seasons/${id}/exceptions`, payload)
  },
  revokeException(seasonId: number, exceptionId: number) {
    return client.delete<{ success: boolean }>(`/seasons/${seasonId}/exceptions/${exceptionId}`)
  },
}
