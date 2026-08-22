// 工作台内 reka-ui DropdownMenu 的共享样式：面板 chrome 与选中态选项，避免多处复制后各自漂移。

export const dropdownMenuPanelClass
  = 'z-50 rounded-2xl border border-agent-border-soft bg-agent-surface-raised p-1.5 text-agent-ink shadow-[0_14px_32px_rgb(61_49_36/12%)]'

export function dropdownMenuOptionClass(selected: boolean): string {
  return selected
    ? 'bg-agent-accent-soft text-agent-ink'
    : 'text-agent-ink-soft data-[highlighted]:bg-agent-surface-sunken/50 data-[highlighted]:text-agent-ink'
}
