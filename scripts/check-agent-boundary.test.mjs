import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it, onTestFinished } from 'vitest'

import { checkAgentBoundary } from './check-agent-boundary.mjs'

/** 最小三包工作区；agent 的 manifest 故意多声明一个 Nest 依赖，白名单不应因此放宽。 */
function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'agent-boundary-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const dependencies = { agent: ['@agent/ai', '@agent/contracts', '@nestjs/common'], ai: ['@agent/contracts'], contracts: [] }
  mkdirSync(join(root, 'node_modules/@agent'), { recursive: true })
  for (const [name, names] of Object.entries(dependencies)) {
    write(`packages/${name}/package.json`, JSON.stringify({
      name: `@agent/${name}`,
      type: 'module',
      exports: { '.': { types: './src/index.ts' } },
      dependencies: Object.fromEntries(names.map(dependency => [dependency, 'workspace:*'])),
    }))
    write(`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } }))
    write(`packages/${name}/src/index.ts`, names.map(dependency => `export * from '${dependency}'\n`).join('') || 'export const value = 1\n')
    symlinkSync(join(root, 'packages', name), join(root, 'node_modules/@agent', name), 'junction')
  }
  write('packages/agent/src/index.ts', 'import type { value } from \'@agent/ai\'\nexport type { value }\nexport * from \'./local.js\'\n')
  write('packages/agent/src/local.ts', 'export const local = () => import(\'node:fs\')\n')
  write('apps/api/src/host.ts', 'export interface Host { id: string }\n')
  return { root, write }
}

it('只依赖本包、ai/contracts 与标准库时通过', () => {
  assert.deepEqual(checkAgentBoundary(createWorkspace().root), [])
})

it('拒绝 Nest type import、越界相对导入、跨包相对路径与无法静态核对的动态导入', () => {
  const { root, write } = createWorkspace()
  write('packages/agent/src/bad.ts', [
    'import type { Injectable } from \'@nestjs/common\'',
    'export type Host = typeof import(\'../../../apps/api/src/host.js\')',
    'export const viaPath = () => import(\'../../ai/src/index.js\')',
    'export const dynamic = (name: string) => import(name)',
    'export type Nest = Injectable',
  ].join('\n'))
  const file = join('packages', 'agent', 'src', 'bad.ts')
  assert.deepEqual(checkAgentBoundary(root), [
    `${file}: 禁止依赖 @nestjs/common`,
    `${file}: 相对导入越过本包 src：../../../apps/api/src/host.js`,
    `${file}: 相对导入越过本包 src：../../ai/src/index.js`,
    `${file}: 不允许无法静态核对的模块路径`,
  ])
})
