import type {
  AdminLlmFetchModelsResponse,
  AdminLlmImportModelsResponse,
  AdminLlmModel,
  AdminLlmModelInput,
  AdminLlmModelTestResult,
  AdminLlmPreviewModelsRequest,
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

/** 存库前用表单里的地址与密钥拉一次模型清单。 */
export function previewLlmProviderModels(
  input: AdminLlmPreviewModelsRequest,
  options: AdminRunFetchOptions = {},
): Promise<AdminLlmFetchModelsResponse> {
  return requestAdminRun<AdminLlmFetchModelsResponse>(
    `${BASE}/providers/preview-models`,
    options,
    { method: 'POST', body: input },
  )
}

/** 存库前对勾选的模型各发一条最短对话，逐个回报通不通。 */
export function testLlmProviderModels(
  input: AdminLlmTestModelsRequest,
  options: AdminRunFetchOptions = {},
): Promise<AdminLlmTestModelsResponse> {
  return requestAdminRun<AdminLlmTestModelsResponse>(
    `${BASE}/providers/test-models`,
    options,
    { method: 'POST', body: input },
  )
}

/** 编辑已有服务商时用库里的密钥测。 */
export function testLlmProviderModelsOf(
  providerId: string,
  wireNames: string[],
  baseUrl: string | undefined,
  options: AdminRunFetchOptions = {},
): Promise<AdminLlmTestModelsResponse> {
  return requestAdminRun<AdminLlmTestModelsResponse>(
    providerPath(providerId, '/test-models'),
    options,
    { method: 'POST', body: { wireNames, ...(baseUrl ? { baseUrl } : {}) } },
  )
}

/** 编辑服务商时用库里的密钥拉；传 baseUrl 则用表单里还没保存的地址。 */
export function fetchLlmProviderModelNames(
  providerId: string,
  baseUrl: string | undefined,
  options: AdminRunFetchOptions = {},
): Promise<AdminLlmFetchModelsResponse> {
  return requestAdminRun<AdminLlmFetchModelsResponse>(
    providerPath(providerId, '/fetch-models'),
    options,
    { method: 'POST', body: baseUrl ? { baseUrl } : {} },
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
