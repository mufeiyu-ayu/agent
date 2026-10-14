import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { GoogleDataClient } from './google-data-client.js'
import { GoogleDataController } from './google-data.controller.js'
import { GoogleDataService } from './google-data.service.js'
import { GoogleQueryService } from './google-query.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [GoogleDataController],
  providers: [GoogleDataClient, GoogleDataService, GoogleQueryService],
  exports: [GoogleQueryService],
})
export class GoogleDataModule {}
