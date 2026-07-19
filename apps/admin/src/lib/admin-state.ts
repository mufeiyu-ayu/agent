export type AdminTheme = 'light' | 'dark' | 'system'

export interface AdminPreferences {
  theme: AdminTheme
  sidebarCollapsed: boolean
}

export interface RouteTab {
  path: string
  title: string
  fixed?: boolean
}

interface RouteNavigationContext {
  meta: {
    activeMenu?: string
    title?: string
  }
  name?: unknown
  params?: Record<string, unknown>
  path: string
}

export const defaultAdminPreferences: AdminPreferences = {
  theme: 'system',
  sidebarCollapsed: false,
}

const themes: AdminTheme[] = ['light', 'dark', 'system']

export function parseAdminPreferences(value: string | null): AdminPreferences {
  if (!value)
    return { ...defaultAdminPreferences }

  try {
    const parsed = JSON.parse(value) as Partial<AdminPreferences>

    return {
      theme: themes.includes(parsed.theme as AdminTheme)
        ? parsed.theme as AdminTheme
        : defaultAdminPreferences.theme,
      sidebarCollapsed: typeof parsed.sidebarCollapsed === 'boolean'
        ? parsed.sidebarCollapsed
        : defaultAdminPreferences.sidebarCollapsed,
    }
  }
  catch {
    return { ...defaultAdminPreferences }
  }
}

export function routeAfterTabClose(
  tabs: RouteTab[],
  closingPath: string,
  currentPath: string,
): string {
  if (closingPath !== currentPath)
    return currentPath

  const closingIndex = tabs.findIndex(tab => tab.path === closingPath)
  const remainingTabs = tabs.filter(tab => tab.path !== closingPath)
  const fallbackIndex = Math.max(0, closingIndex - 1)

  return remainingTabs[fallbackIndex]?.path ?? '/overview'
}

export function resolveRouteTabTitle(route: RouteNavigationContext): string {
  const fallbackTitle = route.meta.title ?? route.path

  if (route.name !== 'run-detail')
    return fallbackTitle

  const runId = route.params?.runId

  if (typeof runId !== 'string' || !runId)
    return fallbackTitle

  const suffix = runId.length > 11 ? `…${runId.slice(-11)}` : runId
  return `Run · ${suffix}`
}

export function resolveActiveMenuPath(route: RouteNavigationContext): string {
  return route.meta.activeMenu ?? route.path
}
