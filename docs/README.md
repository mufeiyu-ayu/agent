# AI SEO Agent Docs

这里是项目文档入口。项目已经完成 Session Chat、Streaming、Agent Runtime 与最小 Tool Calling baseline；下一条 Agent 主线已经确认为阶段 6 `Context Engineering 基础`。

## 当前状态

| 方向 | 状态 | 入口 |
| --- | --- | --- |
| 总路线 | 阶段 5 已完成；阶段 6 已规划为下一阶段，尚未进入实现 | [roadmap.md](./roadmap.md) |
| 当前任务 | 当前没有 Active 正式实现任务；阶段 6 Task 0 是下一项要创建 Issue 的任务 | [tasks/README.md](./tasks/README.md) |
| 阶段 6 任务 | Context 基线、history normalization、budget、Observation policy、Runtime 接入与回归收口 | [tasks/phase-06-context-engineering/README.md](./tasks/phase-06-context-engineering/README.md) |
| 阶段 5 归档 | Tool Calling 最终能力、验收和源码阅读顺序 | [tasks/completed/phase-05-tool-calling.md](./tasks/completed/phase-05-tool-calling.md) |
| 开发工作流 | GPT 规划、Issue 固化、Codex Clarification Gate、Draft PR、Review、验收和授权规范 | [development-workflow.md](./development-workflow.md) |
| Codex 研究入口 | 研究资料是架构依据，不直接代表任务状态 | [research/README.md](./research/README.md) |
| Context 研究 | model-visible history、UI transcript、Observation budget 与 compaction 边界 | [research/codex-reference/context-history.md](./research/codex-reference/context-history.md) |
| Admin Console | 后台产品支线 Task 0-1 Completed，Task 2-4 Planned | [tasks/admin-console.md](./tasks/admin-console.md) |
| 工作记录 | 记录真实阶段推进、验收、合并和已确认规划 | [work-log.md](./work-log.md) |

## 文档分层

| 路径 | 用途 |
| --- | --- |
| `roadmap.md` | 项目阶段顺序、当前判断和明确非目标 |
| `tasks/README.md` | 当前任务看板；Active / Next / Planned / Completed 以这里和对应 task docs 为准 |
| `tasks/phase-06-context-engineering/` | 下一阶段任务规划；Task 0 为 Next，Task 1-5 为 Planned |
| `tasks/completed/phase-05-tool-calling.md` | 阶段 5 最小 Tool Calling 的最终归档与源码复盘入口 |
| `tasks/completed/` | 已完成阶段的简洁归档 |
| `development-workflow.md` | 正式任务、Clarification Gate、PR、验收和授权边界 |
| `research/` | 深度研究、外部项目分析和历史学习路线，不作为正式状态事实 |
| `work-log.md` | 已真实发生的规划确认、实现、验收与合并记录 |

## 当前执行说明

- 阶段 6 已经确认方向并完成任务拆分，但没有创建 Issue、分支或 PR。
- `Task 0：Context 基线、契约与测试夹具` 是下一项正式任务；开始实现前必须创建一个独立 Issue。
- Task 1-5 不能因为 Task 0 被规划就自动启动，必须等待前置任务验收并逐个创建 Issue。
- 阶段 5 源码复盘仍可作为自由学习模式继续，不影响阶段 6 的正式状态。
- Admin Console 是可并行支线，不替代 Context 主线，也不提前标记阶段 9。

## 维护原则

- 当前可执行任务放在对应阶段目录，并在 `tasks/README.md` 标记 `Next / Active / Planned / Completed`。
- `Next` 表示下一项要创建 Issue 的任务，不等于已经开始实现。
- 研究资料放在 `research/`，只作为设计依据。
- 任务文档必须写清范围、非目标、Red / Green / Refactor、验证和验收标准。
- 已完成任务保留简洁归档，不继续占用当前任务入口。
- 正式任务状态、roadmap 阶段状态和 work-log 收口遵守 [development-workflow.md](./development-workflow.md)，不能把规划完成误写成实现完成。
