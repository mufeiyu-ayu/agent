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

export interface SeoGenerationOutput {
  title: string
  description: string
}

export class SeoGenerationOutputError extends Error {
  constructor(
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'SeoGenerationOutputError'
  }
}
