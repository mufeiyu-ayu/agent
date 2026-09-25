<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import userAvatarUrl from '@/assets/avatar-user.jpg'
import brandLogoUrl from '@/assets/logo.webp'
import AppIcon from '@/components/common/AppIcon.vue'
import { dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'

import ConversationList from './ConversationList.vue'

const props = defineProps<{
  balanceAvailable: boolean
  /** 服务商不提供余额时整行隐藏。 */
  balanceHidden: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  collapsed: boolean
  hasMoreRecentChats: boolean
  isLoadingMoreRecentChats: boolean
  mobile?: boolean
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
  user: AgentPlatformUser
}>()

const emit = defineEmits<{
  deleteChat: [chatId: string]
  loadMoreChats: []
  newChat: []
  openSettings: []
  refreshBalance: []
  renameChat: [chatId: string, title: string]
  selectChat: [chatId: string]
  toggleSidebar: []
}>()

const { t } = useI18n()

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-agent-moss' : 'bg-agent-border'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')

let openingSettings = false

function openSettings() {
  openingSettings = true
  emit('openSettings')
}

/** 打开设置时焦点交给弹窗，菜单关闭后不再把焦点抢回头像按钮。 */
function handleMenuCloseAutoFocus(event: Event) {
  if (!openingSettings)
    return
  openingSettings = false
  event.preventDefault()
}

/**
 * 余额行点击后触发刷新，但阻止菜单关闭，方便用户看到刷新结果。
 */
function handleBalanceSelect(event: Event) {
  event.preventDefault()

  if (!isRefreshingBalance.value)
    emit('refreshBalance')
}
</script>

