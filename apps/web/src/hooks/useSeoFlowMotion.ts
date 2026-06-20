import type { MaybeRefOrGetter, Ref } from 'vue'
import type {
  SeoFlowMotionConfig,
  SeoFlowMotionFrame,
  SeoFlowMotionFrameRenderer,
  SeoFlowMotionPath,
  SeoFlowMotionPauseReason,
  SeoFlowMotionRange,
  SeoFlowMotionStatus,
  SeoFlowParticle,
  SeoFlowPathSample,
  SeoFlowPathSampler,
  SeoFlowPathSegment,
  SeoFlowRenderedParticle,
} from '../types/seo-flow-motion'

import { onMounted, onUnmounted, readonly, ref, toValue, watch } from 'vue'

export const DEFAULT_SEO_FLOW_MOTION_CONFIG: SeoFlowMotionConfig = {
  particleCount: 44,
  mobileParticleCount: 18,
  mobileBreakpoint: 768,
  speed: {
    min: 0.035,
    max: 0.09,
  },
  radius: {
    min: 1.4,
    max: 2.8,
  },
  opacity: {
    min: 0.38,
    max: 0.92,
  },
  pulseStrength: 0.22,
  fpsCap: 60,
  seed: 29,
}

export interface UseSeoFlowMotionOptions {
  containerRef?: Ref<Element | null>
  paths: MaybeRefOrGetter<SeoFlowMotionPath[]>
  config?: MaybeRefOrGetter<Partial<SeoFlowMotionConfig> | undefined>
  active?: MaybeRefOrGetter<boolean>
  autoStart?: boolean
  renderFrame: SeoFlowMotionFrameRenderer
  onStatusChange?: (status: SeoFlowMotionStatus) => void
}

export function createSeoFlowPathSamplers(paths: SeoFlowMotionPath[]): SeoFlowPathSampler[] {
  return paths
    .map((path) => {
      const segments = createPathSegments(path)
      const length = segments.reduce((total, segment) => total + segment.length, 0)

      return {
        id: path.id,
        path,
        length,
        segments,
      }
    })
    .filter(sampler => sampler.length > 0 && sampler.segments.length > 0)
}

export function sampleSeoFlowPathSampler(
  sampler: SeoFlowPathSampler,
  progress: number,
): SeoFlowPathSample {
  const normalizedProgress = normalizeProgress(progress)
  const targetDistance = normalizedProgress * sampler.length
  let selectedSegment = sampler.segments[sampler.segments.length - 1]

  for (const segment of sampler.segments) {
    if (targetDistance <= segment.startDistance + segment.length) {
      selectedSegment = segment
      break
    }
  }

  if (!selectedSegment) {
    const fallbackPoint = sampler.path.points[0] ?? { x: 0, y: 0 }

    return {
      pathId: sampler.id,
      x: fallbackPoint.x,
      y: fallbackPoint.y,
      angle: 0,
      progress: normalizedProgress,
    }
  }

  const localProgress = selectedSegment.length === 0
    ? 0
    : (targetDistance - selectedSegment.startDistance) / selectedSegment.length

  return {
    pathId: sampler.id,
    x: interpolateNumber(selectedSegment.from.x, selectedSegment.to.x, localProgress),
    y: interpolateNumber(selectedSegment.from.y, selectedSegment.to.y, localProgress),
    angle: selectedSegment.angle,
    progress: normalizedProgress,
  }
}

