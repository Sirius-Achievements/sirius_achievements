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
}

export const documentsApi = {
  list(params: DocumentsParams) {
    return client.get<DocumentsResponse>('/documents', { params })
  },

  search(q: string) {
    return client.get<Array<{ value: string; text: string }>>('/documents/search', { params: { q } })
  },

  preview(id: number) {
    return client.get(`/documents/${id}/preview`, { responseType: 'blob' })
  },

  download(id: number) {
    return client.get(`/documents/${id}/download`, { responseType: 'blob' })
  },

  delete(id: number) {
    return client.delete<{ success: boolean }>(`/documents/${id}`)
  },
}
