import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common'

import { AdminLlmService } from './admin-llm.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import {
  AdminLlmCredentialsDto,
  AdminLlmIdParamDto,
  CreateAdminLlmProviderDto,
  ImportAdminLlmModelsDto,
  ProbeAdminLlmModelsDto,
  TestAdminLlmModelsDto,
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

  /** 本机出站代理状态：只回 `协议://主机:端口`，代理地址里的凭据不回显。 */
  @Get('proxy')
  getProxyStatus() {
    return this.adminLlmService.getProxyStatus()
  }

  @Get('providers')
  listProviders() {
    return this.adminLlmService.listProviders()
  }

  @Post('providers')
  createProvider(@Body() body: CreateAdminLlmProviderDto) {
    return this.adminLlmService.createProvider(body)
  }

  /** 用表单里的地址与密钥（或 providerId 对应库里的密钥）拉一次模型清单，不落库。 */
  @Post('providers/fetch-models')
  fetchModels(@Body() body: AdminLlmCredentialsDto) {
    return this.adminLlmService.fetchModelNames(body)
  }

  /** 同上凭据，对勾选的模型各发一条最短对话，不落库。 */
  @Post('providers/test-models')
  testModels(@Body() body: TestAdminLlmModelsDto) {
    return this.adminLlmService.testModelNames(body)
  }

  @Patch('providers/:id')
  updateProvider(@Param() params: AdminLlmIdParamDto, @Body() body: UpdateAdminLlmProviderDto) {
    return this.adminLlmService.updateProvider(params.id, body)
  }

  @Delete('providers/:id')
  deleteProvider(@Param() params: AdminLlmIdParamDto) {
    return this.adminLlmService.deleteProvider(params.id)
  }

  @Post('providers/:id/import-models')
  importModels(@Param() params: AdminLlmIdParamDto, @Body() body: ImportAdminLlmModelsDto) {
    return this.adminLlmService.importModels(params.id, body.wireNames, body.testResults)
  }

  @Get('models')
  listAllModels() {
    return this.adminLlmService.listAllModels()
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
