<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser, AgentRecentChat } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'
import type { WorkspaceThemeId, WorkspaceThemeOption } from '../../types/workspace-theme'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import brandLogoUrl from '@/assets/logo.webp'
import AppIcon from '@/components/common/AppIcon.vue'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'
import { useLocale } from '@/hooks/useLocale'

import ConversationList from './ConversationList.vue'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  collapsed: boolean
  hasMoreRecentChats: boolean
  isLoadingMoreRecentChats: boolean
  mobile?: boolean
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
  user: AgentPlatformUser
  workspaceTheme: WorkspaceThemeId
  workspaceThemeOptions: readonly WorkspaceThemeOption[]
}>()

const emit = defineEmits<{
  deleteChat: [chatId: string]
  loadMoreChats: []
  newChat: []
  refreshBalance: []
  renameChat: [chatId: string, title: string]
  selectChat: [chatId: string]
  toggleSidebar: []
  updateWorkspaceTheme: [value: WorkspaceThemeId]
}>()

const { t } = useI18n()
const { localeOptions, currentLocale, currentLocaleLabel, updateLocale } = useLocale()

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-agent-moss' : 'bg-agent-border'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')

const currentThemeOption = computed(() => {
  return props.workspaceThemeOptions.find(option => option.value === props.workspaceTheme)
})

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
    class="relative flex h-full shrink-0 flex-col border-r border-agent-border bg-agent-sidebar py-5 font-sans text-sm transition-[width,padding] duration-300"
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
        class="grid size-9 place-items-center rounded-lg text-agent-ink-muted transition hover:bg-agent-surface hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
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
          SEO Agent
        </h1>
      </div>

      <button
        v-if="!collapsed"
        type="button"
        :title="mobile ? t('layout.sidebar.close') : t('layout.sidebar.collapse')"
        :aria-label="mobile ? t('layout.sidebar.close') : t('layout.sidebar.collapse')"
        class="grid size-9 place-items-center rounded-lg text-agent-ink-muted transition hover:bg-agent-surface hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
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
      class="mb-5 inline-flex h-9 items-center gap-2.5 rounded-lg bg-agent-surface-raised text-sm font-medium text-agent-ink ring-1 ring-agent-border-soft transition hover:bg-agent-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/45"
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
          class="grid size-8 place-items-center rounded-lg text-agent-ink-muted transition hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
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
        class="grid size-11 place-items-center rounded-xl text-agent-ink-muted transition hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
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
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-agent-primary text-[11px] font-semibold text-white">
            {{ user.initials }}
          </span>
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
          >
            <DropdownMenuItem
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

            <DropdownMenuSeparator class="mx-1 my-1.5 h-px bg-agent-border-subtle" />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm outline-none transition data-[highlighted]:bg-agent-surface-sunken/50 data-[state=open]:bg-agent-surface-sunken/50"
              >
                <span class="flex items-center gap-2.5">
                  <AppIcon :name="currentThemeOption?.icon ?? 'tabler:sun-low'" :size="16" class="text-agent-ink-muted" />
                  {{ t('layout.themeSwitcher.placeholder') }}
                </span>
                <span class="flex shrink-0 items-center gap-1 text-agent-ink-muted">
                  {{ currentThemeOption ? t(currentThemeOption.shortLabelKey) : '' }}
                  <AppIcon name="tabler:chevron-right" :size="14" />
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  :side-offset="6"
                  class="min-w-[176px]" :class="[dropdownMenuPanelClass]"
                >
                  <DropdownMenuItem
                    v-for="option in workspaceThemeOptions"
                    :key="option.value"
                    class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm outline-none transition"
                    :class="dropdownMenuOptionClass(option.value === workspaceTheme)"
                    @select="emit('updateWorkspaceTheme', option.value)"
                  >
                    <span class="flex items-center gap-2">
                      <AppIcon :name="option.icon" :size="15" class="text-agent-ink-muted" />
                      {{ t(option.labelKey) }}
                    </span>
                    <AppIcon
                      v-if="option.value === workspaceTheme"
                      name="tabler:check"
                      :size="15"
                      class="shrink-0"
                    />
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm outline-none transition data-[highlighted]:bg-agent-surface-sunken/50 data-[state=open]:bg-agent-surface-sunken/50"
              >
                <span class="flex items-center gap-2.5">
                  <AppIcon name="tabler:language" :size="16" class="text-agent-ink-muted" />
                  {{ t('common.languageSwitcher.placeholder') }}
                </span>
                <span class="flex shrink-0 items-center gap-1 text-agent-ink-muted">
                  {{ currentLocaleLabel }}
                  <AppIcon name="tabler:chevron-right" :size="14" />
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  :side-offset="6"
                  class="min-w-[152px]" :class="[dropdownMenuPanelClass]"
                >
                  <DropdownMenuItem
                    v-for="option in localeOptions"
                    :key="option.value"
                    class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm outline-none transition"
                    :class="dropdownMenuOptionClass(option.value === currentLocale)"
                    @select="updateLocale(option.value)"
                  >
                    <span>{{ t(option.labelKey) }}</span>
                    <AppIcon
                      v-if="option.value === currentLocale"
                      name="tabler:check"
                      :size="15"
                      class="shrink-0"
                    />
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
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
