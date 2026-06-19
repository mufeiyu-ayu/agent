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
  updatedAt: string
  active?: boolean
}

export interface AgentPlatformUser {
  name: string
  initials: string
}
