/**
 * 服务商报「输入超出模型上下文」的识别规则，原样抄自 Pi（`packages/ai/src/utils/overflow.ts`，890f920）：
 * 只看完整报错文本、不看状态码，命中限流类的先排除。只抄 Pi 的 Case 1（报错文本）；Case 2、3（z.ai、小米 MiMo
 * 的静默溢出）与只对 Cerebras 生效的「400 / 413 (no body)」都针对我们没有接入的服务商。
 *
 * 以下注释与规则都是 Pi 原文。
 *
 * Regex patterns to detect context overflow errors from different providers.
 *
 * These patterns match error messages returned when the input exceeds
 * the model's context window.
 *
 * Provider-specific patterns (with example error messages):
 *
 * - Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
 * - Anthropic: "413 {\"error\":{\"type\":\"request_too_large\",\"message\":\"Request exceeds the maximum size\"}}"
 * - OpenAI: "Your input exceeds the context window of this model"
 * - OpenAI/LiteLLM: "Requested token count exceeds the model's maximum context length of 131072 tokens"
 * - OpenAI-compatible: "Input length (265330) exceeds model's maximum context length (262144)."
 * - Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
 * - xAI: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
 * - Groq: "Please reduce the length of the messages or completion"
 * - OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
 * - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
 * - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
 * - llama.cpp: "the request exceeds the available context size, try increasing it"
 * - LM Studio: "tokens to keep from the initial prompt is greater than the context length"
 * - GitHub Copilot: "prompt token count of X exceeds the limit of Y"
 * - MiniMax: "invalid params, context window exceeds limit"
 * - Kimi For Coding: "Your request exceeded model token limit: X (requested: Y)"
 * - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
 * - Cerebras: "400/413 status code (no body)"
 * - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
 * - z.ai: `{"code":"1261","message":"Prompt too long"}` or silent overflow via usage.input > contextWindow
 * - Xiaomi MiMo: Truncates input to fill contextWindow exactly, then returns finish_reason "length"
 *   with output=0 (no room left to generate). Detected via stopReason "length" + zero output +
 *   input filling the context window.
 * - DashScope/Qwen: "Range of input length should be [1, X]" (HTTP 400 invalid_parameter_error)
 * - Ollama: Some deployments truncate silently, others return errors like "prompt too long; exceeded max context length by X tokens"
 */
const OVERFLOW_PATTERNS = [
  /prompt (?:is )?too long/i, // Anthropic and z.ai token overflow
  /request_too_large/i, // Anthropic request byte-size overflow (HTTP 413)
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions & Responses API)
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI-compatible proxies (LiteLLM)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter (most backends)
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter/Poolside
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together AI
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding
  /too large for model with \d+ maximum context length/i, // Mistral
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i, // DS4 server
  /model_context_window_exceeded/i, // z.ai non-standard finish_reason surfaced as error text
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
  /range of input length should be/i, // DashScope / Qwen Token Plan
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /too many tokens/i, // Generic fallback
  /token limit exceeded/i, // Generic fallback
]

/**
 * Patterns that indicate non-overflow errors (e.g. rate limiting, server errors).
 * Error messages matching any of these are excluded from overflow detection
 * even if they also match an OVERFLOW_PATTERN.
 *
 * Example: Bedrock formats throttling errors as "ThrottlingException: Too many tokens,
 * please wait before trying again." which would match the /too many tokens/i overflow
 * pattern without this exclusion.
 */
const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i, // AWS Bedrock non-overflow errors (human-readable prefixes from formatBedrockError)
  /rate limit/i, // Generic rate limiting
  /too many requests/i, // Generic HTTP 429 style
]

/**
 * 报错是否表示输入超出模型上下文。传入同一个报错的几种未截断原文（上游 body 里的 message、SDK 拼了状态码的 message）：
 * 任何一段命中限流类就不算，否则任何一段命中超长规则就算。
 */
export function isContextOverflowMessage(messages: readonly string[]): boolean {
  return !messages.some(message => NON_OVERFLOW_PATTERNS.some(pattern => pattern.test(message)))
    && messages.some(message => OVERFLOW_PATTERNS.some(pattern => pattern.test(message)))
}
