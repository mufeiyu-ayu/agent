<script setup lang="ts">
import type { SeoCenterNodeConfig } from '@/types/seo-flow'

import AppIcon from '@/components/common/AppIcon.vue'

defineProps<{
  node: SeoCenterNodeConfig
}>()
</script>

<template>
  <div
    class="relative flex size-[108px] items-center justify-center min-[1800px]:size-[128px]"
    :aria-label="`${node.label} ${node.description}`"
    :data-seo-center-node="node.id"
  >
    <span class="absolute inset-0 rounded-full border border-[#d7b18a]/60" aria-hidden="true" />
    <span class="absolute inset-2 rounded-full border border-[#d7b18a]/32" aria-hidden="true" />
    <span class="absolute -inset-2 rounded-full bg-[#d7a372]/10 blur-xl" aria-hidden="true" />

    <span
      class="absolute inset-0 rounded-full bg-[conic-gradient(from_135deg,rgba(215,177,138,0.0),rgba(215,177,138,0.52),rgba(137,163,118,0.18),rgba(215,177,138,0.0))] opacity-70"
      aria-hidden="true"
    />

    <div class="relative flex size-[82px] items-center justify-center rounded-full border border-white/[0.12] bg-[#1c1815]/96 text-[#f1d2ae] shadow-[0_20px_58px_rgb(0_0_0/36%),inset_0_1px_0_rgba(255,255,255,0.08)] min-[1800px]:size-[96px]">
      <AppIcon name="tabler:sparkles" :size="42" />
    </div>
  </div>
</template>
