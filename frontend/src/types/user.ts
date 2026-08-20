import { Achievement } from './achievement'
import { EducationLevel, UserRole, UserStatus } from './enums'

export interface User {
  id: number
  first_name: string
  last_name: string
  email: string
  phone_number?: string
  avatar_path?: string
  public_visibility?: Record<string, boolean>
  registration_rejection_reason?: string
  role: UserRole
  status: UserStatus
  education_level?: EducationLevel
  course?: number
  study_group?: string
  moderator_courses?: number[]
  moderator_groups?: string[]
  session_gpa?: string
  reviewed_by_id?: number
  is_active: boolean
  created_at: string
  updated_at: string
  resume_text?: string
  resume_generated_at?: string
  match_reason?: string
}

export interface UserListResponse {
  users: User[]
  page: number
  total_items: number
  total_pages: number
  roles: string[]
  statuses: string[]
  education_levels: string[]
  course_mapping?: Record<string, number>
  group_mapping?: Record<string, Record<number, string[]>>
  search_mode?: 'ai' | 'fallback'
}

export interface UserDetailResponse {
  user: User
  achievements: Achievement[]
  season_history: SeasonResult[]
  total_docs: number
  rank: number | null
  total_points: number
  gpa_bonus: number
  chart_labels: string[]
  chart_counts: number[]
  chart_points: number[]
  roles: string[]
  education_levels: string[]
  course_mapping?: Record<string, number>
  group_mapping?: Record<string, Record<number, string[]>>
  audit_log: Array<{
    id: number
    action: string
    details?: string
    created_at?: string
    actor: string
  }>
}

export interface UserNote {
  id: number
  user_id: number
  author_id: number | null
  text: string
  file_path: string | null
  has_file: boolean
  created_at: string
  author: {
    id: number
    first_name: string
    last_name: string
    email: string
    avatar_path?: string
  } | null
}

export interface SeasonResult {
  id: number
  season_name: string
  points: number
  rank: number
  created_at: string
}
