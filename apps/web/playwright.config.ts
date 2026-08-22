import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Issue #60 专属的最小浏览器验收配置。
 *
 * 所有用例通过 `page.route()` 提供确定性 API fixture，不启动 API 进程、不连数据库、
 * 不调用模型 Provider，因此结果可重复复现，而不是依赖某次真实模型输出。
 */
// 端口可用 E2E_PORT 覆盖：本机 5174 常被 apps/admin dev server 占用，
// reuseExistingServer 会误连到错误应用导致全量失败。
// 空串 / 非数字回落到默认端口，避免 --port 0 或 NaN 让健康检查空等。
const PORT = Number(process.env.E2E_PORT) || 5174
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // 显式绑定 127.0.0.1：vite 默认的 `localhost` 在本机会优先解析到 ::1，
    // Playwright 的健康检查会连不上。
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
