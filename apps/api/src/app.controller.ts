import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get('health')
  getHealth() {
    return {
      ok: true,
      service: 'api',
    }
  }

  @Get('api/demo')
  getDemo() {
    return {
      message: 'Hello from Nest API',
      timestamp: new Date().toISOString(),
    }
  }
}
