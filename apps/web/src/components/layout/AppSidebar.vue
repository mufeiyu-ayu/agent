<script setup lang="ts">
import type { AgentNavigationItem, AgentRecentChat } from '../../types/agent-platform'

import { useI18n } from 'vue-i18n'

import brandLogoUrl from '@/assets/brand-logo.png'
import AppIcon from '@/components/common/AppIcon.vue'

defineProps<{
  collapsed: boolean
  mobile?: boolean
  navigationItems: AgentNavigationItem[]
  recentChats: AgentRecentChat[]
}>()

const emit = defineEmits<{
  newChat: []
  toggleSidebar: []
}>()

const { t } = useI18n()
</script>

<template>
  <aside
    class="relative flex h-full shrink-0 flex-col border-r border-agent-border bg-agent-sidebar py-5 transition-[width,padding] duration-300"
    :class="[
      collapsed ? 'w-[76px] px-3' : 'w-[292px] px-5',
      mobile ? 'flex' : 'hidden lg:flex',
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

      <div v-else class="flex min-w-0 items-center gap-3">
        <div class="size-10 shrink-0 overflow-hidden rounded-xl bg-agent-surface-raised ring-1 ring-agent-border-soft">
          <img
            :src="brandLogoUrl"
            alt=""
            aria-hidden="true"
            class="size-full object-cover"
          >
        </div>
        <div class="min-w-0">
          <h1 class="truncate text-lg font-extrabold tracking-normal text-agent-ink">
            SEO Agent
          </h1>
          <p class="text-xs font-semibold text-agent-ink-muted">
            {{ t('layout.sidebar.productSubtitle') }}
          </p>
        </div>
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
      class="mb-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-agent-primary px-4 text-sm font-bold text-white transition hover:bg-agent-primary-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/55"
      :class="{ 'px-0': collapsed }"
      @click="emit('newChat')"
    >
      <AppIcon name="tabler:plus" :size="19" />
      <span v-if="!collapsed">{{ t('layout.sidebar.newChat') }}</span>
    </button>

    <nav class="space-y-1">
      <button
        v-for="item in navigationItems"
        :key="item.id"
        type="button"
        :title="collapsed ? item.label : undefined"
        :aria-label="collapsed ? item.label : undefined"
        class="flex h-11 w-full items-center rounded-xl text-sm font-semibold text-agent-ink-muted transition hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        :class="[
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
          item.active ? 'bg-agent-accent-soft text-agent-ink ring-1 ring-agent-border-soft' : '',
        ]"
      >
        <AppIcon
          :name="item.icon"
          :size="19"
          :class="item.active ? 'text-agent-accent' : 'text-agent-ink-muted'"
        />
        <span v-if="!collapsed">{{ item.label }}</span>
      </button>
    </nav>

    <div
      v-if="!collapsed"
      class="mt-8 flex min-h-0 flex-1 flex-col"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-xs font-bold tracking-normal text-agent-ink-muted">
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
        class="rounded-2xl border border-dashed border-agent-border bg-agent-surface/72 px-3.5 py-4"
      >
        <p class="text-sm font-semibold leading-5 text-agent-ink-soft">
          {{ t('layout.sidebar.emptyRecentTitle') }}
        </p>
        <p class="mt-1 text-xs font-medium leading-5 text-agent-ink-muted">
          {{ t('layout.sidebar.emptyRecentDescription') }}
        </p>
      </div>

      <div v-else class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <button
          v-for="chat in recentChats"
          :key="chat.id"
          type="button"
          class="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
          :class="chat.active ? 'bg-agent-surface-raised text-agent-ink ring-1 ring-agent-border-soft' : 'text-agent-ink-soft hover:bg-agent-surface-raised'"
        >
          <AppIcon name="tabler:message-circle" :size="18" class="mt-0.5 text-agent-ink-muted" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-bold">
              {{ chat.title }}
            </span>
            <span class="mt-1 block text-xs font-semibold text-agent-ink-muted">
              {{ chat.updatedAt }}
            </span>
          </span>
          <AppIcon v-if="chat.active" name="tabler:dots-vertical" :size="17" class="mt-0.5 text-agent-ink-muted" />
        </button>
      </div>
    </div>

    <div v-else class="mt-8 flex flex-1 flex-col items-center gap-2">
      <button
        v-for="chat in recentChats.slice(0, 4)"
        :key="chat.id"
        type="button"
        :title="chat.title"
        :aria-label="chat.title"
        class="grid size-11 place-items-center rounded-xl text-agent-ink-muted transition hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        :class="{ 'bg-agent-surface-raised text-agent-accent ring-1 ring-agent-border-soft': chat.active }"
      >
        <AppIcon name="tabler:message-circle" :size="18" />
      </button>
    </div>
  </aside>
</template>
