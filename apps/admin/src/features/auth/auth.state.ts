import type { AuthUser, ChangePasswordRequest, LoginRequest } from '@agent/contracts'
import { readonly, ref } from 'vue'

import { AdminRunApiError } from '../shared/admin-api'
import { changePassword, fetchCurrentUser, login, logout } from './auth-api'

// 登录态是全应用单例：路由守卫、侧栏与各页面共享同一份。
const currentUser = ref<AuthUser | null>(null)
let loading: Promise<AuthUser | null> | undefined

/** 首次调用时问后端要当前用户，之后复用；未登录为 null。网络或 5xx 失败照常抛出且不缓存，不当成掉登录。 */
function loadCurrentUser(): Promise<AuthUser | null> {
  loading ??= fetchCurrentUser()
    .then(user => currentUser.value = user)
    .catch((error: unknown) => {
      loading = undefined
      throw error
    })

  return loading
}

function setCurrentUser(user: AuthUser | null) {
  currentUser.value = user
  loading = Promise.resolve(user)
}

export function useAuth() {
  return {
    currentUser: readonly(currentUser),
    loadCurrentUser,
    async signIn(input: LoginRequest) {
      const user = await login(input)
      setCurrentUser(user)
      return user
    },
    async signOut() {
      // 只有 401（Session 已失效）算已退出；403 / 网络失败时 Cookie 仍有效，照实抛出，不假装退出。
      await logout().catch((error: unknown) => {
        if (!(error instanceof AdminRunApiError) || error.status !== 401)
          throw error
      })
      setCurrentUser(null)
    },
    async updatePassword(input: ChangePasswordRequest) {
      const user = await changePassword(input)
      setCurrentUser(user)
      return user
    },
  }
}

/** 登录后回跳地址只接受站内路径，挡住 `//evil.example` 这类开放跳转。 */
export function safeRedirect(value: unknown, fallback = '/overview'): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : fallback
}
