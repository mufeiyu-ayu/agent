import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    // 共享包直接解析到源码，测试不依赖 dist。
    alias: {
      '@agent/contracts': fromRoot('./packages/contracts/src/index.ts'),
      '@agent/ai': fromRoot('./packages/ai/src/index.ts'),
    },
  },
  test: {
    projects: [
      {
        // swc 按被测文件就近读 tsconfig，api 的 emitDecoratorMetadata 生效：Nest 依赖注入与 ValidationPipe 直接跑源码。
        plugins: [swc.vite()],
        test: {
          name: 'api',
          include: ['apps/api/src/**/*.test.ts'],
          exclude: ['**/*.db.test.ts'],
        },
      },
      {
        plugins: [swc.vite()],
        test: {
          // 真实库测试只由 pnpm test:db 运行，文件之间串行。
          name: 'db',
          include: ['apps/api/src/**/*.db.test.ts'],
          fileParallelism: false,
        },
      },
      { test: { name: 'ai', include: ['packages/ai/src/**/*.test.ts'] } },
      {
        resolve: { alias: { '@': fromRoot('./apps/web/src') } },
        test: { name: 'web', include: ['apps/web/src/**/*.test.ts'] },
      },
      {
        resolve: { alias: { '@': fromRoot('./apps/admin/src') } },
        test: { name: 'admin', include: ['apps/admin/src/**/*.test.ts'] },
      },
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'] } },
    ],
  },
})
