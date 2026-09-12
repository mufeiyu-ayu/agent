# CLAUDE.md

@AGENTS.md

本文件是 Claude Code 的工具适配层。基线、默认流程和硬约束全部由上面的 `@AGENTS.md` 引入，不在此重复；这里只给 `AGENTS.md` 中随工具变化的三个占位取值。

| 占位 | Claude Code 取值 |
| --- | --- |
| `<review 命令>` | `/code-review`（暂存后、commit 前审暂存区 diff） |
| skill 路径 | `.claude/skills/github-issue-workflow`、`.claude/skills/github-pr-review-fix`（占位写法，pi 经 `.pi/settings.json` 复用同一份） |
| `<分支前缀>` | `claude`，任务分支为 `claude/issue-N-<slug>` |
