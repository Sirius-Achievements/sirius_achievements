import client from './client'
import { SupportListResponse, SupportChatResponse, SupportTicket, SupportMessage } from '@/types/support'

export const supportApi = {
  list(view?: string) {
    return client.get<SupportListResponse>('/support', { params: { view } })
  },

  similar(query: string) {
    return client.get<{ tickets: SupportTicket[] }>('/support/similar', { params: { q: query } })
  },

  create(formData: FormData) {
    return client.post<{ ticket: SupportTicket }>('/support', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getChat(ticketId: number) {
    return client.get<SupportChatResponse>(`/support/${ticketId}`)
  },

  sendMessage(ticketId: number, formData: FormData) {
    return client.post<{ message: SupportMessage; ticket: SupportTicket }>(`/support/${ticketId}/send`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getAttachment(messageId: number) {
    return client.get(`/support/messages/${messageId}/attachment`, { responseType: 'blob' })
  },

  // Moderation support
  getNewTickets(params?: { page?: number; query?: string; sort_by?: string; sort_order?: string }) {
    return client.get<SupportListResponse>('/moderation/support', { params })
  },

  getMyChats(params?: { page?: number; status?: string; statuses?: string[]; status_logic?: string; query?: string; sort_by?: string; sort_order?: string }) {
    return client.get<SupportListResponse>('/moderation/support/chats', { params })
  },

  getAllTickets(params?: { page?: number; status?: string; statuses?: string[]; status_logic?: string; query?: string; sort_by?: string; sort_order?: string }) {
    return client.get<SupportListResponse>('/moderation/support/all', { params })
  },

  getModChat(ticketId: number) {
    return client.get<SupportChatResponse>(`/moderation/support/${ticketId}`)
  },

  takeTicket(ticketId: number) {
    return client.post<{ success: boolean; ticket: SupportTicket }>(`/moderation/support/${ticketId}/take`)
  },

  sendModMessage(ticketId: number, formData: FormData) {
    return client.post<{ message: SupportMessage; ticket: SupportTicket }>(`/moderation/support/${ticketId}/send`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  closeTicket(ticketId: number, resolution: string) {
    return client.post<{ success: boolean; ticket: SupportTicket }>(`/moderation/support/${ticketId}/close`, { resolution })
  },

  reopenTicket(ticketId: number, sessionDuration?: string) {
    return client.post<{ success: boolean; ticket: SupportTicket }>(`/moderation/support/${ticketId}/reopen`, {
      session_duration: sessionDuration,
    })
  },

  search(q: string) {
    return client.get<Array<{ value: string; text: string }>>('/moderation/support/search', { params: { q } })
  },
}
