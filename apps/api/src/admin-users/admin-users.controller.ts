import type { AuthContext } from '../auth/auth.decorators.js'
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common'

import { CurrentAuth } from '../auth/auth.decorators.js'
import { AdminUsersService } from './admin-users.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { AdminUserIdParamDto, CreateAdminUserDto, ResetAdminUserPasswordDto, UpdateAdminUserDto } from './dto/admin-users.dto.js'

@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService)
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get()
  list() {
    return this.adminUsersService.list()
  }

  @Post()
  create(@Body() body: CreateAdminUserDto) {
    return this.adminUsersService.create(body)
  }

  @Patch(':userId')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() params: AdminUserIdParamDto,
    @Body() body: UpdateAdminUserDto,
  ) {
    return this.adminUsersService.update(auth.user.id, params.userId, body)
  }

  @Post(':userId/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param() params: AdminUserIdParamDto,
    @Body() body: ResetAdminUserPasswordDto,
  ) {
    return this.adminUsersService.resetPassword(params.userId, body.password)
  }
}
