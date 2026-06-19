<script setup lang="ts">
import type {
  SeoFlowMotionConfig,
  SeoFlowMotionFrame,
  SeoFlowMotionPath,
  SeoFlowMotionStatus,
  SeoFlowPathSample,
  SeoParticleFieldApi,
} from '@/types/seo-flow-motion'

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  createSeoFlowPathSamplers,
  sampleSeoFlowPathSampler,
  useSeoFlowMotion,
} from '@/hooks/useSeoFlowMotion'

interface SeoParticleFieldProps {
  paths?: SeoFlowMotionPath[]
  config?: Partial<SeoFlowMotionConfig>
  active?: boolean
  overlay?: boolean
  showGuideLines?: boolean
  decorative?: boolean
  viewBox?: string
  preserveAspectRatio?: string
  ariaLabel?: string
}

interface StaticGlowPoint extends SeoFlowPathSample {
  id: string
  radius: number
  opacity: number
  color: string
}

interface ParsedViewBox {
  minX: number
  minY: number
  width: number
  height: number
}

interface CanvasProjection {
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
}

const props = withDefaults(defineProps<SeoParticleFieldProps>(), {
  active: true,
  overlay: false,
  showGuideLines: true,
  decorative: true,
  viewBox: '0 0 640 360',
  preserveAspectRatio: 'xMidYMid meet',
  ariaLabel: 'SEO Agent workflow motion',
})

const emit = defineEmits<{
  ready: [api: SeoParticleFieldApi]
  motionStart: []
  motionStop: []
  motionStatusChange: [status: SeoFlowMotionStatus]
}>()

const DEFAULT_SEO_FLOW_PATHS: SeoFlowMotionPath[] = [
  {
    id: 'brief-to-agent',
    points: [
      { x: 62, y: 184 },
      { x: 156, y: 184 },
      { x: 214, y: 122 },
      { x: 304, y: 122 },
    ],
    weight: 1.1,
    color: 'rgb(14 165 233)',
    glowColor: 'rgb(125 211 252)',
    particleColor: 'rgb(56 189 248)',
  },
  {
    id: 'agent-to-keywords',
    points: [
      { x: 304, y: 122 },
      { x: 396, y: 122 },
      { x: 458, y: 78 },
      { x: 568, y: 78 },
    ],
    weight: 0.9,
    color: 'rgb(16 185 129)',
    glowColor: 'rgb(110 231 183)',
    particleColor: 'rgb(52 211 153)',
  },
  {
    id: 'agent-to-outline',
    points: [
      { x: 304, y: 122 },
      { x: 396, y: 122 },
      { x: 458, y: 184 },
      { x: 578, y: 184 },
    ],
    weight: 1.2,
    color: 'rgb(245 158 11)',
    glowColor: 'rgb(252 211 77)',
    particleColor: 'rgb(251 191 36)',
  },
]

const STATIC_GLOW_PROGRESS = [0.18, 0.54, 0.84] as const
const MAX_CANVAS_DPR = 2

const containerRef = ref<Element | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let resizeObserver: ResizeObserver | null = null
let canvasContext: CanvasRenderingContext2D | null = null
let canvasCssWidth = 0
let canvasCssHeight = 0
let canvasDpr = 1
let lastFrame: SeoFlowMotionFrame = {
  elapsedMs: 0,
  deltaMs: 0,
  particles: [],
}

const activePaths = computed(() => {
  if (props.paths && props.paths.length > 0)
    return props.paths

  return DEFAULT_SEO_FLOW_PATHS
})

const motionConfig = computed(() => props.config ?? {})

const activeState = computed(() => props.active)

const parsedViewBox = computed(() => parseViewBox(props.viewBox))