<template>
  <aside
    class="relative flex h-full shrink-0 flex-col border-r border-agent-border-subtle bg-agent-sidebar py-5 font-sans text-sm transition-[width,padding] duration-300"
    :class="[
      mobile ? 'flex w-full px-5' : collapsed ? 'w-[68px] px-3' : 'w-[264px] px-4',
      mobile ? undefined : 'hidden min-[960px]:flex',
    ]"
  >
    <div
      class="mb-6 flex items-center"
      :class="collapsed ? 'justify-center' : 'justify-between gap-3'"
    >
      <button
        v-if="collapsed"
        type="button"
        :title="t('layout.sidebar.expand')"
        :aria-label="t('layout.sidebar.expand')"
        class="grid size-9 place-items-center rounded-lg text-agent-ink-muted transition hover:bg-agent-surface-sunken/45 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        @click="emit('toggleSidebar')"
      >
        <AppIcon name="tabler:layout-sidebar-left-expand" :size="21" />
      </button>

      <div v-else class="flex min-w-0 items-center gap-2.5 pl-1">
        <div class="size-7 shrink-0 overflow-hidden rounded-lg">
          <img
            :src="brandLogoUrl"
            alt=""
            aria-hidden="true"
            class="size-full object-cover"
          >
        </div>
        <h1 class="sidebar-wordmark min-w-0 truncate text-[17px] font-bold text-agent-ink">
          {{ t('common.appName') }}
        </h1>
      </div>

      <button
        v-if="!collapsed"
        type="button"
        :title="mobile ? t('layout.sidebar.close') : t('layout.sidebar.collapse')"
        :aria-label="mobile ? t('layout.sidebar.close') : t('layout.sidebar.collapse')"
        class="grid size-9 place-items-center rounded-lg text-agent-ink-muted transition hover:bg-agent-surface-sunken/45 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        @click="emit('toggleSidebar')"
      >
        <AppIcon v-if="mobile" name="tabler:x" :size="19" />
        <AppIcon v-else name="tabler:layout-sidebar-left-collapse" :size="21" />
      </button>
    </div>

    <button
      type="button"
      :title="collapsed ? t('layout.sidebar.newChat') : undefined"
      :aria-label="collapsed ? t('layout.sidebar.newChat') : undefined"
      class="mb-5 inline-flex h-9 items-center gap-2.5 rounded-lg bg-agent-surface-raised text-sm font-medium text-agent-ink ring-1 ring-agent-border-soft transition hover:bg-agent-surface-sunken/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/45"
      :class="collapsed ? 'justify-center px-0' : 'px-2.5'"
      @click="emit('newChat')"
    >
      <AppIcon name="tabler:plus" :size="17" />
      <span v-if="!collapsed">{{ t('layout.sidebar.newChat') }}</span>
    </button>

    <nav class="space-y-0.5">
      <button
        v-for="item in navigationItems"
        :key="item.id"
        type="button"
        :title="collapsed ? item.label : undefined"
        :aria-label="collapsed ? item.label : undefined"
        class="flex h-9 w-full items-center rounded-lg text-sm text-agent-ink-muted transition hover:bg-agent-surface-sunken/45 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        :class="[
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
          item.active ? 'bg-agent-surface-sunken/60 font-medium text-agent-ink' : 'font-normal',
        ]"
      >
        <AppIcon
          :name="item.icon"
          :size="18"
          :class="item.active ? 'text-agent-ink' : 'text-agent-ink-muted'"
        />
        <span v-if="!collapsed">{{ item.label }}</span>
      </button>
    </nav>

    <div
      v-if="!collapsed"
      class="mt-7 flex min-h-0 flex-1 flex-col"
    >
      <div class="mb-1.5 flex items-center justify-between gap-3 pl-2.5">
        <h2 class="text-xs font-medium tracking-normal text-agent-ink-muted">
          {{ t('layout.sidebar.recentChats') }}
        </h2>
        <button
          v-if="recentChats.length > 0"
          type="button"
          :title="t('layout.sidebar.searchRecentChats')"
          :aria-label="t('layout.sidebar.searchRecentChats')"
          class="grid size-8 place-items-center rounded-lg text-agent-ink-muted transition hover:bg-agent-surface-sunken/45 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        >
          <AppIcon name="tabler:search" :size="17" />
        </button>
      </div>

      <div
        v-if="recentChats.length === 0"
        class="px-2.5 py-2"
      >
        <p class="text-[13px] font-normal leading-5 text-agent-ink-muted">
          {{ t('layout.sidebar.emptyRecentTitle') }}
        </p>
      </div>

      <ConversationList
        v-else
        :has-more="hasMoreRecentChats"
        :is-loading-more="isLoadingMoreRecentChats"
        :recent-chats="recentChats"
        @delete-chat="emit('deleteChat', $event)"
        @load-more="emit('loadMoreChats')"
        @rename-chat="(chatId, title) => emit('renameChat', chatId, title)"
        @select-chat="emit('selectChat', $event)"
      />
    </div>

    <div v-else class="mt-8 flex flex-1 flex-col items-center gap-2">
      <button
        v-for="chat in recentChats.slice(0, 4)"
        :key="chat.id"
        type="button"
        :title="chat.title"
        :aria-label="chat.title"
        class="grid size-11 place-items-center rounded-xl text-agent-ink-muted transition hover:bg-agent-surface-sunken/45 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        :class="{ 'bg-agent-surface-sunken/45 text-agent-accent ring-1 ring-agent-border-soft': chat.active }"
        @click="emit('selectChat', chat.id)"
      >
        <AppIcon name="tabler:message-circle" :size="18" />
      </button>
    </div>

    <div class="mt-3 shrink-0" :class="collapsed ? 'flex justify-center' : undefined">
      <DropdownMenuRoot>
        <DropdownMenuTrigger
          type="button"
          :aria-label="t('layout.settings.trigger')"
          class="flex items-center rounded-lg text-left transition hover:bg-agent-surface-sunken/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40 data-[state=open]:bg-agent-surface-sunken/55"
          :class="collapsed ? 'size-11 justify-center' : 'h-11 w-full gap-2.5 px-2.5'"
        >
          <img :src="userAvatarUrl" alt="" class="size-7 shrink-0 rounded-full object-cover">
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1 truncate text-sm text-agent-ink">{{ user.name }}</span>
            <AppIcon name="tabler:selector" :size="16" class="shrink-0 text-agent-ink-muted" />
          </template>
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
          <DropdownMenuContent
            side="top"
            align="start"
            :side-offset="8"
            class="w-[248px]" :class="[dropdownMenuPanelClass]"
            @close-auto-focus="handleMenuCloseAutoFocus"
          >
            <DropdownMenuItem
              v-if="!balanceHidden"
              class="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm outline-none transition data-[highlighted]:bg-agent-surface-sunken/50"
              :aria-label="`${t('common.actions.refreshBalance')}：${balanceLabel}`"
              @select="handleBalanceSelect"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="size-2 shrink-0 rounded-full" :class="balanceToneClass" />
                <span class="truncate">{{ balanceLabel }}</span>
              </span>
              <AppIcon
                name="tabler:refresh"
                :size="15"
                class="shrink-0 text-agent-ink-muted"
                :class="{ 'animate-spin': isRefreshingBalance }"
              />
            </DropdownMenuItem>

            <DropdownMenuSeparator v-if="!balanceHidden" class="mx-1 my-1.5 h-px bg-agent-border-subtle" />

            <DropdownMenuItem
              class="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition data-[highlighted]:bg-agent-surface-sunken/50"
              @select="openSettings"
            >
              <AppIcon name="tabler:settings" :size="16" class="text-agent-ink-muted" />
              {{ t('layout.settings.open') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-wordmark {
  font-family: "Libre Baskerville", Georgia, ui-serif, serif;
}
</style>
