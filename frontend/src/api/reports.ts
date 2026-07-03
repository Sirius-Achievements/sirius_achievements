import client from './client'

export interface ReportParams {
  period?: string
  date_from?: string
  date_to?: string
  education_level?: string
  course?: string
  group?: string
  student_id?: string
  student_ids?: string[]
  category?: string
  categories?: string[]
  status?: string
}

export interface ScopeStudent {
  id: number
  first_name: string
  last_name: string
  course: number | null
  study_group: string | null
  education_level: string | null
}

function paramsToPayload(params: ReportParams | URLSearchParams) {
  if (!(params instanceof URLSearchParams)) {
    return params
  }

  const payload: ReportParams = {}
  params.forEach((value, key) => {
    if (key === 'student_ids') {
      payload.student_ids = [...(payload.student_ids ?? []), value]
      return
    }
    if (key === 'categories') {
      payload.categories = [...(payload.categories ?? []), value]
      return
    }
    ;(payload as Record<string, string | string[]>)[key] = value
  })
  return payload
}

export const reportsApi = {
  exportCsv(type: string, params: ReportParams | URLSearchParams) {
    return client.post(`/reports/${type}/export`, paramsToPayload(params), { responseType: 'blob' })
  },

  scopeStudents(params: { education_level?: string; course?: string; group?: string }) {
    return client.get<{ students: ScopeStudent[] }>('/reports/meta/students', { params })
  },
}
