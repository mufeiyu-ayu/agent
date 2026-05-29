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
