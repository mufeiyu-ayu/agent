import { isMap, parseDocument } from 'yaml'

function frontmatter(content: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(content)
  const document = parseDocument(match?.[1] ?? 'name: ""\ndescription: ""', { uniqueKeys: true })
  if (document.errors.length || !isMap(document.contents))
    throw new Error('Invalid skill frontmatter')
  return { document, body: (match?.[2] ?? content).replace(/^\r?\n/, '') }
}

export function readSkillMarkdown(content: string) {
  const { document, body } = frontmatter(content)
  const metadata = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>
  return { name: typeof metadata.name === 'string' ? metadata.name : '', description: typeof metadata.description === 'string' ? metadata.description : '', body }
}

/** 只更新表单编辑的两项，保留其他元数据和 YAML 引号/多行语义。 */
export function writeSkillMarkdown(original: string, name: string, description: string, body: string): string {
  const { document } = frontmatter(original)
  document.set('name', name)
  document.set('description', description)
  return `---\n${document.toString()}---\n\n${body.replace(/^\r?\n/, '')}`
}