export function useSeoFlowMotion(options: UseSeoFlowMotionOptions) {
  const isRunning = ref(false)
  const isReducedMotion = ref(false)
  const isDocumentVisible = ref(true)
  const isIntersecting = ref(true)
  const pauseReasons = ref<SeoFlowMotionPauseReason[]>([])

  const renderedParticles: SeoFlowRenderedParticle[] = []
  let particles: SeoFlowParticle[] = []
  let samplers: SeoFlowPathSampler[] = []
  let samplerById = new Map<string, SeoFlowPathSampler>()
  let animationFrameId: number | null = null
  let frameTimeoutId: number | null = null
  let mediaQuery: MediaQueryList | null = null
  let intersectionObserver: IntersectionObserver | null = null
  let lastFrameTime = 0
  let startedAt = 0
  let activeParticleCount = 0
  let isMounted = false
  let isManuallyPaused = options.autoStart === false
  let lastStatusSignature = ''

  function start() {
    isManuallyPaused = false
    syncPlayback()
  }

  function stop() {
    isManuallyPaused = true
    syncPlayback()
  }

  function restart() {
    rebuildMotion()
    renderEmptyFrame()
    syncPlayback()
  }

  function rebuildMotion() {
    const config = resolveConfig()

    samplers = createSeoFlowPathSamplers(toValue(options.paths))
    samplerById = new Map(samplers.map(sampler => [sampler.id, sampler]))
    particles = createSeoFlowParticles(samplers, config)
    activeParticleCount = getActiveParticleCount(config)
  }

  function syncPlayback() {
    if (!isMounted)
      return

    updatePauseReasons()

    if (pauseReasons.value.length > 0) {
      cancelLoop(true)
      notifyStatusChange()
      return
    }

    if (isRunning.value) {
      notifyStatusChange()
      return
    }

    startedAt = performance.now()
    lastFrameTime = startedAt
    isRunning.value = true
    scheduleNextFrame()
    notifyStatusChange()
  }

  function scheduleNextFrame() {
    if (animationFrameId !== null || frameTimeoutId !== null)
      return

    const config = resolveConfig()
    const minFrameMs = 1000 / config.fpsCap
    const delayMs = Math.max(0, minFrameMs - (performance.now() - lastFrameTime))

    if (delayMs > 4) {
      frameTimeoutId = window.setTimeout(() => {
        frameTimeoutId = null
        animationFrameId = window.requestAnimationFrame(renderMotionFrame)
      }, delayMs)
      return
    }

    animationFrameId = window.requestAnimationFrame(renderMotionFrame)
  }

  function renderMotionFrame(now: number) {
    animationFrameId = null

    if (!isRunning.value)
      return

    const config = resolveConfig()
    const minFrameMs = 1000 / config.fpsCap

    if (now - lastFrameTime < minFrameMs) {
      scheduleNextFrame()
      return
    }

    const deltaMs = Math.min(now - lastFrameTime, 80)
    const elapsedMs = now - startedAt

    lastFrameTime = now
    activeParticleCount = getActiveParticleCount(config)
    renderParticles(elapsedMs, deltaMs, config)
    scheduleNextFrame()
  }

  function renderParticles(
    elapsedMs: number,
    deltaMs: number,
    config: SeoFlowMotionConfig,
  ) {
    renderedParticles.length = 0

    const count = Math.min(activeParticleCount, particles.length)
    const deltaSeconds = deltaMs / 1000

    for (let index = 0; index < count; index += 1) {
      const particle = particles[index]

      if (!particle)
        continue

      const sampler = samplerById.get(particle.pathId)

      if (!sampler)
        continue

      particle.progress = normalizeProgress(particle.progress + particle.speed * deltaSeconds)

      const sampledProgress = sampler.path.reverse ? 1 - particle.progress : particle.progress
      const sample = sampleSeoFlowPathSampler(sampler, sampledProgress)
      const phase = Math.sin(elapsedMs * 0.004 + particle.phase)
      const opacity = clampNumber(
        particle.opacity * (1 - config.pulseStrength / 2 + phase * config.pulseStrength),
        0,
        1,
      )

      renderedParticles.push({
        id: particle.id,
        pathId: particle.pathId,
        x: sample.x,
        y: sample.y,
        radius: particle.radius,
        opacity,
        color: particle.color,
        progress: sample.progress,
        angle: sampler.path.reverse ? sample.angle + Math.PI : sample.angle,
      })
    }

    const frame: SeoFlowMotionFrame = {
      elapsedMs,
      deltaMs,
      particles: renderedParticles,
    }

    options.renderFrame(frame)
  }

  function cancelLoop(shouldClearFrame: boolean) {
    if (frameTimeoutId !== null) {
      window.clearTimeout(frameTimeoutId)
      frameTimeoutId = null
    }

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    isRunning.value = false

    if (shouldClearFrame)
      renderEmptyFrame()
  }

  function renderEmptyFrame() {
    options.renderFrame({
      elapsedMs: 0,
      deltaMs: 0,
      particles: [],
    })
  }

  function updatePauseReasons() {
    const nextReasons: SeoFlowMotionPauseReason[] = []

    if (isManuallyPaused)
      nextReasons.push('manual')

    if (!getActiveState())
      nextReasons.push('inactive')

    if (!isDocumentVisible.value)
      nextReasons.push('document-hidden')

    if (!isIntersecting.value)
      nextReasons.push('offscreen')

    if (isReducedMotion.value)
      nextReasons.push('reduced-motion')

    if (samplers.length === 0 || particles.length === 0)
      nextReasons.push('empty-path')

    pauseReasons.value = nextReasons
  }

  function notifyStatusChange() {
    const status: SeoFlowMotionStatus = {
      running: isRunning.value,
      reducedMotion: isReducedMotion.value,
      documentVisible: isDocumentVisible.value,
      intersecting: isIntersecting.value,
      pauseReasons: [...pauseReasons.value],
    }
    const signature = JSON.stringify(status)

    if (signature === lastStatusSignature)
      return

    lastStatusSignature = signature
    options.onStatusChange?.(status)
  }

  function setupReducedMotionListener() {
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    isReducedMotion.value = mediaQuery.matches
    mediaQuery.addEventListener('change', handleReducedMotionChange)
  }

  function setupVisibilityListener() {
    isDocumentVisible.value = document.visibilityState !== 'hidden'
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  function observeContainer(element: Element | null) {
    intersectionObserver?.disconnect()
    intersectionObserver = null

    if (!element || !('IntersectionObserver' in window)) {
      isIntersecting.value = true
      syncPlayback()
      return
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]

        isIntersecting.value = entry?.isIntersecting ?? true
        syncPlayback()
      },
      {
        threshold: 0.08,
      },
    )
    intersectionObserver.observe(element)
  }

  function handleReducedMotionChange(event: MediaQueryListEvent) {
    isReducedMotion.value = event.matches
    syncPlayback()
  }

  function handleVisibilityChange() {
    isDocumentVisible.value = document.visibilityState !== 'hidden'
    syncPlayback()
  }

  function handleResize() {
    activeParticleCount = getActiveParticleCount(resolveConfig())
  }

  function getActiveState(): boolean {
    if (options.active === undefined)
      return true

    return toValue(options.active)
  }

  function resolveConfig(): SeoFlowMotionConfig {
    const input = toValue(options.config) ?? {}

    return {
      particleCount: normalizeCount(input.particleCount, DEFAULT_SEO_FLOW_MOTION_CONFIG.particleCount),
      mobileParticleCount: normalizeCount(
        input.mobileParticleCount,
        DEFAULT_SEO_FLOW_MOTION_CONFIG.mobileParticleCount,
      ),
      mobileBreakpoint: normalizeCount(
        input.mobileBreakpoint,
        DEFAULT_SEO_FLOW_MOTION_CONFIG.mobileBreakpoint,
      ),
      speed: normalizeRange(input.speed, DEFAULT_SEO_FLOW_MOTION_CONFIG.speed),
      radius: normalizeRange(input.radius, DEFAULT_SEO_FLOW_MOTION_CONFIG.radius),
      opacity: normalizeRange(input.opacity, DEFAULT_SEO_FLOW_MOTION_CONFIG.opacity),
      pulseStrength: clampNumber(
        input.pulseStrength ?? DEFAULT_SEO_FLOW_MOTION_CONFIG.pulseStrength,
        0,
        0.8,
      ),
      fpsCap: clampNumber(input.fpsCap ?? DEFAULT_SEO_FLOW_MOTION_CONFIG.fpsCap, 12, 120),
      seed: Math.max(1, Math.floor(input.seed ?? DEFAULT_SEO_FLOW_MOTION_CONFIG.seed)),
    }
  }

  function getActiveParticleCount(config: SeoFlowMotionConfig): number {
    if (typeof window === 'undefined')
      return config.particleCount

    const isMobile = window.innerWidth < config.mobileBreakpoint
    const count = isMobile ? config.mobileParticleCount : config.particleCount

    return Math.max(0, Math.floor(count))
  }

  watch(
    () => getActiveState(),
    () => syncPlayback(),
  )

  watch(
    () => toValue(options.paths),
    () => restart(),
    {
      deep: true,
    },
  )

  watch(
    () => toValue(options.config),
    () => restart(),
    {
      deep: true,
    },
  )

  watch(
    () => options.containerRef?.value ?? null,
    element => observeContainer(element),
    {
      flush: 'post',
    },
  )

  onMounted(() => {
    isMounted = true

    setupReducedMotionListener()
    setupVisibilityListener()
    window.addEventListener('resize', handleResize)
    observeContainer(options.containerRef?.value ?? null)
    rebuildMotion()
    syncPlayback()
  })

  onUnmounted(() => {
    isMounted = false
    cancelLoop(false)
    intersectionObserver?.disconnect()
    mediaQuery?.removeEventListener('change', handleReducedMotionChange)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('resize', handleResize)
  })

  return {
    isRunning: readonly(isRunning),
    isReducedMotion: readonly(isReducedMotion),
    isDocumentVisible: readonly(isDocumentVisible),
    isIntersecting: readonly(isIntersecting),
    pauseReasons: readonly(pauseReasons),
    start,
    stop,
    restart,
  }
}

