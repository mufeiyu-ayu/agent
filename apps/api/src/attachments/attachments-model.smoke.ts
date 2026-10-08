import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { LLMError, resolveChatRequestConfig } from '@agent/ai'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * 手动真模型看图检查：只读本机开发库，使用已有服务商凭据和出站策略。
 * 每个可见模型发一次真实图片请求（有费用），不上传文件、不创建会话、不修改能力开关。
 * 在 apps/api 下运行：
 * node --env-file=../../.env --import tsx src/attachments/attachments-model.smoke.ts --run [模型 id...]
 * 不带 --run 只列模型。正常图片请求之外的链路由 attachments.smoke.ts / 真实库测试覆盖。
 */
const TIMEOUT_MS = 60_000
const OUTPUT_LIMIT = 2048
const EXPECTED_DIGITS = '4271'
const PROMPT = '请读出图片中的四位数字，只回复这四位数字。无法看图就回复 NO_IMAGE，不要猜测。'

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname), '只允许本机开发库，不访问生产')
  const args = process.argv.slice(2)
  const run = args[0] === '--run'
  const requested = new Set(run ? args.slice(1) : [])
  assert.ok(run || args.length === 0, '用法：--run [模型 id...]；无参数只列模型')
  const prisma = new PrismaService()

  try {
    const rows = await prisma.llmModel.findMany({
      where: { visible: true, provider: { enabled: true } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, displayName: true, supportsImageInput: true, provider: { select: { family: true } } },
    })
    for (const id of requested)
      assert.ok(rows.some(row => row.id === id), `没有可测试的模型：${id}`)
    const targets = rows.filter(row => requested.size === 0 || requested.has(row.id))
    assert.ok(targets.length > 0, '没有启用且前台可见的模型')

    if (!run) {
      console.log(JSON.stringify(targets, null, 2))
      return
    }

    const runtime = new LLMRuntimeConfigService()
    const models = new LlmModelConfigService(prisma, runtime)
    const llm = new LLMService(runtime)
    const image = await readFile(new URL('./__fixtures__/vision.png', import.meta.url))
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '测试图片不是 PNG')
    const results = []

    for (const target of targets) {
      const started = Date.now()
      const model = await models.resolveModel(target.id)
      const request = resolveChatRequestConfig({ ...model.profile, supportsImageInput: true })
      request.maxOutputTokens = Math.min(request.maxOutputTokens, OUTPUT_LIMIT)
      let text = ''
      let finishReason: string | undefined
      let error: string | undefined
      let outputTokens: number | undefined

      try {
        for await (const event of llm.chatStream(model.provider, [{
          type: 'message',
          role: 'user',
          content: PROMPT,
          images: [{ name: 'vision.png', mimeType: 'image/png', data: image.toString('base64') }],
        }], { request, signal: AbortSignal.timeout(TIMEOUT_MS) })) {
          if (event.type === 'text_delta')
            text += event.delta
          if (event.type === 'response_completed')
            finishReason = event.finishReason
          if (event.type === 'usage')
            outputTokens = event.usage.outputTokens
        }
      }
      catch (failure) {
        // 不打印异常 detail / cause，那里可能含上游凭据；LLMError.message 已经由生产适配器脱敏。
        error = failure instanceof LLMError ? failure.message : failure instanceof Error ? failure.name : 'unknown_error'
        error = error.replaceAll(model.provider.apiKey, '***')
      }

      const ok = !error && text.trim() === EXPECTED_DIGITS && finishReason === 'stop'
      const result = {
        modelId: target.id,
        name: target.displayName,
        family: model.family,
        ok,
        response: text.replaceAll(model.provider.apiKey, '***').slice(0, 120),
        finishReason,
        outputTokens,
        error,
        elapsedMs: Date.now() - started,
      }
      results.push(result)
      console.log(JSON.stringify(result))
    }

    console.log(`看图正确 ${results.filter(result => result.ok).length}/${results.length}；开关未修改。`)
    if (results.some(result => !result.ok))
      process.exitCode = 1
  }
  finally {
    await prisma.$disconnect()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : '检查失败')
  process.exitCode = 1
})
