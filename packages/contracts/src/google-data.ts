export const GOOGLE_DATA_SERVICES = ['gsc', 'ga4'] as const
export type GoogleDataService = (typeof GOOGLE_DATA_SERVICES)[number]

export interface GoogleDataSelection {
  gscSite: string | null
  ga4Property: string | null
  ga4Stream: string | null
}

export interface GoogleDataConnection {
  configured: boolean
  connected: boolean
  needsAuth: boolean
  authorizing: boolean
  email: string | null
  services: GoogleDataService[]
  selection: GoogleDataSelection
  revision: number
}

export interface GoogleDataResource {
  id: string
  name: string
  url?: string
}

export interface GoogleDataVerification {
  revision: number
  service: GoogleDataService
  checkedAt: string
  hasData: boolean
}
