/**
 * 已校验回答的确定性重放切分。
 *
 * hidden draft 在校验通过前不对用户可见；通过后必须用既有 `assistant_delta`
 * 把正文放出去，而不是新增一个 stream event type。
 *
 * 硬约束：切分只能落在 Unicode code point 边界上，且 chunks 拼接后必须逐字符
 * 等于 persisted content 与 `done.content`，否则前端增量拼接会与最终内容不一致。
 */

/** 单个 delta 的 code point 数量；纯展示节奏参数，不影响最终内容。 */
export const VALIDATED_ANSWER_REPLAY_CHUNK_CODE_POINTS = 64

export function toValidatedAnswerChunks(
  answer: string,
  chunkCodePoints = VALIDATED_ANSWER_REPLAY_CHUNK_CODE_POINTS,
): string[] {
  if (!Number.isSafeInteger(chunkCodePoints) || chunkCodePoints <= 0)
    throw new RangeError('validated answer replay chunk 必须是正整数 code point 数')

  if (answer.length === 0)
    return []

  // 展开为 code point 数组：代理对与 Emoji 不会被从中间切开。
  const codePoints = [...answer]
  const chunks: string[] = []

  for (let index = 0; index < codePoints.length; index += chunkCodePoints) {
    chunks.push(codePoints.slice(index, index + chunkCodePoints).join(''))
  }

  return chunks
}
