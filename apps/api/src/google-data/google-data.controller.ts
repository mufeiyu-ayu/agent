import type { AuthContext } from '../auth/auth.decorators.js'
import { GOOGLE_DATA_SERVICES } from '@agent/contracts'
import { BadRequestException, Body, Controller, Get, Headers, Inject, Post, Query, Res } from '@nestjs/common'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { CurrentAuth } from '../auth/auth.decorators.js'
import { readAppOrigins } from '../auth/auth.guard.js'
import { GoogleDataService } from './google-data.service.js'

class ConnectDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique() @IsIn(GOOGLE_DATA_SERVICES, { each: true })
  services!: Array<'gsc' | 'ga4'>
}
class ResourceQuery {
  @IsIn(GOOGLE_DATA_SERVICES) service!: 'gsc' | 'ga4'
  @IsOptional() @IsString() @MaxLength(128) property?: string
}
class SelectDto {
  @IsIn(GOOGLE_DATA_SERVICES) service!: 'gsc' | 'ga4'
  @IsInt() @Min(0) revision!: number
  @IsString() @MaxLength(2048) resource!: string
  @IsOptional() @IsString() @MaxLength(128) stream?: string
}
class VerifyDto {
  @IsIn(GOOGLE_DATA_SERVICES) service!: 'gsc' | 'ga4'
  @IsInt() @Min(0) revision!: number
}

@Controller('google-data')
export class GoogleDataController {
  constructor(@Inject(GoogleDataService) private readonly google: GoogleDataService) {}

  @Get() detail(@CurrentAuth() auth: AuthContext) { return this.google.detail(auth.user.id) }
  @Post('connect') connect(@CurrentAuth() auth: AuthContext, @Body() body: ConnectDto, @Headers('origin') origin: string) {
    if (origin !== new URL(this.google.callbackUrl).origin)
      throw new BadRequestException('originRequired')
    return this.google.start(auth, body.services)
  }

  @Post('cancel') cancel(@CurrentAuth() auth: AuthContext) { return this.google.cancel(auth.user.id) }
  @Post('disconnect') disconnect(@CurrentAuth() auth: AuthContext) { return this.google.disconnect(auth.user.id) }
  @Get('resources') resources(@CurrentAuth() auth: AuthContext, @Query() query: ResourceQuery) { return this.google.resources(auth.user.id, query.service, query.property) }
  @Post('selection') select(@CurrentAuth() auth: AuthContext, @Body() body: SelectDto) { return this.google.select(auth.user.id, body.service, body.revision, body.resource, body.stream) }
  @Post('verify') verify(@CurrentAuth() auth: AuthContext, @Body() body: VerifyDto) { return this.google.verify(auth.user.id, body.service, body.revision) }

  @Get('oauth/callback')
  async callback(@CurrentAuth() auth: AuthContext, @Query() query: { code?: string, state?: string, error?: string }, @Res() response: { redirect: (status: number, url: string) => void }) {
    let result = 'connected'
    try {
      await this.google.callback(auth, query)
    }
    catch { result = 'failed' }
    response.redirect(303, `${readAppOrigins()[0]}/plugins?googleData=${result}`)
  }
}
