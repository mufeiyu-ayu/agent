# AI SEO Agent Docs

这里是项目文档入口。项目已经完成 Session Chat、Streaming、Agent Runtime、最小 Tool Calling、阶段 6 Task 0 的第二个只读 Article Tool，以及横向运行参数治理；当前 Agent 主线是阶段 6 `有界单 Agent Loop` 的 Task 1。

## 当前状态

| 方向 | 状态 | 入口 |
| --- | --- | --- |
| 总路线 | 阶段 1-5 Completed；阶段 6 Active，Task 0 Completed、横向前置 Completed、Task 1 Next | [roadmap.md](./roadmap.md) |
| 当前任务 | 当前没有 Active 正式实现任务；Phase 6 Task 1 是下一项要编写规格并创建 Issue 的任务 | [tasks/README.md](./tasks/README.md) |
| 运行参数治理 | Issue #27 / PR #28 已验收并合并 | [tasks/runtime-configuration-governance.md](./tasks/runtime-configuration-governance.md) |
| 阶段 6 | Agent Loop、执行状态、终止条件、错误语义和行为测试 | [tasks/phase-06-bounded-agent-loop/README.md](./tasks/phase-06-bounded-agent-loop/README.md) |
| 阶段 6 Task 0 | `get_article_detail` 与 Tool 目录重构已验收并通过 PR #26 合并 | [tasks/phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md](./tasks/phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md) |
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
| `tasks/runtime-configuration-governance.md` | 已完成的横向前置任务；运行参数、Model Profile 与 Tool Observation 预算治理 |
| `tasks/phase-06-bounded-agent-loop/` | 当前阶段规划；Task 0 Completed，Task 1 Next，Task 2 Planned |
| `tasks/completed/` | 已完成阶段的简洁归档 |
| `development-workflow.md` | 正式任务、Clarification Gate、PR、验收和授权边界 |
| `research/` | 深度研究、外部项目分析和历史学习材料，不作为正式状态事实 |
| `work-log.md` | 已真实发生的规划确认、实现、验收、合并和修正记录 |

## 当前执行说明

- 阶段 6 方向仍是 `有界单 Agent Loop`，当前处于 Active。
- `Task 0：新增 get_article_detail 只读工具` 已通过 Issue #25 / PR #26 完成实现、Review、GPT 验收、用户确认与合并。
- 横向工程 Issue #27 已通过 PR #28 完成 64K 输入、40 条 Completed 历史、Model Profile、应用输出策略、三类请求超时和分级 Tool Observation 预算治理。
- 当前 Runtime 仍保持固定两轮特例，只向模型暴露并允许执行 `search_articles`；`get_article_detail` 已注册但尚未开放给模型。
- `Task 1：有界顺序 Agent Loop` 是下一项正式任务；开始实现前必须基于最新 `master` 编写规格、创建独立 Issue 并通过 Clarification Gate。
- Task 1 需要处理多次顺序 Sampling / Tool Call、服务端执行上限、超限终态，以及 DeepSeek `reasoning_content` continuation。
- Task 2 必须等待 Task 1 验收后，再基于真实失败路径编写正式规格。
- 阶段 6 完成前不提前编号或编写后续 Agent 阶段。
- 阶段 5、Task 0 与配置治理源码复盘仍可作为自由学习模式继续，不影响正式任务状态。
- Admin Console 是可并行产品支线，不替代 Agent 主线。

## 维护原则

- 当前可执行任务放在对应任务文档，并在 `tasks/README.md` 标记 `Next / Active / Planned / Completed`。
- `Next` 表示下一项正式任务，不等于已经开始实现。
- 一个 Task 只解决一个明确学习和工程问题；不预先写死尚未获得代码证据的后续规格。
- 研究资料可以比当前阶段更远，但必须明确它不是执行承诺。
- 正式任务状态、roadmap 阶段状态和 work-log 收口遵守 [development-workflow.md](./development-workflow.md)，不能把规划完成误写成实现完成。