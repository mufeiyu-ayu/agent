<script setup lang="ts">
import type { WorkspaceThemeId, WorkspaceThemeOption } from '@/types/workspace-theme'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const props = defineProps<{
  modelValue: WorkspaceThemeId
  options: readonly WorkspaceThemeOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: WorkspaceThemeId]
}>()

const { t } = useI18n()

const fallbackThemeOption: WorkspaceThemeOption = {
  value: 'warm-ledger',
  labelKey: 'layout.themeSwitcher.themes.warmLedger.label',
  shortLabelKey: 'layout.themeSwitcher.themes.warmLedger.shortLabel',
  icon: 'tabler:sun-low',
}

const selectedTheme = computed(() => {
  return props.options.find(option => option.value === props.modelValue) ?? props.options[0] ?? fallbackThemeOption
})

function updateTheme(value: unknown) {
  const nextTheme = props.options.find(option => option.value === value)

  if (!nextTheme)
    return

  emit('update:modelValue', nextTheme.value)
}
</script>

<template>
  <Select
    :model-value="modelValue"
    @update:model-value="updateTheme"
  >
    <SelectTrigger
      :aria-label="t('layout.themeSwitcher.ariaLabel')"
      class="group h-9 w-9 overflow-hidden rounded-full border-agent-border bg-agent-surface-raised px-0 text-agent-ink-soft shadow-none hover:border-agent-border hover:bg-agent-surface focus:ring-agent-focus/35 sm:w-[92px] sm:px-3 lg:h-10 lg:w-[112px]"
    >
      <AppIcon :name="selectedTheme.icon" :size="17" class="shrink-0 text-agent-ink-muted transition group-hover:text-agent-ink" />
      <SelectValue :placeholder="t('layout.themeSwitcher.placeholder')">
        <span class="hidden truncate text-xs font-bold sm:inline lg:text-sm">
          {{ t(selectedTheme.shortLabelKey) }}
        </span>
      </SelectValue>
    </SelectTrigger>

    <SelectContent
      align="end"
      class="min-w-[184px] rounded-xl border-agent-border bg-agent-surface-raised p-1.5 text-agent-ink shadow-[0_14px_32px_rgb(61_49_36/12%)]"
      position="popper"
    >
      <SelectItem
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        class="h-9 rounded-lg py-0 pl-3 pr-9 text-sm font-semibold text-agent-ink-soft transition-colors focus:bg-agent-surface-sunken focus:text-agent-ink data-[highlighted]:bg-agent-surface-sunken data-[highlighted]:text-agent-ink data-[state=checked]:bg-agent-accent-soft data-[state=checked]:text-agent-ink [&>span:first-child]:right-3 [&>span:first-child]:size-4"
      >
        <span class="flex min-w-0 items-center gap-2">
          <AppIcon :name="option.icon" :size="16" class="shrink-0 text-agent-ink-muted" />
          <span class="truncate">{{ t(option.labelKey) }}</span>
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
