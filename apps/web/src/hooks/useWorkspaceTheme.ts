import type { WorkspaceThemeId, WorkspaceThemeOption } from '@/types/workspace-theme'

import { computed, readonly, ref, watch } from 'vue'

const workspaceThemeStorageKey = 'ai-seo-agent:workspace-theme'
const defaultWorkspaceTheme: WorkspaceThemeId = 'warm-ledger'

export const workspaceThemeOptions = [
  {
    value: 'warm-ledger',
    labelKey: 'layout.themeSwitcher.themes.warmLedger.label',
    shortLabelKey: 'layout.themeSwitcher.themes.warmLedger.shortLabel',
    icon: 'tabler:sun-low',
  },
  {
    value: 'olive-ember',
    labelKey: 'layout.themeSwitcher.themes.oliveEmber.label',
    shortLabelKey: 'layout.themeSwitcher.themes.oliveEmber.shortLabel',
    icon: 'tabler:moon-stars',
  },
] as const satisfies readonly WorkspaceThemeOption[]

const workspaceTheme = ref<WorkspaceThemeId>(defaultWorkspaceTheme)

let initialized = false

export function useWorkspaceTheme() {
  initializeWorkspaceTheme()
  applyDocumentWorkspaceTheme(workspaceTheme.value)

  const currentWorkspaceTheme = computed(() => {
    return workspaceThemeOptions.find(option => option.value === workspaceTheme.value) ?? workspaceThemeOptions[0]
  })

  function updateWorkspaceTheme(value: WorkspaceThemeId) {
    workspaceTheme.value = value
    applyDocumentWorkspaceTheme(value)
    saveWorkspaceTheme(value)
  }

  return {
    currentWorkspaceTheme,
    workspaceTheme: readonly(workspaceTheme),
    workspaceThemeOptions,
    updateWorkspaceTheme,
  }
}

function initializeWorkspaceTheme() {
  if (initialized) {
    applyDocumentWorkspaceTheme(workspaceTheme.value)
    return
  }

  initialized = true
  workspaceTheme.value = readSavedWorkspaceTheme()

  if (typeof window === 'undefined')
    return

  watch(
    workspaceTheme,
    (theme) => {
      applyDocumentWorkspaceTheme(theme)
      saveWorkspaceTheme(theme)
    },
    { immediate: true },
  )
}

function readSavedWorkspaceTheme(): WorkspaceThemeId {
  if (typeof window === 'undefined')
    return defaultWorkspaceTheme

  try {
    const savedTheme = window.localStorage.getItem(workspaceThemeStorageKey)

    return isWorkspaceThemeId(savedTheme) ? savedTheme : defaultWorkspaceTheme
  }
  catch {
    return defaultWorkspaceTheme
  }
}

function saveWorkspaceTheme(theme: WorkspaceThemeId) {
  try {
    window.localStorage.setItem(workspaceThemeStorageKey, theme)
  }
  catch {
    // localStorage 可能被浏览器隐私设置禁用；主题切换仍应在当前页面生效。
  }
}

function applyDocumentWorkspaceTheme(theme: WorkspaceThemeId) {
  if (typeof document === 'undefined')
    return

  document.documentElement.dataset.agentWorkspaceTheme = theme
}

function isWorkspaceThemeId(value: unknown): value is WorkspaceThemeId {
  return typeof value === 'string' && workspaceThemeOptions.some(option => option.value === value)
}
