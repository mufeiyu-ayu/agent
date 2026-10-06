import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ChatModule } from '../chat/chat.module.js'
import { ChatService } from '../chat/chat.service.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { LlmModule } from '../llm/llm.module.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { fileHash, parseStoredFiles } from './workspace-files.js'
import { WorkspaceGcService } from './workspace-gc.service.js'
import { artifactMime, previewCsp, previewDocument } from './workspace-preview.js'
import { WorkspaceService } from './workspace.service.js'
import 'reflect-metadata'

@Module({ imports: [LlmModule, ChatModule] })
class NativeCheckModule {}

const { Pool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string }) => {
    query: (sql: string, values?: unknown[]) => Promise<unknown>
    connect: () => Promise<{ query: (sql: string, values?: unknown[]) => Promise<unknown>, release: () => void }>
    end: () => Promise<void>
  }
}

const CASES = [
  {
    name: 'react',
    prompt: '做一个最小交互计数演示页面，明确写“演示数据”。使用默认 React + TypeScript + Vite 底座，计数初始为 0，按钮文字“增加”，output 元素显示数字，点击加 1，页面标题“React 初次”。额外创建 public/obsolete-note.txt 内容“恢复删除检查”。维护真实项目，真实执行 pnpm check 和 pnpm build，保存源码与成功 Artifact；不联网、不安装依赖、不启动 dev server。',
    followup: '恢复刚才的 React 项目。计数初始改为 10，按钮文字改成“增加两次”，每次加 2，页面标题改成“React 续改”。删除 public/obsolete-note.txt，确保下次恢复不会复活。真实检查和构建；这是隔离纠错验证，若看到 AC-09 故障标记导致构建失败，必须 read 定位并 edit 修复，再重新检查和构建，不能假报成功。',
  },
  {
    name: 'html',
    prompt: '做最小原生 HTML + Tailwind 前台演示，不用 React/JSX，沿用同一 Vite/Tailwind 底座。index.html 标题“HTML 初次”，有“切换主题”按钮，点击切换 body 的 data-theme 属性 light/dark。about.html 标题“关于页面”，两个页面都至少有 1200px 高的空白/内容和目标区域（首页 id=features、子页 id=pricing），保留首页 ./about.html#pricing 和子页 ./index.html#features 真链接。Vite 配置必须构建这两个 HTML 入口，产物含完整 JS/CSS。创建 public/obsolete-note.txt 内容“HTML恢复检查”。真实检查、pnpm build 并保存；无外网/安装/dev server，不转为 React。',
    followup: '恢复刚才的原生 HTML/Tailwind 项目，保持不用 React。将首页标题改为“HTML 续改”，保留主题按钮、双页入口和往返锚点链接，删除 public/obsolete-note.txt。真实检查并构建新的成功 Artifact，完整保存源码。',
  },
]

