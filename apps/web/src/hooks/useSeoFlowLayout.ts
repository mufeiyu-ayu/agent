import type { Ref } from 'vue'
import type {
  SeoFlowParticlePathConfig,
  SeoFlowPathConfig,
  SeoFlowPathTone,
  SeoFlowPoint,
  SeoFlowStreamDelay,
  SeoFlowViewBox,
} from '@/types/seo-flow'

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

type FlowAnchorSide = 'left' | 'right'

type FlowRouteType = 'inbound' | 'fanout' | 'handoff'

interface UseSeoFlowLayoutOptions {
  containerRef: Ref<HTMLElement | null>
  viewBox: SeoFlowViewBox
}

interface FlowRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface FlowPathDefinition {
  id: string
  from: string
  to: string
  fromSide: FlowAnchorSide
  toSide: FlowAnchorSide
  fromRatio: number
  toRatio: number
  route: FlowRouteType
  tone: SeoFlowPathTone
  bend?: number
  streamDelay?: SeoFlowStreamDelay
  weight?: number
  reverse?: boolean
  color: string
  glowColor: string
  particleColor: string
}

interface FlowCurve {
  d: string
  points: SeoFlowPoint[]
}

const COPPER_PARTICLE = {
  color: 'rgba(213,154,97,0.52)',
  glowColor: 'rgba(240,193,143,0.72)',
  particleColor: 'rgb(240 193 143)',
}

const MOSS_PARTICLE = {
  color: 'rgba(137,163,118,0.48)',
  glowColor: 'rgba(182,196,173,0.66)',
  particleColor: 'rgb(182 196 173)',
}

const SAND_PARTICLE = {
  color: 'rgba(223,193,157,0.45)',
  glowColor: 'rgba(244,223,197,0.72)',
  particleColor: 'rgb(244 223 197)',
}

const NEUTRAL_PARTICLE = {
  color: 'rgba(222,209,191,0.38)',
  glowColor: 'rgba(244,234,220,0.54)',
  particleColor: 'rgb(244 234 220)',
}

const FLOW_PATH_DEFINITIONS: FlowPathDefinition[] = [
  {
    id: 'seo-flow-page-to-agent',
    from: 'page-input',
    to: 'seo-agent-core',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.38,
    route: 'inbound',
    tone: 'copper',
    bend: -28,
    streamDelay: 'short',
    weight: 1.2,
    ...COPPER_PARTICLE,
  },
  {
    id: 'seo-flow-signals-to-agent',
    from: 'content-signals',
    to: 'seo-agent-core',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.50,
    route: 'inbound',
    tone: 'moss',
    bend: 0,
    streamDelay: 'medium',
    weight: 1,
    ...MOSS_PARTICLE,
  },
  {
    id: 'seo-flow-intent-to-agent',
    from: 'search-intent',
    to: 'seo-agent-core',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.62,
    route: 'inbound',
    tone: 'moss',
    bend: 28,
    streamDelay: 'long',
    weight: 1,
    ...MOSS_PARTICLE,
  },
  {
    id: 'seo-flow-agent-to-audit',
    from: 'seo-agent-core',
    to: 'page-audit',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.31,
    toRatio: 0.50,
    route: 'fanout',
    tone: 'sand',
    bend: -46,
    streamDelay: 'short',
    weight: 1,
    ...SAND_PARTICLE,
  },
  {
    id: 'seo-flow-agent-to-keywords',
    from: 'seo-agent-core',
    to: 'keyword-discovery',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.43,
    toRatio: 0.50,
    route: 'fanout',
    tone: 'moss',
    bend: -16,
    streamDelay: 'medium',
    weight: 0.85,
    ...MOSS_PARTICLE,
  },
  {
    id: 'seo-flow-agent-to-plan',
    from: 'seo-agent-core',
    to: 'content-plan',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.57,
    toRatio: 0.50,
    route: 'fanout',
    tone: 'sand',
    bend: 16,
    streamDelay: 'long',
    weight: 0.95,
    ...SAND_PARTICLE,
  },
  {
    id: 'seo-flow-agent-to-linking',
    from: 'seo-agent-core',
    to: 'internal-linking',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.69,
    toRatio: 0.50,
    route: 'fanout',
    tone: 'moss',
    bend: 46,
    streamDelay: 'short',
    weight: 0.8,
    ...MOSS_PARTICLE,
  },
  {
    id: 'seo-flow-audit-to-brief',
    from: 'page-audit',
    to: 'search-ready-brief',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.30,
    route: 'handoff',
    tone: 'copper',
    streamDelay: 'short',
    weight: 0.7,
    ...COPPER_PARTICLE,
  },
  {
    id: 'seo-flow-keywords-to-brief',
    from: 'keyword-discovery',
    to: 'search-ready-brief',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.42,
    route: 'handoff',
    tone: 'moss',
    streamDelay: 'medium',
    weight: 0.72,
    ...MOSS_PARTICLE,
  },
  {
    id: 'seo-flow-plan-to-brief',
    from: 'content-plan',
    to: 'search-ready-brief',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.55,
    route: 'handoff',
    tone: 'sand',
    streamDelay: 'long',
    weight: 0.72,
    ...SAND_PARTICLE,
  },
  {
    id: 'seo-flow-linking-to-brief',
    from: 'internal-linking',
    to: 'search-ready-brief',
    fromSide: 'right',
    toSide: 'left',
    fromRatio: 0.50,
    toRatio: 0.67,
    route: 'handoff',
    tone: 'neutral',
    weight: 0.62,
    ...NEUTRAL_PARTICLE,
  },
]

