import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import {
  defaultAdminPreferences,
  parseAdminPreferences,
  resolveActiveMenuPath,
  resolveRouteTabTitle,
  routeAfterTabClose,
} from './admin-state'

describe('admin-state', () => {
  it('偏好：坏 JSON 与非法值回落默认值', () => {
    assert.deepEqual(parseAdminPreferences('{bad json'), defaultAdminPreferences)
    assert.deepEqual(
      parseAdminPreferences('{"theme":"dark","sidebarCollapsed":true}'),
      { theme: 'dark', sidebarCollapsed: true },
    )
    assert.deepEqual(
      parseAdminPreferences('{"theme":"neon","sidebarCollapsed":"yes"}'),
      defaultAdminPreferences,
    )
  })

  it('关闭标签后回到固定标签', () => {
    const tabs = [
      { path: '/overview', title: 'Overview', fixed: true },
      { path: '/runs', title: 'Runs' },
    ]

    assert.equal(routeAfterTabClose(tabs, '/runs', '/runs'), '/overview')
    assert.equal(routeAfterTabClose(tabs, '/runs', '/overview'), '/overview')
  })

  it('详情标签标题带 id 尾部，菜单高亮取 activeMenu', () => {
    const firstRunRoute = {
      path: '/runs/demo_run_tool_20260719_01',
      name: 'run-detail',
      params: { runId: 'demo_run_tool_20260719_01' },
      meta: { title: 'Run Detail', activeMenu: '/runs' },
    }
    const secondRunRoute = {
      path: '/runs/demo_run_answer_20260719_02',
      name: 'run-detail',
      params: { runId: 'demo_run_answer_20260719_02' },
      meta: { title: 'Run Detail', activeMenu: '/runs' },
    }

    assert.equal(resolveRouteTabTitle(firstRunRoute), 'Run · …20260719_01')
    assert.equal(resolveRouteTabTitle(secondRunRoute), 'Run · …20260719_02')
    assert.notEqual(resolveRouteTabTitle(firstRunRoute), resolveRouteTabTitle(secondRunRoute))
    assert.equal(resolveRouteTabTitle({ path: '/runs', meta: { title: 'Runs' } }), 'Runs')
    assert.equal(
      resolveRouteTabTitle({
        path: '/conversations/demo_conversation_20260822',
        name: 'conversation-detail',
        params: { conversationId: 'demo_conversation_20260822' },
        meta: { title: 'Conversation Detail', activeMenu: '/conversations' },
      }),
      'Conversation · …on_20260822',
    )
    assert.equal(resolveActiveMenuPath(firstRunRoute), '/runs')
    assert.equal(resolveActiveMenuPath({ path: '/runs', meta: { title: 'Runs' } }), '/runs')
    assert.equal(resolveActiveMenuPath({ path: '/overview', meta: { title: 'Overview' } }), '/overview')
  })
})
