import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../generated/prisma/client.js'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim()

    if (!connectionString) {
      throw new Error('请在项目根目录 .env 中设置 DATABASE_URL')
    }

    const adapter = new PrismaPg({ connectionString })

    super({ adapter })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
