import { Module } from '@nestjs/common'
import { AttachmentStorageService } from '../attachments/attachment-storage.service.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { SkillsController } from './skills.controller.js'
import { SkillsService } from './skills.service.js'

@Module({ imports: [PrismaModule], controllers: [SkillsController], providers: [SkillsService, AttachmentStorageService], exports: [SkillsService] })
export class SkillsModule {}
