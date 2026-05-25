export function parseJsonOutput<T>(content: string | null | undefined): T {
  if (content == null || content.trim().length === 0) {
    throw new Error('模型返回的 content 为空，无法解析 JSON Output。')
  }

  try {
    return JSON.parse(content) as T
  }
  catch {
    throw new Error(`模型返回的 content 不是合法 JSON：${content}`)
  }
}
