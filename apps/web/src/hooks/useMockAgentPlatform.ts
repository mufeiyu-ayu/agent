import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../types/agent-platform'

import { FileText, FolderOpen, History, LayoutTemplate, Settings, Sparkles } from '@lucide/vue'

const navigationItems: AgentNavigationItem[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'history', label: 'History', icon: History },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const recentChats: AgentRecentChat[] = [

]

const user: AgentPlatformUser = {
  name: 'Demo User',
  initials: 'D',
}

export function useMockAgentPlatform() {
  return {
    navigationItems,
    recentChats,
    user,
    productIcon: Sparkles,
  }
}
