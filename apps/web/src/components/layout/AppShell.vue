<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { computed, ref } from 'vue'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

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
        class="w-[288px] max-w-[calc(100vw-28px)] gap-0 border-r border-slate-200/70 bg-[#fbfbfa] p-0 shadow-[24px_0_70px_rgb(15_23_42/14%)] duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform data-[side=left]:data-[state=open]:slide-in-from-left-12 data-[side=left]:data-[state=closed]:slide-out-to-left-12 lg:hidden"
        :show-close-button="false"
      >
        <SheetTitle class="sr-only">
          Navigation
        </SheetTitle>
        <SheetDescription class="sr-only">
          Main navigation and recent chats
        </SheetDescription>
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
