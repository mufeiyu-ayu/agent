import type { AuthUser } from '@agent/contracts'
import type { User } from '../generated/prisma/client.js'
import type { AuthContext } from './auth.decorators.js'
import type { ChangePasswordDto, LoginDto } from './dto/auth.dto.js'
import { randomBytes } from 'node:crypto'
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'
import { hashPassword, verifyPassword } from './password.js'
import { createSessionToken, hashSessionToken, SESSION_TTL_MS } from './session-cookie.js'

/** 账号不存在、密码错误、已停用、已锁定一律同一个 401 文案，不暴露账号状态。 */
export const LOGIN_FAILED_MESSAGE = '邮箱或密码错误'

const ACCOUNT_FAILURE_LIMIT = 5
const ACCOUNT_LOCK_MS = 15 * 60 * 1000
// ponytail: 按 IP / 按 Session 的失败计数只在进程内，单实例有效、重启清零；多实例部署时换成库表或 Redis。
// IP 上限放宽到 50：运营可能共用一个出口 IP，太紧会让一人输错连累全办公室。
const IP_FAILURE_LIMIT = 50
// 改密码时原密码的失败按 Session 计：外人触发不了（不像账号锁那样知道邮箱就能锁），拿到 Session 也没法无限猜。
const SESSION_FAILURE_LIMIT = 5
const FAILURE_WINDOW_MS = 15 * 60 * 1000
const FAILURE_MAX_ENTRIES = 10_000
// scrypt 在 libuv 线程池（默认 4 个）里跑，每次约 128MB 内存。未登录就能调的 login 不设上限，
// 并发洪泛会占满线程池，连带 DNS 解析与 pg 建连卡住、聊天不可用。
// ponytail: 进程内并发上限，超出直接 429 不排队；按 IP 的洪泛限流放到部署 Issue 的反代层。
const LOGIN_CONCURRENCY_LIMIT = 2

// 账号不存在时也跑一次 scrypt，响应耗时不泄露邮箱是否存在。
let dummyPasswordHash: Promise<string> | undefined

@Injectable()
export class AuthService {
  private readonly failures = new Map<string, { count: number, resetAt: number }>()
  private loginsInFlight = 0

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async login(input: LoginDto, ip: string): Promise<{ user: AuthUser, token: string }> {
    if (this.isBlocked(`ip:${ip}`, IP_FAILURE_LIMIT))
      throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS)

    if (this.loginsInFlight >= LOGIN_CONCURRENCY_LIMIT)
      throw new HttpException('登录繁忙，请稍后再试', HttpStatus.TOO_MANY_REQUESTS)

    this.loginsInFlight += 1

    try {
      return await this.verifyAndCreateSession(input, ip)
    }
    finally {
      this.loginsInFlight -= 1
    }
  }

  private async verifyAndCreateSession(input: LoginDto, ip: string): Promise<{ user: AuthUser, token: string }> {
    const user = await this.prismaService.user.findUnique({ where: { email: input.email } })
    dummyPasswordHash ??= hashPassword(randomBytes(16).toString('hex')).catch((error: unknown) => {
      dummyPasswordHash = undefined
      throw error
    })
    const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? await dummyPasswordHash)
    const now = new Date()
    const locked = user?.lockedUntil != null && user.lockedUntil > now

    if (!user || user.disabled || locked || !passwordMatches) {
      this.recordFailure(`ip:${ip}`)

      if (user && !user.disabled && !locked)
        await this.recordAccountFailure(user.id)

      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE)
    }

    const token = createSessionToken()
    const updatedUser = await this.prismaService.$transaction(async (tx) => {
      // 带条件写：scrypt 期间并发的失败请求可能已把账号锁上或管理员已停用，此时不发 Session。
      const { count } = await tx.user.updateMany({
        where: { id: user.id, disabled: false, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      })

      if (count === 0)
        return null

      // 顺手清掉这个人已过期的 Session，表不会无限长。
      await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } })
      await tx.session.create({
        data: {
          tokenHash: hashSessionToken(token),
          userId: user.id,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      })

      return tx.user.findUniqueOrThrow({ where: { id: user.id } })
    })

    if (!updatedUser)
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE)

    return { user: toAuthUser(updatedUser), token }
  }

  /** Cookie token → 当前用户；Session 不存在、已过期或用户已停用都返回 null。 */
  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.prismaService.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    })

    if (!session || session.expiresAt <= new Date() || session.user.disabled)
      return null

    return { user: toAuthUser(session.user), sessionId: session.id }
  }

  async logout(sessionId: string): Promise<void> {
    await this.prismaService.session.deleteMany({ where: { id: sessionId } })
  }

  /** 改密码后其他设备全部下线，只保留当前这条 Session。 */
  async changePassword(auth: AuthContext, input: ChangePasswordDto): Promise<AuthUser> {
    const user = await this.prismaService.user.findUniqueOrThrow({ where: { id: auth.user.id } })

    const failureKey = `session:${auth.sessionId}`

    // 400 而不是 401 / 429：401 会让前端当成掉登录跳走。
    if (this.isBlocked(failureKey, SESSION_FAILURE_LIMIT))
      throw new BadRequestException('尝试次数过多，请 15 分钟后再试')

    if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
      this.recordFailure(failureKey)
      throw new BadRequestException('当前密码错误')
    }

    if (input.newPassword === input.currentPassword)
      throw new BadRequestException('新密码不能与当前密码相同')

    const passwordHash = await hashPassword(input.newPassword)
    const [updatedUser] = await this.prismaService.$transaction([
      this.prismaService.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prismaService.session.deleteMany({ where: { userId: user.id, id: { not: auth.sessionId } } }),
    ])

    return toAuthUser(updatedUser)
  }

  private async recordAccountFailure(userId: string): Promise<void> {
    const { failedLoginCount } = await this.prismaService.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    })

    if (failedLoginCount >= ACCOUNT_FAILURE_LIMIT) {
      await this.prismaService.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + ACCOUNT_LOCK_MS) },
      })
    }
  }

  private isBlocked(key: string, limit: number): boolean {
    const entry = this.failures.get(key)

    return entry !== undefined && entry.resetAt > Date.now() && entry.count >= limit
  }

  private recordFailure(key: string): void {
    const now = Date.now()
    const entry = this.failures.get(key)

    if (entry && entry.resetAt > now) {
      entry.count += 1
      return
    }

    if (this.failures.size >= FAILURE_MAX_ENTRIES) {
      for (const [staleKey, value] of this.failures) {
        if (value.resetAt <= now)
          this.failures.delete(staleKey)
      }

      // 清完仍满（大量来源同时在窗口内）时淘汰最早的一条，表的大小有硬上限。
      if (this.failures.size >= FAILURE_MAX_ENTRIES)
        this.failures.delete(this.failures.keys().next().value!)
    }

    this.failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS })
  }
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}
