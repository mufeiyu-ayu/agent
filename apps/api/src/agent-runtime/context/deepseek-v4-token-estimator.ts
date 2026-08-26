import type { ModelInputItem } from '../../llm/model-input.types.js'
import type { ModelToolSpec } from '../../llm/model-tool-spec.types.js'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { Tokenizer } from '@huggingface/tokenizers'
import { Injectable } from '@nestjs/common'

import { ContextTokenEstimationError } from '../agent-runtime.errors.js'

const BOS_TOKEN = '<｜begin▁of▁sentence｜>'
const EOS_TOKEN = '<｜end▁of▁sentence｜>'
const USER_TOKEN = '<｜User｜>'
const ASSISTANT_TOKEN = '<｜Assistant｜>'
const THINKING_START_TOKEN = '<think>'
const THINKING_END_TOKEN = '</think>'
const DSML_TOKEN = '｜DSML｜'

const TOOLS_TEMPLATE = `## Tools

You have access to a set of tools to help answer the user's question. You can invoke tools by writing a "<${DSML_TOKEN}tool_calls>" block like the following:

<${DSML_TOKEN}tool_calls>
<${DSML_TOKEN}invoke name="$TOOL_NAME">
<${DSML_TOKEN}parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</${DSML_TOKEN}parameter>
...
</${DSML_TOKEN}invoke>
<${DSML_TOKEN}invoke name="$TOOL_NAME2">
...
</${DSML_TOKEN}invoke>
</${DSML_TOKEN}tool_calls>

String parameters should be specified as is and set \`string="true"\`. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set \`string="false"\`.

If thinking_mode is enabled (triggered by ${THINKING_START_TOKEN}), you MUST output your complete reasoning inside ${THINKING_START_TOKEN}...${THINKING_END_TOKEN} BEFORE any tool calls or final response.

Otherwise, output directly after ${THINKING_END_TOKEN} with tool calls or final response.

### Available Tool Schemas

{tool_schemas}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.
`

export interface TokenEstimatorInput {
  items: ModelInputItem[]
  tools: ModelToolSpec[]
}

/** Context planning 只依赖该边界，不依赖具体 tokenizer 包。 */
export abstract class TokenEstimator {
  abstract readonly strategyId: string
  abstract estimateRequest(input: TokenEstimatorInput): number
}

@Injectable()
export class DeepSeekV4TokenEstimator extends TokenEstimator {
  readonly strategyId = 'deepseek-v4-official-b5968e9'
  private readonly tokenizer: Tokenizer

  constructor() {
    super()

    try {
      const tokenizer = JSON.parse(gunzipSync(readFileSync(
        new URL('../../../tokenizers/deepseek-v4/tokenizer.json.gz', import.meta.url),
      )).toString('utf8')) as object
      const config = JSON.parse(readFileSync(
        new URL('../../../tokenizers/deepseek-v4/tokenizer_config.json', import.meta.url),
        'utf8',
      )) as object

      this.tokenizer = new Tokenizer(tokenizer, config)
    }
    catch (cause) {
      throw new ContextTokenEstimationError(cause)
    }
  }

  estimateRequest(input: TokenEstimatorInput): number {
    try {
      return this.encodeTokenIds(renderDeepSeekV4RequestPrompt(input)).length
    }
    catch (cause) {
      if (cause instanceof ContextTokenEstimationError)
        throw cause

      throw new ContextTokenEstimationError(cause)
    }
  }

  encodeTokenIds(text: string): number[] {
    return this.tokenizer.encode(text, { add_special_tokens: false }).ids
  }
}

type DeepSeekContentBlock
  = | { type: 'text', text: string }
    | { type: 'tool_result', content: string }

type DeepSeekRenderMessage
  = | {
    role: 'system'
    content: string
    tools?: ModelToolSpec[]
  }
  | {
    role: 'user'
    contentBlocks: DeepSeekContentBlock[]
  }
  | {
    role: 'assistant'
    content: string
    reasoningContent?: string
    toolCall?: {
      name: string
      rawArgumentsJson: string
    }
  }

/** DeepSeek V4 官方 encoding_dsv4.py@b5968e9 的本项目输入子集。 */
export function renderDeepSeekV4RequestPrompt(
  input: TokenEstimatorInput,
): string {
  const messages = toDeepSeekRenderMessages(input)
  const dropThinking = !messages.some(
    message => message.role === 'system' && Boolean(message.tools?.length),
  )
  const lastUserIndex = findLastUserIndex(messages)
  let prompt = BOS_TOKEN

  for (const [index, message] of messages.entries()) {
    prompt += renderMessage(message, index, lastUserIndex, dropThinking)

    const nextRole = messages[index + 1]?.role

    if (nextRole && nextRole !== 'assistant')
      continue

    if (message.role === 'user') {
      prompt += ASSISTANT_TOKEN
      prompt += !dropThinking || index >= lastUserIndex
        ? THINKING_START_TOKEN
        : THINKING_END_TOKEN
    }
  }

  return prompt
}

