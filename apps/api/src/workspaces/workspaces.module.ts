import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { WorkspacePreviewService } from './workspace-preview.service.js'
import { AdminWorkspacesController, WorkspaceController, WorkspacePreviewController } from './workspace.controller.js'
import { WorkspaceService } from './workspace.service.js'

@Module({ imports: [PrismaModule], controllers: [WorkspaceController, AdminWorkspacesController, WorkspacePreviewController], providers: [WorkspaceCloudService, WorkspaceMonitoringService, WorkspaceService, WorkspacePreviewService], exports: [WorkspaceService] })
export class WorkspacesModule {}
