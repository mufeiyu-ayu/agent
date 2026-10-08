import type { ChatRequest, ReasoningEffort } from '@agent/contracts'
import {
  ATTACHMENT_MAX_COUNT,
  CHAT_MESSAGE_MAX_CHARS,
  REASONING_EFFORTS,
} from '@agent/contracts'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
  // 只校验「至少包含一个非空白字符」，不做 trim：
  // trim 与持久化规范化仍由 AgentRuntime 负责，MaxLength 也保持在 trim 前生效。
  // 带了附件时文字可以为空：只发图片或文件也是一条消息。
  @ValidateIf((object: ChatDto) => !Array.isArray(object.attachmentIds) || object.attachmentIds.length === 0 || typeof object.message !== 'string' || object.message.length > 0)
  @IsNotEmpty()
  @Matches(/\S/u, {
    message: 'message 不能只包含空白字符',
  })
  @MaxLength(CHAT_MESSAGE_MAX_CHARS)
  message!: string

  /** 已上传的附件 id；归属与是否已发出过在绑定到消息时校验。 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTACHMENT_MAX_COUNT)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(128, { each: true })
  attachmentIds?: string[]

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
