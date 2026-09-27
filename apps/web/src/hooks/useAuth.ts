import type { AuthUser, ChangePasswordRequest, GoogleOneTapResult, LoginRequest } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { readonly, ref } from 'vue'

import { changePassword, fetchCurrentUser, login, loginWithOneTap, logout } from '@/api/auth'

// 登录态是全应用单例：路由守卫与各页面共享同一份。
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
    async signIn(payload: LoginRequest) {
      const user = await login(payload)
      setCurrentUser(user)
      return user
    },
    async signInWithOneTap(credential: string): Promise<GoogleOneTapResult> {
      const result = await loginWithOneTap(credential)

      if (result.status === 'ok')
        setCurrentUser(result.user)

      return result
    },
    async signOut() {
      // 只有 401（Session 已失效）算已退出；403 / 网络失败时 Cookie 仍有效，照实抛出，不假装退出。
      await logout().catch((error: unknown) => {
        if (!isAxiosError(error) || error.response?.status !== 401)
          throw error
      })
      setCurrentUser(null)
    },
    async updatePassword(payload: ChangePasswordRequest) {
      const user = await changePassword(payload)
      setCurrentUser(user)
      return user
    },
  }
}
