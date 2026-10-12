import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js'
import { ResponseTransformInterceptor } from '../interceptors/response-transform.interceptor.js'
import { createAppValidationPipe } from '../pipes/app-validation.pipe.js'

export function registerAppGlobals(app: INestApplication): void {
  // 解析仍先于 AuthGuard；只为技能包写入口放宽，其他 JSON 保留 100 KiB。
  const expressApp = app as NestExpressApplication
  expressApp.useBodyParser('json', {
    limit: '16mb',
    type: request => /^application\/json(?:;|$)/iu.test(request.headers['content-type'] ?? '')
      && ((request.method === 'POST' && /^\/api\/skills\/?$/u.test(request.url ?? ''))
        || (request.method === 'PUT' && /^\/api\/skills\/[^/?]+\/draft\/?(?:\?.*)?$/u.test(request.url ?? ''))),
  })
  expressApp.useBodyParser('json', { limit: '100kb' })
  app.setGlobalPrefix('api')
  app.useGlobalPipes(createAppValidationPipe())
  app.useGlobalInterceptors(new ResponseTransformInterceptor())
  app.useGlobalFilters(new AllExceptionsFilter())
}
