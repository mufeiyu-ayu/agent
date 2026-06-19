<script setup lang="ts">
import AppIcon from '@/components/common/AppIcon.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/hooks/useLocale'

const {
  t,
  localeOptions,
  currentLocale,
  currentLocaleLabel,
  currentLocaleShortLabel,
  updateLocale,
} = useLocale()
</script>

<template>
  <Select
    :model-value="currentLocale"
    @update:model-value="updateLocale"
  >
    <SelectTrigger
      :aria-label="t('common.languageSwitcher.ariaLabel')"
      class="h-9 w-[78px] overflow-hidden rounded-full border-agent-border bg-agent-surface-raised px-2 text-xs font-bold tracking-normal text-agent-ink-soft shadow-none hover:border-agent-border hover:bg-agent-surface focus:ring-agent-focus/35 sm:h-10 sm:w-[126px] sm:px-3 sm:text-sm"
    >
      <AppIcon name="tabler:language" :size="17" class="text-agent-ink-muted" />
      <SelectValue :placeholder="t('common.languageSwitcher.placeholder')">
        <span class="hidden sm:inline">{{ currentLocaleLabel }}</span>
        <span class="sm:hidden">{{ currentLocaleShortLabel }}</span>
      </SelectValue>
    </SelectTrigger>

    <SelectContent class="min-w-[148px] rounded-xl">
      <SelectItem
        v-for="option in localeOptions"
        :key="option.value"
        :value="option.value"
      >
        {{ t(option.labelKey) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
