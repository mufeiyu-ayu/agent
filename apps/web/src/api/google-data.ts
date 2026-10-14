import type { GoogleDataConnection, GoogleDataResource, GoogleDataService, GoogleDataVerification } from '@agent/contracts'
import { http } from './http'

const base = '/api/google-data'
export const getGoogleData = (signal: AbortSignal) => http.get<GoogleDataConnection>(base, { signal }).then(r => r.data)
export const connectGoogleData = (services: GoogleDataService[], signal: AbortSignal) => http.post<{ authorizationUrl: string }>(`${base}/connect`, { services }, { signal }).then(r => r.data)
export const cancelGoogleData = (signal: AbortSignal) => http.post<GoogleDataConnection>(`${base}/cancel`, {}, { signal }).then(r => r.data)
export const disconnectGoogleData = (signal: AbortSignal) => http.post<GoogleDataConnection>(`${base}/disconnect`, {}, { signal }).then(r => r.data)
export const getGoogleResources = (service: GoogleDataService, signal: AbortSignal, property?: string) => http.get<GoogleDataResource[]>(`${base}/resources`, { params: { service, property }, signal, timeout: 35_000 }).then(r => r.data)
export const selectGoogleResource = (service: GoogleDataService, revision: number, resource: string, stream: string | undefined, signal: AbortSignal) => http.post<GoogleDataConnection>(`${base}/selection`, { service, revision, resource, stream }, { signal, timeout: 65_000 }).then(r => r.data)
export const verifyGoogleData = (service: GoogleDataService, revision: number, signal: AbortSignal) => http.post<GoogleDataVerification>(`${base}/verify`, { service, revision }, { signal, timeout: 35_000 }).then(r => r.data)
