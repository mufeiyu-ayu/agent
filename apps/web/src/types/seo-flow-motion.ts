export interface SeoFlowPoint {
  x: number
  y: number
}

export interface SeoFlowMotionPath {
  id: string
  points: SeoFlowPoint[]
  weight?: number
  reverse?: boolean
  color?: string
  glowColor?: string
  particleColor?: string
}

export interface SeoFlowPathSegment {
  from: SeoFlowPoint
  to: SeoFlowPoint
  length: number
  startDistance: number
  angle: number
}

export interface SeoFlowPathSampler {
  id: string
  path: SeoFlowMotionPath
  length: number
  segments: SeoFlowPathSegment[]
}

export interface SeoFlowPathSample {
  pathId: string
  x: number
  y: number
  angle: number
  progress: number
}

export interface SeoFlowMotionRange {
  min: number
  max: number
}

export interface SeoFlowMotionConfig {
  particleCount: number
  mobileParticleCount: number
  mobileBreakpoint: number
  speed: SeoFlowMotionRange
  radius: SeoFlowMotionRange
  opacity: SeoFlowMotionRange
  pulseStrength: number
  fpsCap: number
  seed: number
}

export interface SeoFlowParticle {
  id: string
  pathId: string
  progress: number
  speed: number
  radius: number
  opacity: number
  color: string
  phase: number
}

export interface SeoFlowRenderedParticle {
  id: string
  pathId: string
  x: number
  y: number
  radius: number
  opacity: number
  color: string
  progress: number
  angle: number
}

export interface SeoFlowMotionFrame {
  elapsedMs: number
  deltaMs: number
  particles: SeoFlowRenderedParticle[]
}

export type SeoFlowMotionPauseReason
  = | 'manual'
    | 'inactive'
    | 'document-hidden'
    | 'offscreen'
    | 'reduced-motion'
    | 'empty-path'

export interface SeoFlowMotionStatus {
  running: boolean
  reducedMotion: boolean
  documentVisible: boolean
  intersecting: boolean
  pauseReasons: SeoFlowMotionPauseReason[]
}

export type SeoFlowMotionFrameRenderer = (frame: SeoFlowMotionFrame) => void

export interface SeoParticleFieldApi {
  start: () => void
  stop: () => void
  restart: () => void
}
