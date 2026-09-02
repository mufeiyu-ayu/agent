import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

const DEFAULT_API_PORT = 3000
const MAX_PORT_ATTEMPTS = 20
const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
}

export async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS && port <= 65535; port += 1) {
    if (await isPortAvailable(port))
      return port
  }

  throw new Error(`从 ${startPort} 开始连续 ${MAX_PORT_ATTEMPTS} 个 API 端口均被占用`)
}

export function resolvePnpmCommand(platform, args, commandInterpreter) {
  return platform === 'win32'
    ? [commandInterpreter ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args]]
    : ['pnpm', args]
}

export function resolveConfiguredPort(processPort, envContents) {
  return processPort ?? parseEnv(envContents).PORT
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()

    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })
}

function parsePort(value) {
  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`无效的 PORT：${value}`)

  return port
}

async function main() {
  const rootEnvPath = fileURLToPath(new URL('../.env', import.meta.url))
  const envContents = existsSync(rootEnvPath) ? readFileSync(rootEnvPath, 'utf8') : ''
  const configuredPort = resolveConfiguredPort(process.env.PORT, envContents)
  const hasExplicitPort = configuredPort !== undefined
  const requestedPort = parsePort(configuredPort ?? DEFAULT_API_PORT)
  const apiPort = hasExplicitPort
    ? requestedPort
    : await findAvailablePort(requestedPort)
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${apiPort}`

  if (apiPort !== requestedPort)
    console.warn(`[dev:apps] API 端口 ${requestedPort} 已被占用，自动使用 ${apiPort}`)

  console.log(`[dev:apps] API: http://localhost:${apiPort} | Web/Admin proxy: ${apiProxyTarget}`)

  const pnpmArgs = [
    '--parallel',
    '--filter',
    './apps/*',
    'dev',
    ...process.argv.slice(2),
  ]
  const [pnpmCommand, commandArgs] = resolvePnpmCommand(
    process.platform,
    pnpmArgs,
    process.env.ComSpec,
  )
  const child = spawn(pnpmCommand, commandArgs, {
    env: {
      ...process.env,
      PORT: String(apiPort),
      VITE_API_PROXY_TARGET: apiProxyTarget,
    },
    stdio: 'inherit',
  })

  child.once('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.once('close', (code, signal) => {
    process.exitCode = code ?? signalExitCodes[signal] ?? 1
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill(signal)
    })
  }
}

const entryPath = process.argv[1]

if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((error) => {
    console.error(`[dev:apps] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
