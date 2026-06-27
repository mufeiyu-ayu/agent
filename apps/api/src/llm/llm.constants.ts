export const LLM_REQUEST_TIMEOUT_MS = 10000

// 流式回答可能明显超过普通 HTTP 请求，给 SDK 一个独立上限，同时保留外部 AbortSignal 控制。
export const LLM_STREAM_TIMEOUT_MS = 10 * 60 * 1000

export const DEFAULT_CHAT_TEMPERATURE = 0.7

export const DEFAULT_CHAT_MAX_TOKENS = 2048
