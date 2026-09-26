import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dayjs from 'dayjs'
import { describe, it } from 'vitest'

import { i18n, resolveAdminLocale } from './index'
import { messages } from './messages'

/**
 * 按变量拼出来、源码里查不到完整字面量的键，按前缀（或完整键）登记并写明原因；新增动态键要在这里补一行。
 * 登记的键只豁免「被引用」检查，中英两侧键集合一致的检查照常生效。
 */
const DYNAMIC_KEY_PREFIXES: Array<{ prefix: string, reason: string }> = [
  { prefix: 'overview.trend.status.', reason: '趋势图按 AgentRunStatus 枚举值拼接' },
  { prefix: 'runTrace.errorCodes.', reason: 'Run 失败类别按 AgentRunErrorCode 枚举值拼接' },
  { prefix: 'eventDetail.context.outcome.', reason: 'Context Inspector 按 outcome 枚举值拼接' },
  { prefix: 'llmModels.families.', reason: '服务商家族按 LlmProviderFamily 枚举值拼接' },
  // 数字字段的校验文案按字段名拼接；同名的字段标签键是字面量引用，不在豁免之列。
  ...['contextWindowTokens', 'maxOutputTokens'].flatMap(field => ['Required', 'Invalid'].map(suffix => ({
    prefix: `llmModels.models.form.${field}${suffix}`,
    reason: '数字字段的 Required / Invalid 按字段名拼接',
  }))),
]

describe('admin i18n', () => {
  it('语言解析：存储值优先，其次按浏览器语言回落', () => {
    assert.equal(resolveAdminLocale('en-US', 'zh-CN'), 'en-US')
    assert.equal(resolveAdminLocale(null, 'en-GB'), 'en-US')
    assert.equal(resolveAdminLocale('unknown', 'zh-CN'), 'zh-CN')
    assert.equal(dayjs('2026-08-10').locale('zh-cn').format('ddd'), '周一')
  })

  it('中英键集合一致', () => {
    assert.deepEqual(getKeys(messages['zh-CN']), getKeys(messages['en-US']))
  })

  it('每个键在 src 里被引用', () => {
    assert.deepEqual(findUnreferencedKeys(getKeys(messages['zh-CN'])), [], '以上键在 src 里没有被引用')
  })

  it('切换语言后按当前语言取文案', () => {
    i18n.global.locale.value = 'en-US'
    assert.equal(i18n.global.t('navigation.runs'), 'Runs')
    i18n.global.locale.value = 'zh-CN'
    assert.equal(i18n.global.t('navigation.runs'), '运行记录')
  })
})

function getKeys(value: object, prefix = ''): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof child === 'object' && child !== null ? getKeys(child, path) : path
    })
    .sort()
}

/** 键的完整字面量（单引号 / 双引号 / 反引号）至少在 src 的 .ts / .vue 里出现一次；文案本身与测试文件不算引用。 */
function findUnreferencedKeys(keys: string[]): string[] {
  const srcDir = fileURLToPath(new URL('..', import.meta.url))
  const source = listSourceFiles(srcDir)
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')

  return keys.filter(key => (
    !DYNAMIC_KEY_PREFIXES.some(({ prefix }) => key.startsWith(prefix))
    && !['\'', '"', '`'].some(quote => source.includes(`${quote}${key}${quote}`))
  ))
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory())
      return listSourceFiles(path)

    return /\.(?:ts|vue)$/.test(entry.name)
      && !entry.name.endsWith('.test.ts')
      && path !== fileURLToPath(new URL('./messages.ts', import.meta.url))
      ? [path]
      : []
  })
}
