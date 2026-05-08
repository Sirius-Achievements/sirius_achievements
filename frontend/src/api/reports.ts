import client from './client'

export interface ReportParams {
  date_from?: string
  date_to?: string
  education_level?: string
  course?: string
  group?: string
  student_id?: string
  student_ids?: string[]
  category?: string
  status?: string
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
    ;(payload as Record<string, string | string[]>)[key] = value
  })
  return payload
}

export const reportsApi = {
  exportCsv(type: string, params: ReportParams | URLSearchParams) {
    return client.post(`/reports/${type}/export`, paramsToPayload(params), { responseType: 'blob' })
  },
}
