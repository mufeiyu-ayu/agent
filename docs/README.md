# AI SEO Agent Docs

这里是项目文档入口。项目已经完成 Session Chat、Streaming、Agent Runtime 与最小 Tool Calling；当前唯一确定的下一条 Agent 主线是阶段 6 `有界单 Agent Loop`。

## 当前状态

| 方向 | 状态 | 入口 |
| --- | --- | --- |
| 总路线 | 阶段 1-5 Completed；阶段 6 已规划，尚未进入实现 | [roadmap.md](./roadmap.md) |
| 当前任务 | 当前没有 Active 正式实现任务；阶段 6 Task 0 是下一项要创建 Issue 的任务 | [tasks/README.md](./tasks/README.md) |
| 阶段 6 | Agent Loop、执行状态、终止条件、错误语义和行为测试 | [tasks/phase-06-bounded-agent-loop/README.md](./tasks/phase-06-bounded-agent-loop/README.md) |
| 阶段 6 Task 0 | 新增 `get_article_detail` 只读工具，保持 Runtime 行为不变 | [tasks/phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md](./tasks/phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md) |
| 阶段 5 归档 | Tool Calling 最终能力、验收和源码阅读顺序 | [tasks/completed/phase-05-tool-calling.md](./tasks/completed/phase-05-tool-calling.md) |
| 开发工作流 | GPT 规划、Issue 固化、Codex Clarification Gate、Draft PR、Review、验收和授权规范 | [development-workflow.md](./development-workflow.md) |
| Agent 研究入口 | 架构资料和源码参考，不直接代表当前任务状态 | [research/README.md](./research/README.md) |
| Admin Console | 后台产品支线 Task 0-1 Completed，Task 2-4 Planned | [tasks/admin-console.md](./tasks/admin-console.md) |
| 工作记录 | 记录真实阶段推进、验收、合并和路线修正 | [work-log.md](./work-log.md) |

## 文档分层

| 路径 | 用途 |
| --- | --- |
| `roadmap.md` | 只维护已完成阶段、当前阶段和明确边界 |
| `tasks/README.md` | 正式任务看板；Active / Next / Planned / Completed 以这里和对应 Task 文档为准 |
| `tasks/phase-06-bounded-agent-loop/` | 当前阶段规划；Task 0 为 Next，Task 1-2 只保留阶段级边界 |
| `tasks/completed/` | 已完成阶段的简洁归档 |
| `development-workflow.md` | 正式任务、Clarification Gate、PR、验收和授权边界 |
| `research/` | 深度研究、外部项目分析和历史学习材料，不作为正式状态事实 |
| `work-log.md` | 已真实发生的规划确认、实现、验收、合并和修正记录 |

## 当前执行说明

- 阶段 6 方向已经确认为 `有界单 Agent Loop`，但尚未创建 Issue、实现分支或 PR。
- `Task 0：新增 get_article_detail 只读工具` 是下一项正式任务；开始实现前必须创建独立 Issue 并通过 Clarification Gate。
- Task 0 只新增第二个只读工具，不修改当前固定两轮 Runtime；Loop 升级留给 Task 1。
- Task 1、Task 2 必须等待前置任务验收后，再基于最新代码编写正式规格，不能因为阶段规划存在就自动启动。
- 阶段 6 完成前不提前编号或编写后续 Agent 阶段。
- 阶段 5 源码复盘仍可作为自由学习模式继续，不影响阶段 6 的正式状态。
- Admin Console 是可并行产品支线，不替代 Agent 主线。

## 维护原则

- 当前可执行任务放在对应阶段目录，并在 `tasks/README.md` 标记 `Next / Active / Planned / Completed`。
- `Next` 表示下一项要创建 Issue 的任务，不等于已经开始实现。
- 一个 Task 只解决一个明确学习和工程问题；不预先写死尚未获得代码证据的后续规格。
- 研究资料可以比当前阶段更远，但必须明确它不是执行承诺。
- 正式任务状态、roadmap 阶段状态和 work-log 收口遵守 [development-workflow.md](./development-workflow.md)，不能把规划完成误写成实现完成。
