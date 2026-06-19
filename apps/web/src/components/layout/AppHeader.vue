<script setup lang="ts">
import type { AgentPlatformUser } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { Bell, CircleHelp, PanelLeftOpen, RefreshCw } from '@lucide/vue'
import { computed } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import AppUserSettingsSheet from './AppUserSettingsSheet.vue'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  user: AgentPlatformUser
}>()

const emit = defineEmits<{
  openNavigation: []
  refreshBalance: []
}>()

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-emerald-500' : 'bg-slate-300'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')
</script>

<template>
  <header class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/70 bg-white/88 px-3 backdrop-blur-xl lg:h-16 lg:gap-4 lg:bg-white lg:px-7">
    <div class="flex min-w-0 items-center gap-2.5 lg:gap-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        title="Open navigation"
        aria-label="Open navigation"
        class="size-9 rounded-full border border-slate-200/75 bg-white/80 text-slate-500 shadow-[0_8px_22px_rgb(15_23_42/6%)] hover:border-slate-300 hover:bg-white hover:text-slate-950 lg:hidden"
        @click="emit('openNavigation')"
      >
        <PanelLeftOpen :size="18" />
      </Button>

      <div class="hidden min-w-0 lg:block">
        <h1 class="truncate text-base font-black text-slate-950 sm:text-lg">
          AI SEO Agent
        </h1>
        <p class="hidden text-xs font-semibold text-slate-500 sm:block">
          Conversation workspace
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-3">
      <Badge
        as="div"
        variant="outline"
        class="hidden h-10 items-center gap-2 rounded-full border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm lg:flex"
      >
        <span class="size-2 rounded-full" :class="balanceToneClass" />
        <span class="hidden sm:inline">{{ balanceLabel }}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Refresh balance"
          aria-label="Refresh balance"
          class="size-7 rounded-full text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50"
          :disabled="isRefreshingBalance"
          @click="emit('refreshBalance')"
        >
          <RefreshCw :class="{ 'animate-spin': isRefreshingBalance }" :size="15" />
        </Button>
      </Badge>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        title="Help"
        aria-label="Help"
        class="hidden size-10 rounded-full text-slate-600 hover:bg-slate-100 hover:text-blue-600 lg:inline-flex"
      >
        <CircleHelp :size="20" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        title="Notifications"
        aria-label="Notifications"
        class="hidden size-10 rounded-full text-slate-600 hover:bg-slate-100 hover:text-blue-600 lg:inline-flex"
      >
        <Bell :size="20" />
      </Button>

      <AppUserSettingsSheet
        :balance-available="balanceAvailable"
        :balance-label="balanceLabel"
        :balance-status="balanceStatus"
        :user="user"
        @refresh-balance="emit('refreshBalance')"
      />
    </div>
  </header>
</template>
