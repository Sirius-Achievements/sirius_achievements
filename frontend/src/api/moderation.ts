import client from './client'
import { User } from '@/types/user'
import { Achievement, ModerationAchievementsResponse } from '@/types/achievement'

export interface AchievementMetadataPayload {
  title: string
  description?: string
  category?: string
  level?: string
  result?: string
}

export interface ModerationUsersParams {
  query?: string
  sort_by?: string
}

export interface ModerationAchievementsParams {
  page?: number
  query?: string
  category?: string
  level?: string
  result?: string
  categories?: string[]
  levels?: string[]
  results?: string[]
  category_logic?: string
  level_logic?: string
  result_logic?: string
  sort_by?: string
}

export const moderationApi = {
  getUsers(params?: ModerationUsersParams) {
    return client.get<{ users: User[]; total_count: number }>('/moderation/users', { params })
  },

  approveUser(id: number) {
    return client.post<{ success: boolean; user: User }>(`/moderation/users/${id}/approve`)
  },

  rejectUser(id: number) {
    return client.post<{ success: boolean; user: User }>(`/moderation/users/${id}/reject`)
  },

  getAchievements(params?: ModerationAchievementsParams) {
    return client.get<ModerationAchievementsResponse>('/moderation/achievements', { params })
  },

  updateAchievement(id: number, status: string, rejectionReason?: string) {
    return client.post<{ success: boolean; achievement: Achievement }>(`/moderation/achievements/${id}`, {
      status,
      rejection_reason: rejectionReason,
    })
  },

  updateAchievementMetadata(id: number, payload: AchievementMetadataPayload) {
    return client.patch<{ success: boolean; achievement: Achievement }>(`/moderation/achievements/${id}/metadata`, payload)
  },

  batchUpdateAchievements(ids: number[], action: string) {
    return client.post<{ success: boolean; count: number }>('/moderation/achievements/batch', { ids, action })
  },

  takeUser(id: number) {
    return client.post<{ success: boolean; user: User }>(`/moderation/users/${id}/take`)
  },

  releaseUser(id: number) {
    return client.post<{ success: boolean; user: User }>(`/moderation/users/${id}/release`)
  },

  takeAchievement(id: number) {
    return client.post<{ success: boolean; achievement: Achievement }>(`/moderation/achievements/${id}/take`)
  },

  releaseAchievement(id: number) {
    return client.post<{ success: boolean; achievement: Achievement }>(`/moderation/achievements/${id}/release`)
  },
}
