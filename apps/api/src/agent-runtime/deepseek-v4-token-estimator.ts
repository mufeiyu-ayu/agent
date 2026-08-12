import type { ChatMessage } from '../llm/llm.types.js'
import type { ModelToolSpec } from '../llm/model-tool-spec.types.js'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { Tokenizer } from '@huggingface/tokenizers'
import { Injectable } from '@nestjs/common'

import { ContextTokenEstimationError } from './agent-runtime.errors.js'

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

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.`

export interface TokenEstimatorInput {
  messages: ChatMessage[]
  tools: ModelToolSpec[]
}

/** Context Selection 只依赖该边界，不依赖具体 tokenizer 包。 */
export abstract class TokenEstimator {
  abstract readonly strategyId: string
  abstract estimateInitialRequest(input: TokenEstimatorInput): number
}

@Injectable()
export class DeepSeekV4TokenEstimator extends TokenEstimator {
  readonly strategyId = 'deepseek-v4-official-b5968e9'
  private readonly tokenizer: Tokenizer

  constructor() {
    super()

    try {
      const tokenizer = JSON.parse(gunzipSync(readFileSync(
        new URL('../../tokenizers/deepseek-v4/tokenizer.json.gz', import.meta.url),
      )).toString('utf8')) as object
      const config = JSON.parse(readFileSync(
        new URL('../../tokenizers/deepseek-v4/tokenizer_config.json', import.meta.url),
        'utf8',
      )) as object

      this.tokenizer = new Tokenizer(tokenizer, config)
    }
    catch (cause) {
      throw new ContextTokenEstimationError(cause)
    }
  }

  estimateInitialRequest(input: TokenEstimatorInput): number {
    try {
      return this.encodeTokenIds(renderDeepSeekV4InitialPrompt(input)).length
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

/** DeepSeek V4 官方 encoding_dsv4.py 的 initial chat 子集。 */
export function renderDeepSeekV4InitialPrompt(
  input: TokenEstimatorInput,
): string {
  const lastUserIndex = input.messages
    .map(message => message.role)
    .lastIndexOf('user')
  const dropThinking = input.tools.length === 0
  let prompt = BOS_TOKEN

  for (const [index, message] of input.messages.entries()) {
    if (message.role === 'system') {
      prompt += message.content
      if (input.tools.length > 0) {
        prompt += `\n\n${renderTools(input.tools)}`
      }
    }
    else if (message.role === 'user') {
      prompt += `${USER_TOKEN}${message.content}`
    }
    else {
      if (!dropThinking || index > lastUserIndex)
        prompt += THINKING_END_TOKEN

      prompt += `${message.content}${EOS_TOKEN}`
    }

    const nextRole = input.messages[index + 1]?.role

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

function renderTools(tools: ModelToolSpec[]): string {
  const toolSchemas = tools.map(tool => pythonJson({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  })).join('\n')

  return TOOLS_TEMPLATE.replace('{tool_schemas}', toolSchemas)
}

function pythonJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(pythonJson).join(', ')}]`

  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(
      ([key, entry]) => `${JSON.stringify(key)}: ${pythonJson(entry)}`,
    ).join(', ')}}`
  }

  const serialized = JSON.stringify(value)

  if (serialized === undefined)
    throw new TypeError('DeepSeek V4 tool schema contains an unsupported value')

  return serialized
}
