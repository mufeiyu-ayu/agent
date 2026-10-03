import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { AdminWorkspacesController, WorkspaceController } from './workspace.controller.js'
import { WorkspaceService } from './workspace.service.js'

@Module({ imports: [PrismaModule], controllers: [WorkspaceController, AdminWorkspacesController], providers: [WorkspaceCloudService, WorkspaceMonitoringService, WorkspaceService], exports: [WorkspaceService] })
export class WorkspacesModule {}
