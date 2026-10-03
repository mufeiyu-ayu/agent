# Codex 工具适配

仓库基线在根 `AGENTS.md`；正式交付读 `docs/workflow.md`。本文件只维护工具差异，不导入其他客户端的命令。

| 占位 | Codex 取值 |
| --- | --- |
| `<review 命令>` | 原生只读 `codex review`；目标、范围与档位见下文 |
| skill 路径 | `.agents/skills/github-issue-workflow`、`.agents/skills/github-pr-review-fix`，由 Codex 自动发现 |
| `<分支前缀>` | `codex`，正式任务为 `codex/issue-N-<slug>` |

- 确认所有未提交改动均属本任务时，先按下文选 `review_effort`（`medium` / `high` / `xhigh`），在同一 shell 运行 `codex -s read-only review --uncommitted -c model_reasoning_effort="$review_effort"`；它包含 staged、unstaged 与 untracked，不是 staged-only。
- 存在其他任务改动时按 `~/.codex/skills/git-smart-commit/references/review-protocol.md` 为明确文件建立独立审查快照，原生 Review 不包装额外子 Agent。该协议只用于准备与审查，不由此授权 commit；命令中的默认 `high` 按本仓库选定档位替换，不因采用快照而降低档位。
- 高风险（定义见 workflow）或 Runtime / ai 核心层用 `xhigh`；其余正式 Issue 用 `high`；非高风险小改动用 `medium`；docs-only 不启动独立代码 Review。已有明确档位优先，`max` 不作默认。
- 本机 `codex review` 的自定义 prompt 与 `--uncommitted` / `--base` / `--commit` 互斥；需要给需求背景时按快照协议使用 stdin prompt，不混用参数。
- 使用前完成定向验证，调用前按全局规则设置联网代理。Review 失败或不完整不能算通过，修复与最终验收仍由当前会话负责。
