<script setup lang="ts">
import type { AppMessageType } from '../../types/seo'

import { AlertCircle, CheckCircle2, Info, X } from '@lucide/vue'
import { computed } from 'vue'

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

const messageClass = computed(() => {
  if (props.type === 'success')
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_18px_45px_rgb(16_185_129/18%)]'

  if (props.type === 'info')
    return 'border-blue-200 bg-blue-50 text-blue-700 shadow-[0_18px_45px_rgb(37_99_235/18%)]'

  return 'border-rose-200 bg-rose-50 text-rose-700 shadow-[0_18px_45px_rgb(225_29_72/18%)]'
})

const Icon = computed(() => {
  if (props.type === 'success')
    return CheckCircle2

  if (props.type === 'info')
    return Info

  return AlertCircle
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
      class="pointer-events-none fixed left-1/2 top-5 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2"
      role="alert"
      aria-live="assertive"
    >
      <Alert
        class="pointer-events-auto flex min-h-12 items-center gap-3 rounded-[14px] px-4 py-3 text-sm font-semibold"
        :class="messageClass"
      >
        <component :is="Icon" class="shrink-0" :size="20" />
        <p class="min-w-0 flex-1 leading-5">
          {{ text }}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Close message"
          aria-label="Close message"
          class="size-7 shrink-0 rounded-full hover:bg-white/70"
          @click="emit('close')"
        >
          <X :size="16" />
        </Button>
      </Alert>
    </div>
  </Transition>
</template>
