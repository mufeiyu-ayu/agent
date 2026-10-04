import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'vitest'
import { fileHash, parseStoredFiles, workspacePath } from './workspace-files.js'

describe('工作文件边界', () => {
  it('只允许工作区内的普通路径，拒绝越界、控制字符与依赖目录', () => {
    assert.equal(workspacePath('/workspace/project/src/main.js'), 'src/main.js')
    assert.equal(workspacePath('报表/最近七天.html'), '报表/最近七天.html')
    for (const path of ['', '/etc/passwd', '../other-user/index.html', 'a/../b', 'a\\b', 'a\0b', '.git/config', 'node_modules/x.js', '\uD800'])
      assert.throws(() => workspacePath(path))
  })

  it('恢复时拒绝指向其他用户对象的清单和重复路径', () => {
    const prefix = 'users/u/conversations/c/'
    const content = Buffer.from('hello')
    const hash = fileHash(content)
    const file = { path: 'a.txt', bytes: 5, sha256: hash, key: `${prefix}objects/${hash}` }
    assert.deepEqual(parseStoredFiles([file], prefix), [file])
    assert.throws(() => parseStoredFiles([{ ...file, key: `users/other/objects/${hash}` }], prefix))
    assert.throws(() => parseStoredFiles([file, file], prefix))
    assert.throws(() => parseStoredFiles([{ ...file, bytes: 3000000 }], prefix))
  })
})
