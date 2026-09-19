export type FlowCardTone = 'copper' | 'moss' | 'sand' | 'ink'

export type FlowCardSide = 'left' | 'right'

export type FlowPathTone = FlowCardTone | 'neutral'

export type FlowStreamDelay = 'none' | 'short' | 'medium' | 'long'

export type ProcessCardHeight = 'short' | 'medium' | 'tall'

export type BriefLineWidth = 'full' | 'wide' | 'medium' | 'short' | 'tiny'

export type BriefSectionTone = 'title' | 'meta' | 'check'

export interface ProcessItem {
  id: string
  label: string
  meta?: string
}

export interface ProcessCardConfig {
  id: string
  eyebrow?: string
  title: string
  description: string
  icon: string
  tone: FlowCardTone
  side: FlowCardSide
  indexLabel?: string
  compact?: boolean
  height?: ProcessCardHeight
  items: ProcessItem[]
}

export interface CenterMetric {
  id: string
  label: string
  value: string
}

export interface CenterNodeConfig {
  id: string
  eyebrow: string
  label: string
  description: string
  sparkLabel: string
  metrics: CenterMetric[]
}

export interface BriefPreviewLine {
  id: string
  width: BriefLineWidth
}

export interface BriefPreviewSection {
  id: string
  label: string
  value: string
  tone: BriefSectionTone
}

export interface BriefPreviewConfig {
  id: string
  fileName: string
  status: string
  summary: string
  updatedLabel: string
  sections: BriefPreviewSection[]
  lines: BriefPreviewLine[]
}

export interface FlowPoint {
  x: number
  y: number
}

export interface FlowPathConfig {
  id: string
  from: string
  to: string
  d: string
  tone: FlowPathTone
  start: FlowPoint
  end: FlowPoint
  streamDelay?: FlowStreamDelay
}

export interface FlowParticlePathConfig {
  id: string
  points: FlowPoint[]
  weight?: number
  reverse?: boolean
  color?: string
  glowColor?: string
  particleColor?: string
}

export interface FlowViewBox {
  width: number
  height: number
}
