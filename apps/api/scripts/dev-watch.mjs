import { spawn } from 'node:child_process'
import process from 'node:process'

const tscCommand = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
const commands = [
  [tscCommand, ['--watch', '--preserveWatchOutput']],
  // 两个共享包也 watch：改了源码就重新生成 dist，下面的 node --watch 追踪到 import 的 dist 变化后重启 API。
  // predev 的一次性编译保留，保证首次启动时 dist 已存在。
  [tscCommand, ['--watch', '--preserveWatchOutput', '-p', '../../packages/contracts']],
  [tscCommand, ['--watch', '--preserveWatchOutput', '-p', '../../packages/ai']],
  [process.execPath, [
    '--env-file-if-exists=../../.env',
    '--watch',
    '--watch-preserve-output',
    'dist/main.js',
  ]],
]
const children = commands.map(([command, args]) => spawn(command, args, {
  stdio: 'inherit',
}))
const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
}
let remainingChildren = children.length
let stopping = false
let exitCode = 0

for (const child of children) {
  child.once('error', (error) => {
    console.error(error)
    exitCode = 1
    stopChildren('SIGTERM', child)
  })
  child.once('close', (code, signal) => {
    remainingChildren -= 1

    if (!stopping) {
      exitCode = code ?? signalExitCodes[signal] ?? 1
      stopChildren(signal ?? 'SIGTERM', child)
    }

    if (remainingChildren === 0)
      process.exitCode = exitCode
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    exitCode = signalExitCodes[signal]
    stopChildren(signal)
  })
}

function stopChildren(signal, source) {
  if (stopping)
    return

  stopping = true
  for (const child of children) {
    if (child !== source && child.exitCode === null && child.signalCode === null)
      child.kill(signal)
  }
}
