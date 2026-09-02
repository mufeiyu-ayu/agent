/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'

import {
  findAvailablePort,
  resolveConfiguredPort,
  resolvePnpmCommand,
} from './dev-apps.mjs'

test('resolveConfiguredPort preserves process and root .env precedence', () => {
  assert.equal(resolveConfiguredPort('4000', 'PORT=5000'), '4000')
  assert.equal(resolveConfiguredPort(undefined, 'PORT=5000'), '5000')
})

test('resolvePnpmCommand runs pnpm through cmd.exe on Windows', () => {
  assert.deepEqual(
    resolvePnpmCommand('win32', ['dev'], 'C:\\Windows\\System32\\cmd.exe'),
    ['C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'pnpm', 'dev']],
  )
})

test('findAvailablePort skips an occupied port', async () => {
  const occupiedPort = await findAvailablePort(31000)
  const blocker = createServer()

  await new Promise((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(occupiedPort, resolve)
  })

  try {
    const selectedPort = await findAvailablePort(occupiedPort)

    assert.ok(selectedPort > occupiedPort)
  }
  finally {
    await new Promise(resolve => blocker.close(resolve))
  }
})
