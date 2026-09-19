export interface FlowPoint {
  x: number
  y: number
}

export interface FlowMotionPath {
  id: string
  points: FlowPoint[]
  weight?: number
  reverse?: boolean
  color?: string
  glowColor?: string
  particleColor?: string
}

export interface FlowPathSegment {
  from: FlowPoint
  to: FlowPoint
  length: number
  startDistance: number
  angle: number
}

export interface FlowPathSampler {
  id: string
  path: FlowMotionPath
  length: number
  segments: FlowPathSegment[]
}

export interface FlowPathSample {
  pathId: string
  x: number
  y: number
  angle: number
  progress: number
}

export interface FlowMotionRange {
  min: number
  max: number
}

export interface FlowMotionConfig {
  particleCount: number
  mobileParticleCount: number
  mobileBreakpoint: number
  speed: FlowMotionRange
  radius: FlowMotionRange
  opacity: FlowMotionRange
  pulseStrength: number
  fpsCap: number
  seed: number
}

export interface FlowParticle {
  id: string
  pathId: string
  progress: number
  speed: number
  radius: number
  opacity: number
  color: string
  phase: number
}

export interface FlowRenderedParticle {
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

export interface FlowMotionFrame {
  elapsedMs: number
  deltaMs: number
  particles: FlowRenderedParticle[]
}

export type FlowMotionPauseReason
  = | 'manual'
    | 'inactive'
    | 'document-hidden'
    | 'offscreen'
    | 'reduced-motion'
    | 'empty-path'

export interface FlowMotionStatus {
  running: boolean
  reducedMotion: boolean
  documentVisible: boolean
  intersecting: boolean
  pauseReasons: FlowMotionPauseReason[]
}

export type FlowMotionFrameRenderer = (frame: FlowMotionFrame) => void

export interface ParticleFieldApi {
  start: () => void
  stop: () => void
  restart: () => void
}
