import type { InjectionKey, Ref } from 'vue'
import { inject } from 'vue'

/** 首页各部分共用的登录状态：由 HomeView 提供，「Start asking」「Log in」据此决定进工作台还是弹登录框。 */
export interface HomeLogin {
  loggedIn: Readonly<Ref<boolean>>
  openLogin: () => void
}

export const HOME_LOGIN: InjectionKey<HomeLogin> = Symbol('home-login')

export function useHomeLogin(): HomeLogin {
  return inject(HOME_LOGIN)!
}
