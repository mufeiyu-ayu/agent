export interface GenerateSeoContentResult {
  title: string
  description: string
  suggestions: string[]
  generatedAt: string
}

export interface SeoGenerationOutput {
  title: string
  description: string
  suggestions: string[]
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
