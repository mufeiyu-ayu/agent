import type { LucideIcon } from '@lucide/vue'

export type GenerationStatus = 'empty' | 'loading' | 'success' | 'error'

export type CopyableSeoField = 'title' | 'description'

export interface NavigationItem {
  label: string
  icon: LucideIcon
  active?: boolean
}

export interface SeoCheck {
  label: string
  detail: string
  pass: boolean
}

export interface GenerateSeoRequest {
  pageTopic: string
  language: string
  keywords: string[]
}

export interface GenerateSeoResponse {
  title: string
  description: string
  checks: SeoCheck[]
  generatedAt: string
}

export interface SeoInputValidationErrors {
  pageTopic?: string
  keywords?: string
}

export type AppMessageType = 'error' | 'success' | 'info'

export interface AppMessageState {
  visible: boolean
  type: AppMessageType
  text: string
}
