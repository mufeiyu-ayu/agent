<script setup lang="ts">
import type { AgentPlatformUser } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { Bell, ChevronDown, CircleHelp, PanelLeftOpen, RefreshCw, Sparkles } from '@lucide/vue'
import { computed } from 'vue'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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
  <header class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-7">
    <div class="flex min-w-0 items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        title="Open navigation"
        aria-label="Open navigation"
        class="size-10 rounded-xl border-slate-200 text-slate-600 hover:border-blue-200 hover:text-blue-600 lg:hidden"
        @click="emit('openNavigation')"
      >
        <PanelLeftOpen :size="20" />
      </Button>

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
      <Badge
        as="div"
        variant="outline"
        class="flex h-10 items-center gap-2 rounded-full border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm"
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
        class="hidden size-10 rounded-full text-slate-600 hover:bg-slate-100 hover:text-blue-600 md:inline-flex"
      >
        <CircleHelp :size="20" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        title="Notifications"
        aria-label="Notifications"
        class="hidden size-10 rounded-full text-slate-600 hover:bg-slate-100 hover:text-blue-600 md:inline-flex"
      >
        <Bell :size="20" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        title="User menu"
        aria-label="User menu"
        class="h-auto rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
      >
        <Avatar size="lg" class="size-10 bg-slate-800 text-white">
          <AvatarFallback class="bg-slate-800 text-sm font-black text-white">
            {{ user.initials }}
          </AvatarFallback>
        </Avatar>
        <ChevronDown class="hidden text-slate-500 sm:block" :size="18" />
      </Button>
    </div>
  </header>
</template>
