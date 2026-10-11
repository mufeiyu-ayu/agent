import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js'
import { ResponseTransformInterceptor } from '../interceptors/response-transform.interceptor.js'
import { createAppValidationPipe } from '../pipes/app-validation.pipe.js'

export function registerAppGlobals(app: INestApplication): void {
  // 2 MiB 技能包经过 JSON 转义最多约 12 MiB，业务层仍校验解码后的文件上限。
  ;(app as NestExpressApplication).useBodyParser('json', { limit: '16mb' })
  app.setGlobalPrefix('api')
  app.useGlobalPipes(createAppValidationPipe())
  app.useGlobalInterceptors(new ResponseTransformInterceptor())
  app.useGlobalFilters(new AllExceptionsFilter())
}
