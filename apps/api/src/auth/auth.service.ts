import type { AuthUser, UserStatus } from '@agent/contracts'
import type { Prisma, User } from '../generated/prisma/client.js'
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
    // Google 注册的账号没有密码，同样拿假哈希比对，结果必然失败。
    const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? await dummyPasswordHash)
    const now = new Date()
    const locked = user?.lockedUntil != null && user.lockedUntil > now
    const active = user !== null && userStatus(user) === 'ACTIVE'

    if (!user || !active || locked || !passwordMatches) {
      this.recordFailure(`ip:${ip}`)

      if (user && active && !locked)
        await this.recordAccountFailure(user.id)

      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE)
    }

    // 带条件写：scrypt 期间并发的失败请求可能已把账号锁上。
    const session = await this.createSession(user.id, {
      condition: { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      resetPasswordLock: true,
      now,
    })

    if (!session)
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE)

    return session
  }

  /**
   * 给启用中的账号发 Session，密码与 Google 登录共用。带条件写：校验期间管理员可能已停用该账号，
   * 此时返回 null、不发 Session。只有密码登录成功才清密码失败计数与锁定：Google 登录清掉它，
   * 正在爆破密码的人就又多了几次机会。
   */
  async createSession(
    userId: string,
    options: { condition?: Prisma.UserWhereInput, resetPasswordLock: boolean, now?: Date },
  ): Promise<{ user: AuthUser, token: string } | null> {
    const now = options.now ?? new Date()
    const token = createSessionToken()
    const user = await this.prismaService.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { ...options.condition, id: userId, disabled: false, pendingApproval: false },
        data: { lastLoginAt: now, ...(options.resetPasswordLock ? { failedLoginCount: 0, lockedUntil: null } : {}) },
      })

      if (count === 0)
        return null

      // 顺手清掉这个人已过期的 Session，表不会无限长。
      await tx.session.deleteMany({ where: { userId, expiresAt: { lte: now } } })
      await tx.session.create({
        data: {
          tokenHash: hashSessionToken(token),
          userId,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      })

      return tx.user.findUniqueOrThrow({ where: { id: userId } })
    })

    return user ? { user: toAuthUser(user), token } : null
  }

  /**
   * 未登录就能调的 Google 回调、One Tap 与 nonce 签发：按 key（含 IP）计每一次请求（不只是失败），15 分钟内超过上限直接 429。
   * 与密码登录的失败计数分开记，免得同一出口 IP 的同事正常 Google 登录挤占密码登录的额度。
   */
  throttleGoogleAttempt(key: string, limit = IP_FAILURE_LIMIT): void {
    if (this.isBlocked(key, limit))
      throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS)

    this.recordFailure(key)
  }

  /** Cookie token → 当前用户；Session 不存在、已过期或用户已停用都返回 null。 */
  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.prismaService.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    })

    if (!session || session.expiresAt <= new Date() || userStatus(session.user) !== 'ACTIVE')
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

    // 没有密码的 Google 账号不能自己设密码，要密码找管理员重置。
    if (!user.passwordHash || !await verifyPassword(input.currentPassword, user.passwordHash)) {
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

/** 库里的两个布尔 → 对外的三态；停用优先（旧版本停用了待审核账号时两者都为真）。 */
export function userStatus(user: Pick<User, 'disabled' | 'pendingApproval'>): UserStatus {
  return user.disabled ? 'DISABLED' : user.pendingApproval ? 'PENDING' : 'ACTIVE'
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}
