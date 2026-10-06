import type { WorkspaceFile } from '@agent/contracts'
import type { TurnRun } from '../types/chat'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { visibleWorkspaceFiles, workspaceArtifacts, workspaceFileTree, workspaceFileType } from './workspace-files'

it('文件树保留完整路径、目录优先；搜索可找到折叠目录中的文件', () => {
  const paths = ['README.md', 'src/page.ts', 'src/nested/page.html', 'assets/data.json']
  const collapsed = new Set(['src'])
  assert.deepEqual(workspaceFileTree(paths, '', collapsed).map(entry => entry.path), ['assets', 'assets/data.json', 'src', 'README.md'])
  assert.deepEqual(workspaceFileTree(paths, 'PAGE.HTML', collapsed), [
    { path: 'src', name: 'src', depth: 0, directory: true },
    { path: 'src/nested', name: 'nested', depth: 1, directory: true },
    { path: 'src/nested/page.html', name: 'page.html', depth: 2, directory: false },
  ])
  assert.equal(workspaceFileType('src/page.ts').language, 'typescript')
  assert.equal(workspaceFileType('README.md').icon, 'vscode-icons:file-type-markdown')
})

it('展示过滤只匹配指定根文件及 tests，不修改 Source；业务 Markdown 和源码保留', () => {
  const paths = ['README.md', 'SHADCN-LICENSE.md', '.gitignore', '.npmrc', '.nvmrc', 'tests/nested/x.ts', 'report.md', 'src/README.md', '.custom', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'index.html', 'src/components/ui/a.tsx', 'src/lib/a.ts', 'public/a.svg']
  const files = paths.map(path => ({ path, sha256: 'a', bytes: 1 }))
  const original = structuredClone(files)
  const visible = visibleWorkspaceFiles(files)
  assert.deepEqual(visible.map(file => file.path), paths.slice(6))
  assert.deepEqual(workspaceFileTree(visible.map(file => file.path), 'README', new Set()).filter(entry => !entry.directory).map(entry => entry.path), ['src/README.md'])
  assert.deepEqual(files, original)
  assert.equal(visibleWorkspaceFiles(files.slice(0, 6)).length, 0)
  assert.equal(files.slice(0, 6).length, 6)
})

it('交付卡片只来自已保存且仍存在的文件；读取和未完成保存不生成卡片', () => {
  const page = { path: 'index.html', bytes: 100, sha256: 'a' } satisfies WorkspaceFile
  const script = { path: 'scripts/check.js', bytes: 50, sha256: 'b' } satisfies WorkspaceFile
  const run: TurnRun = { startedAt: 0, phase: 'ended', toolBeforeAnswer: false, thoughts: [], steps: [
    { callId: 'write', toolName: 'write', status: 'ok', workspace: { title: '编写页面', operation: 'write', path: page.path, revision: 1, files: [page, script] } },
    { callId: 'read', toolName: 'read', status: 'ok', workspace: { title: '读取页面', operation: 'read', path: page.path } },
  ] }
  assert.deepEqual(workspaceArtifacts(run, [page, script]), [page, script])
  // R3：同路径的新内容不能冒充旧回答的交付文件；同 SHA 不依赖历史 manifest revision。
  assert.deepEqual(workspaceArtifacts(run, [{ ...page, sha256: 'new-content' }]), [])
  assert.deepEqual(workspaceArtifacts({ ...run, steps: [{ ...run.steps[0]!, workspace: { ...run.steps[0]!.workspace!, revision: 10 } }] }, [page]), [page])
  assert.deepEqual(workspaceArtifacts(run, [script]), [script])
  assert.deepEqual(workspaceArtifacts(run, []), [])
  assert.deepEqual(workspaceArtifacts({ ...run, steps: [run.steps[1]!] }, [page]), [])
  assert.deepEqual(workspaceArtifacts({ ...run, steps: [{ ...run.steps[0]!, status: 'stopped' }] }, [page]), [])
})
