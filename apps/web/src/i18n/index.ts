import { createI18n } from 'vue-i18n'

import { messages } from './messages'

export const localeOptions = [
  {
    value: 'zh-CN',
    labelKey: 'common.languages.zh',
    shortLabel: '中',
  },
  {
    value: 'en-US',
    labelKey: 'common.languages.en',
    shortLabel: 'EN',
  },
] as const

export type AppLocale = keyof typeof messages

export const defaultLocale: AppLocale = 'zh-CN'

const localeStorageKey = 'agent-web-locale'

export function isAppLocale(value: unknown): value is AppLocale {
  return localeOptions.some(option => option.value === value)
}

function getInitialLocale(): AppLocale {
  if (typeof window === 'undefined')
    return defaultLocale

  const savedLocale = readSavedLocale()

  if (isAppLocale(savedLocale))
    return savedLocale

  return window.navigator.language.toLowerCase().startsWith('en')
    ? 'en-US'
    : defaultLocale
}

/** localStorage 可能被隐私设置禁用（访问即抛 SecurityError）：模块加载时读不到就按浏览器语言，不能让整页白屏。 */
function readSavedLocale(): string | null {
  try {
    return window.localStorage.getItem(localeStorageKey)
  }
  catch {
    return null
  }
}

export function persistLocale(locale: AppLocale) {
  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.setItem(localeStorageKey, locale)
  }
  catch {
    // 存不下时切换仍在当前页面生效。
  }
}

export function syncDocumentLocale(locale: AppLocale) {
  if (typeof document === 'undefined')
    return

  document.documentElement.lang = locale
}

export const initialLocale = getInitialLocale()

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: defaultLocale,
  messages,
})
