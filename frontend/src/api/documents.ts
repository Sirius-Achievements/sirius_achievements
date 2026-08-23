import client from './client'
import { Achievement } from '@/types/achievement'

export interface DocumentsParams {
  page?: number
  query?: string
  status?: string
  category?: string
  level?: string
  result?: string
  statuses?: string[]
  categories?: string[]
  levels?: string[]
  results?: string[]
  category_logic?: string
  level_logic?: string
  result_logic?: string
  sort_by?: string
  date_from?: string
  date_to?: string
  season?: string
}

export interface DocumentsResponse {
  achievements: Achievement[]
  total: number
  page: number
  total_pages: number
  statuses: string[]
  categories: string[]
  levels: string[]
  results?: string[]
  selected_season?: string
  available_seasons?: string[]
}

export const documentsApi = {
  list(params: DocumentsParams) {
    return client.get<DocumentsResponse>('/documents', { params })
  },

  search(q: string, season = 'current') {
    return client.get<Array<{ value: string; text: string }>>('/documents/search', { params: { q, season } })
  },

  preview(id: number) {
    return client.get(`/documents/${id}/preview`, { responseType: 'blob' })
  },

  download(id: number) {
    return client.get(`/documents/${id}/download`, { responseType: 'blob' })
  },

  delete(id: number) {
    return client.delete<{ success: boolean; action?: 'archived' | 'deleted' }>(`/documents/${id}`)
  },
}
