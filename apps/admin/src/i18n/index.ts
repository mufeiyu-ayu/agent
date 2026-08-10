import { createI18n } from 'vue-i18n'

import { messages } from './messages'

export type AdminLocale = keyof typeof messages

export const defaultLocale: AdminLocale = 'zh-CN'
export const localeOptions = [
  { value: 'zh-CN', labelKey: 'language.chinese', shortLabel: '中' },
  { value: 'en-US', labelKey: 'language.english', shortLabel: 'EN' },
] as const

const STORAGE_KEY = 'agent-admin-locale'

export function isAdminLocale(value: unknown): value is AdminLocale {
  return localeOptions.some(option => option.value === value)
}

export function resolveAdminLocale(
  storedLocale: string | null,
  browserLanguage: string,
): AdminLocale {
  if (isAdminLocale(storedLocale))
    return storedLocale

  return browserLanguage.toLowerCase().startsWith('en') ? 'en-US' : defaultLocale
}

function getInitialLocale(): AdminLocale {
  if (typeof window === 'undefined')
    return defaultLocale

  let storedLocale: string | null = null
  try {
    storedLocale = localStorage.getItem(STORAGE_KEY)
  }
  catch {
    // 存储不可用时继续按浏览器语言选择。
  }

  return resolveAdminLocale(storedLocale, navigator.language)
}

export const initialLocale = getInitialLocale()

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: defaultLocale,
  messages,
})

export function syncDocumentLocale(locale: AdminLocale): void {
  if (typeof document !== 'undefined')
    document.documentElement.lang = locale
}

export function persistAdminLocale(locale: AdminLocale): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(STORAGE_KEY, locale)
  }
  catch {
    // 存储不可用时仍保留当前会话内语言。
  }
}

if (typeof document !== 'undefined')
  syncDocumentLocale(initialLocale)