const staticGlowPoints = computed<StaticGlowPoint[]>(() => {
  const samplers = createSeoFlowPathSamplers(activePaths.value)
  const glowPoints: StaticGlowPoint[] = []

  samplers.forEach((sampler, samplerIndex) => {
    STATIC_GLOW_PROGRESS.forEach((progress, glowIndex) => {
      const sample = sampleSeoFlowPathSampler(sampler, progress)

      glowPoints.push({
        ...sample,
        id: `${sampler.id}-glow-${glowIndex}`,
        radius: 3 + (samplerIndex + glowIndex) % 3,
        opacity: 0.14 + glowIndex * 0.07,
        color: sampler.path.glowColor ?? sampler.path.particleColor ?? sampler.path.color ?? 'rgb(125 211 252)',
      })
    })
  })

  return glowPoints
})

const rootClass = computed(() => {
  return [
    props.overlay ? 'absolute inset-0 h-full' : 'relative aspect-[16/9] min-h-[260px]',
    'pointer-events-none block w-full overflow-hidden',
  ]
})

const motion = useSeoFlowMotion({
  containerRef,
  paths: activePaths,
  config: motionConfig,
  active: activeState,
  renderFrame,
  onStatusChange: status => emit('motionStatusChange', status),
})

const particleFieldApi: SeoParticleFieldApi = {
  start: motion.start,
  stop: motion.stop,
  restart: motion.restart,
}
const isReducedMotion = motion.isReducedMotion

watch(() => motion.isRunning.value, (isRunning) => {
  if (isRunning) {
    emit('motionStart')
    return
  }

  emit('motionStop')
})

watch(
  [parsedViewBox, () => props.preserveAspectRatio],
  () => drawCanvas(lastFrame),
  {
    flush: 'post',
  },
)

watch(
  [isReducedMotion, staticGlowPoints],
  () => drawCanvas(lastFrame),
  {
    flush: 'post',
  },
)

onMounted(() => {
  setupCanvasResize()
  resizeCanvas()
  emit('ready', particleFieldApi)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  canvasContext = null
})

function setupCanvasResize() {
  resizeObserver?.disconnect()
  resizeObserver = null

  const canvas = canvasRef.value

  if (!canvas || typeof ResizeObserver === 'undefined')
    return

  resizeObserver = new ResizeObserver(() => resizeCanvas())
  resizeObserver.observe(canvas)
}

function resizeCanvas() {
  const canvas = canvasRef.value

  if (!canvas)
    return

  const rect = canvas.getBoundingClientRect()
  const nextCssWidth = Math.max(0, rect.width)
  const nextCssHeight = Math.max(0, rect.height)
  const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR)
  const nextWidth = Math.max(1, Math.round(nextCssWidth * nextDpr))
  const nextHeight = Math.max(1, Math.round(nextCssHeight * nextDpr))

  canvasCssWidth = nextCssWidth
  canvasCssHeight = nextCssHeight
  canvasDpr = nextDpr

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth
    canvas.height = nextHeight
    canvasContext = canvas.getContext('2d')
  }

  drawCanvas(lastFrame)
}

function renderFrame(frame: SeoFlowMotionFrame) {
  lastFrame = frame
  drawCanvas(frame)
}

function drawCanvas(frame: SeoFlowMotionFrame) {
  const canvas = canvasRef.value

  if (!canvas || canvasCssWidth <= 0 || canvasCssHeight <= 0)
    return

  const context = canvasContext ?? canvas.getContext('2d')

  if (!context)
    return

  canvasContext = context
  context.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0)
  context.clearRect(0, 0, canvasCssWidth, canvasCssHeight)

  const projection = getProjection()

  if (props.showGuideLines)
    drawGuideLines(context, projection)

  if (isReducedMotion.value) {
    drawStaticGlow(context, projection)
    return
  }

  drawParticles(context, projection, frame.particles)
}

