import type {
  ModelInputItem,
  ModelToolSpec,
} from '@agent/ai'
import { Buffer } from 'node:buffer'

/**
 * 粗估 token（照抄 Codex `utils/string/src/truncate.rs` 的 approx_token_count）：UTF-8 字节数 ÷ 4，向上取整。
 * 本地 23 次真实调用对照，它是实际的 0.86～1.11；Pi 的「字符数 ÷ 4」中文越多越少算，只有 0.40～0.91。
 */
export function roughTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

/** 每张图片按固定值估（照抄 Pi `compaction.ts` 的 4800 字符 ÷ 4，ce950d78），与实际分辨率无关。 */
export const IMAGE_TOKENS = 1200

/**
 * 一个输入项发给模型的文字：正文、`reasoning_content`、工具名 + 参数 JSON、工具结果；
 * 每项各自取整再求和（同 Codex），role 与 callId 这类包装不计。
 */
export function estimateItemTokens(item: ModelInputItem): number {
  switch (item.type) {
    case 'message':
      return roughTokens(item.content) + (item.images?.length ?? 0) * IMAGE_TOKENS
    case 'tool_result':
      return roughTokens(item.content)
    case 'assistant_tool_call':
      return roughTokens([
        item.content ?? '',
        item.reasoningContent,
        ...item.calls.map(call => `${call.name}${call.rawArgumentsJson}`),
      ].join(''))
  }
}

/** 整份请求全部粗估：各输入项，加上工具定义（我们加的：Pi 890f920 只算消息；我们每次问答都从库重建，要估整份请求）。 */
export function estimateRequestTokens(input: { items: ModelInputItem[], tools: ModelToolSpec[] }): number {
  return input.items.reduce(
    (tokens, item) => tokens + estimateItemTokens(item),
    roughTokens(JSON.stringify(input.tools)),
  )
}
