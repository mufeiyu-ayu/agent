# CLAUDE.md

@AGENTS.md

本文件是 Claude Code 的工具适配层。基线由上面的 `@AGENTS.md` 引入；正式交付按需读取 `docs/workflow.md`，不在此重复；这里只给 `AGENTS.md` 中随工具变化的三个占位取值。

| 占位 | Claude Code 取值 |
| --- | --- |
| `<review 命令>` | `/code-review <档位> <仓库绝对路径> <本次需求背景>`（验证后、commit 前；以本任务暂存 diff 为核对范围，工具可能覆盖更广，档位按下表） |
| skill 路径 | `.claude/skills/github-issue-workflow`、`.claude/skills/github-pr-review-fix`（同名软链接到 `.agents/skills`，原调用方式保留） |
| `<分支前缀>` | `claude`，任务分支为 `claude/issue-N-<slug>` |

`/code-review` 档位（档位越高覆盖越广，也越容易出过度 review 的 finding，处理见 `docs/workflow.md` 第 2 节）：

| 改动 | 档位 |
| --- | --- |
| 高风险（定义见 `docs/workflow.md` 第 2 节）或核心层（`apps/api/src/agent-runtime/`、`packages/agent`、`packages/ai`） | `xhigh` |
| 其余正式 Issue | `high` |
| 小改动例外（非高风险、单一关注点） | `medium` |
| docs-only | 跳过 |

`max` 不作默认，确有需要时在 Issue 里写明。Issue 验收标准的 Review 条目注明本表档位、本仓库目标与本次需求范围；实际调用显式给绝对路径和背景，不能只传档位。
