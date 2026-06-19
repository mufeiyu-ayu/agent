import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../types/agent-platform'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const navigationConfig = [
  { id: 'page-audit', labelKey: 'navigation.pageAudit', icon: 'tabler:file-search', active: true },
  { id: 'keyword-ideas', labelKey: 'navigation.keywordIdeas', icon: 'tabler:bulb' },
  { id: 'content-plan', labelKey: 'navigation.contentPlan', icon: 'tabler:article' },
  { id: 'seo-checklist', labelKey: 'navigation.seoChecklist', icon: 'tabler:checklist' },
  { id: 'history', labelKey: 'navigation.history', icon: 'tabler:history' },
  { id: 'settings', labelKey: 'navigation.settings', icon: 'tabler:settings' },
] as const

const recentChats: AgentRecentChat[] = [

]

const user: AgentPlatformUser = {
  name: 'Demo User',
  initials: 'D',
}

export function useMockAgentPlatform() {
  const { t } = useI18n()

  const navigationItems = computed<AgentNavigationItem[]>(() => {
    return navigationConfig.map(item => ({
      id: item.id,
      label: t(item.labelKey),
      icon: item.icon,
      active: 'active' in item ? item.active : undefined,
    }))
  })

  return {
    navigationItems,
    recentChats,
    user,
    productIcon: 'tabler:sparkles',
  }
}
