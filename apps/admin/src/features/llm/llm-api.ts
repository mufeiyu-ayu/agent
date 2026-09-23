import type {
  AdminLlmCredentialsInput,
  AdminLlmFetchModelsResponse,
  AdminLlmImportModelsResponse,
  AdminLlmModel,
  AdminLlmModelInput,
  AdminLlmModelTestResult,
  AdminLlmProvider,
  AdminLlmProviderInput,
  AdminLlmTestModelsRequest,
  AdminLlmTestModelsResponse,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'

import { requestAdminRun } from '../shared/admin-api'

const BASE = '/api/admin/llm'

function providerPath(providerId: string, suffix = ''): string {
  return `${BASE}/providers/${encodeURIComponent(providerId)}${suffix}`
}

function modelPath(modelId: string): string {
  return `${BASE}/models/${encodeURIComponent(modelId)}`
}

export function fetchLlmProviders(options: AdminRunFetchOptions = {}): Promise<AdminLlmProvider[]> {
  return requestAdminRun<AdminLlmProvider[]>(`${BASE}/providers`, options)
}

export function createLlmProvider(input: AdminLlmProviderInput): Promise<AdminLlmProvider> {
  return requestAdminRun<AdminLlmProvider>(`${BASE}/providers`, {}, { method: 'POST', body: input })
}

export function updateLlmProvider(
  providerId: string,
  input: Partial<AdminLlmProviderInput>,
): Promise<AdminLlmProvider> {
  return requestAdminRun<AdminLlmProvider>(providerPath(providerId), {}, { method: 'PATCH', body: input })
}

export function deleteLlmProvider(providerId: string): Promise<{ id: string }> {
  return requestAdminRun<{ id: string }>(providerPath(providerId), {}, { method: 'DELETE' })
}

/** 用表单凭据拉模型清单：有 apiKey 用它，否则服务端按 providerId 取库里的密钥。 */
export function fetchLlmModelNames(
  input: AdminLlmCredentialsInput,
  options: AdminRunFetchOptions = {},
): Promise<AdminLlmFetchModelsResponse> {
  return requestAdminRun<AdminLlmFetchModelsResponse>(
    `${BASE}/providers/fetch-models`,
    options,
    { method: 'POST', body: input },
  )
}

/** 同上凭据，对勾选的模型各发一条最短对话，逐个回报通不通。 */
export function testLlmModelNames(
  input: AdminLlmTestModelsRequest,
  options: AdminRunFetchOptions = {},
): Promise<AdminLlmTestModelsResponse> {
  return requestAdminRun<AdminLlmTestModelsResponse>(
    `${BASE}/providers/test-models`,
    options,
    { method: 'POST', body: input },
  )
}

/** 弹窗里已测过的结果一并带上，导入后表格立刻有状态。 */
export function importLlmProviderModels(
  providerId: string,
  wireNames: string[],
  testResults: AdminLlmModelTestResult[] = [],
): Promise<AdminLlmImportModelsResponse> {
  return requestAdminRun<AdminLlmImportModelsResponse>(
    providerPath(providerId, '/import-models'),
    {},
    { method: 'POST', body: { wireNames, testResults } },
  )
}

/** 全部服务商的模型；按服务商筛选在页面里做。 */
export function fetchAllLlmModels(options: AdminRunFetchOptions = {}): Promise<AdminLlmModel[]> {
  return requestAdminRun<AdminLlmModel[]>(`${BASE}/models`, options)
}

/** 重测已入库的模型，返回写回结果后的行。 */
export function probeLlmModels(modelIds: string[]): Promise<AdminLlmModel[]> {
  return requestAdminRun<AdminLlmModel[]>(`${BASE}/models/probe`, {}, { method: 'POST', body: { modelIds } })
}

export function updateLlmModel(modelId: string, input: Partial<AdminLlmModelInput>): Promise<AdminLlmModel> {
  return requestAdminRun<AdminLlmModel>(modelPath(modelId), {}, { method: 'PATCH', body: input })
}

export function deleteLlmModel(modelId: string): Promise<{ id: string }> {
  return requestAdminRun<{ id: string }>(modelPath(modelId), {}, { method: 'DELETE' })
}
