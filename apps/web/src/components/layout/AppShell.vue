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
  hasMoreRecentChats: boolean
  isLoadingMoreRecentChats: boolean
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
  user: AgentPlatformUser
  workspaceTheme: WorkspaceThemeId
  workspaceThemeOptions: readonly WorkspaceThemeOption[]
  workspaceBackground?: AppShellWorkspaceBackground
}>()

const emit = defineEmits<{
  deleteChat: [chatId: string]
  loadMoreChats: []
  newChat: []
  refreshBalance: []
  renameChat: [chatId: string, title: string]
  selectChat: [chatId: string]
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

function handleSelectChat(chatId: string) {
  emit('selectChat', chatId)
  closeMobileSidebar()
}

function handleDeleteChat(chatId: string) {
  emit('deleteChat', chatId)
  closeMobileSidebar()
}

function handleRenameChat(chatId: string, title: string) {
  emit('renameChat', chatId, title)
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
      :has-more-recent-chats="props.hasMoreRecentChats"
      :is-loading-more-recent-chats="props.isLoadingMoreRecentChats"
      :navigation-items="props.navigationItems"
      :recent-chats="props.recentChats"
      @delete-chat="handleDeleteChat"
      @load-more-chats="emit('loadMoreChats')"
      @new-chat="handleNewChat"
      @rename-chat="handleRenameChat"
      @select-chat="handleSelectChat"
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
          :has-more-recent-chats="props.hasMoreRecentChats"
          :is-loading-more-recent-chats="props.isLoadingMoreRecentChats"
          :navigation-items="props.navigationItems"
          :recent-chats="props.recentChats"
          mobile
          @delete-chat="handleDeleteChat"
          @load-more-chats="emit('loadMoreChats')"
          @new-chat="handleNewChat"
          @rename-chat="handleRenameChat"
          @select-chat="handleSelectChat"
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
