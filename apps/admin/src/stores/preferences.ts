import type { AdminTheme } from '@/lib/admin-state'
import { defineStore } from 'pinia'

import { computed, ref, watch } from 'vue'
import { parseAdminPreferences } from '@/lib/admin-state'

const STORAGE_KEY = 'agent-admin-preferences'

function readStoredPreferences() {
  try {
    return parseAdminPreferences(localStorage.getItem(STORAGE_KEY))
  }
  catch {
    return parseAdminPreferences(null)
  }
}

export const useAdminPreferencesStore = defineStore('admin-preferences', () => {
  const initialPreferences = readStoredPreferences()
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const theme = ref<AdminTheme>(initialPreferences.theme)
  const sidebarCollapsed = ref(initialPreferences.sidebarCollapsed)
  const systemDark = ref(media.matches)

  const resolvedTheme = computed<'light' | 'dark'>(() => (
    theme.value === 'system'
      ? (systemDark.value ? 'dark' : 'light')
      : theme.value
  ))

  media.addEventListener('change', (event) => {
    systemDark.value = event.matches
  })

  watch(resolvedTheme, (value) => {
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      value === 'dark' ? '#1c1d20' : '#ffffff',
    )
  }, { immediate: true })

  watch([theme, sidebarCollapsed], ([themeValue, collapsed]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        theme: themeValue,
        sidebarCollapsed: collapsed,
      }))
    }
    catch {
      // 存储不可用时仍保留当前会话内状态。
    }
  })

  function setTheme(value: AdminTheme) {
    theme.value = value
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return {
    resolvedTheme,
    setTheme,
    sidebarCollapsed,
    theme,
    toggleSidebar,
  }
})
