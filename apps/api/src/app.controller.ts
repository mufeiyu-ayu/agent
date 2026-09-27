import { Controller, Get } from '@nestjs/common'

import { Public } from './auth/auth.decorators.js'

@Controller()
export class AppController {
  @Public()
  @Get('health')
  getHealth() {
    return {
      ok: true,
      service: 'api',
    }
  }
}
