<script setup lang="ts">
import type {
  BriefPreviewConfig,
  CenterNodeConfig,
  FlowViewBox,
  ProcessCardConfig,
} from '@/types/flow'

import { ref } from 'vue'

import BriefPreview from '@/components/home/BriefPreview.vue'
import CenterNode from '@/components/home/CenterNode.vue'
import FlowLines from '@/components/home/FlowLines.vue'
import ParticleField from '@/components/home/ParticleField.vue'
import ProcessCard from '@/components/home/ProcessCard.vue'
import { useFlowLayout } from '@/hooks/useFlowLayout'

const leftProcessCards: ProcessCardConfig[] = [
  {
    id: 'user-question',
    eyebrow: 'Input',
    title: 'User question',
    description: 'Natural language',
    icon: 'tabler:file-description',
    tone: 'copper',
    side: 'left',
    indexLabel: '01',
    height: 'short',
    items: [],
  },
  {
    id: 'chat-history',
    eyebrow: 'Context',
    title: 'Chat history',
    description: 'Turns · Budget',
    icon: 'tabler:radar-2',
    tone: 'moss',
    side: 'left',
    indexLabel: '02',
    height: 'tall',
    items: [],
  },
  {
    id: 'article-library',
    eyebrow: 'Knowledge',
    title: 'Article library',
    description: 'Chunks · Vectors',
    icon: 'tabler:target',
    tone: 'moss',
    side: 'left',
    indexLabel: '03',
    height: 'medium',
    items: [],
  },
]

const centerNode: CenterNodeConfig = {
  id: 'agent-core',
  eyebrow: 'Orchestrator',
  label: 'Agent Runtime',
  description: 'Plan · Call · Verify',
  sparkLabel: 'Agent spark',
  metrics: [
    { id: 'prompt', label: 'Prompt', value: 'Role' },
    { id: 'tools', label: 'Tools', value: 'Guard' },
    { id: 'review', label: 'Check', value: 'Pass' },
  ],
}

const rightProcessCards: ProcessCardConfig[] = [
  {
    id: 'keyword-search',
    eyebrow: 'Search',
    title: 'Keyword search',
    description: 'Title · Slug · Keywords',
    icon: 'tabler:clipboard-list',
    tone: 'sand',
    side: 'right',
    indexLabel: '04',
    compact: true,
    items: [],
  },
]

const briefPreview: BriefPreviewConfig = {
  id: 'answer',
  fileName: 'Answer',
  status: 'Ready for review',
}

const flowViewBox: FlowViewBox = {
  width: 1600,
  height: 430,
}

const processMapRef = ref<HTMLElement | null>(null)
const { flowPaths, particlePaths, isMeasured: isFlowMeasured } = useFlowLayout({
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
    id: `signal-particle-${index}`,
    tone,
    style: `left:${left}%;top:${top}%;width:${size}px;height:${size}px;opacity:${opacity};`,
  }
})
</script>

<template>
  <section
    class="relative h-full w-full"
    aria-labelledby="process-map-title"
  >
    <h2 id="process-map-title" class="sr-only">
      Agent workflow diagram
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

      <FlowLines
        class="absolute inset-0 z-[2] hidden lg:block"
        :paths="flowPaths"
        :view-box="flowViewBox"
        :show-endpoints="isFlowMeasured"
        :show-streams="false"
      />
      <ParticleField
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
          <ProcessCard
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
          <CenterNode :node="centerNode" />
        </div>

        <div class="seo-right-stack">
          <ProcessCard
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
          <BriefPreview :brief="briefPreview" />
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
  --right-width: 220px;
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
  top: var(--center-y);
  left: var(--right-x);
  display: flex;
  width: var(--right-width);
  flex-direction: column;
  transform: translateY(-50%);
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
    --right-width: 230px;
    --brief-width: 300px;
    --brief-top: 18px;
  }
}
</style>