function drawGuideLines(context: CanvasRenderingContext2D, projection: CanvasProjection) {
  context.save()
  context.globalAlpha = 0.22
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 1.35

  for (const path of activePaths.value) {
    if (path.points.length < 2)
      continue

    const firstPoint = projectPoint(path.points[0], projection)

    context.beginPath()
    context.moveTo(firstPoint.x, firstPoint.y)

    for (let index = 1; index < path.points.length; index += 1) {
      const point = projectPoint(path.points[index], projection)

      context.lineTo(point.x, point.y)
    }

    context.strokeStyle = path.color ?? 'rgb(14 165 233)'
    context.stroke()
  }

  context.restore()
}

function drawParticles(
  context: CanvasRenderingContext2D,
  projection: CanvasProjection,
  particles: SeoFlowMotionFrame['particles'],
) {
  if (particles.length === 0)
    return

  const radiusScale = getRadiusScale(projection)

  context.save()
  context.globalCompositeOperation = 'lighter'

  for (const particle of particles) {
    const point = projectPoint(particle, projection)
    const radius = Math.max(1, particle.radius * radiusScale)

    context.globalAlpha = particle.opacity * 0.46
    context.shadowBlur = radius * 5.8
    context.shadowColor = particle.color
    context.fillStyle = particle.color
    context.beginPath()
    context.arc(point.x, point.y, radius * 1.55, 0, Math.PI * 2)
    context.fill()

    context.globalAlpha = particle.opacity
    context.shadowBlur = 0
    context.beginPath()
    context.arc(point.x, point.y, radius * 0.78, 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
}

function drawStaticGlow(context: CanvasRenderingContext2D, projection: CanvasProjection) {
  const radiusScale = getRadiusScale(projection)

  context.save()
  context.globalCompositeOperation = 'lighter'

  for (const glowPoint of staticGlowPoints.value) {
    const point = projectPoint(glowPoint, projection)
    const radius = Math.max(1, glowPoint.radius * radiusScale)

    context.globalAlpha = glowPoint.opacity
    context.shadowBlur = radius * 4.4
    context.shadowColor = glowPoint.color
    context.fillStyle = glowPoint.color
    context.beginPath()
    context.arc(point.x, point.y, radius, 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
}

function getProjection(): CanvasProjection {
  const viewBox = parsedViewBox.value
  const scaleX = canvasCssWidth / viewBox.width
  const scaleY = canvasCssHeight / viewBox.height

  if (props.preserveAspectRatio === 'none') {
    return {
      offsetX: -viewBox.minX * scaleX,
      offsetY: -viewBox.minY * scaleY,
      scaleX,
      scaleY,
    }
  }

  const scale = Math.min(scaleX, scaleY)

  return {
    offsetX: (canvasCssWidth - viewBox.width * scale) / 2 - viewBox.minX * scale,
    offsetY: (canvasCssHeight - viewBox.height * scale) / 2 - viewBox.minY * scale,
    scaleX: scale,
    scaleY: scale,
  }
}

function projectPoint(
  point: { x: number, y: number },
  projection: CanvasProjection,
): { x: number, y: number } {
  return {
    x: projection.offsetX + point.x * projection.scaleX,
    y: projection.offsetY + point.y * projection.scaleY,
  }
}

function getRadiusScale(projection: CanvasProjection): number {
  return (projection.scaleX + projection.scaleY) / 2
}

function parseViewBox(value: string): ParsedViewBox {
  const parts = value.trim().split(/\s+/).map(Number)

  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) {
    return {
      minX: 0,
      minY: 0,
      width: 640,
      height: 360,
    }
  }

  const [minX, minY, width, height] = parts

  return {
    minX,
    minY,
    width: Math.max(1, width),
    height: Math.max(1, height),
  }
}

defineExpose({
  isRunning: motion.isRunning,
  isReducedMotion: motion.isReducedMotion,
  pauseReasons: motion.pauseReasons,
  start: motion.start,
  stop: motion.stop,
  restart: motion.restart,
})
</script>

<template>
  <div
    ref="containerRef"
    :class="rootClass"
    :aria-hidden="decorative ? true : undefined"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : ariaLabel"
  >
    <canvas
      ref="canvasRef"
      class="block h-full w-full"
    />
  </div>
</template>
