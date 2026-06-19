<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { Icon } from '@iconify/vue'
import { reactiveOmit } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import SheetOverlay from './SheetOverlay.vue'

interface SheetContentProps extends DialogContentProps {
  class?: HTMLAttributes['class']
  side?: 'top' | 'right' | 'bottom' | 'left'
  showCloseButton?: boolean
}

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SheetContentProps>(), {
  side: 'right',
  showCloseButton: true,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'side', 'showCloseButton')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const { t } = useI18n()
</script>

<template>
  <DialogPortal>
    <SheetOverlay />
    <DialogContent
      data-slot="sheet-content"
      :data-side="side"
      :class="cn('bg-popover text-popover-foreground fixed z-50 flex flex-col gap-4 bg-clip-padding text-sm shadow-lg transition duration-300 ease-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[side=bottom]:data-[state=open]:slide-in-from-bottom-8 data-[side=left]:data-[state=open]:slide-in-from-left-8 data-[side=right]:data-[state=open]:slide-in-from-right-8 data-[side=top]:data-[state=open]:slide-in-from-top-8 data-[side=bottom]:data-[state=closed]:slide-out-to-bottom-8 data-[side=left]:data-[state=closed]:slide-out-to-left-8 data-[side=right]:data-[state=closed]:slide-out-to-right-8 data-[side=top]:data-[state=closed]:slide-out-to-top-8', props.class)"
      v-bind="{ ...$attrs, ...forwarded }"
    >
      <slot />

      <DialogClose
        v-if="showCloseButton"
        data-slot="sheet-close"
        as-child
      >
        <Button
          variant="ghost"
          class="absolute top-3 right-3 size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          size="icon-sm"
        >
          <Icon icon="tabler:x" :width="16" :height="16" :inline="true" aria-hidden="true" />
          <span class="sr-only">{{ t('common.actions.close') }}</span>
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
