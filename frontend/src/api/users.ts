import client from './client'
import { User, UserListResponse, UserDetailResponse, UserNote } from '@/types/user'
import type { SearchSuggestionItem } from '@/components/staff/SearchAutocompleteInput'

export interface UsersParams {
  page?: number
  query?: string
  role?: string
  status?: string
  education_level?: string
  course?: string
  sort_by?: string
}

export const usersApi = {
  list(params: UsersParams) {
    return client.get<UserListResponse>('/users', { params })
  },

  get(id: number) {
    return client.get<UserDetailResponse>(`/users/${id}`)
  },

  search(q: string, limit = 50) {
    return client.get<SearchSuggestionItem[]>('/users/search', { params: { q, limit } })
  },

  updateRole(id: number, role: string, educationLevel?: string, moderatorCourses?: number[], moderatorGroups?: string[]) {
    return client.post<{ success: boolean; user: User }>(`/users/${id}/role`, {
      role,
      education_level: educationLevel,
      moderator_courses: moderatorCourses,
      moderator_groups: moderatorGroups,
    })
  },

  delete(id: number) {
    return client.delete<{ success: boolean; user: User }>(`/users/${id}`)
  },

  restore(id: number) {
    return client.post<{ success: boolean; user: User }>(`/users/${id}/restore`)
  },

  generateResume(id: number) {
    return client.post<{ resume?: string; can_generate: boolean; reason?: string; user?: User }>(
      `/users/${id}/generate-resume`
    )
  },

  checkResume(id: number) {
    return client.get<{ resume?: string; can_generate: boolean; reason?: string }>(`/users/${id}/generate-resume`)
  },

  exportPdf(id: number) {
    return client.get(`/users/${id}/export-pdf`, { responseType: 'blob' })
  },

  setGpa(id: number, gpa: string) {
    return client.post<{ success: boolean; gpa: string; bonus: number; user: User }>(`/users/${id}/set-gpa`, { gpa })
  },

  sendSupportMessage(id: number, formData: FormData) {
    return client.post<{ success: boolean; ticket_id: number }>(`/users/${id}/support-message`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  listNotes(userId: number) {
    return client.get<{ notes: UserNote[] }>(`/users/${userId}/notes`)
  },

  createNote(userId: number, text: string, file?: File) {
    const form = new FormData()
    form.append('text', text)
    if (file) form.append('file', file)
    return client.post<{ note: UserNote }>(`/users/${userId}/notes`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  deleteNote(userId: number, noteId: number) {
    return client.delete<{ success: boolean }>(`/users/${userId}/notes/${noteId}`)
  },

  getNoteFileUrl(userId: number, noteId: number) {
    return `/api/v1/users/${userId}/notes/${noteId}/file`
  },

  getNoteFile(userId: number, noteId: number) {
    return client.get(`/users/${userId}/notes/${noteId}/file`, { responseType: 'blob' })
  },
}