const FLOW_NODE_IDS = Array.from(
  new Set(FLOW_PATH_DEFINITIONS.flatMap(definition => [definition.from, definition.to])),
)

export function useSeoFlowLayout(options: UseSeoFlowLayoutOptions) {
  const flowPaths = ref<SeoFlowPathConfig[]>([])
  const particlePaths = ref<SeoFlowParticlePathConfig[]>([])
  const isMeasured = ref(false)

  let resizeObserver: ResizeObserver | null = null
  let animationFrameId: number | null = null

  function refresh() {
    if (typeof window === 'undefined')
      return

    if (animationFrameId !== null)
      return

    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = null
      measureLayout()
    })
  }

  function setupResizeObserver() {
    resizeObserver?.disconnect()
    resizeObserver = null

    const root = options.containerRef.value

    if (!root || typeof ResizeObserver === 'undefined')
      return

    resizeObserver = new ResizeObserver(() => refresh())
    resizeObserver.observe(root)

    for (const nodeId of FLOW_NODE_IDS) {
      const element = findFlowElement(root, nodeId)

      if (element)
        resizeObserver.observe(element)
    }
  }

  function measureLayout() {
    const root = options.containerRef.value

    if (!root) {
      clearMeasurements()
      return
    }

    const rootRect = root.getBoundingClientRect()

    if (rootRect.width <= 0 || rootRect.height <= 0) {
      clearMeasurements()
      return
    }

    const rects = new Map<string, FlowRect>()

    for (const nodeId of FLOW_NODE_IDS) {
      const element = findFlowElement(root, nodeId)

      if (!element) {
        clearMeasurements()
        return
      }

      rects.set(nodeId, readFlowRect(element, rootRect, options.viewBox))
    }

    const nextFlowPaths: SeoFlowPathConfig[] = []
    const nextParticlePaths: SeoFlowParticlePathConfig[] = []

    for (const definition of FLOW_PATH_DEFINITIONS) {
      const fromRect = rects.get(definition.from)
      const toRect = rects.get(definition.to)

      if (!fromRect || !toRect)
        continue

      const start = getAnchorPoint(fromRect, definition.fromSide, definition.fromRatio)
      const end = getAnchorPoint(toRect, definition.toSide, definition.toRatio)
      const curve = createFlowCurve(start, end, definition.route, definition.bend ?? 0)

      nextFlowPaths.push({
        id: definition.id,
        from: definition.from,
        to: definition.to,
        d: curve.d,
        tone: definition.tone,
        start,
        end,
        streamDelay: definition.streamDelay,
      })

      nextParticlePaths.push({
        id: `particle-${definition.id}`,
        points: curve.points,
        weight: definition.weight,
        reverse: definition.reverse,
        color: definition.color,
        glowColor: definition.glowColor,
        particleColor: definition.particleColor,
      })
    }

    flowPaths.value = nextFlowPaths
    particlePaths.value = nextParticlePaths
    isMeasured.value = nextFlowPaths.length > 0
  }

  function clearMeasurements() {
    flowPaths.value = []
    particlePaths.value = []
    isMeasured.value = false
  }

  watch(
    () => options.containerRef.value,
    async () => {
      await nextTick()
      setupResizeObserver()
      refresh()
    },
    {
      flush: 'post',
    },
  )

  onMounted(async () => {
    await nextTick()
    setupResizeObserver()
    refresh()
    window.addEventListener('resize', refresh, { passive: true })
    window.addEventListener('orientationchange', refresh, { passive: true })
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
    resizeObserver = null

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    window.removeEventListener('resize', refresh)
    window.removeEventListener('orientationchange', refresh)
  })

  return {
    flowPaths,
    particlePaths,
    isMeasured,
    refresh,
  }
}

