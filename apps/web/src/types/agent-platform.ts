import type { LucideIcon } from '@lucide/vue'

export interface AgentNavigationItem {
  id: string
  label: string
  icon: LucideIcon
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
