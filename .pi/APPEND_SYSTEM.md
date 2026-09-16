# pi 工具适配层

本文件是 pi 在本仓库的工具适配层。基线、默认流程和硬约束在 `AGENTS.md`（pi 已自动加载），不在此重复；这里只给 `AGENTS.md` 中随工具变化的三个占位取值。pi 不解析 `AGENTS.md` 里的 `@docs/workflow.md` 导入，会话开始先读 `docs/workflow.md`，它是默认流程与硬约束的正文。

| 占位 | pi 取值 |
| --- | --- |
| `<review 命令>` | pi-subagents 的 `reviewer` 子代理：先 `git diff --cached > <临时目录>/staged.diff`，再 `subagent({ agent: "reviewer", task: "审 <该文件> 中的暂存区 diff，对照仓库源码给出 P0-P3 findings" })`；reviewer 没有 bash，只读文件，不给它开工具 |
| skill 路径 | `.claude/skills/github-issue-workflow`、`.claude/skills/github-pr-review-fix`（经 `.pi/settings.json` 的 `skills` 引入，以 `/skill:github-issue-workflow` 等命令加载） |
| `<分支前缀>` | `pi`，任务分支为 `pi/issue-N-<slug>` |
