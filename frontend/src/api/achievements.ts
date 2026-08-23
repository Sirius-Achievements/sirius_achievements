import client from './client'
import { Achievement, AchievementListResponse } from '@/types/achievement'

export interface AchievementsParams {
  page?: number
  query?: string
  status?: string
  category?: string
  level?: string
  result?: string
  sort_by?: string
  season?: string
}

export const achievementsApi = {
  list(params: AchievementsParams) {
    return client.get<AchievementListResponse>('/achievements', { params })
  },

  create(formData: FormData) {
    return client.post<{ achievement: Achievement }>('/achievements', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  revise(id: number, formData: FormData) {
    return client.put<{ achievement: Achievement }>(`/achievements/${id}/revise`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  delete(id: number) {
    return client.delete<{ success: boolean; action?: 'archived' | 'deleted' }>(`/achievements/${id}`)
  },

  search(q: string, season = 'current') {
    return client.get<Array<{ value: string; text: string }>>('/achievements/search', { params: { q, season } })
  },
}
