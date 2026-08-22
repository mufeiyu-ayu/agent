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

/** 详情路由 → 用于 tab 标题的 id 参数名；新增详情页在这里登记即可。 */
const DETAIL_ROUTE_ID_PARAMS = {
  'conversation-detail': 'conversationId',
  'run-detail': 'runId',
} as const

export type DetailRouteName = keyof typeof DETAIL_ROUTE_ID_PARAMS

export function resolveRouteTabTitle(
  route: RouteNavigationContext,
  formatDetailTitle: (routeName: DetailRouteName, idSuffix: string) => string
    = (routeName, id) => `${routeName === 'run-detail' ? 'Run' : 'Conversation'} · ${id}`,
): string {
  const fallbackTitle = route.meta.title ?? route.path
  const routeName = typeof route.name === 'string' && route.name in DETAIL_ROUTE_ID_PARAMS
    ? route.name as DetailRouteName
    : undefined

  if (!routeName)
    return fallbackTitle

  const id = route.params?.[DETAIL_ROUTE_ID_PARAMS[routeName]]

  if (typeof id !== 'string' || !id)
    return fallbackTitle

  const suffix = id.length > 11 ? `…${id.slice(-11)}` : id
  return formatDetailTitle(routeName, suffix)
}

export function resolveActiveMenuPath(route: RouteNavigationContext): string {
  return route.meta.activeMenu ?? route.path
}
