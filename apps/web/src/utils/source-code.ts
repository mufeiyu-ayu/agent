/** 聊天流仍限 2 万字符；只读文件视图按需高亮 / 格式化到 10 万字符。 */
export const FILE_CODE_LIMIT = 100_000

export function fileFormatParser(path: string): string | undefined {
  const parsers: Record<string, string> = { html: 'html', css: 'css', js: 'babel', jsx: 'babel', ts: 'typescript', tsx: 'typescript', json: 'json' }
  return parsers[path.split('.').at(-1)?.toLowerCase() ?? '']
}

/** highlight.js 只生成 span；跨行的嵌套颜色在每一行闭合并重新打开。 */
export function highlightedCodeLines(html: string): string[] {
  const lines: string[] = []
  const spans: string[] = []
  let line = ''
  for (const part of html.split(/(<span\b[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') {
      lines.push(line + '</span>'.repeat(spans.length))
      line = spans.join('')
      continue
    }
    if (part.startsWith('<span '))
      spans.push(part)
    else if (part === '</span>')
      spans.pop()
    line += part
  }
  lines.push(line)
  return lines
}

export async function formatFileCode(code: string, path: string): Promise<string> {
  const parser = fileFormatParser(path)
  if (!parser || code.length > FILE_CODE_LIMIT)
    throw new Error('文件类型或大小不支持格式化')
  const [prettier, html, postcss, babel, estree, typescript] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
  ])
  return prettier.format(code, { parser, plugins: [html, postcss, babel, estree, typescript], tabWidth: 2, printWidth: 100 })
}
