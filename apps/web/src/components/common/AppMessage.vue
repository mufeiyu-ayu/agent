<script setup lang="ts">
import type { AppMessageType } from '../../types/seo'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  visible: boolean
  type: AppMessageType
  text: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

const messageClass = computed(() => {
  if (props.type === 'success')
    return 'border-agent-moss/25 bg-agent-moss-soft text-agent-moss shadow-[0_8px_18px_rgb(61_92_70/9%)]'

  if (props.type === 'info')
    return 'border-agent-accent/25 bg-agent-accent-soft text-agent-accent shadow-[0_8px_18px_rgb(111_70_52/9%)]'

  return 'border-destructive/20 bg-destructive/10 text-destructive shadow-[0_8px_18px_rgb(154_52_48/10%)]'
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="-translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-3 opacity-0"
  >
    <div
      v-if="visible && text"
      class="pointer-events-none fixed left-1/2 top-4 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 sm:top-5 sm:max-w-[520px]"
      role="status"
      aria-live="polite"
    >
      <Alert
        class="pointer-events-auto flex min-h-10 w-auto max-w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold leading-5 sm:px-3.5"
        :class="messageClass"
      >
        <p class="min-w-0 flex-1 truncate whitespace-nowrap">
          {{ text }}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :title="t('common.actions.closeAlert')"
          :aria-label="t('common.actions.closeAlert')"
          class="-mr-1 size-7 shrink-0 rounded-lg text-agent-ink-muted hover:bg-agent-surface-raised/80 hover:text-agent-ink"
          @click="emit('close')"
        >
          <AppIcon name="tabler:x" :size="16" />
        </Button>
      </Alert>
    </div>
  </Transition>
</template>
