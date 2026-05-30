import type { SeoCheck, SeoCheckInput } from '../types/seo.types.js'

export function buildSeoChecks(input: SeoCheckInput): SeoCheck[] {
  const lowerTitle = input.title.toLowerCase()
  const lowerDescription = input.description.toLowerCase()
  const titleGenerated = input.title.trim().length > 0
  const descriptionGenerated = input.description.trim().length > 0
  const normalizedKeywords = normalizeKeywords(input.keywords)
  const keywordIncluded = normalizedKeywords.some((keyword) => {
    return lowerTitle.includes(keyword) || lowerDescription.includes(keyword)
  })

  return [
    {
      label: 'Title generated',
      detail: titleGenerated
        ? 'Generated content includes a title.'
        : 'Generated content is missing a title.',
      pass: titleGenerated,
    },
    {
      label: 'Description generated',
      detail: descriptionGenerated
        ? 'Generated content includes a meta description.'
        : 'Generated content is missing a meta description.',
      pass: descriptionGenerated,
    },
    {
      label: 'Keywords included',
      detail: normalizedKeywords.length > 0
        ? 'At least one target keyword appears in generated content.'
        : 'No target keywords were provided.',
      pass: keywordIncluded,
    },
  ]
}

function normalizeKeywords(keywords: string[]): string[] {
  return keywords
    .map(keyword => keyword.trim().toLowerCase())
    .filter(Boolean)
}