function toDeepSeekRenderMessages(
  input: TokenEstimatorInput,
): DeepSeekRenderMessage[] {
  const messages: DeepSeekRenderMessage[] = []

  for (const item of input.items) {
    switch (item.type) {
      case 'message':
        if (item.role === 'system') {
          messages.push({ role: 'system', content: item.content })
        }
        else if (item.role === 'user') {
          appendUserBlock(messages, { type: 'text', text: item.content })
        }
        else {
          messages.push({ role: 'assistant', content: item.content })
        }
        break

      case 'assistant_tool_call':
        messages.push({
          role: 'assistant',
          content: item.content ?? '',
          reasoningContent: item.reasoningContent,
          toolCall: {
            name: item.name,
            rawArgumentsJson: item.rawArgumentsJson,
          },
        })
        break

      case 'tool_result':
        appendUserBlock(messages, {
          type: 'tool_result',
          content: item.content,
        })
        break
    }
  }

  if (input.tools.length > 0) {
    const systemMessage = messages.find(
      (message): message is Extract<DeepSeekRenderMessage, { role: 'system' }> =>
        message.role === 'system',
    )

    if (!systemMessage)
      throw new TypeError('DeepSeek V4 tools require a system message')

    systemMessage.tools = input.tools
  }

  return messages
}

function appendUserBlock(
  messages: DeepSeekRenderMessage[],
  block: DeepSeekContentBlock,
): void {
  const previous = messages.at(-1)

  if (previous?.role === 'user') {
    previous.contentBlocks.push(block)
    return
  }

  messages.push({ role: 'user', contentBlocks: [block] })
}

function renderMessage(
  message: DeepSeekRenderMessage,
  index: number,
  lastUserIndex: number,
  dropThinking: boolean,
): string {
  switch (message.role) {
    case 'system':
      return message.content + (message.tools?.length
        ? `\n\n${renderTools(message.tools)}`
        : '')

    case 'user':
      return USER_TOKEN + message.contentBlocks.map((block) => {
        if (block.type === 'text')
          return block.text

        return `<tool_result>${block.content}</tool_result>`
      }).join('\n\n')

    case 'assistant': {
      const reasoning = !dropThinking || index > lastUserIndex
        ? `${message.reasoningContent ?? ''}${THINKING_END_TOKEN}`
        : ''
      const toolCall = message.toolCall
        ? renderToolCall(message.toolCall)
        : ''

      return `${reasoning}${message.content}${toolCall}${EOS_TOKEN}`
    }
  }
}

function renderTools(tools: ModelToolSpec[]): string {
  const toolSchemas = tools.map(tool => pythonJson({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  })).join('\n')

  return TOOLS_TEMPLATE.replace('{tool_schemas}', toolSchemas)
}

function renderToolCall(input: {
  name: string
  rawArgumentsJson: string
}): string {
  const argumentsDsml = renderToolArguments(input.rawArgumentsJson)

  return `\n\n<${DSML_TOKEN}tool_calls>\n<${DSML_TOKEN}invoke name="${input.name}">\n${argumentsDsml}\n</${DSML_TOKEN}invoke>\n</${DSML_TOKEN}tool_calls>`
}

function renderToolArguments(rawArgumentsJson: string): string {
  let parsed: unknown
  let valueSources: Map<string, string> | undefined

  try {
    parsed = JSON.parse(rawArgumentsJson)
    valueSources = readTopLevelObjectValueSources(rawArgumentsJson)
  }
  catch {
    if (/\b(?:NaN|Infinity)\b/.test(rawArgumentsJson)) {
      throw new TypeError(
        'DeepSeek V4 non-finite JSON number is outside the verified subset',
      )
    }

    parsed = { arguments: rawArgumentsJson }
  }

  if (!isJsonObject(parsed))
    throw new TypeError('DeepSeek V4 tool arguments must encode a JSON object')

  assertVerifiedObjectKeys(parsed)

  return Object.entries(parsed).map(([key, value]) => {
    const string = typeof value === 'string'
    const renderedValue = string
      ? value
      : pythonJson(value, valueSources?.get(key))

    return `<${DSML_TOKEN}parameter name="${key}" string="${string}">${renderedValue}</${DSML_TOKEN}parameter>`
  }).join('\n')
}

