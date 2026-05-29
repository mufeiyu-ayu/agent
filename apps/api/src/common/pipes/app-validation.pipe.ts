import type { ValidationError } from 'class-validator'
import { BadRequestException, ValidationPipe } from '@nestjs/common'

export function createAppValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    exceptionFactory: (errors) => {
      return new BadRequestException({
        statusCode: 400,
        message: '请求参数校验失败',
        error: 'Bad Request',
        details: flattenValidationErrors(errors),
      })
    },
  })
}

function flattenValidationErrors(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const propertyPath = parentPath ? `${parentPath}.${error.property}` : error.property
    const constraintMessages = Object.values(error.constraints ?? {}).map((message) => {
      return `${propertyPath}: ${message}`
    })
    const childrenMessages = flattenValidationErrors(error.children ?? [], propertyPath)

    return [...constraintMessages, ...childrenMessages]
  })
}
