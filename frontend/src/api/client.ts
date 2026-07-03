import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { API_BASE, APP_PREFIX, STORAGE_KEYS } from '@/utils/constants'
import { emitServerError } from '@/utils/serverErrorBus'

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  // Serialize array query params as repeated keys (statuses=a&statuses=b) to
  // match FastAPI's list[str] = Query(...), not the bracketed a[]=... default.
  paramsSerializer: { indexes: null },
})

function getCookieValue(name: string): string | null {
  const cookies = document.cookie ? document.cookie.split('; ') : []
  for (const cookie of cookies) {
    const [cookieName, ...rest] = cookie.split('=')
    if (cookieName === name) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token!)
  })
  failedQueue = []
}

client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN)
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`
  }

  const csrfToken = getCookieValue('XSRF-TOKEN')
  const method = (config.method ?? 'get').toLowerCase()
  if (csrfToken && config.headers && (method !== 'get' && method !== 'head' && method !== 'options' || config.url?.includes('/auth/session'))) {
    config.headers['X-CSRF-Token'] = csrfToken
  }

  if (typeof FormData !== 'undefined' && config.data instanceof FormData && config.headers) {
    if (typeof config.headers.delete === 'function') {
      config.headers.delete('Content-Type')
    } else {
      delete config.headers['Content-Type']
    }
  }

  return config
})

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const requestUrl = originalRequest?.url ?? ''
    const isAuthRoute = requestUrl.includes('/auth/')

    if (error.response?.status === 401 && !originalRequest?._retry && !isAuthRoute) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers = originalRequest.headers ?? {}
              originalRequest.headers.Authorization = `Bearer ${token}`
              resolve(client(originalRequest))
            },
            reject,
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
        if (!refreshToken) throw new Error('No refresh token')

        const { data } = await axios.post(`${API_BASE}/auth/refresh`, {
          refresh_token: refreshToken,
        })

        const newAccessToken = data.access_token
        localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, newAccessToken)
        if (data.refresh_token) {
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token)
        }

        processQueue(null, newAccessToken)
        originalRequest.headers = originalRequest.headers ?? {}
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        return client(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN)
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
        window.location.href = `${APP_PREFIX}/login`
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    const status = error.response?.status
    const isNetworkFailure = !error.response && error.code !== 'ERR_CANCELED'
    if ((status !== undefined && status >= 500) || isNetworkFailure) {
      emitServerError({ status: status ?? 0, url: requestUrl })
    }

    return Promise.reject(error)
  }
)

export default client
