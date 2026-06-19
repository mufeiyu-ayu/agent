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

  const savedLocale = window.localStorage.getItem(localeStorageKey)

  if (isAppLocale(savedLocale))
    return savedLocale

  return window.navigator.language.toLowerCase().startsWith('en')
    ? 'en-US'
    : defaultLocale
}

export function persistLocale(locale: AppLocale) {
  if (typeof window === 'undefined')
    return

  window.localStorage.setItem(localeStorageKey, locale)
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
