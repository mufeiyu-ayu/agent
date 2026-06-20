<script setup lang="ts">
import type {
  SeoBriefPreviewConfig,
  SeoCenterNodeConfig,
  SeoFlowViewBox,
  SeoProcessCardConfig,
} from '@/types/seo-flow'

import { ref } from 'vue'

import SeoBriefPreview from '@/components/seo/SeoBriefPreview.vue'
import SeoCenterNode from '@/components/seo/SeoCenterNode.vue'
import SeoFlowLines from '@/components/seo/SeoFlowLines.vue'
import SeoParticleField from '@/components/seo/SeoParticleField.vue'
import SeoProcessCard from '@/components/seo/SeoProcessCard.vue'
import { useSeoFlowLayout } from '@/hooks/useSeoFlowLayout'

const leftProcessCards: SeoProcessCardConfig[] = [
  {
    id: 'page-input',
    eyebrow: 'Input',
    title: 'Page input',
    description: 'https://example.com/blog/',
    icon: 'tabler:file-description',
    tone: 'copper',
    side: 'left',
    indexLabel: '01',
    height: 'short',
    items: [],
  },
  {
    id: 'content-signals',
    eyebrow: 'Context',
    title: 'Content signals',
    description: 'Headings · Entities · Schema',
    icon: 'tabler:radar-2',
    tone: 'moss',
    side: 'left',
    indexLabel: '02',
    height: 'tall',
    items: [],
  },
  {
    id: 'search-intent',
    eyebrow: 'Intent',
    title: 'Search intent',
    description: 'Informational · How-to · Commercial',
    icon: 'tabler:target',
    tone: 'moss',
    side: 'left',
    indexLabel: '03',
    height: 'medium',
    items: [],
  },
]

const centerNode: SeoCenterNodeConfig = {
  id: 'seo-agent-core',
  eyebrow: 'Orchestrator',
  label: 'SEO Agent',
  description: 'Plan · Draft · Verify',
  sparkLabel: 'Agent spark',
  metrics: [
    { id: 'prompt', label: 'Prompt', value: 'Role' },
    { id: 'schema', label: 'JSON', value: 'Guard' },
    { id: 'review', label: 'Check', value: 'Pass' },
  ],
}

const rightProcessCards: SeoProcessCardConfig[] = [
  {
    id: 'page-audit',
    eyebrow: 'Audit',
    title: 'Page audit',
    description: 'Technical · Content · UX',
    icon: 'tabler:clipboard-list',
    tone: 'sand',
    side: 'right',
    indexLabel: '04',
    compact: true,
    items: [],
  },
  {
    id: 'keyword-discovery',
    eyebrow: 'Discovery',
    title: 'Keyword discovery',
    description: 'Clusters · Gaps · Intent',
    icon: 'tabler:search',
    tone: 'moss',
    side: 'right',
    indexLabel: '05',
    compact: true,
    items: [],
  },
  {
    id: 'content-plan',
    eyebrow: 'Plan',
    title: 'Content plan',
    description: 'Topics · Outline · Brief',
    icon: 'tabler:list-details',
    tone: 'sand',
    side: 'right',
    indexLabel: '06',
    compact: true,
    items: [],
  },
  {
    id: 'internal-linking',
    eyebrow: 'Links',
    title: 'Internal linking',
    description: 'Opportunities · Anchors',
    icon: 'tabler:link',
    tone: 'moss',
    side: 'right',
    indexLabel: '07',
    compact: true,
    items: [],
  },
]

const briefPreview: SeoBriefPreviewConfig = {
  id: 'search-ready-brief',
  fileName: 'Search-ready brief',
  status: 'Ready for review',
  summary: 'A search brief with reviewable rationale, structured sections, and quality checks.',
  updatedLabel: 'Search-ready',
  sections: [
    { id: 'title', label: 'Title', value: '58 chars', tone: 'title' },
    { id: 'meta', label: 'Meta', value: '142 chars', tone: 'meta' },
    { id: 'check', label: 'Score', value: '8/10', tone: 'check' },
  ],
  lines: [
    { id: 'line-1', width: 'full' },
    { id: 'line-2', width: 'wide' },
    { id: 'line-3', width: 'medium' },
    { id: 'line-4', width: 'short' },
  ],
}

const flowViewBox: SeoFlowViewBox = {
  width: 1600,
  height: 430,
}

const processMapRef = ref<HTMLElement | null>(null)
const { flowPaths, particlePaths, isMeasured: isFlowMeasured } = useSeoFlowLayout({
  containerRef: processMapRef,
  viewBox: flowViewBox,
})

const signalParticles = Array.from({ length: 150 }, (_, index) => {
  const column = index % 20
  const row = Math.floor(index / 20)
  const left = 2 + column * 4.7 + ((row % 2) * 1.2)
  const top = 7 + row * 10.2 + ((column % 3) * 1.2)
  const size = 2 + ((index * 7) % 4)
  const opacity = 0.12 + ((index * 13) % 42) / 100
  const tone = index % 5 === 0 ? 'moss' : 'copper'

  return {
    id: `seo-signal-particle-${index}`,
    tone,
    style: `left:${left}%;top:${top}%;width:${size}px;height:${size}px;opacity:${opacity};`,
  }
})
</script>

