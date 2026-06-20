<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'
import type { WorkspaceThemeId, WorkspaceThemeOption } from '../../types/workspace-theme'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'

interface AppShellWorkspaceBackground {
  imageUrl: string
  position: string
  opacity: string
}

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
  user: AgentPlatformUser
  workspaceTheme: WorkspaceThemeId
  workspaceThemeOptions: readonly WorkspaceThemeOption[]
  workspaceBackground?: AppShellWorkspaceBackground
}>()

const emit = defineEmits<{
  newChat: []
  refreshBalance: []
  updateWorkspaceTheme: [value: WorkspaceThemeId]
}>()

const sidebarCollapsed = ref(false)
const mobileSidebarOpen = ref(false)
const { t } = useI18n()

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
    class="grid h-screen w-full overflow-hidden bg-agent-canvas text-agent-ink transition-[grid-template-columns] duration-300"
    :class="desktopGridClass"
    :data-agent-workspace-theme="props.workspaceTheme"
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
        class="w-[288px] max-w-[calc(100vw-28px)] gap-0 border-r border-agent-border bg-agent-sidebar p-0 shadow-[20px_0_48px_rgb(61_49_36/10%)] duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform data-[side=left]:data-[state=open]:slide-in-from-left-12 data-[side=left]:data-[state=closed]:slide-out-to-left-12 lg:hidden"
        :show-close-button="false"
      >
        <SheetTitle class="sr-only">
          {{ t('layout.mobileNavigation.title') }}
        </SheetTitle>
        <SheetDescription class="sr-only">
          {{ t('layout.mobileNavigation.description') }}
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

    <section class="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-agent-surface">
      <div
        v-if="props.workspaceBackground"
        class="pointer-events-none absolute inset-0 z-0 bg-cover bg-no-repeat transition-[background-position,opacity] duration-300"
        :style="{
          backgroundImage: `url(${props.workspaceBackground.imageUrl})`,
          backgroundPosition: props.workspaceBackground.position,
          opacity: props.workspaceBackground.opacity,
        }"
        aria-hidden="true"
      />

      <div class="relative z-10 flex min-h-0 flex-1 flex-col">
        <AppHeader
          :balance-available="props.balanceAvailable"
          :balance-label="props.balanceLabel"
          :balance-status="props.balanceStatus"
          :user="props.user"
          :workspace-theme="props.workspaceTheme"
          :workspace-theme-options="props.workspaceThemeOptions"
          @open-navigation="mobileSidebarOpen = true"
          @refresh-balance="emit('refreshBalance')"
          @update-workspace-theme="emit('updateWorkspaceTheme', $event)"
        />

        <slot />
      </div>
    </section>
  </main>
</template>
