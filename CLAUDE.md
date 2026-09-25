# CLAUDE.md

@AGENTS.md

本文件是 Claude Code 的工具适配层。基线、默认流程和硬约束全部由上面的 `@AGENTS.md` 引入，不在此重复；这里只给 `AGENTS.md` 中随工具变化的三个占位取值。

| 占位 | Claude Code 取值 |
| --- | --- |
| `<review 命令>` | `/code-review <档位>`（暂存后、commit 前审暂存区 diff；档位按下表） |
| skill 路径 | `.claude/skills/github-issue-workflow`、`.claude/skills/github-pr-review-fix`（占位写法，pi 经 `.pi/settings.json` 复用同一份） |
| `<分支前缀>` | `claude`，任务分支为 `claude/issue-N-<slug>` |

`/code-review` 档位（档位越高覆盖越广，也越容易出过度 review 的 finding，处理见 `docs/workflow.md` 第 2 节）：

| 改动 | 档位 |
| --- | --- |
| 高风险（定义见 `docs/workflow.md` 第 1 节）或核心层（`apps/api/src/agent-runtime/`、`packages/ai`） | `xhigh` |
| 其余正式 Issue | `high` |
| 小改动例外（非高风险、单一关注点） | `medium` |
| docs-only | 跳过 |

`max` 不作默认，确有需要时在 Issue 里写明。Issue 验收标准里的 review 条目按此表写档位，如 `/code-review xhigh`。
