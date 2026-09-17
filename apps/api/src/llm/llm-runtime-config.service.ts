import process from 'node:process'
import { resolveLLMRuntimeConfig } from '@agent/ai'
import { Injectable } from '@nestjs/common'

@Injectable()
export class LLMRuntimeConfigService {
  readonly value = resolveLLMRuntimeConfig(process.env)
}
