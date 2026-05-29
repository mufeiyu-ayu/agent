import type { INestApplication } from '@nestjs/common'

import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js'
import { ResponseTransformInterceptor } from '../interceptors/response-transform.interceptor.js'
import { createAppValidationPipe } from '../pipes/app-validation.pipe.js'

export function registerAppGlobals(app: INestApplication): void {
  app.useGlobalPipes(createAppValidationPipe())
  app.useGlobalInterceptors(new ResponseTransformInterceptor())
  app.useGlobalFilters(new AllExceptionsFilter())
}
