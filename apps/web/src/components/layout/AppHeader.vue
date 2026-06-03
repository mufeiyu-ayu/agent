<script setup lang="ts">
import type { AgentPlatformUser } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { Bell, ChevronDown, CircleHelp, Globe2, PanelLeftOpen, RefreshCw, Sparkles } from '@lucide/vue'
import { computed } from 'vue'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  language: string
  user: AgentPlatformUser
}>()

const emit = defineEmits<{
  'openNavigation': []
  'refreshBalance': []
  'update:language': [value: string]
}>()

const languageOptions = ['English', '中文', '日本語', 'Deutsch']

const languageModel = computed({
  get: () => props.language,
  set: value => emit('update:language', value),
})

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-emerald-500' : 'bg-slate-300'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')
</script>

<template>
  <header class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-7">
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        title="Open navigation"
        aria-label="Open navigation"
        class="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:text-blue-600 lg:hidden"
        @click="emit('openNavigation')"
      >
        <PanelLeftOpen :size="20" />
      </button>

      <div class="grid size-10 place-items-center rounded-2xl bg-blue-600 text-white lg:hidden">
        <Sparkles :size="21" />
      </div>

      <div class="min-w-0">
        <h1 class="truncate text-base font-black text-slate-950 sm:text-lg">
          AI SEO Agent
        </h1>
        <p class="hidden text-xs font-semibold text-slate-500 sm:block">
          Conversation workspace
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <div class="flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
        <span class="size-2 rounded-full" :class="balanceToneClass" />
        <span class="hidden sm:inline">{{ balanceLabel }}</span>
        <button
          type="button"
          title="Refresh balance"
          aria-label="Refresh balance"
          class="grid size-7 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50"
          :disabled="isRefreshingBalance"
          @click="emit('refreshBalance')"
        >
          <RefreshCw :class="{ 'animate-spin': isRefreshingBalance }" :size="15" />
        </button>
      </div>

      <label class="relative flex h-10 items-center">
        <Globe2 class="pointer-events-none absolute left-3 text-slate-500" :size="17" />
        <select
          v-model="languageModel"
          aria-label="Language"
          class="h-10 w-11 appearance-none rounded-full border border-slate-200 bg-white py-0 pl-10 pr-2 text-sm font-bold text-transparent shadow-sm outline-none transition hover:border-blue-200 focus:border-blue-300 focus:ring-4 focus:ring-blue-100 sm:w-[132px] sm:pl-9 sm:pr-8 sm:text-slate-700"
        >
          <option
            v-for="option in languageOptions"
            :key="option"
          >
            {{ option }}
          </option>
        </select>
        <ChevronDown class="pointer-events-none absolute right-3 hidden text-slate-500 sm:block" :size="16" />
      </label>

      <button
        type="button"
        title="Help"
        aria-label="Help"
        class="hidden size-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-blue-600 md:grid"
      >
        <CircleHelp :size="20" />
      </button>

      <button
        type="button"
        title="Notifications"
        aria-label="Notifications"
        class="hidden size-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-blue-600 md:grid"
      >
        <Bell :size="20" />
      </button>

      <button
        type="button"
        class="flex items-center gap-2 rounded-full pl-1 pr-2 transition hover:bg-slate-100"
      >
        <span class="grid size-10 place-items-center rounded-full bg-slate-800 text-sm font-black text-white">
          {{ user.initials }}
        </span>
        <ChevronDown class="hidden text-slate-500 sm:block" :size="18" />
      </button>
    </div>
  </header>
</template>