/** 手动真实 Agent 验收：只读本机开发库模型配置，写独立 TEST_DATABASE_URL schema 和本次临时云资源。 */
async function main() {
  process.env.OSS_WORKSPACE_GC_ENABLED = 'false'
  const testUrl = process.env.TEST_DATABASE_URL!
  const devUrl = process.env.DATABASE_URL!
  assert.ok(testUrl && devUrl && testUrl !== devUrl)
  for (const url of [testUrl, devUrl])
    assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname), '只允许本机开发/测试库')
  const dev = new PrismaService(devUrl)
  const model = await dev.llmModel.findFirst({ where: { isDefault: true, visible: true, provider: { enabled: true } }, include: { provider: true } })
    ?? await dev.llmModel.findFirst({ where: { visible: true, lastProbeOk: true, provider: { enabled: true, family: 'deepseek' } }, include: { provider: true }, orderBy: { createdAt: 'asc' } })
  await dev.$disconnect()
  assert.ok(model, '开发库必须有可用的默认模型或已探活的可见 DeepSeek 模型')
  const schema = `web_project_check_${randomUUID().replaceAll('-', '')}`
  const output = process.argv[2] || `/tmp/${schema}`
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ output, schema, model: model.displayName, template: process.env.E2B_TEMPLATE }))
  const pool = new Pool({ connectionString: testUrl })
  const client = await pool.connect()
  try {
    // 历史迁移需要 vector；放 public，临时 schema 清理不能删除共享扩展或干扰并行定向测试。
    await client.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public')
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query('SELECT set_config(\'search_path\', $1, false)', [`${schema},public`])
    const migrations = new URL('../../../../prisma/migrations/', import.meta.url)
    for (const directory of (await readdir(migrations)).sort()) {
      if (directory !== 'migration_lock.toml')
        await client.query(await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'))
    }
  }
  finally { client.release() }
  const scoped = new URL(testUrl)
  scoped.searchParams.set('schema', schema)
  scoped.searchParams.set('options', `-c search_path=${schema},public`)
  process.env.DATABASE_URL = scoped.toString()
  const app = await NestFactory.createApplicationContext(NativeCheckModule, { logger: ['error', 'warn'] })
  const prisma = app.get(PrismaService)
  const workspace = app.get(WorkspaceService)
  const chat = app.get(ChatService)
  const { provider, ...modelRow } = model
  await prisma.llmProvider.create({ data: provider })
  await prisma.llmModel.create({ data: { ...modelRow, isDefault: true } })
  await prisma.runtimeConfig.update({ where: { id: 1 }, data: { runDeadlineMs: 600_000, debugCaptureModelIo: false } })
  const user = await prisma.user.create({ data: { email: `${schema}@example.test` } })
  const report: unknown[] = []
  const injection: Array<Record<string, unknown>> = []
  const restores: Array<{ case: string, round: number, files: Array<{ path: string, sha256: string }> }> = []
  let currentCase = ''
  let currentRound = 0
  const originalRequest = workspace.cloud.request.bind(workspace.cloud)
  workspace.cloud.request = async (sandbox, script, request, ...rest) => {
    const input = request as { action?: string, files?: Array<{ path: string, content: string }> }
    if (input.action === 'restore')
      restores.push({ case: currentCase, round: currentRound, files: (input.files ?? []).map(file => ({ path: file.path, sha256: fileHash(Buffer.from(file.content, 'base64')) })) })
    return originalRequest(sandbox, script, request, ...rest)
  }
  const originalBash = workspace.bash.bind(workspace)
  let injectBuildFailure = false
  workspace.bash = async (execution, command, timeout, signal, build = false) => {
    if (injectBuildFailure && build) {
      injectBuildFailure = false
      const result = await originalBash(execution, 'printf \'\\nimport "./__ac09_missing_probe__";\\n\' >> src/App.tsx', timeout, signal)
      assert.equal(result.exitCode, 0)
      injection.push({ kind: '受控测试注入，不是模型计划', runId: execution.runId, file: 'src/App.tsx', marker: '__ac09_missing_probe__' })
    }
    return originalBash(execution, command, timeout, signal, build)
  }
  try {
    for (const example of CASES) {
      const conversation = await prisma.conversation.create({ data: { title: `#231 ${example.name}`, userId: user.id } })
      let lastArtifact = ''
      let previousSource: Array<{ path: string, sha256: string }> = []
      for (const [index, prompt] of [example.prompt, example.followup].entries()) {
        currentCase = example.name
        currentRound = index + 1
        injectBuildFailure = example.name === 'react' && index === 1
        const events = []
        for await (const event of await chat.chatStream(user.id, { conversationId: conversation.id, message: prompt })) {
          events.push(event)
          if (event.type === 'tool_started')
            console.log(`${example.name}-${index + 1}: ${event.toolName}`)
        }
        const run = await prisma.agentRun.findFirstOrThrow({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' } })
        await workspace.releaseRun(run.id)
        const steps = await prisma.agentStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
        const snapshot = await workspace.snapshot(user.id, conversation.id)
        const directory = join(output, `${example.name}-${index + 1}`)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'records.json'), JSON.stringify({ prompt, run, steps, events, snapshot }, null, 2))
        assert.equal(run.status, 'COMPLETED', JSON.stringify(events.at(-1)))
        assert.ok(snapshot.artifact, '真实 Agent 必须产出成功 Artifact')
        assert.notEqual(snapshot.artifact.id, lastArtifact, '续改必须生成新构建')
        lastArtifact = snapshot.artifact.id
        const row = await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: conversation.id } })
        const artifact = await prisma.workspaceArtifact.findUniqueOrThrow({ where: { id: snapshot.artifact.id } })
        for (const [kind, manifest] of [['source', row.files], ['dist', artifact.files]] as const) {
          for (const file of parseStoredFiles(manifest, `users/${user.id}/conversations/${conversation.id}/`)) {
            const path = join(directory, kind, file.path)
            await mkdir(join(path, '..'), { recursive: true })
            await writeFile(path, await workspace.cloud.readFile(file))
          }
        }
        await writeFile(join(directory, 'source.zip'), await workspace.archive(user.id, conversation.id, snapshot.revision, AbortSignal.timeout(60_000)))
        if (example.name === 'html') {
          const entry = await readFile(join(directory, 'source/index.html'), 'utf8')
          assert.doesNotMatch(entry, /src\/main\.tsx|ReactDOM|createRoot/)
        }
        const browser = await render(directory, example.name, index)
        const zip = await readFile(join(directory, 'source.zip'))
        const sourceManifest = parseStoredFiles(row.files, `users/${user.id}/conversations/${conversation.id}/`)
        const unpacked = createRequire(import.meta.url)('node:child_process').spawnSync('python3', ['-c', 'import sys,zipfile,json,hashlib;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([{\"path\":n,\"sha256\":hashlib.sha256(z.read(n)).hexdigest()} for n in z.namelist()]))', join(directory, 'source.zip')], { encoding: 'utf8' })
        assert.equal(unpacked.status, 0)
        const zipFiles = JSON.parse(unpacked.stdout) as Array<{ path: string, sha256: string }>
        assert.deepEqual(zipFiles, sourceManifest.map(file => ({ path: file.path, sha256: file.sha256 })))
        assert.ok(!zipFiles.some(file => /^(?:dist|node_modules)\//.test(file.path)))
        if (index === 1) {
          assert.ok(!snapshot.files.some(file => file.path === 'public/obsolete-note.txt'))
          assert.deepEqual(restores.find(record => record.case === example.name && record.round === 2)!.files, previousSource, '新实例恢复与首轮已确认 Source 逐路径/SHA 相同')
        }
        else { assert.ok(snapshot.files.some(file => file.path === 'public/obsolete-note.txt')) }
        previousSource = sourceManifest.map(file => ({ path: file.path, sha256: file.sha256 }))
        if (example.name === 'html')
          assert.ok(snapshot.artifact.files.some(file => file.path === 'about.html'), '原生第二 HTML 入口必须实际进入 dist')
        if (example.name === 'react' && index === 1) {
          const toolSteps = steps.filter(step => step.type === 'tool_execution')
          const failedBuild = toolSteps.find(step => JSON.stringify(step.output).includes('__ac09_missing_probe__') && JSON.stringify(step.output).includes('exitCode'))
          assert.ok(failedBuild, '必须保留实际故障 build stderr/exit 记录')
          const later = toolSteps.filter(step => step.sequence > failedBuild.sequence)
          assert.ok(later.some(step => (step.input as { toolName?: string })?.toolName === 'read'))
          assert.ok(later.some(step => (step.input as { toolName?: string })?.toolName === 'edit'))
          assert.ok(later.some(step => JSON.stringify(step.output).includes('pnpm build')))
        }
        const fact = { case: example.name, round: index + 1, restored: restores.filter(record => record.case === example.name && record.round === index + 1), conversationId: conversation.id, runId: run.id, sourceRevision: snapshot.revision, artifactId: artifact.id, sourceFiles: snapshot.files.map(file => file.path), artifactFiles: snapshot.artifact.files.map(file => file.path), browser, zip: { bytes: zip.length, files: zipFiles }, sourceManifest: sourceManifest.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), injection }
        report.push(fact)
        await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
        console.log(JSON.stringify(fact))
      }
    }
    assert.equal(report.length, 4)
    console.log('两个最小 Web Agent 案例初次/续改：四轮验证完成')
  }
  finally {
    let cleaned = false
    try {
      await workspace.onModuleDestroy()
      const cloud = workspace.cloud
      const gc = app.get(WorkspaceGcService)
      const conversations = await prisma.conversation.findMany({ where: { userId: user.id }, select: { id: true } })
      for (const conversation of conversations) {
        await new ConversationsService(prisma, gc).delete(user.id, conversation.id)
        const result = await gc.collect(conversation.id, true)
        assert.equal(result.blocked, null, '未知上传/删除须保留 schema 核查，不能丢目标')
        assert.deepEqual(result.failed, [])
      }
      const remaining = await cloud.listFiles(`users/${user.id}/`)
      assert.deepEqual(remaining.keys, [])
      assert.equal(remaining.nextMarker, undefined)
      cleaned = true
    }
    finally {
      try {
        await app.close()
      }
      finally {
        try {
          if (cleaned) {
            await pool.query(`DROP SCHEMA "${schema}" CASCADE`)
            console.log('本轮测试资源清理已确认；没有清理既有业务前缀。')
          }
          else {
            await writeFile(join(output, 'cleanup-pending.json'), JSON.stringify({ schema, prefix: `users/${user.id}/`, pending: true }))
            console.error('保留本轮 schema/持久目标供核查；应用与连接仍关闭。')
          }
        }
        finally { await pool.end() }
      }
    }
  }
}

