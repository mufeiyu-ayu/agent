<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type {
  SeoFlowPathConfig,
  SeoFlowPathTone,
  SeoFlowStreamDelay,
  SeoFlowViewBox,
} from '@/types/seo-flow'

import { computed } from 'vue'

const props = withDefaults(defineProps<{
  paths: SeoFlowPathConfig[]
  viewBox?: SeoFlowViewBox
  showEndpoints?: boolean
  showStreams?: boolean
}>(), {
  viewBox: () => ({ width: 1120, height: 560 }),
  showEndpoints: true,
  showStreams: true,
})

const pathRefs = new Map<string, SVGPathElement>()

const toneClassMap: Record<SeoFlowPathTone, string> = {
  copper: 'seo-flow-path--copper',
  moss: 'seo-flow-path--moss',
  sand: 'seo-flow-path--sand',
  ink: 'seo-flow-path--ink',
  neutral: 'seo-flow-path--neutral',
}

const delayClassMap: Record<SeoFlowStreamDelay, string> = {
  none: '',
  short: 'seo-flow-stream--delay-short',
  medium: 'seo-flow-stream--delay-medium',
  long: 'seo-flow-stream--delay-long',
}

const svgViewBox = computed(() => `0 0 ${props.viewBox.width} ${props.viewBox.height}`)

const pathIds = computed(() => props.paths.map(path => path.id))

function setPathElement(pathId: string, element: Element | ComponentPublicInstance | null): void {
  if (element instanceof SVGPathElement) {
    pathRefs.set(pathId, element)
    return
  }

  pathRefs.delete(pathId)
}

function getPathElement(pathId: string): SVGPathElement | undefined {
  return pathRefs.get(pathId)
}

function getToneClass(tone: SeoFlowPathTone): string {
  return toneClassMap[tone]
}

function getDelayClass(delay: SeoFlowStreamDelay | undefined): string {
  return delayClassMap[delay ?? 'none']
}

defineExpose({
  getPathElement,
  pathIds,
  pathRefs,
})
</script>

<template>
  <svg
    class="seo-flow-lines h-full w-full"
    :viewBox="svgViewBox"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <g
      v-for="path in paths"
      :key="path.id"
      :data-seo-flow-from="path.from"
      :data-seo-flow-to="path.to"
    >
      <path
        :id="path.id"
        :ref="element => setPathElement(path.id, element)"
        class="seo-flow-path"
        :class="getToneClass(path.tone)"
        :d="path.d"
        pathLength="1"
      />
      <path
        v-if="showStreams"
        :id="`${path.id}-stream`"
        class="seo-flow-stream"
        :class="[getToneClass(path.tone), getDelayClass(path.streamDelay)]"
        :d="path.d"
        pathLength="1"
      />

      <g v-if="showEndpoints">
        <circle
          class="seo-flow-dot seo-flow-dot--outer"
          :class="getToneClass(path.tone)"
          :cx="path.start.x"
          :cy="path.start.y"
          r="3.6"
        />
        <circle
          class="seo-flow-dot seo-flow-dot--inner"
          :class="getToneClass(path.tone)"
          :cx="path.start.x"
          :cy="path.start.y"
          r="1.35"
        />
        <circle
          class="seo-flow-dot seo-flow-dot--outer"
          :class="getToneClass(path.tone)"
          :cx="path.end.x"
          :cy="path.end.y"
          r="3.6"
        />
        <circle
          class="seo-flow-dot seo-flow-dot--inner"
          :class="getToneClass(path.tone)"
          :cx="path.end.x"
          :cy="path.end.y"
          r="1.35"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.seo-flow-lines {
  overflow: visible;
  pointer-events: none;
}

.seo-flow-path,
.seo-flow-stream {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.seo-flow-path {
  opacity: 0.38;
  stroke-width: 1;
}

.seo-flow-stream {
  opacity: 0.64;
  stroke-dasharray: 0.055 0.945;
  stroke-dashoffset: 0;
  stroke-width: 1.9;
  animation: seo-flow-stream 5.8s ease-in-out infinite;
}

.seo-flow-dot {
  vector-effect: non-scaling-stroke;
}

.seo-flow-dot--outer {
  fill: #16130f;
  stroke: currentColor;
  stroke-width: 1.2;
  opacity: 0.9;
}

.seo-flow-dot--inner {
  fill: currentColor;
}

.seo-flow-path--copper {
  color: rgba(213, 154, 97, 0.96);
}

.seo-flow-path--moss {
  color: rgba(137, 163, 118, 0.9);
}

.seo-flow-path--sand {
  color: rgba(223, 193, 157, 0.88);
}

.seo-flow-path--ink {
  color: rgba(244, 234, 220, 0.72);
}

.seo-flow-path--neutral {
  color: rgba(222, 209, 191, 0.66);
}

.seo-flow-stream--delay-short {
  animation-delay: -1.4s;
}

.seo-flow-stream--delay-medium {
  animation-delay: -2.8s;
}

.seo-flow-stream--delay-long {
  animation-delay: -4.2s;
}

@keyframes seo-flow-stream {
  0% {
    stroke-dashoffset: 1;
  }

  58%,
  100% {
    stroke-dashoffset: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .seo-flow-stream {
    animation: none;
    opacity: 0.48;
  }
}
</style>
