<script setup lang="ts">
import type { AgentPlatformUser } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
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
const { t } = useI18n()

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-agent-moss' : 'bg-agent-border'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')

const settingItems = computed(() => [
  {
    id: 'account',
    icon: 'tabler:user-circle',
    label: t('layout.settings.account'),
  },
  {
    id: 'notifications',
    icon: 'tabler:bell',
    label: t('layout.settings.notifications'),
  },
  {
    id: 'help',
    icon: 'tabler:help-circle',
    label: t('layout.settings.help'),
  },
  {
    id: 'preferences',
    icon: 'tabler:settings',
    label: t('layout.settings.preferences'),
  },
])
</script>

<template>
  <Sheet v-model:open="settingsOpen">
    <SheetTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        :title="t('layout.settings.trigger')"
        :aria-label="t('layout.settings.trigger')"
        class="size-9 rounded-full border border-agent-border bg-agent-surface-raised p-0 shadow-none transition-[background-color,border-color,transform] duration-200 hover:border-agent-border hover:bg-agent-surface active:scale-95 sm:size-10"
      >
        <Avatar size="lg" class="size-8 bg-agent-primary text-white sm:size-9">
          <AvatarFallback class="bg-agent-primary text-sm font-semibold text-white">
            {{ user.initials }}
          </AvatarFallback>
        </Avatar>
      </Button>
    </SheetTrigger>

    <SheetContent
      side="right"
      :show-close-button="false"
      class="!w-[334px] max-w-[calc(100vw-16px)] gap-0 border-l border-agent-border bg-agent-surface/95 p-0 shadow-[0_24px_64px_rgb(61_49_36/13%)] backdrop-blur-2xl duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform data-[side=right]:data-[state=open]:slide-in-from-right-12 data-[side=right]:data-[state=closed]:slide-out-to-right-12 sm:!w-[360px]"
    >
      <div class="flex h-full flex-col">
        <SheetHeader class="px-5 pb-3 pt-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <Avatar size="lg" class="size-11 bg-agent-primary text-white">
                <AvatarFallback class="bg-agent-primary text-base font-semibold text-white">
                  {{ user.initials }}
                </AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <SheetTitle class="truncate text-[15px] font-semibold leading-5 text-agent-ink">
                  {{ user.name }}
                </SheetTitle>
                <SheetDescription class="mt-0.5 text-xs font-medium leading-5 text-agent-ink-muted">
                  {{ t('common.appName') }}
                </SheetDescription>
              </div>
            </div>

            <SheetClose as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :title="t('layout.settings.close')"
                :aria-label="t('layout.settings.close')"
                class="size-8 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken hover:text-agent-ink"
              >
                <AppIcon name="tabler:x" :size="17" />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        <div class="flex flex-1 flex-col gap-3 px-3.5 pb-5 pt-2">
          <section class="overflow-hidden rounded-2xl border border-agent-border bg-agent-surface-raised">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3 px-3.5 py-3">
                <span class="grid size-8 shrink-0 place-items-center rounded-xl bg-agent-primary text-white">
                  <AppIcon name="tabler:wallet" :size="16" />
                </span>
                <div class="min-w-0">
                  <p class="text-[13px] font-semibold leading-5 text-agent-ink">
                    {{ t('layout.settings.balanceTitle') }}
                  </p>
                  <p class="flex items-center gap-2 text-xs font-medium leading-5 text-agent-ink-muted">
                    <span class="size-2 rounded-full" :class="balanceToneClass" />
                    <span class="truncate">{{ balanceLabel }}</span>
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                :title="t('common.actions.refreshBalance')"
                :aria-label="t('common.actions.refreshBalance')"
                class="mr-2 size-8 rounded-lg text-agent-ink-muted hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:!border-agent-border focus-visible:!ring-1 focus-visible:!ring-agent-focus/40 disabled:opacity-50"
                :disabled="isRefreshingBalance"
                @click="emit('refreshBalance')"
              >
                <AppIcon
                  name="tabler:refresh"
                  :size="16"
                  :class="{ 'animate-spin': isRefreshingBalance }"
                />
              </Button>
            </div>
          </section>

          <nav class="overflow-hidden rounded-2xl border border-agent-border bg-agent-surface-raised">
            <button
              v-for="item in settingItems"
              :key="item.id"
              type="button"
              class="group flex h-12 w-full items-center gap-3 border-b border-agent-border-subtle px-3.5 text-left text-[13px] font-medium text-agent-ink-soft transition last:border-b-0 hover:bg-agent-surface hover:text-agent-ink"
            >
              <AppIcon :name="item.icon" :size="16" class="text-agent-ink-muted transition group-hover:text-agent-ink-soft" />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <AppIcon name="tabler:chevron-right" :size="15" class="text-agent-ink-faint transition group-hover:translate-x-0.5 group-hover:text-agent-ink-muted" />
            </button>
          </nav>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