async function render(directory: string, kind: string, round: number) {
  let origin = ''
  const base = () => `${origin}/files/`
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const url = new URL(request.url!, 'http://check.invalid')
      const path = url.pathname
      if (path === '/') {
      // 仅回放本轮 Agent dist 的可信测试宿主；生产宿主导航另由 Vue E2E 覆盖。
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><iframe title="Agent build" sandbox="allow-scripts" style="width:100%;height:900px;border:0" src="/document?generation=initial"></iframe><script>const f=document.querySelector("iframe");addEventListener("message",e=>{if(e.source!==f.contentWindow||e.origin!=="null")return;if(e.data?.type==="artifact-ready"){document.documentElement.dataset.ready=f.src;return}if(e.data?.type!=="artifact-page")return;delete document.documentElement.dataset.ready;const u=new URL(f.src,location.href);u.searchParams.set("path",e.data.path);u.searchParams.set("generation",crypto.randomUUID());u.hash=e.data.fragment||"";f.src=u.href})</script>')
        return
      }
      if (path === '/document') {
        const pagePath = url.searchParams.get('path') ?? 'index.html'
        assert.ok(pagePath.endsWith('.html') && !pagePath.includes('..'))
        const html = await readFile(join(directory, 'dist', pagePath), 'utf8')
        response.setHeader('Content-Type', 'text/html')
        response.setHeader('Content-Security-Policy', previewCsp(base()))
        response.end(previewDocument(html, base(), pagePath))
        return
      }
      assert.ok(path.startsWith('/files/') && !path.includes('..'))
      response.setHeader('Content-Type', artifactMime(path))
      response.setHeader('Content-Disposition', 'attachment')
      response.setHeader('Content-Security-Policy', 'sandbox; default-src \'none\'')
      response.setHeader('Access-Control-Allow-Origin', 'null')
      response.end(await readFile(join(directory, 'dist', path.slice(7))))
    }
    catch { response.writeHead(404).end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  origin = `http://127.0.0.1:${address.port}`
  const { chromium } = createRequire(new URL('../../../web/package.json', import.meta.url))('@playwright/test')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors: string[] = []
    page.on('pageerror', (error: Error) => errors.push(error.message))
    // 无云负向入口：缺失/非法 HTML 返回受控404，不以未捕获 listener rejection 退出。
    assert.equal((await page.request.get(`${origin}/document?path=missing-probe.html`)).status(), 404)
    assert.equal((await page.request.get(`${origin}/document?path=${encodeURIComponent('../outside.html')}`)).status(), 404)
    await page.goto(origin)
    const ready = () => page.waitForFunction(() => document.documentElement.dataset.ready === document.querySelector<HTMLIFrameElement>('iframe')?.src)
    const frame = page.frameLocator('iframe').frameLocator('iframe')
    await ready()
    await frame.locator('h1').first().waitFor()
    const title = await frame.locator('h1').first().textContent()
    assert.equal(title, kind === 'react' ? (round === 0 ? 'React 初次' : 'React 续改') : (round === 0 ? 'HTML 初次' : 'HTML 续改'))
    const buttons = await frame.getByRole('button').count()
    let interaction: Record<string, unknown>
    if (kind === 'react') {
      const count = frame.locator('output')
      assert.equal(await count.textContent(), round === 0 ? '0' : '10')
      await frame.getByRole('button', { name: round === 0 ? '增加' : '增加两次', exact: true }).click()
      assert.equal(await count.textContent(), round === 0 ? '1' : '12')
      interaction = { counterBefore: round === 0 ? 0 : 10, counterAfter: round === 0 ? 1 : 12 }
    }
    else {
      await frame.getByRole('button', { name: '切换主题', exact: true }).click()
      assert.equal(await frame.locator('body').getAttribute('data-theme'), 'dark')
      await frame.locator('a[href$="about.html#pricing"]').first().click()
      await frame.locator('#pricing').waitFor()
      await ready()
      const pricing = await frame.locator('#pricing').evaluate((element: HTMLElement) => ({ top: element.getBoundingClientRect().top, y: scrollY, height: innerHeight }))
      assert.ok(pricing.top >= -3 && pricing.top < pricing.height / 3 && pricing.y > 0, JSON.stringify(pricing))
      await frame.locator('a[href$="index.html#features"]').first().click()
      await frame.locator('#features').waitFor()
      await ready()
      const features = await frame.locator('#features').evaluate((element: HTMLElement) => ({ top: element.getBoundingClientRect().top, y: scrollY, height: innerHeight }))
      assert.ok(features.top >= -3 && features.top < features.height / 3 && features.y > 0, JSON.stringify(features))
      interaction = { themeAfterClick: 'dark', pricing, features }
    }
    await page.screenshot({ path: join(directory, 'browser.png'), fullPage: true })
    assert.deepEqual(errors, [])
    return { title, buttons, errors, interaction, negativeHtmlEntries: 2 }
  }
  finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

async function replay() {
  const directory = process.argv[3]!
  const cases = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')) as Array<{ case: string, round: number }>
  const results = []
  for (const item of cases)
    results.push({ case: item.case, round: item.round, browser: await render(join(directory, `${item.case}-${item.round}`), item.case, item.round - 1) })
  await writeFile(join(directory, 'browser-replay.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
}

const execution = process.argv[2] === '--replay' ? replay() : main()
execution.catch((error: unknown) => {
  // 不打印 SDK 异常 stack 或请求，失败的详细业务记录在本机 records.json。
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : '验收失败')
  process.exitCode = 1
})
