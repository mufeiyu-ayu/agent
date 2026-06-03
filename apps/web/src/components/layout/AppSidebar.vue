<script setup lang="ts">
import type { AgentNavigationItem, AgentRecentChat } from '../../types/agent-platform'

import { ChevronLeft, MessageCircle, MoreVertical, PanelLeftOpen, Plus, Search, Sparkles, X } from '@lucide/vue'

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
</script>

<template>
  <aside
    class="relative flex h-full shrink-0 flex-col border-r border-slate-200 bg-[#fbfcfe] py-5 transition-[width,padding] duration-300"
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
        title="Expand navigation"
        aria-label="Expand navigation"
        class="grid size-10 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-blue-600"
        @click="emit('toggleSidebar')"
      >
        <PanelLeftOpen :size="20" />
      </button>

      <div v-else class="flex min-w-0 items-center gap-3">
        <div class="grid size-10 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_26px_rgb(37_99_235/18%)]">
          <Sparkles :size="22" />
        </div>
        <div class="min-w-0">
          <h1 class="truncate text-xl font-bold tracking-normal text-slate-950">
            SEO Agent
          </h1>
          <p class="text-xs font-semibold text-slate-500">
            Agent workspace
          </p>
        </div>
      </div>

      <button
        v-if="!collapsed"
        type="button"
        :title="mobile ? 'Close navigation' : 'Collapse navigation'"
        :aria-label="mobile ? 'Close navigation' : 'Collapse navigation'"
        class="grid size-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-blue-200 hover:text-blue-600"
        @click="emit('toggleSidebar')"
      >
        <X v-if="mobile" :size="18" />
        <ChevronLeft v-else :size="18" />
      </button>
    </div>

    <button
      type="button"
      :title="collapsed ? 'New Chat' : undefined"
      :aria-label="collapsed ? 'New Chat' : undefined"
      class="mb-6 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-bold text-white shadow-[0_16px_30px_rgb(37_99_235/20%)] transition hover:bg-blue-500"
      :class="{ 'px-0': collapsed }"
      @click="emit('newChat')"
    >
      <Plus :size="19" />
      <span v-if="!collapsed">New Chat</span>
    </button>

    <nav class="space-y-1">
      <button
        v-for="item in navigationItems"
        :key="item.id"
        type="button"
        :title="collapsed ? item.label : undefined"
        :aria-label="collapsed ? item.label : undefined"
        class="flex h-11 w-full items-center rounded-xl text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-blue-600 hover:shadow-sm"
        :class="[
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
          item.active ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : '',
        ]"
      >
        <component :is="item.icon" :size="19" />
        <span v-if="!collapsed">{{ item.label }}</span>
      </button>
    </nav>

    <div
      v-if="!collapsed"
      class="mt-8 flex min-h-0 flex-1 flex-col"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-xs font-bold uppercase tracking-normal text-slate-400">
          Recent Chats
        </h2>
        <button
          type="button"
          title="Search recent chats"
          aria-label="Search recent chats"
          class="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-blue-600"
        >
          <Search :size="16" />
        </button>
      </div>

      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <button
          v-for="chat in recentChats"
          :key="chat.id"
          type="button"
          class="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition"
          :class="chat.active ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-700 hover:bg-white hover:shadow-sm'"
        >
          <MessageCircle class="mt-0.5 shrink-0" :size="18" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-bold">
              {{ chat.title }}
            </span>
            <span class="mt-1 block text-xs font-semibold text-slate-400">
              {{ chat.updatedAt }}
            </span>
          </span>
          <MoreVertical v-if="chat.active" class="mt-0.5 shrink-0 text-blue-500" :size="17" />
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
        class="grid size-11 place-items-center rounded-xl text-slate-500 transition hover:bg-white hover:text-blue-600 hover:shadow-sm"
        :class="{ 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200': chat.active }"
      >
        <MessageCircle :size="18" />
      </button>
    </div>
  </aside>
</template>
