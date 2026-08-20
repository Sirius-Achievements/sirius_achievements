import client from './client'
import { User } from '@/types/user'

export interface LoginResponse {
  access_token: string
  refresh_token: string
  user: User
}

export interface RegisterData {
  first_name: string
  last_name: string
  email: string
  education_level: string
  course: number
  group: string
  password: string
  password_confirm: string
}

export interface FlowResponse {
  flow_token?: string
  verified_token?: string
  retry_after?: number
  message?: string
  verified?: boolean
  success?: boolean
  user?: User
  access_token?: string
  refresh_token?: string
}

export const authApi = {
  login(email: string, password: string) {
    return client.post<LoginResponse>('/auth/login', { email, password })
  },

  register(data: RegisterData) {
    return client.post<FlowResponse>('/auth/register', data)
  },

  refresh(refreshToken: string) {
    return client.post<{ access_token: string; refresh_token?: string }>('/auth/refresh', {
      refresh_token: refreshToken,
    })
  },

  forgotPassword(email: string) {
    return client.post<FlowResponse>('/auth/forgot-password', { email })
  },

  verifyCode(flowToken: string, code: string) {
    return client.post<FlowResponse>('/auth/verify-code', { flow_token: flowToken, code })
  },

  resetPassword(flowToken: string, password: string, passwordConfirm: string) {
    return client.post('/auth/reset-password', {
      flow_token: flowToken,
      password,
      password_confirm: passwordConfirm,
    })
  },

  resendCode(flowToken: string) {
    return client.post<FlowResponse>('/auth/resend-code', { flow_token: flowToken })
  },

  verifyEmail(flowToken: string, code: string) {
    return client.post<LoginResponse>('/auth/verify-email', { flow_token: flowToken, code })
  },

  resendVerifyEmail(flowToken: string) {
    return client.post<FlowResponse>('/auth/resend-verify-email', { flow_token: flowToken })
  },

  restartVerifyEmail(email: string) {
    return client.post<FlowResponse>('/auth/restart-verify-email', { email })
  },

  me() {
    return client.get<{ user: User }>('/auth/me')
  },

  session() {
    return client.post<LoginResponse>('/auth/session')
  },

  logout() {
    return client.post<{ success: boolean }>('/auth/logout')
  },
}
