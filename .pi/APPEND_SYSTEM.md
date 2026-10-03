# pi 工具适配层

本文件是 pi 在本仓库的工具适配层。基线在 `AGENTS.md`（pi 已自动加载）；正式交付按需读取 `docs/workflow.md`，不在此重复；这里只给 `AGENTS.md` 中随工具变化的三个占位取值。源码阅读与局部修改无需例行加载交付流程。

| 占位 | pi 取值 |
| --- | --- |
| `<review 命令>` | pi-subagents 的只读 `reviewer`；按 `~/.pi/agent/skills/git-smart-commit/references/review-protocol.md` 准备本任务快照、diff 与必要完整文件，再直接调用；不把准备审查等同于授权提交，不给 reviewer 开写入或 shell 工具 |
| skill 路径 | `.agents/skills/github-issue-workflow`、`.agents/skills/github-pr-review-fix`（经 `.pi/settings.json` 的 `skills` 引入，以 `/skill:github-issue-workflow` 等命令加载） |
| `<分支前缀>` | `pi`，任务分支为 `pi/issue-N-<slug>` |

Review 档位：高风险或 Runtime / ai 核心层 `xhigh`，其余正式 Issue `high`，非高风险小改动 `medium`，docs-only 跳过；按当前 reviewer 支持的模型 / thinking 字段设置，不假设不同客户端命令通用。
