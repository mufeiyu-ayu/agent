import type { InkLevel, WorkspaceThemeId, WorkspaceThemeOption } from '@/types/workspace-theme'

import { computed, readonly, ref, watch } from 'vue'

const workspaceThemeStorageKey = 'agent:workspace-theme'
const defaultWorkspaceTheme: WorkspaceThemeId = 'warm-ledger'

export const workspaceThemeOptions = [
  {
    value: 'warm-ledger',
    shortLabelKey: 'layout.themeSwitcher.themes.warmLedger.shortLabel',
    icon: 'tabler:sun',
  },
  {
    value: 'olive-ember',
    shortLabelKey: 'layout.themeSwitcher.themes.oliveEmber.shortLabel',
    icon: 'tabler:moon',
  },
] as const satisfies readonly WorkspaceThemeOption[]

/** 文字亮度三档；standard 即主题原色，soft / bright 由 style.css 按主题覆盖 ink 四档。 */
export const inkLevelOptions = ['soft', 'standard', 'bright'] as const satisfies readonly InkLevel[]

const inkLevelStorageKey = 'agent:ink-level'

const workspaceTheme = ref<WorkspaceThemeId>(defaultWorkspaceTheme)
const inkLevel = ref<InkLevel>('standard')

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

  function updateInkLevel(value: InkLevel) {
    inkLevel.value = value
    document.documentElement.dataset.agentInkLevel = value
    saveToStorage(inkLevelStorageKey, value)
  }

  return {
    currentWorkspaceTheme,
    workspaceTheme: readonly(workspaceTheme),
    workspaceThemeOptions,
    updateWorkspaceTheme,
    inkLevel: readonly(inkLevel),
    inkLevelOptions,
    updateInkLevel,
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

  inkLevel.value = readSavedInkLevel()
  document.documentElement.dataset.agentInkLevel = inkLevel.value

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

/** 没存过时跟随系统「增强对比度」：开了默认高亮档。 */
function readSavedInkLevel(): InkLevel {
  try {
    const saved = window.localStorage.getItem(inkLevelStorageKey)
    if (saved && (inkLevelOptions as readonly string[]).includes(saved))
      return saved as InkLevel
  }
  catch {}

  return window.matchMedia?.('(prefers-contrast: more)').matches ? 'bright' : 'standard'
}

function saveWorkspaceTheme(theme: WorkspaceThemeId) {
  saveToStorage(workspaceThemeStorageKey, theme)
}

function saveToStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  }
  catch {
    // localStorage 可能被浏览器隐私设置禁用；设置仍应在当前页面生效。
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
