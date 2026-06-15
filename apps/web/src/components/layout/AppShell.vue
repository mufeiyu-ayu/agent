<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { computed, ref } from 'vue'

import { Sheet, SheetContent } from '@/components/ui/sheet'

import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
  user: AgentPlatformUser
}>()

const emit = defineEmits<{
  newChat: []
  refreshBalance: []
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

    <Sheet v-model:open="mobileSidebarOpen">
      <SheetContent
        side="left"
        class="w-[292px] max-w-[292px] gap-0 border-r border-slate-200 bg-white p-0 shadow-2xl lg:hidden"
        :show-close-button="false"
      >
        <AppSidebar
          :collapsed="false"
          :navigation-items="props.navigationItems"
          :recent-chats="props.recentChats"
          mobile
          @new-chat="handleNewChat"
          @toggle-sidebar="closeMobileSidebar"
        />
      </SheetContent>
    </Sheet>

    <section class="flex min-h-0 min-w-0 flex-col bg-white">
      <AppHeader
        :balance-available="props.balanceAvailable"
        :balance-label="props.balanceLabel"
        :balance-status="props.balanceStatus"
        :user="props.user"
        @open-navigation="mobileSidebarOpen = true"
        @refresh-balance="emit('refreshBalance')"
      />

      <slot />
    </section>
  </main>
</template>
