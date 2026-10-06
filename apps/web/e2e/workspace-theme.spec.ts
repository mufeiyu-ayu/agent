import type { Page } from '@playwright/test'
import assert from 'node:assert/strict'
import { test } from '@playwright/test'
import { installApiRoutes, installBrowserStubs } from './fixtures'

async function assertUnscaledWorkspace(page: Page) {
  const state = await page.evaluate(() => {
    const main = document.querySelector('main[data-agent-workspace-theme]')!
    return [document.documentElement, main].map((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return { transform: style.transform, opacity: style.opacity, filter: style.filter, shadow: style.boxShadow, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  })
  const viewport = page.viewportSize()!
  for (const element of state) {
    assert.equal(element.transform, 'none', '组件交互样式不能缩放页面根节点')
    assert.equal(element.opacity, '1')
    assert.equal(element.filter, 'none')
    assert.equal(element.shadow, 'none')
    assert.equal(element.x, 0)
    assert.equal(element.y, 0)
    assert.equal(element.width, viewport.width)
    assert.equal(element.height, viewport.height)
  }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`Kuro 深浅主题切换不污染根布局，设置关闭后无缩小或遮罩残留（${viewport.width}px）`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    await installApiRoutes(page, () => [])
    await page.addInitScript(() => localStorage.setItem('agent:workspace-theme', 'warm-ledger'))
    await page.goto('/workspace')
    await page.getByRole('textbox').first().waitFor()
    await assertUnscaledWorkspace(page)

    for (const [label, theme] of [['余烬', 'olive-ember'], ['浅色', 'warm-ledger']]) {
      if (viewport.width < 960)
        await page.getByRole('button', { name: '打开导航', exact: true }).click()
      await page.getByRole('button', { name: '用户设置', exact: true }).click()
      await page.getByRole('menuitem', { name: '设置', exact: true }).click()
      await page.getByRole('radio', { name: label, exact: true }).click()
      await page.waitForFunction(expected => document.documentElement.dataset.agentWorkspaceTheme === expected, theme)
      await assertUnscaledWorkspace(page)
      const panelColors = await page.locator('.settings-panel').evaluate((panel, dark) => {
        const style = getComputedStyle(panel)
        const probe = document.createElement('span')
        probe.style.backgroundColor = dark ? 'color-mix(in oklch, var(--agent-surface-sunken), white 4%)' : 'var(--agent-surface-raised)'
        panel.appendChild(probe)
        const expected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return { actual: style.backgroundColor, expected }
      }, theme === 'olive-ember')
      assert.equal(panelColors.actual, panelColors.expected, '设置面板仍应用自己的主题背景')
      await page.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.locator('.settings-panel').waitFor({ state: 'detached' })
      await page.locator('.settings-overlay').waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.body.style.overflow !== 'hidden')
      await assertUnscaledWorkspace(page)
    }
  })
}
