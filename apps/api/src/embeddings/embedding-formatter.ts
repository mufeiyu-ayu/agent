function normalizeEmbeddingText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\s\u200B\u2060]+/gu, ' ')
    .trim()
}

export function formatEmbeddingQueryInput(query: string): string {
  const normalizedQuery = normalizeEmbeddingText(query)
  if (!normalizedQuery)
    throw new Error('embedding query 必须是非空字符串')

  return `task: search result | query: ${normalizedQuery}`
}

export function formatEmbeddingDocumentInput(
  title: string,
  sectionPath: string,
  chunkText: string,
): string {
  const normalizedTitle = normalizeEmbeddingText(title) || 'none'
  const normalizedSectionPath = normalizeEmbeddingText(sectionPath)
  const normalizedChunkText = normalizeEmbeddingText(chunkText)

  if (!normalizedChunkText)
    throw new Error('embedding document text 必须是非空字符串')

  const documentText = normalizedSectionPath
    ? `${normalizedSectionPath}\n\n${normalizedChunkText}`
    : normalizedChunkText

  return `title: ${normalizedTitle} | text: ${documentText}`
}