<template>
  <section
    class="relative h-full w-full"
    aria-labelledby="seo-process-map-title"
  >
    <h2 id="seo-process-map-title" class="sr-only">
      SEO Agent workflow diagram
    </h2>

    <div ref="processMapRef" class="relative h-full min-h-[340px] min-[1800px]:min-h-[390px]">
      <div class="seo-signal-cloud pointer-events-none absolute z-[1] hidden lg:block" aria-hidden="true">
        <span
          v-for="particle in signalParticles"
          :key="particle.id"
          class="seo-signal-cloud__particle"
          :class="`seo-signal-cloud__particle--${particle.tone}`"
          :style="particle.style"
        />
      </div>

      <SeoFlowLines
        class="absolute inset-0 z-[2] hidden lg:block"
        :paths="flowPaths"
        :view-box="flowViewBox"
        :show-endpoints="isFlowMeasured"
        :show-streams="false"
      />
      <SeoParticleField
        class="z-[3] hidden lg:block"
        overlay
        :paths="particlePaths"
        :config="{
          particleCount: 44,
          mobileParticleCount: 0,
          speed: { min: 0.045, max: 0.105 },
          radius: { min: 1.2, max: 2.5 },
          opacity: { min: 0.32, max: 0.82 },
          pulseStrength: 0.16,
          fpsCap: 30,
          seed: 41,
        }"
        view-box="0 0 1600 430"
        preserve-aspect-ratio="none"
        :show-guide-lines="false"
      />

      <div class="seo-process-coordinate relative z-10 h-full">
        <div class="seo-left-stack">
          <SeoProcessCard
            v-for="card in leftProcessCards"
            :id="card.id"
            :key="card.id"
            :title="card.title"
            :description="card.description"
            :items="card.items"
            :icon="card.icon"
            :tone="card.tone"
            :side="card.side"
            :eyebrow="card.eyebrow"
            :index-label="card.indexLabel"
            :compact="card.compact"
            :height="card.height"
          />
        </div>

        <div class="seo-center-slot">
          <SeoCenterNode :node="centerNode" />
        </div>

        <div class="seo-right-stack">
          <SeoProcessCard
            v-for="card in rightProcessCards"
            :id="card.id"
            :key="card.id"
            :title="card.title"
            :description="card.description"
            :items="card.items"
            :icon="card.icon"
            :tone="card.tone"
            :side="card.side"
            :eyebrow="card.eyebrow"
            :index-label="card.indexLabel"
            :compact="card.compact"
            :height="card.height"
          />
        </div>

        <div class="seo-brief-slot">
          <SeoBriefPreview :brief="briefPreview" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.seo-signal-cloud {
  left: 13%;
  top: 10%;
  width: 39%;
  height: 78%;
  mask-image: radial-gradient(circle at 55% 50%, #000 0%, #000 56%, transparent 86%);
}

.seo-process-coordinate {
  --left-top: 18px;
  --left-width: 180px;
  --left-height: 318px;
  --center-x: 39%;
  --center-y: calc(var(--left-top) + var(--left-height) / 2);
  --right-x: 57%;
  --right-top: 30px;
  --right-width: 220px;
  --right-gap: 18px;
  --brief-width: 280px;
  --brief-top: 12px;
}

.seo-left-stack {
  position: absolute;
  top: var(--left-top);
  left: 0;
  display: flex;
  width: var(--left-width);
  height: var(--left-height);
  flex-direction: column;
  justify-content: space-between;
}

.seo-center-slot {
  position: absolute;
  top: var(--center-y);
  left: var(--center-x);
  transform: translate(-50%, -50%);
}

.seo-right-stack {
  position: absolute;
  top: var(--right-top);
  left: var(--right-x);
  display: flex;
  width: var(--right-width);
  flex-direction: column;
  gap: var(--right-gap);
}

.seo-brief-slot {
  position: absolute;
  top: var(--brief-top);
  right: 0;
  width: var(--brief-width);
}

.seo-signal-cloud__particle {
  position: absolute;
  display: block;
  border: 1px solid currentColor;
  border-radius: 1px;
}

.seo-signal-cloud__particle--copper {
  color: rgba(213, 154, 97, 0.78);
  background: rgba(213, 154, 97, 0.10);
}

.seo-signal-cloud__particle--moss {
  color: rgba(137, 163, 118, 0.74);
  background: rgba(137, 163, 118, 0.10);
}

@media (min-width: 1800px) {
  .seo-signal-cloud {
    left: 13%;
    top: 9%;
    width: 38%;
    height: 80%;
  }

  .seo-process-coordinate {
    --left-top: 24px;
    --left-width: 200px;
    --left-height: 354px;
    --center-x: 39%;
    --right-x: 57%;
    --right-top: 36px;
    --right-width: 230px;
    --right-gap: 20px;
    --brief-width: 300px;
    --brief-top: 18px;
  }
}
</style>