function findFlowElement(root: HTMLElement, nodeId: string): HTMLElement | null {
  const selectors = [
    `[data-seo-process-card="${nodeId}"]`,
    `[data-seo-center-node="${nodeId}"]`,
    `[data-seo-brief-preview="${nodeId}"]`,
  ]

  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector)

    if (element)
      return element
  }

  return null
}

function readFlowRect(
  element: HTMLElement,
  rootRect: DOMRect,
  viewBox: SeoFlowViewBox,
): FlowRect {
  const rect = element.getBoundingClientRect()
  const scaleX = viewBox.width / rootRect.width
  const scaleY = viewBox.height / rootRect.height
  const left = (rect.left - rootRect.left) * scaleX
  const right = (rect.right - rootRect.left) * scaleX
  const top = (rect.top - rootRect.top) * scaleY
  const bottom = (rect.bottom - rootRect.top) * scaleY

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function getAnchorPoint(rect: FlowRect, side: FlowAnchorSide, ratio: number): SeoFlowPoint {
  const y = rect.top + rect.height * ratio

  return {
    x: side === 'right' ? rect.right : rect.left,
    y,
  }
}

function createFlowCurve(
  start: SeoFlowPoint,
  end: SeoFlowPoint,
  route: FlowRouteType,
  bend: number,
): FlowCurve {
  if (route === 'fanout')
    return createFanoutCurve(start, end)

  if (route === 'handoff')
    return createHandoffCurve(start, end)

  return createHorizontalCurve(start, end, route, bend)
}

function createHorizontalCurve(
  start: SeoFlowPoint,
  end: SeoFlowPoint,
  route: FlowRouteType,
  bend: number,
): FlowCurve {
  const direction = end.x >= start.x ? 1 : -1
  const distance = Math.abs(end.x - start.x)
  const controlDistance = getControlDistance(distance, route)
  const endBendRatio = route === 'handoff' ? 0.22 : 0.34
  const controlA = {
    x: start.x + direction * controlDistance,
    y: start.y + bend,
  }
  const controlB = {
    x: end.x - direction * controlDistance,
    y: end.y - bend * endBendRatio,
  }
  const points = sampleCubicBezier(start, controlA, controlB, end, 22)

  return {
    d: [
      'M',
      formatFlowNumber(start.x),
      formatFlowNumber(start.y),
      'C',
      formatFlowNumber(controlA.x),
      formatFlowNumber(controlA.y),
      formatFlowNumber(controlB.x),
      formatFlowNumber(controlB.y),
      formatFlowNumber(end.x),
      formatFlowNumber(end.y),
    ].join(' '),
    points,
  }
}

function createFanoutCurve(start: SeoFlowPoint, end: SeoFlowPoint): FlowCurve {
  const distance = Math.max(1, end.x - start.x)
  const verticalDelta = end.y - start.y
  const verticalDistance = Math.abs(verticalDelta)

  if (verticalDistance < 8)
    return createHorizontalCurve(start, end, 'fanout', 0)

  const directionY = verticalDelta > 0 ? 1 : -1
  const horizontalLength = clampNumber(distance * 0.56, 150, 260)
  const busX = Math.max(
    start.x + 92,
    Math.min(end.x - 76, end.x - horizontalLength),
  )
  const leftSpace = busX - start.x
  const rightSpace = end.x - busX

  if (leftSpace < 28 || rightSpace < 48)
    return createHorizontalCurve(start, end, 'fanout', 0)

  const maxRadius = Math.min(
    verticalDistance / 2,
    leftSpace - 8,
    rightSpace - 18,
    74,
  )

  if (maxRadius < 10)
    return createHorizontalCurve(start, end, 'fanout', 0)

  const radius = clampNumber(maxRadius, 10, 74)
  const firstCornerStart = {
    x: busX - radius,
    y: start.y,
  }
  const firstCornerEnd = {
    x: busX,
    y: start.y + directionY * radius,
  }
  const verticalEnd = {
    x: busX,
    y: end.y - directionY * radius,
  }
  const secondCornerEnd = {
    x: busX + radius,
    y: end.y,
  }
  const firstControlA = {
    x: firstCornerStart.x + radius * 0.58,
    y: start.y,
  }
  const firstControlB = {
    x: busX,
    y: start.y + directionY * radius * 0.42,
  }
  const secondControlA = {
    x: busX,
    y: end.y - directionY * radius * 0.42,
  }
  const secondControlB = {
    x: secondCornerEnd.x - radius * 0.58,
    y: end.y,
  }
  const points = [
    ...sampleLineSegment(start, firstCornerStart, 5),
    ...sampleCubicBezier(firstCornerStart, firstControlA, firstControlB, firstCornerEnd, 10).slice(1),
    ...sampleLineSegment(firstCornerEnd, verticalEnd, 8).slice(1),
    ...sampleCubicBezier(verticalEnd, secondControlA, secondControlB, secondCornerEnd, 10).slice(1),
    ...sampleLineSegment(secondCornerEnd, end, 8).slice(1),
  ]

  return {
    d: [
      'M',
      formatFlowNumber(start.x),
      formatFlowNumber(start.y),
      'L',
      formatFlowNumber(firstCornerStart.x),
      formatFlowNumber(firstCornerStart.y),
      'C',
      formatFlowNumber(firstControlA.x),
      formatFlowNumber(firstControlA.y),
      formatFlowNumber(firstControlB.x),
      formatFlowNumber(firstControlB.y),
      formatFlowNumber(firstCornerEnd.x),
      formatFlowNumber(firstCornerEnd.y),
      'L',
      formatFlowNumber(verticalEnd.x),
      formatFlowNumber(verticalEnd.y),
      'C',
      formatFlowNumber(secondControlA.x),
      formatFlowNumber(secondControlA.y),
      formatFlowNumber(secondControlB.x),
      formatFlowNumber(secondControlB.y),
      formatFlowNumber(secondCornerEnd.x),
      formatFlowNumber(secondCornerEnd.y),
      'L',
      formatFlowNumber(end.x),
      formatFlowNumber(end.y),
    ].join(' '),
    points,
  }
}

function createHandoffCurve(start: SeoFlowPoint, end: SeoFlowPoint): FlowCurve {
  const distance = Math.max(1, end.x - start.x)
  const verticalDelta = end.y - start.y
  const verticalDistance = Math.abs(verticalDelta)

  if (verticalDistance < 8)
    return createHorizontalCurve(start, end, 'handoff', 0)

  const directionY = verticalDelta > 0 ? 1 : -1
  const entryLead = clampNumber(distance * 0.38, 38, 64)
  const busX = end.x - entryLead
  const leftSpace = busX - start.x
  const rightSpace = end.x - busX

  if (leftSpace < 14 || rightSpace < 14)
    return createHorizontalCurve(start, end, 'handoff', 0)

  const maxRadius = Math.min(
    verticalDistance / 2,
    leftSpace - 4,
    rightSpace - 4,
  )
  const radius = Math.min(26, Math.max(6, maxRadius))
  const firstCornerStart = {
    x: busX - radius,
    y: start.y,
  }
  const firstCornerEnd = {
    x: busX,
    y: start.y + directionY * radius,
  }
  const verticalEnd = {
    x: busX,
    y: end.y - directionY * radius,
  }
  const secondCornerEnd = {
    x: busX + radius,
    y: end.y,
  }
  const firstControlA = {
    x: firstCornerStart.x + radius * 0.55,
    y: start.y,
  }
  const firstControlB = {
    x: busX,
    y: start.y + directionY * radius * 0.45,
  }
  const secondControlA = {
    x: busX,
    y: end.y - directionY * radius * 0.45,
  }
  const secondControlB = {
    x: secondCornerEnd.x - radius * 0.55,
    y: end.y,
  }
  const points = [
    ...sampleLineSegment(start, firstCornerStart, 5),
    ...sampleCubicBezier(firstCornerStart, firstControlA, firstControlB, firstCornerEnd, 8).slice(1),
    ...sampleLineSegment(firstCornerEnd, verticalEnd, 8).slice(1),
    ...sampleCubicBezier(verticalEnd, secondControlA, secondControlB, secondCornerEnd, 8).slice(1),
    ...sampleLineSegment(secondCornerEnd, end, 5).slice(1),
  ]

  return {
    d: [
      'M',
      formatFlowNumber(start.x),
      formatFlowNumber(start.y),
      'L',
      formatFlowNumber(firstCornerStart.x),
      formatFlowNumber(firstCornerStart.y),
      'C',
      formatFlowNumber(firstControlA.x),
      formatFlowNumber(firstControlA.y),
      formatFlowNumber(firstControlB.x),
      formatFlowNumber(firstControlB.y),
      formatFlowNumber(firstCornerEnd.x),
      formatFlowNumber(firstCornerEnd.y),
      'L',
      formatFlowNumber(verticalEnd.x),
      formatFlowNumber(verticalEnd.y),
      'C',
      formatFlowNumber(secondControlA.x),
      formatFlowNumber(secondControlA.y),
      formatFlowNumber(secondControlB.x),
      formatFlowNumber(secondControlB.y),
      formatFlowNumber(secondCornerEnd.x),
      formatFlowNumber(secondCornerEnd.y),
      'L',
      formatFlowNumber(end.x),
      formatFlowNumber(end.y),
    ].join(' '),
    points,
  }
}

function getControlDistance(distance: number, route: FlowRouteType): number {
  if (route === 'inbound')
    return clampNumber(distance * 0.48, 56, 210)

  if (route === 'fanout')
    return clampNumber(distance * 0.50, 54, 118)

  return clampNumber(distance * 0.48, 34, 82)
}

function sampleLineSegment(
  start: SeoFlowPoint,
  end: SeoFlowPoint,
  steps: number,
): SeoFlowPoint[] {
  const points: SeoFlowPoint[] = []

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps

    points.push({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    })
  }

  return points
}

function sampleCubicBezier(
  start: SeoFlowPoint,
  controlA: SeoFlowPoint,
  controlB: SeoFlowPoint,
  end: SeoFlowPoint,
  steps: number,
): SeoFlowPoint[] {
  const points: SeoFlowPoint[] = []

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps
    const inverse = 1 - progress
    const x = inverse ** 3 * start.x
      + 3 * inverse ** 2 * progress * controlA.x
      + 3 * inverse * progress ** 2 * controlB.x
      + progress ** 3 * end.x
    const y = inverse ** 3 * start.y
      + 3 * inverse ** 2 * progress * controlA.y
      + 3 * inverse * progress ** 2 * controlB.y
      + progress ** 3 * end.y

    points.push({ x, y })
  }

  return points
}

function formatFlowNumber(value: number): string {
  return value.toFixed(2)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
