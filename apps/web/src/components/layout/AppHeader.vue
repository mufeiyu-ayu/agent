<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { Button } from '@/components/ui/button'

const emit = defineEmits<{
  openNavigation: []
}>()

const { t } = useI18n()
</script>

<template>
  <header class="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-14 items-center px-3 min-[960px]:hidden">
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      :title="t('layout.mobileNavigation.open')"
      :aria-label="t('layout.mobileNavigation.open')"
      class="pointer-events-auto size-9 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken hover:text-agent-ink"
      @click="emit('openNavigation')"
    >
      <AppIcon name="tabler:layout-sidebar-left-expand" :size="21" />
    </Button>
  </header>
</template>
