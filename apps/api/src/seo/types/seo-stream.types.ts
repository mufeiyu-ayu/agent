import type { GenerateSeoContentResult } from './seo.types.js'

export type SeoStreamEvent
  = | {
    type: 'started'
    message: string
  }
  | {
    type: 'progress'
    message: string
  }
  | {
    type: 'result'
    data: GenerateSeoContentResult
  }
  | {
    type: 'done'
  }
