export type SeoFlowCardTone = 'copper' | 'moss' | 'sand' | 'ink'

export type SeoFlowCardSide = 'left' | 'right'

export type SeoFlowPathTone = SeoFlowCardTone | 'neutral'

export type SeoFlowStreamDelay = 'none' | 'short' | 'medium' | 'long'

export type SeoProcessCardHeight = 'short' | 'medium' | 'tall'

export type SeoBriefLineWidth = 'full' | 'wide' | 'medium' | 'short' | 'tiny'

export type SeoBriefSectionTone = 'title' | 'meta' | 'check'

export interface SeoProcessItem {
  id: string
  label: string
  meta?: string
}

export interface SeoProcessCardConfig {
  id: string
  eyebrow?: string
  title: string
  description: string
  icon: string
  tone: SeoFlowCardTone
  side: SeoFlowCardSide
  indexLabel?: string
  compact?: boolean
  height?: SeoProcessCardHeight
  items: SeoProcessItem[]
}

export interface SeoCenterMetric {
  id: string
  label: string
  value: string
}

export interface SeoCenterNodeConfig {
  id: string
  eyebrow: string
  label: string
  description: string
  sparkLabel: string
  metrics: SeoCenterMetric[]
}

export interface SeoBriefPreviewLine {
  id: string
  width: SeoBriefLineWidth
}

export interface SeoBriefPreviewSection {
  id: string
  label: string
  value: string
  tone: SeoBriefSectionTone
}

export interface SeoBriefPreviewConfig {
  id: string
  fileName: string
  status: string
  summary: string
  updatedLabel: string
  sections: SeoBriefPreviewSection[]
  lines: SeoBriefPreviewLine[]
}

export interface SeoFlowPoint {
  x: number
  y: number
}

export interface SeoFlowPathConfig {
  id: string
  from: string
  to: string
  d: string
  tone: SeoFlowPathTone
  start: SeoFlowPoint
  end: SeoFlowPoint
  streamDelay?: SeoFlowStreamDelay
}

export interface SeoFlowParticlePathConfig {
  id: string
  points: SeoFlowPoint[]
  weight?: number
  reverse?: boolean
  color?: string
  glowColor?: string
  particleColor?: string
}

export interface SeoFlowViewBox {
  width: number
  height: number
}
