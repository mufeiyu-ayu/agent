<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

const props = withDefaults(defineProps<{
  content: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  multiline?: boolean
}>(), {
  side: 'bottom',
  multiline: false,
})
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :aria-label="content"
          :side="props.side"
          :side-offset="6"
          class="z-[80] max-w-[calc(100vw-16px)] bg-[#18181b] px-2.5 py-1 text-[11px] font-medium text-white shadow-md select-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none"
          :class="props.multiline ? 'max-w-xs rounded-lg py-1.5 leading-relaxed text-left font-normal text-white/90' : 'rounded-full'"
        >
          {{ content }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
