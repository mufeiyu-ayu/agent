<script setup lang="ts">
import type { SeoCenterNodeConfig } from '@/types/seo-flow'

import aiAvatarHomeCoreSoftUrl from '@/assets/avatar-olive.webp'

defineProps<{
  node: SeoCenterNodeConfig
}>()
</script>

<template>
  <div
    class="relative flex size-[108px] items-center justify-center min-[1800px]:size-[128px]"
    :aria-label="`${node.label} ${node.description}`"
  >
    <span
      class="absolute -inset-5 rounded-full bg-[#d7a372]/8 blur-3xl"
      aria-hidden="true"
    />
    <span
      class="absolute -inset-2 bg-[radial-gradient(circle_at_50%_50%,rgba(137,163,118,0.12),transparent_68%)] blur-2xl"
      aria-hidden="true"
    />

    <div
      class="relative flex size-[94px] items-center justify-center min-[1800px]:size-[110px]"
      :data-seo-center-node="node.id"
    >
      <img
        :src="aiAvatarHomeCoreSoftUrl"
        alt=""
        class="pointer-events-none size-[118px] max-w-none object-contain opacity-95 drop-shadow-[0_18px_38px_rgba(0,0,0,0.28)] min-[1800px]:size-[138px]"
        aria-hidden="true"
      >
    </div>
  </div>
</template>
