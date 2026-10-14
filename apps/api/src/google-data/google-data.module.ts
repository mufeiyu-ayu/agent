import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { GoogleDataClient } from './google-data-client.js'
import { GoogleDataController } from './google-data.controller.js'
import { GoogleDataService } from './google-data.service.js'
import { GoogleQueryService } from './google-query.service.js'
import { GscInspectionService } from './gsc-inspection.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [GoogleDataController],
  providers: [GoogleDataClient, GoogleDataService, GoogleQueryService, GscInspectionService],
  exports: [GoogleQueryService, GscInspectionService],
})
export class GoogleDataModule {}
