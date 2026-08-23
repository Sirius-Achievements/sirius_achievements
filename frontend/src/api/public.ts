import client from './client'
import { Achievement } from '@/types/achievement'
import { SeasonResult } from '@/types/user'

export interface PublicStudentAchievement extends Achievement {
  preview_url: string | null
}

export interface PublicStudent {
  id: number
  first_name: string
  last_name: string
  avatar_path?: string
  education_level?: string
  course?: number
  study_group?: string
  session_gpa?: string
  resume_text?: string
}

export interface PublicStudentResponse {
  student: PublicStudent
  achievements: PublicStudentAchievement[]
  total_points: number | null
  total_docs: number | null
  rank: number | null
  global_total?: number
  group_rank?: number | null
  group_total?: number
  group_name?: string | null
  gpa_bonus: number
  season_history: SeasonResult[]
  chart_labels: string[]
  chart_points: number[]
  chart_uploads: number[]
  chart_cumulative: number[]
  has_chart_data: boolean
  category_breakdown: Array<{
    category: string
    count: number
    points: number
  }>
  selected_season: string
  available_seasons: string[]
  public_url: string
  public_visibility?: Record<string, boolean>
}

export const publicApi = {
  getStudent(studentId: number, season = 'current') {
    return client.get<PublicStudentResponse>(`/public/students/${studentId}`, { params: { season } })
  },
}
