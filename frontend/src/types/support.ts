import { SupportTicketStatus } from './enums'

export interface SupportTicket {
  id: number
  user_id: number
  moderator_id?: number
  subject: string
  category?: string
  resolution?: string
  status: SupportTicketStatus
  created_at: string
  updated_at: string
  assigned_at?: string
  session_expires_at?: string
  closed_at?: string
  archived_at?: string
  messages_count?: number
  student_unread_count?: number
  moderator_unread_count?: number
  user?: {
    id: number
    first_name: string
    last_name: string
    email: string
    education_level?: string
    avatar_path?: string
  }
  moderator?: {
    id: number
    first_name: string
    last_name: string
    email: string
    avatar_path?: string
  }
  messages?: SupportMessage[]
}

export interface SupportMessage {
  id: number
  ticket_id: number
  sender_id: number
  reply_to_id?: number | null
  text?: string
  file_path?: string
  is_from_moderator: boolean
  created_at: string
  sender?: {
    id: number
    first_name: string
    last_name: string
    avatar_path?: string
  }
}

export interface SupportChatResponse {
  ticket: SupportTicket
  messages: SupportMessage[]
  can_manage_ticket?: boolean
  can_take_ticket?: boolean
  is_my_ticket?: boolean
}

export interface SupportListResponse {
  tickets: SupportTicket[]
  page?: number
  total_pages?: number
  total?: number
  view?: string
  unread_count?: number
  stats?: {
    active: number
    free: number
    mine: number
    overdue: number
  }
}
