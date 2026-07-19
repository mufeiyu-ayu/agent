import assert from 'node:assert/strict'

import {
  defaultAdminPreferences,
  parseAdminPreferences,
  routeAfterTabClose,
} from './admin-state'

assert.deepEqual(parseAdminPreferences('{bad json'), defaultAdminPreferences)
assert.deepEqual(
  parseAdminPreferences('{"theme":"dark","sidebarCollapsed":true}'),
  { theme: 'dark', sidebarCollapsed: true },
)
assert.deepEqual(
  parseAdminPreferences('{"theme":"neon","sidebarCollapsed":"yes"}'),
  defaultAdminPreferences,
)

const tabs = [
  { path: '/overview', title: 'Overview', fixed: true },
  { path: '/runs', title: 'Runs' },
]

assert.equal(routeAfterTabClose(tabs, '/runs', '/runs'), '/overview')
assert.equal(routeAfterTabClose(tabs, '/runs', '/overview'), '/overview')

console.log('admin state checks passed')
