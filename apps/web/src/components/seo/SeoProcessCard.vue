<script setup lang="ts">
import type {
  SeoFlowCardSide,
  SeoFlowCardTone,
  SeoProcessCardHeight,
  SeoProcessItem,
} from '@/types/seo-flow'

import { computed } from 'vue'

import AppIcon from '@/components/common/AppIcon.vue'

interface ToneClasses {
  shell: string
  icon: string
  iconHalo: string
  eyebrow: string
}

const props = withDefaults(defineProps<{
  id: string
  title: string
  description: string
  items: SeoProcessItem[]
  icon: string
  tone?: SeoFlowCardTone
  side?: SeoFlowCardSide
  eyebrow?: string
  indexLabel?: string
  compact?: boolean
  height?: SeoProcessCardHeight
}>(), {
  tone: 'copper',
  side: 'left',
  compact: false,
})

const toneClassMap: Record<SeoFlowCardTone, ToneClasses> = {
  copper: {
    shell: 'border-[#d59a61]/28 bg-[#191512]/86 shadow-[0_18px_42px_rgb(0_0_0/24%),inset_0_1px_0_rgba(255,255,255,0.06)]',
    icon: 'border-[#d59a61]/38 bg-[#d59a61]/12 text-[#f0c18f]',
    iconHalo: 'bg-[#d59a61]/22',
    eyebrow: 'text-[#d7b18a]',
  },
  moss: {
    shell: 'border-[#8fa67e]/28 bg-[#151a15]/86 shadow-[0_18px_42px_rgb(0_0_0/24%),inset_0_1px_0_rgba(255,255,255,0.06)]',
    icon: 'border-[#8fa67e]/38 bg-[#8fa67e]/12 text-[#b6c4ad]',
    iconHalo: 'bg-[#8fa67e]/20',
    eyebrow: 'text-[#b6c4ad]',
  },
  sand: {
    shell: 'border-[#dfc19d]/28 bg-[#1b1813]/86 shadow-[0_18px_42px_rgb(0_0_0/24%),inset_0_1px_0_rgba(255,255,255,0.06)]',
    icon: 'border-[#dfc19d]/36 bg-[#dfc19d]/12 text-[#f3dfc5]',
    iconHalo: 'bg-[#dfc19d]/20',
    eyebrow: 'text-[#dfc19d]',
  },
  ink: {
    shell: 'border-[#4d473f]/45 bg-[#26211b]/92 shadow-[0_18px_42px_rgb(0_0_0/24%)]',
    icon: 'border-white/[0.12] bg-white/[0.09] text-[#f3dfc5]',
    iconHalo: 'bg-white/10',
    eyebrow: 'text-[#d8b58b]',
  },
}

const toneClasses = computed(() => toneClassMap[props.tone])

const titleId = computed(() => `seo-process-card-${props.id}-title`)

const shellSizeClass = computed(() => {
  if (props.compact)
    return 'h-[60px] px-3 py-2.5 min-[1800px]:h-[66px] min-[1800px]:px-3.5'

  if (props.height === 'short')
    return 'h-[86px] px-3 py-3 min-[1800px]:h-[92px] min-[1800px]:px-3.5'

  if (props.height === 'medium')
    return 'h-[92px] px-3 py-3 min-[1800px]:h-[98px] min-[1800px]:px-3.5'

  if (props.height === 'tall')
    return 'h-[92px] px-3 py-3 min-[1800px]:h-[98px] min-[1800px]:px-3.5'

  return 'px-3 py-3'
})

const iconSize = computed(() => 16)

const iconShellClass = computed(() => 'size-8')

const titleTextClass = computed(() => {
  if (props.compact)
    return 'text-sm leading-5 min-[1800px]:text-[15px] min-[1800px]:leading-5'

  return 'text-sm leading-5 min-[1800px]:text-[15px] min-[1800px]:leading-5'
})

const descriptionTextClass = computed(() => {
  if (props.compact)
    return 'mt-0.5 text-xs leading-4 min-[1800px]:text-[13px] min-[1800px]:leading-4'

  return 'mt-0.5 text-xs leading-4 min-[1800px]:text-[13px] min-[1800px]:leading-4'
})

const sideClasses = computed(() => {
  if (props.side === 'left') {
    return {
      shell: 'lg:text-left',
      header: '',
      items: '',
    }
  }

  return {
    shell: 'lg:text-left',
    header: '',
    items: 'lg:justify-start',
  }
})
</script>

<template>
  <article
    class="relative overflow-hidden rounded-lg border text-left backdrop-blur-md"
    :class="[toneClasses.shell, sideClasses.shell, shellSizeClass]"
    :aria-labelledby="titleId"
    :data-seo-process-card="id"
  >
    <div
      class="flex h-full min-w-0 items-center gap-3"
      :class="sideClasses.header"
    >
      <div class="relative shrink-0">
        <span
          class="absolute inset-0 rounded-full blur-md"
          :class="toneClasses.iconHalo"
          aria-hidden="true"
        />
        <span
          class="relative flex items-center justify-center rounded-md border"
          :class="[toneClasses.icon, iconShellClass]"
        >
          <AppIcon :name="icon" :size="iconSize" />
        </span>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <p
          v-if="(eyebrow || indexLabel) && !compact"
          class="mb-1 text-[9px] font-bold uppercase leading-none tracking-normal"
          :class="toneClasses.eyebrow"
        >
          <span v-if="indexLabel">{{ indexLabel }}</span>
          <span v-if="indexLabel && eyebrow" class="mx-1 opacity-45">/</span>
          <span v-if="eyebrow">{{ eyebrow }}</span>
        </p>

        <h3
          :id="titleId"
          class="truncate font-semibold text-[#fff6e8]"
          :class="titleTextClass"
        >
          {{ title }}
        </h3>

        <p
          v-if="description"
          class="truncate font-medium text-[#a99f94]"
          :class="descriptionTextClass"
        >
          {{ description }}
        </p>
      </div>
    </div>
  </article>
</template>
