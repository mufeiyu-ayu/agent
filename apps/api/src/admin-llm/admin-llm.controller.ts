import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common'

import { AdminLlmService } from './admin-llm.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import {
  AdminLlmIdParamDto,
  CreateAdminLlmProviderDto,
  ImportAdminLlmModelsDto,
  PreviewAdminLlmModelsDto,
  ProbeAdminLlmModelsDto,
  ProviderBaseUrlOverrideDto,
  TestAdminLlmModelsDto,
  TestProviderModelsDto,
  UpdateAdminLlmModelDto,
  UpdateAdminLlmProviderDto,
} from './dto/admin-llm.dto.js'

/** Admin 的第一个写入口；鉴权按 2026-09-20 决定推迟，局域网内单人使用。 */
@Controller('admin/llm')
export class AdminLlmController {
  constructor(
    @Inject(AdminLlmService)
    private readonly adminLlmService: AdminLlmService,
  ) {}

  @Get('providers')
  listProviders() {
    return this.adminLlmService.listProviders()
  }

  @Post('providers')
  createProvider(@Body() body: CreateAdminLlmProviderDto) {
    return this.adminLlmService.createProvider(body)
  }

  /** 存库前验证：用表单里的地址与密钥拉一次模型清单。 */
  @Post('providers/preview-models')
  previewModels(@Body() body: PreviewAdminLlmModelsDto) {
    return this.adminLlmService.previewModelNames(body)
  }

  /** 存库前验证：对勾选的模型各发一条最短对话。 */
  @Post('providers/test-models')
  testModels(@Body() body: TestAdminLlmModelsDto) {
    return this.adminLlmService.testModelNames(body)
  }

  @Post('providers/:id/test-models')
  testProviderModels(@Param() params: AdminLlmIdParamDto, @Body() body: TestProviderModelsDto) {
    return this.adminLlmService.testProviderModelNames(params.id, body.wireNames, body.baseUrl)
  }

  @Patch('providers/:id')
  updateProvider(@Param() params: AdminLlmIdParamDto, @Body() body: UpdateAdminLlmProviderDto) {
    return this.adminLlmService.updateProvider(params.id, body)
  }

  @Delete('providers/:id')
  deleteProvider(@Param() params: AdminLlmIdParamDto) {
    return this.adminLlmService.deleteProvider(params.id)
  }

  @Post('providers/:id/fetch-models')
  fetchModels(@Param() params: AdminLlmIdParamDto, @Body() body: ProviderBaseUrlOverrideDto) {
    return this.adminLlmService.fetchModelNames(params.id, body.baseUrl)
  }

  @Post('providers/:id/import-models')
  importModels(@Param() params: AdminLlmIdParamDto, @Body() body: ImportAdminLlmModelsDto) {
    return this.adminLlmService.importModels(params.id, body.wireNames, body.testResults)
  }

  @Get('models')
  listAllModels() {
    return this.adminLlmService.listAllModels()
  }

  @Get('providers/:id/models')
  listModels(@Param() params: AdminLlmIdParamDto) {
    return this.adminLlmService.listModels(params.id)
  }

  /** 重测已入库的模型，结果写回行。 */
  @Post('models/probe')
  probeModels(@Body() body: ProbeAdminLlmModelsDto) {
    return this.adminLlmService.probeModels(body)
  }

  @Patch('models/:id')
  updateModel(@Param() params: AdminLlmIdParamDto, @Body() body: UpdateAdminLlmModelDto) {
    return this.adminLlmService.updateModel(params.id, body)
  }

  @Delete('models/:id')
  deleteModel(@Param() params: AdminLlmIdParamDto) {
    return this.adminLlmService.deleteModel(params.id)
  }
}
