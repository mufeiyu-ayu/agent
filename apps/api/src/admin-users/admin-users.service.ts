import type { AdminUser } from '@agent/contracts'
import type { User } from '../generated/prisma/client.js'
import type { CreateAdminUserDto, UpdateAdminUserDto } from './dto/admin-users.dto.js'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { userStatus } from '../auth/auth.service.js'
import { hashPassword } from '../auth/password.js'
import { PrismaService } from '../prisma/prisma.service.js'

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async list(): Promise<AdminUser[]> {
    const users = await this.prismaService.user.findMany({ orderBy: { createdAt: 'asc' } })

    return users.map(toAdminUser)
  }

  /** 管理员建号：初始密码由管理员告知本人，首次登录必须改。 */
  async create(input: CreateAdminUserDto): Promise<AdminUser> {
    try {
      const user = await this.prismaService.user.create({
        data: {
          email: input.email,
          passwordHash: await hashPassword(input.password),
          role: input.role,
          mustChangePassword: true,
        },
      })

      return toAdminUser(user)
    }
    catch (error) {
      if ((error as { code?: unknown }).code === 'P2002')
        throw new ConflictException('该邮箱已存在')
      throw error
    }
  }

  /**
   * 启用 / 停用、改角色；待审核账号「通过」即启用、「拒绝」即停用（Google 再登录也是停用的统一失败，不会再建申请）。
   * 状态或角色变了，该用户全部 Session 立即失效。
   */
  async update(actorId: string, userId: string, input: UpdateAdminUserDto): Promise<AdminUser> {
    const target = await this.findOrThrow(userId)
    const current = userStatus(target)
    const status = input.status ?? current
    const role = input.role ?? target.role

    if (userId === actorId && status !== 'ACTIVE' && current === 'ACTIVE')
      throw new BadRequestException('不能停用自己')

    // ponytail: 两个管理员同时互相降级的竞态不处理，5～30 人规模碰不到；要防就改成 Serializable 事务。
    if (target.role === 'ADMIN' && current === 'ACTIVE' && (role !== 'ADMIN' || status !== 'ACTIVE')) {
      const otherActiveAdmins = await this.prismaService.user.count({
        where: { role: 'ADMIN', disabled: false, pendingApproval: false, id: { not: userId } },
      })

      if (otherActiveAdmins === 0)
        throw new BadRequestException('至少要保留一个启用中的管理员')
    }

    const [user] = await this.prismaService.$transaction([
      this.prismaService.user.update({ where: { id: userId }, data: { disabled: status === 'DISABLED', pendingApproval: status === 'PENDING', role } }),
      ...(status !== current || role !== target.role
        ? [this.prismaService.session.deleteMany({ where: { userId } })]
        : []),
    ])

    return toAdminUser(user)
  }

  /** 设新的临时密码：解除锁定、要求下次登录改密码，旧 Session 全部失效。没有密码的 Google 账号也用它拿到密码。 */
  async resetPassword(userId: string, password: string): Promise<AdminUser> {
    await this.findOrThrow(userId)

    const [user] = await this.prismaService.$transaction([
      this.prismaService.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prismaService.session.deleteMany({ where: { userId } }),
    ])

    return toAdminUser(user)
  }

  private async findOrThrow(userId: string): Promise<User> {
    const user = await this.prismaService.user.findUnique({ where: { id: userId } })

    if (!user)
      throw new NotFoundException('用户不存在')

    return user
  }
}

function toAdminUser(user: User): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: userStatus(user),
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}
