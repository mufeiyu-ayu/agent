import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import OSS from 'ali-oss'
import { ChatModule } from '../chat/chat.module.js'
import { ChatService } from '../chat/chat.service.js'
import { LlmModule } from '../llm/llm.module.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { parseStoredFiles } from './workspace-files.js'
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
    prompt: '帮我做一个最近七天 topuplist 流量情况的可交互看板。使用已提供的演示数据并明确标注，展示访客、浏览量、会话、每日趋势和渠道，支持切换指标。请维护真实前端项目，在沙箱写文件、检查构建，发现错误就读取和编辑修复，最后保存让我查看源码、预览并下载源码目录。',
    followup: '把渠道改成横向柱状图并调整颜色。继续修改已保存项目，检查并构建新的成功 Artifact。',
  },
  {
    name: 'html',
    prompt: '我想做一个博客页面的前台 Demo，用 HTML + Tailwind 写就好，不用 React。请在当前工作区维护代码，做真实构建验证，保存后让我查看源码、预览并下载源码目录。',
    followup: '继续修改已保存的 HTML 博客，新增一个可在浏览器本地切换的深色主题按钮，调整标题为「我的博客」。保持原生 HTML + Tailwind，不用 React；检查并构建。',
  },
]

/** 手动真实 Agent 验收：只读本机开发库模型配置，写独立 TEST_DATABASE_URL schema 和本次临时云资源。 */
async function main() {
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
  try {
    for (const example of CASES) {
      const conversation = await prisma.conversation.create({ data: { title: `#231 ${example.name}`, userId: user.id } })
      let lastArtifact = ''
      for (const [index, prompt] of [example.prompt, example.followup].entries()) {
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
        const browser = await render(directory)
        const fact = { case: example.name, round: index + 1, conversationId: conversation.id, runId: run.id, sourceRevision: snapshot.revision, artifactId: artifact.id, sourceFiles: snapshot.files.map(file => file.path), artifactFiles: snapshot.artifact.files.map(file => file.path), browser }
        report.push(fact)
        await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
        console.log(JSON.stringify(fact))
      }
    }
    const conversation = await prisma.conversation.create({ data: { title: '#231 Python', userId: user.id } })
    for await (const event of await chat.chatStream(user.id, { conversationId: conversation.id, message: '在工作区创建一个 Python 脚本计算 1 到 10 的平方并真实运行检查；不要初始化网页项目。' })) {
      if (event.type === 'error')
        throw new Error(event.message)
    }
    const scripts = await workspace.snapshot(user.id, conversation.id)
    assert.equal(scripts.webProject, false)
    assert.equal(scripts.artifact, null)
    assert.ok(scripts.files.some(file => file.path.endsWith('.py')))
    assert.ok(!scripts.files.some(file => file.path === 'package.json'))
    console.log('普通 Python 不初始化网页：PASS')
  }
  finally {
    await app.close()
    // 仅清理本次随机用户的 OSS 对象，不扫其他用户或删除共享 Bucket/模板。
    const storageOptions = { accessKeyId: process.env.OSS_ACCESS_KEY_ID!, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!, bucket: process.env.OSS_BUCKET!, region: process.env.OSS_REGION!, authorizationV4: true, secure: true, enableProxy: false, timeout: 15_000 }
    const storage = new OSS(storageOptions)
    let marker: string | undefined
    do {
      const page = await storage.list({ 'prefix': `users/${user.id}/`, 'max-keys': 1000, ...(marker ? { marker } : {}) }, {})
      for (const file of page.objects ?? [])
        await storage.delete(file.name)
      marker = page.isTruncated ? page.nextMarker : undefined
    } while (marker)
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`)
    await pool.end()
    console.log('本轮沙箱、OSS 与测试 schema 清理完成；证据保留在本机 output。')
  }
}

async function render(directory: string) {
  const html = await readFile(join(directory, 'dist/index.html'), 'utf8')
  let origin = ''
  const base = () => `${origin}/files/`
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const path = new URL(request.url!, 'http://check.invalid').pathname
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.setHeader('Content-Security-Policy', previewCsp(base()))
      response.end(previewDocument(html, base()))
      return
    }
    try {
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
    await page.goto(origin)
    const frame = page.frameLocator('iframe')
    await frame.locator('h1').first().waitFor()
    const title = await frame.locator('h1').first().textContent()
    const buttons = await frame.getByRole('button').count()
    assert.ok((await frame.locator('body').textContent()).length > 100)
    await page.screenshot({ path: join(directory, 'browser.png'), fullPage: true })
    assert.deepEqual(errors, [])
    return { title, buttons, errors }
  }
  finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

main().catch((error: unknown) => {
  // 不打印 SDK 异常 stack 或请求，失败的详细业务记录在本机 records.json。
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : '验收失败')
  process.exitCode = 1
})
