import type { DeepSeekReasoningEffort, SeoChatRequest } from '@agent/contracts'
import {
  DEEPSEEK_REASONING_EFFORTS,
  SEO_CHAT_MESSAGE_MAX_CHARS,
} from '@agent/contracts'
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator'

import { SUPPORTED_DEEPSEEK_MODELS } from '../../llm/model-profiles.js'

export class SeoChatDto implements SeoChatRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversationId!: string

  @IsString()
  @IsNotEmpty()
  // 只校验「至少包含一个非空白字符」，不做 trim：
  // trim 与持久化规范化仍由 AgentRuntime 负责，MaxLength 也保持在 trim 前生效。
  @Matches(/\S/u, {
    message: 'message 不能只包含空白字符',
  })
  @MaxLength(SEO_CHAT_MESSAGE_MAX_CHARS)
  message!: string

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_DEEPSEEK_MODELS])
  model?: string

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn([...DEEPSEEK_REASONING_EFFORTS])
  reasoningEffort?: DeepSeekReasoningEffort
}
