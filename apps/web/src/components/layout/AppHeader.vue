<script setup lang="ts">
import type { AgentPlatformUser } from '../../types/agent-platform'
import type { LlmRuntimeStatus } from '../../types/llm'
import type { WorkspaceThemeId, WorkspaceThemeOption } from '../../types/workspace-theme'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import AppUserSettingsSheet from './AppUserSettingsSheet.vue'
import WorkspaceThemeSwitcher from './WorkspaceThemeSwitcher.vue'

const props = defineProps<{
  balanceAvailable: boolean
  balanceLabel: string
  balanceStatus: LlmRuntimeStatus
  user: AgentPlatformUser
  workspaceTheme: WorkspaceThemeId
  workspaceThemeOptions: readonly WorkspaceThemeOption[]
}>()

const emit = defineEmits<{
  openNavigation: []
  refreshBalance: []
  updateWorkspaceTheme: [value: WorkspaceThemeId]
}>()

const balanceToneClass = computed(() => {
  if (props.balanceStatus === 'error')
    return 'bg-amber-500'

  return props.balanceAvailable ? 'bg-agent-moss' : 'bg-agent-border'
})

const isRefreshingBalance = computed(() => props.balanceStatus === 'loading')
const { t } = useI18n()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center justify-between gap-3 bg-transparent px-3 lg:h-16 lg:gap-4 lg:px-7">
    <div class="flex min-w-0 items-center gap-2.5 lg:gap-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="t('layout.mobileNavigation.open')"
        :aria-label="t('layout.mobileNavigation.open')"
        class="size-9 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken hover:text-agent-ink lg:hidden"
        @click="emit('openNavigation')"
      >
        <AppIcon name="tabler:layout-sidebar-left-expand" :size="21" />
      </Button>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
      <WorkspaceThemeSwitcher
        :model-value="workspaceTheme"
        :options="workspaceThemeOptions"
        @update:model-value="emit('updateWorkspaceTheme', $event)"
      />

      <LanguageSwitcher />

      <Badge
        as="div"
        variant="outline"
        class="hidden h-10 items-center gap-2 rounded-full border-agent-border bg-agent-surface-raised px-3 text-sm font-bold text-agent-ink-soft shadow-none lg:flex"
      >
        <span class="size-2 rounded-full" :class="balanceToneClass" />
        <span class="hidden sm:inline">{{ balanceLabel }}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :title="t('common.actions.refreshBalance')"
          :aria-label="t('common.actions.refreshBalance')"
          class="size-7 rounded-lg text-agent-ink-muted hover:bg-agent-surface-sunken hover:text-agent-ink disabled:opacity-50"
          :disabled="isRefreshingBalance"
          @click="emit('refreshBalance')"
        >
          <AppIcon
            name="tabler:refresh"
            :size="15"
            :class="{ 'animate-spin': isRefreshingBalance }"
          />
        </Button>
      </Badge>

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
