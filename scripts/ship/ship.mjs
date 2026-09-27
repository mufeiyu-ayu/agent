// 部署到 askkuro.com（只服务这一台服务器，地址只来自本机 ssh 别名 agent-hk）。用法见 docs/deploy.md「部署」。
//   pnpm ship                     本地检查 → 构建 → 直传镜像 → 备份 → 迁移 → 换版本 → 健康检查（失败自动切回）
//   pnpm ship --skip-checks       跳过分支 / 远端同步 / 测试检查（只用于演练，工作区仍须干净）
//   pnpm ship:rollback [版本]     只回退代码（镜像），不动数据库；不带版本时列出保留的版本并回到上一个
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const SSH_HOST = 'agent-hk'
const HEALTH_URL = 'https://askkuro.com/api/health'
const HEALTH_TIMEOUT_MS = 90_000
const KEEP = 5
const VERSION_PATTERN = /^[0-9a-f]{7,40}$/

class ShipError extends Error {}

function fail(message) {
  throw new ShipError(message)
}

function log(message) {
  console.log(`\n[ship] ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })

  if (result.status !== 0)
    fail(`${command} ${args.join(' ')} 失败（退出码 ${result.status ?? result.signal}）`)

  return result.stdout?.toString().trim() ?? ''
}

function capture(command, args) {
  return run(command, args, { stdio: ['ignore', 'pipe', 'inherit'] })
}

/** 在服务器 ~/kuro 下执行一段 bash；capture 时返回 stdout。 */
function remote(script, { capture = false, input } = {}) {
  return run('ssh', [SSH_HOST, `set -euo pipefail; cd ~/kuro; ${script}`], {
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    input,
  })
}

function compose(version) {
  return `KURO_VERSION=${version} docker compose -f compose.${version}.yml`
}

async function waitHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) })

      if (response.ok)
        return true
    }
    catch {}

    await sleep(3_000)
  }

  return false
}

/**
 * 切到指定版本（用它自己的 compose.<版本>.yml）并做健康检查；成功后记为 current，编排复制为 compose.yml 供手工操作。
 * 启动报错或不健康时切回 fallback（有的话），报错退出。
 */
async function switchTo(version, fallback) {
  let problem

  try {
    remote(`${compose(version)} up -d --remove-orphans`)
    log(`健康检查 ${HEALTH_URL}`)
    problem = await waitHealthy() ? undefined : '健康检查失败'
  }
  catch (error) {
    if (!(error instanceof ShipError))
      throw error

    problem = `启动失败（${error.message}）`
  }

  if (!problem) {
    remote(`cp compose.${version}.yml compose.yml && echo ${version} > current`)
    return
  }

  if (!fallback)
    fail(`${version} ${problem}，没有可切回的版本`)

  log(`${version} ${problem}，切回 ${fallback}`)
  remote(`${compose(fallback)} up -d --remove-orphans`)
  const recovered = await waitHealthy()
  fail(`${version} ${problem}，已切回 ${fallback}${recovered ? '，线上已恢复' : '，但切回后仍不健康，需人工排查'}`)
}

function readReleases() {
  const current = remote('cat current 2>/dev/null || true', { capture: true })
  const releases = remote('cat releases 2>/dev/null || true', { capture: true })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [version, ...time] = line.split(' ')
      return { version, time: time.join(' ') }
    })

  return { current, releases }
}

async function ship(skipChecks) {
  log('本地检查')

  if (capture('git', ['status', '--porcelain']))
    fail('工作区不干净，先提交或清理')

  if (skipChecks) {
    console.warn('已跳过分支、远端同步与 typecheck / lint / test 检查（仅限演练）')
  }
  else {
    if (capture('git', ['branch', '--show-current']) !== 'master')
      fail('只能在 master 上部署')

    run('git', ['fetch', 'origin', 'master'])

    if (capture('git', ['rev-parse', 'HEAD']) !== capture('git', ['rev-parse', 'origin/master']))
      fail('本地 master 与 origin/master 不一致，先同步')

    for (const script of ['typecheck', 'lint', 'test'])
      run('pnpm', [script])
  }

  const version = capture('git', ['rev-parse', '--short=8', 'HEAD'])
  remote('test -f .env || { echo "服务器缺 ~/kuro/.env，先按 docs/deploy.md 初始化" >&2; exit 1; }')
  const { current: previous } = readReleases()

  // 同一版本重传会把标签挪到新镜像上，切回就无处可切。
  if (previous === version)
    fail(`服务器当前已是 ${version}；只改了 .env 时在服务器上 docker compose up -d 生效`)

  log(`构建 ${version}（linux/amd64）`)
  for (const target of ['api', 'caddy'])
    run('docker', ['build', '--platform', 'linux/amd64', '-f', 'deploy/Dockerfile', '--target', target, '-t', `kuro-${target}:${version}`, '.'])

  log('上传镜像与 compose.yml')
  run('bash', ['-c', `set -o pipefail; docker save kuro-api:${version} kuro-caddy:${version} | gzip | ssh ${SSH_HOST} docker load`])
  remote(`cat > compose.${version}.yml`, { input: readFileSync('deploy/compose.yml') })

  log('迁移前备份数据库')
  remote(`${compose(version)} up -d --wait postgres
    mkdir -p backups
    f=backups/$(date +%Y%m%d-%H%M%S)-before-${version}.dump
    ${compose(version)} exec -T postgres pg_dump -U agent -d agent -Fc > "$f.tmp" || { rm -f "$f.tmp"; exit 1; }
    mv "$f.tmp" "$f"
    echo "已备份：$f"`)

  log('执行迁移')
  remote(`${compose(version)} run --rm --no-deps -w /app api node_modules/.bin/prisma migrate deploy`)

  log(`切换到 ${version}`)
  await switchTo(version, previous)

  // 上线成功才轮转：记录版本，只保留最近 KEEP 个版本（镜像与编排）和 KEEP 份备份；失败的尝试不淘汰旧备份。
  remote(`{ grep -v "^${version} " releases 2>/dev/null || true; echo "${version} $(date '+%F %T')"; } | tail -n ${KEEP} > releases.tmp
    mv releases.tmp releases
    keep=$(cut -d' ' -f1 releases | paste -sd'|')
    docker images --format '{{.Repository}}:{{.Tag}}' | awk -F: -v keep="^($keep)$" '$1 ~ /^kuro-(api|caddy)$/ && $2 !~ keep' | xargs -r docker rmi
    docker image prune -f > /dev/null
    for f in compose.*.yml; do v=\${f#compose.}; v=\${v%.yml}; grep -q "^$v " releases || rm -f "$f"; done
    ls -1t backups/*.dump | tail -n +${KEEP + 1} | xargs -r rm --`)
  log(`已上线 ${version}`)
}

async function rollback(target) {
  const { current, releases } = readReleases()

  if (releases.length === 0)
    fail('服务器上还没有部署记录')

  console.log('服务器保留的版本（旧 → 新）：')
  for (const { version, time } of releases)
    console.log(`  ${version === current ? '*' : ' '} ${version}  ${time}`)

  const index = releases.findIndex(release => release.version === current)

  if (target === undefined) {
    if (index <= 0)
      fail('当前已是保留的最早版本，没有上一个版本')

    target = releases[index - 1].version
  }
  else if (!VERSION_PATTERN.test(target) || !releases.some(release => release.version === target)) {
    fail(`${target} 不在保留的版本里`)
  }

  if (target === current) {
    log(`当前已是 ${target}`)
    return
  }

  log(`回退到 ${target}（只回退代码，不动数据库）`)
  await switchTo(target, current)
  log(`已回退到 ${target}`)
}

const [command, ...args] = process.argv.slice(2)

try {
  if (command === 'rollback')
    await rollback(args[0])
  else
    await ship(command === '--skip-checks')
}
catch (error) {
  if (!(error instanceof ShipError))
    throw error

  console.error(`\n[ship] 失败：${error.message}`)
  process.exitCode = 1
}
