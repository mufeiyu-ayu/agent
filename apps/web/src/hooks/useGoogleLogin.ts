import type { AuthUser, GoogleLoginResult } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { fetchAuthConfig, fetchOneTapNonce } from '@/api/auth'
import { useAuth } from '@/hooks/useAuth'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            nonce: string
            callback: (response: { credential: string }) => void
            use_fedcm_for_prompt?: boolean
          }) => void
          prompt: () => void
          cancel: () => void
        }
      }
    }
  }
}

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

let clientIdLoading: Promise<string | null> | undefined
let gisLoading: Promise<void> | undefined

/** Google 客户端 ID；未开启或取不到时为 null，此时不显示按钮、不加载 GIS。全应用只问一次。 */
function loadGoogleClientId(): Promise<string | null> {
  clientIdLoading ??= fetchAuthConfig()
    .then(config => config.googleClientId)
    .catch(() => {
      clientIdLoading = undefined
      return null
    })

  return clientIdLoading
}

function loadGisScript(): Promise<void> {
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      gisLoading = undefined
      reject(new Error('GIS 脚本加载失败'))
    }
    document.head.append(script)
  })

  return gisLoading
}

export function useGoogleClientId() {
  const clientId = ref<string | null>(null)

  onMounted(async () => {
    clientId.value = await loadGoogleClientId()
  })

  return clientId
}

/** Google 重定向登录：整页跳走，回来时已登录（或在登录页看到待审核 / 失败）。 */
function startGoogleLogin(redirect: string): void {
  window.location.assign(`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`)
}

/**
 * 整页跳去 Google 的按钮状态：点了立刻 loading，保持到页面离开；
 * 从 Google 页面按浏览器返回时页面可能来自 bfcache，这时复位。
 */
export function useGoogleRedirect() {
  const redirecting = ref(false)

  function resetOnPageShow(event: PageTransitionEvent) {
    if (event.persisted)
      redirecting.value = false
  }
  onMounted(() => window.addEventListener('pageshow', resetOnPageShow))
  onBeforeUnmount(() => window.removeEventListener('pageshow', resetOnPageShow))

  function start(redirect: string) {
    redirecting.value = true
    startGoogleLogin(redirect)
  }

  return { redirecting, start }
}

export type OneTapOutcome = { user: AuthUser } | { notice: GoogleLoginResult }

/**
 * One Tap：未登录且 Google 已开启时加载 GIS 并弹出（浏览器已登录 Google 时才会出现）。
 * 国内未开梯子时脚本加载不了，静默跳过，不影响其他登录方式。
 */
export function useGoogleOneTap(onOutcome: (outcome: OneTapOutcome) => void) {
  const { loadCurrentUser, signInWithOneTap } = useAuth()
  let active = true

  onMounted(async () => {
    try {
      const [user, clientId] = await Promise.all([loadCurrentUser(), loadGoogleClientId()])

      if (user || !clientId || !active)
        return

      await loadGisScript()
      const nonce = await fetchOneTapNonce()

      if (!active || !window.google)
        return

      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce,
        use_fedcm_for_prompt: true,
        callback: ({ credential }) => {
          void signInWithOneTap(credential).then(
            result => onOutcome(result.status === 'ok' ? { user: result.user } : { notice: result.status }),
            (error: unknown) => onOutcome({ notice: isAxiosError(error) && error.response?.status === 429 ? 'throttled' : 'failed' }),
          )
        },
      })
      window.google.accounts.id.prompt()
    }
    catch {
      // 脚本、配置或 nonce 取不到：One Tap 只是捷径，不打扰用户。
    }
  })

  onBeforeUnmount(() => {
    active = false
    window.google?.accounts.id.cancel()
  })
}
