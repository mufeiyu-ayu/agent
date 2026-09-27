export type AgentIconName = string

export interface AgentNavigationItem {
  id: string
  label: string
  icon: AgentIconName
  active?: boolean
}

export interface AgentRecentChat {
  id: string
  title: string
  active?: boolean
}

export interface AgentPlatformUser {
  /** 显示名与首字母按 `userDisplayName` / `userInitial` 算好；头像取不到时显示首字母。 */
  name: string
  initial: string
  avatarUrl: string | null
}
