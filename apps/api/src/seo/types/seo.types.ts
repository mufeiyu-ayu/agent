export interface SeoCheck {
  label: string
  detail: string
  pass: boolean
}

export interface GenerateSeoContentResult {
  title: string
  description: string
  checks: SeoCheck[]
  generatedAt: string
}

export interface SeoCheckInput {
  title: string
  description: string
  keywords: string[]
}