function createPathSegments(path: SeoFlowMotionPath): SeoFlowPathSegment[] {
  const segments: SeoFlowPathSegment[] = []
  let startDistance = 0

  for (let index = 1; index < path.points.length; index += 1) {
    const from = path.points[index - 1]
    const to = path.points[index]

    if (!from || !to)
      continue

    const length = getDistance(from.x, from.y, to.x, to.y)

    if (length <= 0)
      continue

    segments.push({
      from,
      to,
      length,
      startDistance,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
    })
    startDistance += length
  }

  return segments
}

function createSeoFlowParticles(
  samplers: SeoFlowPathSampler[],
  config: SeoFlowMotionConfig,
): SeoFlowParticle[] {
  const particleCount = Math.max(config.particleCount, config.mobileParticleCount)
  const random = createSeededRandom(config.seed)
  const particles: SeoFlowParticle[] = []

  for (let index = 0; index < particleCount; index += 1) {
    const sampler = pickSampler(samplers, random)

    if (!sampler)
      break

    particles.push({
      id: `seo-flow-particle-${index}`,
      pathId: sampler.id,
      progress: normalizeProgress(index / particleCount + random() * 0.24),
      speed: getRandomInRange(config.speed, random),
      radius: getRandomInRange(config.radius, random),
      opacity: getRandomInRange(config.opacity, random),
      color: sampler.path.particleColor ?? sampler.path.color ?? 'rgb(14 165 233)',
      phase: random() * Math.PI * 2,
    })
  }

  return particles
}

