import type { ChatRequest, ReasoningEffort } from '@agent/contracts'
import {
  CHAT_MESSAGE_MAX_CHARS,
  REASONING_EFFORTS,
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

export class ChatDto implements ChatRequest {
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
  @MaxLength(CHAT_MESSAGE_MAX_CHARS)
  message!: string

  /** Admin 配置的模型行 id；是否存在 / 可见由 ChatService 解析时判定。 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  model?: string

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn([...REASONING_EFFORTS])
  reasoningEffort?: ReasoningEffort
}
