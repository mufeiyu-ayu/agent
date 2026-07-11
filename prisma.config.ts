import process from 'node:process'
import { defineConfig } from 'prisma/config'
import 'dotenv/config'

const databaseUrl = process.env.DATABASE_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'pnpm --filter @agent/api exec tsx scripts/seed.ts',
  },
  datasource: databaseUrl ? { url: databaseUrl } : {},
})
