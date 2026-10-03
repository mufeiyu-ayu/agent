import type { WorkspaceFile } from '@agent/contracts'
import type { TurnRun } from '../types/chat'

/** 只使用已收口工具的保存清单，且文件仍在当前工作区；有页面时优先交付页面。 */
export function workspaceArtifacts(run: TurnRun, currentFiles: WorkspaceFile[]): WorkspaceFile[] {
  const saved = run.steps.filter(step => step.status !== 'running' && step.status !== 'stopped'
    && (step.workspace?.revision ?? 0) > 0 && Array.isArray(step.workspace?.files)).at(-1)?.workspace?.files ?? []
  const paths = new Set(saved.map(file => file.path))
  const files = currentFiles.filter(file => paths.has(file.path))
  const pages = files.filter(file => file.path.toLowerCase().endsWith('.html'))
  return pages.length ? pages : files
}

export function workspaceFileType(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  const types: Record<string, [string, string]> = {
    html: ['vscode-icons:file-type-html', 'xml'],
    css: ['vscode-icons:file-type-css', 'css'],
    js: ['vscode-icons:file-type-js-official', 'javascript'],
    ts: ['vscode-icons:file-type-typescript-official', 'typescript'],
    jsx: ['vscode-icons:file-type-reactjs', 'javascript'],
    tsx: ['vscode-icons:file-type-reactts', 'typescript'],
    json: ['vscode-icons:file-type-json', 'json'],
    md: ['vscode-icons:file-type-markdown', 'markdown'],
    py: ['vscode-icons:file-type-python', 'python'],
    sh: ['vscode-icons:file-type-shell', 'bash'],
    yml: ['vscode-icons:file-type-yaml', 'yaml'],
    yaml: ['vscode-icons:file-type-yaml', 'yaml'],
  }
  const [icon, language] = types[extension] ?? ['tabler:file-text', '']
  return { icon, language, label: extension.toUpperCase() || 'TEXT' }
}

export interface WorkspaceTreeEntry {
  path: string
  name: string
  depth: number
  directory: boolean
}

/** 从保存清单生成目录；搜索时保留匹配文件的父目录，不受折叠状态影响。 */
export function workspaceFileTree(paths: string[], query: string, collapsed: ReadonlySet<string>): WorkspaceTreeEntry[] {
  interface Node { path: string, name: string, directory: boolean, children: Map<string, Node> }
  const root = new Map<string, Node>()
  const search = query.trim().toLowerCase()
  for (const path of paths.filter(path => path.toLowerCase().includes(search))) {
    let children = root
    const parts = path.split('/')
    for (const [index, name] of parts.entries()) {
      if (!children.has(name))
        children.set(name, { path: parts.slice(0, index + 1).join('/'), name, directory: index < parts.length - 1, children: new Map() })
      children = children.get(name)!.children
    }
  }
  const entries: WorkspaceTreeEntry[] = []
  function visit(children: Map<string, Node>, depth: number) {
    for (const node of [...children.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))) {
      entries.push({ path: node.path, name: node.name, depth, directory: node.directory })
      if (search || !collapsed.has(node.path))
        visit(node.children, depth + 1)
    }
  }
  visit(root, 0)
  return entries
}
