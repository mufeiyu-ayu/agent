import type { AppLocale } from '@/i18n'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { defaultLocale, isAppLocale, localeOptions, persistLocale, syncDocumentLocale } from '@/i18n'

export function useLocale() {
  const { locale, t } = useI18n()

  const currentLocale = computed<AppLocale>(() => {
    return isAppLocale(locale.value) ? locale.value : defaultLocale
  })

  const currentLocaleOption = computed(() => {
    return localeOptions.find(option => option.value === currentLocale.value) ?? localeOptions[0]
  })

  const currentLocaleLabel = computed(() => t(currentLocaleOption.value.labelKey))
  const currentLocaleShortLabel = computed(() => currentLocaleOption.value.shortLabel)

  function setLocale(nextLocale: AppLocale) {
    locale.value = nextLocale
    persistLocale(nextLocale)
    syncDocumentLocale(nextLocale)
  }

  function updateLocale(value: unknown) {
    if (!isAppLocale(value))
      return

    setLocale(value)
  }

  return {
    t,
    localeOptions,
    currentLocale,
    currentLocaleLabel,
    currentLocaleShortLabel,
    setLocale,
    updateLocale,
  }
}
