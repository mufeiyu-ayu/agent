import type { SeoCheck } from '../types/seo'

/**
 * 根据当前标题、描述和关键词生成基础 SEO 检查项。
 *
 * @param title - 当前 SEO 标题。
 * @param description - 当前 meta description。
 * @param keywords - 目标关键词列表。
 * @returns 可直接渲染的 SEO 检查结果。
 */
export function buildSeoChecks(title: string, description: string, keywords: string[]): SeoCheck[] {
  const lowerTitle = title.toLowerCase()
  const lowerDescription = description.toLowerCase()
  const normalizedKeywords = keywords.map(keyword => keyword.toLowerCase())
  const keywordIncluded = normalizedKeywords.some((keyword) => {
    return lowerTitle.includes(keyword) || lowerDescription.includes(keyword)
  })

  return [
    {
      label: 'Title length is appropriate',
      detail: 'Recommended: 50-60 characters',
      pass: title.length <= 70 && title.length >= 30,
    },
    {
      label: 'Description length is appropriate',
      detail: 'Recommended: 120-160 characters',
      pass: description.length <= 170 && description.length >= 80,
    },
    {
      label: 'Keywords included',
      detail: 'At least one target keyword appears in generated content',
      pass: keywordIncluded,
    },
  ]
}

/**
 * 将生成时间格式化为工作台展示所需的 24 小时时间。
 *
 * @param date - 需要格式化的时间对象。
 * @returns 形如 `14:32` 的时间字符串。
 */
export function formatGeneratedTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