function pickSampler(
  samplers: SeoFlowPathSampler[],
  random: () => number,
): SeoFlowPathSampler | undefined {
  if (samplers.length === 0)
    return undefined

  const totalWeight = samplers.reduce((total, sampler) => {
    return total + Math.max(sampler.path.weight ?? 1, 0)
  }, 0)

  if (totalWeight <= 0) {
    return samplers[Math.floor(random() * samplers.length)]
  }

  let cursor = random() * totalWeight

  for (const sampler of samplers) {
    cursor -= Math.max(sampler.path.weight ?? 1, 0)

    if (cursor <= 0)
      return sampler
  }

  return samplers[samplers.length - 1]
}

function normalizeRange(
  range: SeoFlowMotionRange | undefined,
  fallback: SeoFlowMotionRange,
): SeoFlowMotionRange {
  const min = Math.max(0, range?.min ?? fallback.min)
  const max = Math.max(min, range?.max ?? fallback.max)

  return {
    min,
    max,
  }
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value))
    return fallback

  return Math.max(0, Math.floor(value))
}

function getRandomInRange(range: SeoFlowMotionRange, random: () => number): number {
  return interpolateNumber(range.min, range.max, random())
}

function createSeededRandom(seed: number): () => number {
  let value = seed

  return () => {
    value += 0x6D2B79F5

    let result = value

    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)

    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function normalizeProgress(value: number): number {
  const progress = value % 1

  return progress < 0 ? progress + 1 : progress
}

function getDistance(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.hypot(toX - fromX, toY - fromY)
}

function interpolateNumber(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
