<script setup lang="ts">
import type { AgentPlatformUser } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { Bell, ChevronRight, CircleHelp, RefreshCw, Settings, UserRound, WalletCards, X } from '@lucide/vue'
import { computed, ref } from 'vue'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  user: AgentPlatformUser
}>()

const emit = defineEmits<{
  refreshBalance: []
}>()

const settingsOpen = ref(false)

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-emerald-500' : 'bg-slate-300'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')

const settingItems = [
  {
    icon: UserRound,
    label: 'Profile',
  },
  {
    icon: Bell,
    label: 'Notifications',
  },
  {
    icon: CircleHelp,
    label: 'Help',
  },
  {
    icon: Settings,
    label: 'Settings',
  },
] as const
</script>

<template>
  <Sheet v-model:open="settingsOpen">
    <SheetTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        title="User settings"
        aria-label="User settings"
        class="size-9 rounded-full border border-slate-200/80 bg-white/85 p-0 shadow-[0_8px_22px_rgb(15_23_42/8%)] transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-slate-300 hover:bg-white hover:shadow-[0_12px_28px_rgb(15_23_42/10%)] active:scale-95 sm:size-10"
      >
        <Avatar size="lg" class="size-8 bg-slate-950 text-white sm:size-9">
          <AvatarFallback class="bg-slate-950 text-sm font-semibold text-white">
            {{ user.initials }}
          </AvatarFallback>
        </Avatar>
      </Button>
    </SheetTrigger>

    <SheetContent
      side="right"
      :show-close-button="false"
      class="!w-[334px] max-w-[calc(100vw-16px)] gap-0 border-l border-slate-200/70 bg-[#fbfbfa]/95 p-0 shadow-[0_24px_90px_rgb(15_23_42/16%)] backdrop-blur-2xl duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform data-[side=right]:data-[state=open]:slide-in-from-right-12 data-[side=right]:data-[state=closed]:slide-out-to-right-12 sm:!w-[360px]"
    >
      <div class="flex h-full flex-col">
        <SheetHeader class="px-5 pb-3 pt-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <Avatar size="lg" class="size-11 bg-slate-950 text-white shadow-[0_12px_30px_rgb(15_23_42/14%)]">
                <AvatarFallback class="bg-slate-950 text-base font-semibold text-white">
                  {{ user.initials }}
                </AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <SheetTitle class="truncate text-[15px] font-semibold leading-5 text-slate-950">
                  {{ user.name }}
                </SheetTitle>
                <SheetDescription class="mt-0.5 text-xs font-medium leading-5 text-slate-500">
                  AI SEO Agent workspace
                </SheetDescription>
              </div>
            </div>

            <SheetClose as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Close settings"
                aria-label="Close settings"
                class="size-8 rounded-full border border-slate-200/70 bg-white/80 text-slate-500 shadow-sm hover:border-slate-300 hover:bg-white hover:text-slate-950"
              >
                <X :size="16" />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        <div class="flex flex-1 flex-col gap-3 px-3.5 pb-5 pt-2">
          <section class="overflow-hidden rounded-[22px] border border-slate-200/75 bg-white/85 shadow-[0_16px_48px_rgb(15_23_42/6%)]">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3 px-3.5 py-3">
                <span class="grid size-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-[0_10px_24px_rgb(15_23_42/12%)]">
                  <WalletCards :size="15" />
                </span>
                <div class="min-w-0">
                  <p class="text-[13px] font-semibold leading-5 text-slate-950">
                    DeepSeek balance
                  </p>
                  <p class="flex items-center gap-2 text-xs font-medium leading-5 text-slate-500">
                    <span class="size-2 rounded-full" :class="balanceToneClass" />
                    <span class="truncate">{{ balanceLabel }}</span>
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                title="Refresh balance"
                aria-label="Refresh balance"
                class="mr-2 size-8 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950 focus-visible:!border-slate-200 focus-visible:!ring-1 focus-visible:!ring-slate-200 disabled:opacity-50"
                :disabled="isRefreshingBalance"
                @click="emit('refreshBalance')"
              >
                <RefreshCw :class="{ 'animate-spin': isRefreshingBalance }" :size="16" />
              </Button>
            </div>
          </section>

          <nav class="overflow-hidden rounded-[22px] border border-slate-200/75 bg-white/90 shadow-[0_16px_48px_rgb(15_23_42/6%)]">
            <button
              v-for="item in settingItems"
              :key="item.label"
              type="button"
              class="group flex h-12 w-full items-center gap-3 border-b border-slate-100/80 px-3.5 text-left text-[13px] font-medium text-slate-700 transition last:border-b-0 hover:bg-slate-50/90 hover:text-slate-950"
            >
              <component :is="item.icon" :size="16" class="text-slate-500 transition group-hover:text-slate-700" />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <ChevronRight :size="15" class="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
            </button>
          </nav>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
