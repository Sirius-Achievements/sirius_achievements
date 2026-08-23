import client from './client'
import { SeasonResult, User } from '@/types/user'

export interface ProfileResponse {
  user: User
  can_generate: boolean
  generate_reason?: string
  chart_labels: string[]
  chart_points: number[]
  chart_uploads: number[]
  chart_cumulative: number[]
  has_chart_data: boolean
  my_docs: Array<{ id: number; title: string; status: string; created_at: string; category: string; level: string; points: number; file_path?: string; result?: string }>
  analytics_docs: Array<{ id: number; title: string; status: string; created_at: string; category: string; level: string; points: number; file_path?: string; result?: string; archived_season?: string | null }>
  gpa_bonus: number
  profile_completion: number
  public_visibility: Record<string, boolean>
  season_history: SeasonResult[]
  resume_versions: Array<{ id: number; text: string; source_documents_count: number; created_at?: string | null }>
  selected_season: string
  available_seasons: string[]
}

export const profileApi = {
  get(season = 'current') {
    return client.get<ProfileResponse>('/profile/', { params: { season } })
  },

  update(formData: FormData) {
    return client.put<{ success: boolean; user: User }>('/profile/', formData)
  },

  sendPasswordCode() {
    return client.post<{ success: boolean; message: string; retry_after: number; flow_id: string }>('/profile/password/send-code')
  },

  verifyPasswordCode(flowId: string, code: string) {
    return client.post<{ verified: boolean; flow_id: string }>('/profile/password/verify', { flow_id: flowId, code })
  },

  resetPassword(flowId: string, newPassword: string, confirmPassword: string) {
    return client.post<{ success: boolean }>('/profile/password/reset', {
      flow_id: flowId,
      new_password: newPassword,
      confirm_password: confirmPassword,
    })
  },

  resendPasswordCode(flowId: string) {
    return client.post<{ success: boolean; message: string; retry_after: number; flow_id: string }>('/profile/password/resend', { flow_id: flowId })
  },
}
