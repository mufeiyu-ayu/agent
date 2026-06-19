<script setup lang="ts">
import type { SeoBriefPreviewConfig } from '@/types/seo-flow'

import AppIcon from '@/components/common/AppIcon.vue'

defineProps<{
  brief: SeoBriefPreviewConfig
}>()
</script>

<template>
  <article
    class="seo-brief-preview relative h-[332px] overflow-visible rounded-lg border border-[#dfc19d]/24 bg-[#1b1813]/70 p-4 text-[#fff6e8] shadow-[0_18px_42px_rgb(0_0_0/20%),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md min-[1800px]:h-[372px] min-[1800px]:p-5"
    :data-seo-brief-preview="brief.id"
    :aria-label="brief.fileName"
  >
    <svg
      class="seo-brief-preview__fold"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path class="seo-brief-preview__fold-edge" d="M0 0L64 64" />
      <path class="seo-brief-preview__fold-crease" d="M0 0V36C0 51 13 64 28 64H64" />
    </svg>

    <div class="seo-brief-preview__content">
      <div class="relative flex items-start gap-3 pr-10">
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-lg font-medium leading-6 min-[1800px]:text-xl">
            {{ brief.fileName }}
          </h3>
          <p class="mt-6 text-[10px] font-bold uppercase leading-none tracking-normal text-[#6f665f]">
            Target keyword
          </p>
          <span class="mt-2 block h-2 w-full rounded-full bg-white/[0.06]" aria-hidden="true" />
          <span class="mt-1.5 block h-2 w-7/12 rounded-full bg-white/[0.05]" aria-hidden="true" />
          <p class="mt-5 text-[10px] font-bold uppercase leading-none tracking-normal text-[#6f665f]">
            Search intent
          </p>
          <span class="mt-2 block h-2 w-8/12 rounded-full bg-white/[0.06]" aria-hidden="true" />
          <span class="mt-1.5 block h-2 w-full rounded-full bg-white/[0.05]" aria-hidden="true" />
          <p class="sr-only">
            {{ brief.status }}
          </p>
        </div>
      </div>

      <div class="mt-5">
        <p class="text-[10px] font-bold uppercase leading-none tracking-normal text-[#6f665f]">
          Outline
        </p>
        <div class="mt-3 space-y-2" aria-hidden="true">
          <span class="block h-1.5 w-10/12 rounded-full bg-white/[0.07]" />
          <span class="block h-1.5 w-11/12 rounded-full bg-white/[0.055]" />
          <span class="block h-1.5 w-8/12 rounded-full bg-white/[0.05]" />
        </div>
      </div>

      <div class="mt-6">
        <p class="text-[10px] font-bold uppercase leading-none tracking-normal text-[#6f665f]">
          Key points
        </p>
        <div class="mt-3 space-y-2" aria-hidden="true">
          <span class="block h-1.5 w-full rounded-full bg-white/[0.07]" />
          <span class="block h-1.5 w-10/12 rounded-full bg-white/[0.055]" />
        </div>
      </div>

      <div class="mt-6">
        <p class="text-[10px] font-bold uppercase leading-none tracking-normal text-[#6f665f]">
          FAQ ideas
        </p>
        <div class="mt-3 space-y-2" aria-hidden="true">
          <span class="block h-1.5 w-7/12 rounded-full bg-white/[0.06]" />
          <span class="block h-1.5 w-9/12 rounded-full bg-white/[0.05]" />
        </div>
      </div>

      <div class="mt-6">
        <p class="text-[10px] font-bold uppercase leading-none tracking-normal text-[#6f665f]">
          Internal links
        </p>
        <div class="mt-3 flex gap-2" aria-hidden="true">
          <span class="h-6 w-9 rounded-sm border border-white/[0.08]" />
          <span class="h-6 w-9 rounded-sm border border-white/[0.08]" />
          <span class="h-6 w-9 rounded-sm border border-white/[0.08]" />
          <span class="h-6 w-9 rounded-sm border border-white/[0.08]" />
        </div>
      </div>
    </div>

    <div class="absolute bottom-4 right-4 flex size-6 items-center justify-center rounded-full border border-white/12 text-[#6f665f] min-[1800px]:bottom-5 min-[1800px]:right-5">
      <AppIcon name="tabler:check" :size="15" />
    </div>
  </article>
</template>

<style scoped>
.seo-brief-preview::before {
  position: absolute;
  top: -2px;
  right: -2px;
  z-index: 1;
  width: 58px;
  height: 58px;
  content: '';
  background: #14110e;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  pointer-events: none;
}

.seo-brief-preview__fold {
  position: absolute;
  top: -1px;
  right: -1px;
  z-index: 2;
  width: 54px;
  height: 54px;
  pointer-events: none;
}

.seo-brief-preview__content {
  position: relative;
  z-index: 0;
  height: 100%;
  overflow: hidden;
}

.seo-brief-preview__fold-edge,
.seo-brief-preview__fold-crease {
  stroke: rgba(223, 193, 157, 0.20);
  stroke-width: 1.25;
  vector-effect: non-scaling-stroke;
}

.seo-brief-preview__fold-edge {
  stroke: rgba(223, 193, 157, 0.27);
}
</style>