/** Python json.dumps(..., ensure_ascii=False) 在本项目 JSON 子集上的等价输出。 */
function pythonJson(value: unknown, numberSource?: string): string {
  if (typeof value === 'string')
    return JSON.stringify(value)

  if (typeof value === 'boolean' || value === null)
    return String(value)

  if (typeof value === 'number') {
    if (numberSource)
      return pythonJsonNumber(numberSource)

    if (!Number.isSafeInteger(value)) {
      throw new TypeError('DeepSeek V4 JSON number is outside the verified integer subset')
    }

    return String(value)
  }

  if (Array.isArray(value))
    return `[${value.map(entry => pythonJson(entry)).join(', ')}]`

  if (isJsonObject(value)) {
    assertVerifiedObjectKeys(value)

    return `{${Object.entries(value).map(
      ([key, entry]) => `${JSON.stringify(key)}: ${pythonJson(entry)}`,
    ).join(', ')}}`
  }

  throw new TypeError('DeepSeek V4 JSON contains an unsupported value')
}

function pythonJsonNumber(source: string): string {
  if (/^-?(?:0|[1-9]\d*)$/.test(source))
    return source === '-0' ? '0' : source

  if (!/^-?(?:0|[1-9]\d*)\.\d+(?:e[+-]?\d+)?$/i.test(source)
    && !/^-?(?:0|[1-9]\d*)e[+-]?\d+$/i.test(source)) {
    throw new TypeError('DeepSeek V4 JSON number syntax is unsupported')
  }

  const value = Number(source)
  if (!Number.isFinite(value))
    throw new TypeError('DeepSeek V4 JSON number is not finite')
  if (value === 0)
    return source.startsWith('-') ? '-0.0' : '0.0'

  const absolute = Math.abs(value)
  if (absolute >= 1e16 || absolute < 1e-4) {
    return value.toExponential().replace(
      /e([+-])(\d)$/,
      'e$10$2',
    )
  }

  const decimal = String(value)
  return decimal.includes('.') ? decimal : `${decimal}.0`
}

function readTopLevelObjectValueSources(input: string): Map<string, string> {
  const sources = new Map<string, string>()
  let index = skipWhitespace(input, 0)

  if (input[index] !== '{')
    return sources

  index = skipWhitespace(input, index + 1)
  while (input[index] !== '}' && index < input.length) {
    const keyStart = index
    const keyEnd = findJsonStringEnd(input, keyStart)
    const key = JSON.parse(input.slice(keyStart, keyEnd)) as string

    index = skipWhitespace(input, keyEnd)
    if (input[index] !== ':')
      throw new SyntaxError('Invalid JSON object separator')

    const valueStart = skipWhitespace(input, index + 1)
    const valueEnd = findJsonValueEnd(input, valueStart)

    sources.set(key, input.slice(valueStart, valueEnd).trim())
    index = skipWhitespace(input, valueEnd)
    if (input[index] === ',')
      index = skipWhitespace(input, index + 1)
  }

  return sources
}

function findJsonStringEnd(input: string, start: number): number {
  if (input[start] !== '"')
    throw new SyntaxError('JSON object key must be a string')

  let escaped = false
  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index]
    if (escaped) {
      escaped = false
    }
    else if (character === '\\') {
      escaped = true
    }
    else if (character === '"') {
      return index + 1
    }
  }

  throw new SyntaxError('Unterminated JSON string')
}

function findJsonValueEnd(input: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < input.length; index += 1) {
    const character = input[index]!
    if (inString) {
      if (escaped)
        escaped = false
      else if (character === '\\')
        escaped = true
      else if (character === '"')
        inString = false
      continue
    }

    if (character === '"') {
      inString = true
    }
    else if (character === '{' || character === '[') {
      depth += 1
    }
    else if (character === '}' || character === ']') {
      if (depth === 0)
        return index
      depth -= 1
    }
    else if (character === ',' && depth === 0) {
      return index
    }
  }

  return input.length
}

function skipWhitespace(input: string, start: number): number {
  let index = start
  while (/\s/.test(input[index] ?? ''))
    index += 1

  return index
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function findLastUserIndex(messages: DeepSeekRenderMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user')
      return index
  }

  return -1
}

function assertVerifiedObjectKeys(value: Record<string, unknown>): void {
  if (Object.keys(value).some(isArrayIndexKey)) {
    throw new TypeError(
      'DeepSeek V4 JSON key order is outside the verified object-key subset',
    )
  }
}

function isArrayIndexKey(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(value))
    return false

  const number = Number(value)

  return number >= 0 && number < 4_294_967_295
}
