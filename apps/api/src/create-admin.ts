// 建管理员并把无主的存量会话归给他。重复执行不会重复建号，而是按这次的密码重置（用于恢复管理员）。
// 用法：ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm create-admin，或 pnpm create-admin --email ... --password ...
// 密码走环境变量更好：命令行参数会留在 shell 历史里。
/* eslint-disable perfectionist/sort-imports, antfu/no-top-level-await -- 一次性 CLI 入口，与 main.ts 同为 dist 下的可执行文件 */
import 'reflect-metadata'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { hashPassword } from './auth/password.js'
import { PrismaService } from './prisma/prisma.service.js'

// 与 @agent/contracts 的 PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH 一致；开发时 tsx 直接跑源码，不依赖 contracts 的 dist。
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
  },
})
const email = (values.email ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
const password = values.password ?? process.env.ADMIN_PASSWORD ?? ''

if (!/^[^\s@]+@[^\s@]+$/.test(email))
  throw new Error('请用 --email 或 ADMIN_EMAIL 提供管理员邮箱')

if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)
  throw new Error(`请用 --password 或 ADMIN_PASSWORD 提供 ${PASSWORD_MIN_LENGTH}～${PASSWORD_MAX_LENGTH} 位密码`)

const prisma = new PrismaService()

try {
  const existing = await prisma.user.findUnique({ where: { email } })
  // 管理员自己定的密码，不要求首次登录再改。邮箱已存在时按这次的密码重置、升为管理员并解锁、启用，
  // 同时让旧 Session 下线：唯一的管理员忘了密码或被锁时，靠它恢复。
  const data = {
    passwordHash: await hashPassword(password),
    role: 'ADMIN',
    disabled: false,
    pendingApproval: false,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
  } as const
  const admin = await prisma.user.upsert({ where: { email }, create: { email, ...data }, update: data })

  if (existing)
    await prisma.session.deleteMany({ where: { userId: admin.id } })

  const { count } = await prisma.conversation.updateMany({
    where: { userId: null },
    data: { userId: admin.id },
  })

  console.log(`${existing ? '账号已存在，已重置密码并设为启用中的管理员' : '已创建管理员'}：${email}；归入无主会话 ${count} 个`)
}
finally {
  await prisma.$disconnect()
}
