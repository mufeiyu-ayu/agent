import { formatDuration } from '../runs/run.utils'

export function formatWorkspaceDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined)
    return '—'
  if (ms === 0)
    return '0s'
  if (ms < 60_000)
    return formatDuration(ms)
  const minutes = Math.floor(ms / 60_000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m ${Math.floor(ms / 1000) % 60}s`
}

export function formatWorkspaceBytes(bytes: number | null | undefined, locale = 'zh-CN'): string {
  if (bytes === null || bytes === undefined)
    return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0
  return `${(bytes / 1024 ** index).toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[index]}`
}

export function workspaceStateColor(state: string) {
  if (['cleanup_pending', 'creation_unknown', 'not_listed', 'error'].includes(state))
    return 'orange'
  return ['idle', 'released', 'create_failed'].includes(state) ? undefined : 'blue'
}
