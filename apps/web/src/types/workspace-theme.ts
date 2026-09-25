export type WorkspaceThemeId = 'warm-ledger' | 'olive-ember'

export type InkLevel = 'soft' | 'standard' | 'bright'

export interface WorkspaceThemeOption {
  value: WorkspaceThemeId
  shortLabelKey: string
  icon: string
}
