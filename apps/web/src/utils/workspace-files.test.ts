import type { WorkspaceFile } from '@agent/contracts'
import type { TurnRun } from '../types/chat'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { workspaceArtifacts, workspaceFileTree, workspaceFileType } from './workspace-files'

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

it('交付卡片只来自已保存且仍存在的文件，优先页面；读取和未完成保存不生成卡片', () => {
  const page = { path: 'index.html', bytes: 100, sha256: 'a' } satisfies WorkspaceFile
  const script = { path: 'tests/check.js', bytes: 50, sha256: 'b' } satisfies WorkspaceFile
  const run: TurnRun = { startedAt: 0, phase: 'ended', toolBeforeAnswer: false, thoughts: [], steps: [
    { callId: 'write', toolName: 'write', status: 'ok', workspace: { title: '编写页面', operation: 'write', path: page.path, revision: 1, files: [page, script] } },
    { callId: 'read', toolName: 'read', status: 'ok', workspace: { title: '读取页面', operation: 'read', path: page.path } },
  ] }
  assert.deepEqual(workspaceArtifacts(run, [page, script]), [page])
  assert.deepEqual(workspaceArtifacts(run, [script]), [script])
  assert.deepEqual(workspaceArtifacts(run, []), [])
  assert.deepEqual(workspaceArtifacts({ ...run, steps: [run.steps[1]!] }, [page]), [])
  assert.deepEqual(workspaceArtifacts({ ...run, steps: [{ ...run.steps[0]!, status: 'stopped' }] }, [page]), [])
})
