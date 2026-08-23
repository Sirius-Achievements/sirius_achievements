import {
  AchievementStatus,
  AchievementCategory,
  AchievementLevel,
  AchievementResult,
} from './enums'

export interface Achievement {
  id: number
  user_id: number
  title: string
  description?: string
  file_path?: string | null
  external_url?: string | null
  category: AchievementCategory
  level: AchievementLevel
  result?: AchievementResult
  points: number
  status: AchievementStatus
  rejection_reason?: string
  archived_season?: string | null
  archived_from_status?: string | null
  moderator_id?: number
  created_at: string
  updated_at: string
  user?: {
    id: number
    first_name: string
    last_name: string
    email: string
    education_level?: string
  }
  projected_points?: number
}

export interface AchievementListResponse {
  achievements: Achievement[]
  page: number
  total_pages: number
  selected_season?: string
  available_seasons?: string[]
}

export interface ModerationAchievementsResponse {
  achievements: Achievement[]
  stats: {
    total_pending: number
  }
  page: number
  total_pages: number
}
