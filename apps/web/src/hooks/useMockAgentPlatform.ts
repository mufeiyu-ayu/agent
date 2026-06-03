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
  {
    id: 'pubg-uc',
    title: 'PUBG UC top-up landing page',
    updatedAt: 'Just now',
    active: true,
  },
  {
    id: 'free-fire',
    title: 'Free Fire diamond top-up SEO',
    updatedAt: '2 hours ago',
  },
  {
    id: 'valorant',
    title: 'Valorant points landing page',
    updatedAt: 'Yesterday',
  },
  {
    id: 'gaming-blog',
    title: 'Best gaming top-up sites blog',
    updatedAt: '2 days ago',
  },
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
