export function normalizeKeywords(keywords: string[]): string[] {
  const seenKeywords = new Set<string>()

  return keywords
    .map(keyword => keyword.trim())
    .filter((keyword) => {
      const normalizedKeyword = keyword.toLowerCase()

      if (!normalizedKeyword || seenKeywords.has(normalizedKeyword))
        return false

      seenKeywords.add(normalizedKeyword)
      return true
    })
}

export function buildMockTitle(primaryKeyword: string): string {
  return `${primaryKeyword} 在线充值 | 快速到账与安全支付`
}

export function buildMockDescription(primaryKeyword: string, pageTopic: string, language: string): string {
  return `为「${pageTopic}」生成 ${language} SEO 描述，突出 ${primaryKeyword}、快速到账、安全支付和清晰购买流程，帮助页面更适合搜索展示。`
}
