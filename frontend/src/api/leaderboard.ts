import client from './client'
import { User } from '@/types/user'

export interface LeaderboardRow {
  rank: number
  user: User
  total_points: number
  achievements_count: number
  is_me: boolean
  points_breakdown: Array<{ label: string; points: number }>
  previous_rank?: number | null
  previous_season?: string | null
}

export interface CompletedSeason {
  name: string
  created_at?: string | null
  participants: number
}

export interface CompletedSeasonRow {
  rank: number
  user: User
  total_points: number
  is_me: boolean
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardRow[]
  my_rank: number
  my_points: number
  current_education_level: string
  current_course: number
  current_category: string
  current_categories?: string[]
  current_category_logic?: 'or' | 'and'
  current_group: string
  ranking_scope: 'current' | 'global' | string
  categories: string[]
  education_levels: string[]
  course_mapping: Record<string, number>
  group_mapping: Record<string, string[]>
  course_group_mapping?: Record<string, Record<number, string[]>>
  can_export: boolean
  can_end_season: boolean
  export_url: string
}

export interface LeaderboardParams {
  education_level?: string
  course?: number | string
  category?: string
  categories?: string[]
  category_logic?: string
  group?: string
  scope?: string
  season?: string
}

export const leaderboardApi = {
  get(params: LeaderboardParams) {
    return client.get<LeaderboardResponse>('/leaderboard', { params })
  },

  exportCsv(params: LeaderboardParams) {
    return client.get('/leaderboard/export', { params, responseType: 'blob' })
  },

  getSeasons(params: LeaderboardParams) {
    return client.get<{ seasons: CompletedSeason[] }>('/leaderboard/seasons', { params })
  },

  getSeason(seasonName: string, params: LeaderboardParams) {
    return client.get<{ season_name: string; leaderboard: CompletedSeasonRow[] }>(`/leaderboard/seasons/${encodeURIComponent(seasonName)}`, { params })
  },

  endSeason(seasonName: string) {
    const formData = new FormData()
    formData.append('season_name', seasonName)
    return client.post<{ success: boolean }>('/leaderboard/end-season', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}
