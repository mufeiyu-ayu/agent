<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { computed, ref } from 'vue'

import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  language: string
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
  user: AgentPlatformUser
}>()

const emit = defineEmits<{
  'newChat': []
  'refreshBalance': []
  'update:language': [value: string]
}>()

const sidebarCollapsed = ref(false)
const mobileSidebarOpen = ref(false)

const desktopGridClass = computed(() => {
  return sidebarCollapsed.value
    ? 'lg:grid-cols-[76px_minmax(0,1fr)]'
    : 'lg:grid-cols-[292px_minmax(0,1fr)]'
})

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function closeMobileSidebar() {
  mobileSidebarOpen.value = false
}

function handleNewChat() {
  emit('newChat')
  closeMobileSidebar()
}
</script>

<template>
  <main
    class="grid h-screen w-full overflow-hidden bg-white text-slate-950 transition-[grid-template-columns] duration-300"
    :class="desktopGridClass"
  >
    <AppSidebar
      :collapsed="sidebarCollapsed"
      :navigation-items="props.navigationItems"
      :recent-chats="props.recentChats"
      @new-chat="handleNewChat"
      @toggle-sidebar="toggleSidebar"
    />

    <div
      v-if="mobileSidebarOpen"
      class="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-[2px] lg:hidden"
      @click="closeMobileSidebar"
    />

    <aside
      class="fixed inset-y-0 left-0 z-50 w-[292px] -translate-x-full border-r border-slate-200 bg-white shadow-2xl transition-transform duration-300 lg:hidden"
      :class="{ 'translate-x-0': mobileSidebarOpen }"
    >
      <AppSidebar
        :collapsed="false"
        :navigation-items="props.navigationItems"
        :recent-chats="props.recentChats"
        mobile
        @new-chat="handleNewChat"
        @toggle-sidebar="closeMobileSidebar"
      />
    </aside>

    <section class="flex min-h-0 min-w-0 flex-col bg-white">
      <AppHeader
        :balance-available="props.balanceAvailable"
        :balance-label="props.balanceLabel"
        :balance-status="props.balanceStatus"
        :language="props.language"
        :user="props.user"
        @open-navigation="mobileSidebarOpen = true"
        @refresh-balance="emit('refreshBalance')"
        @update:language="value => emit('update:language', value)"
      />

      <slot />
    </section>
  </main>
</template>
