# Tasks

本目录只放当前可执行任务、当前阶段规划和已完成阶段归档。研究资料不放在这里。

## 当前看板

阶段 5 最小 Tool Calling 已完成并归档。阶段 6 `有界单 Agent Loop` 已完成 Task 0，并进入 Task 1 的正式规划准备。

当前没有 `Active` 正式实现任务。阶段 6 Task 0 已通过 GPT 技术验收和用户确认，并通过 PR #26 合并到 `master`；Task 1 已成为下一项 `Next` 任务，但尚未创建正式规格、Issue、实现分支或 PR。

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| 阶段 6 Task 0：新增 `get_article_detail` 只读工具 | **Completed** | [phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md](./phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md) | Issue #25 / PR #26；已验收并合并，merge commit `d3609d3f` |
| 阶段 6 Task 1：有界顺序 Agent Loop | **Next** | [phase-06-bounded-agent-loop/README.md](./phase-06-bounded-agent-loop/README.md) | 下一项正式主线；待基于最新 `master` 编写规格并创建独立 Issue |
| 阶段 6 Task 2：可靠性、回归与学习验收 | Planned | [phase-06-bounded-agent-loop/README.md](./phase-06-bounded-agent-loop/README.md) | 等 Task 1 验收后再展开 |
| Admin Console Task 1 | Completed | [admin-console.md](./admin-console.md) | Issue #21 / PR #22；静态 Run List / Run Detail UI 已实现并通过验收 |
| Admin Console Task 0 | Completed | [admin-console.md](./admin-console.md) | Issue #19 / PR #20；`apps/admin` 基础壳已实现并通过验收 |
| Admin Console Task 2-4 | Planned | [admin-console.md](./admin-console.md) | 可并行产品支线；开始时分别创建独立 Issue |
| 阶段 5 最小 Tool Calling | Completed | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | Task 0-5 与收口 Issue 已完成并通过验收 |
| 阶段 4 Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档为可观测 Agent Run 的基础阶段 |
| 阶段 3 Streaming 收口 | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已收口 `done / error / aborted` 最终态一致性 |
| 阶段 2 Session Chat | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 多会话和消息持久化已完成 |

## 阶段 6 任务顺序

```text
Task 0：新增 get_article_detail 只读工具（Completed）
  -> Task 1：有界顺序 Agent Loop（Next）
  -> Task 2：可靠性、回归与学习验收（Planned）
```

执行规则：

- Task 0 已完成实现、Codex Review、GPT 技术验收、用户确认和 PR #26 合并。
- 一个 Issue 只对应一个 Task，不把 Task 0-2 合并成一个大 Issue。
- Task 0 只建立第二个只读工具；当前 Runtime 仍只向模型暴露并允许执行 `search_articles`。
- Task 1 是下一项正式任务，但只有完成正式规格、创建独立 Issue 并通过 Clarification Gate 后才能进入 `Active`。
- Task 2 必须等待 Task 1 验收后再展开正式文档和 Issue。
- 阶段 6 完成前不提前编号、编写或启动后续 Agent 阶段。

## 阶段 6 学习边界

本阶段学习：

- Tool Calling 与 Agent Loop 的区别；
- 多次顺序 Sampling 与 Tool Execution；
- 模型决策与 Runtime 控制权边界；
- 最大 Sampling / Tool Call 次数；
- Timeout、Abort、超限与终态；
- Tool Call / Tool Result 配对和顺序；
- Run / Step Trace；
- Agent 行为测试；
- 仅为 Loop 服务的最小 Context 正确性。

本阶段不做：

- 完整 Context Engineering、Token Budget、自动截断和 Compaction；
- RAG、Embedding、Memory；
- 写工具、Permission、Approval、HITL；
- Durable Recovery、跨进程 Resume；
- 并行 Tool Call、Planner、Workflow Engine；
- MCP、Plugin、Skill、Multi-agent。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Next | 已确认是下一项要创建 Issue 的任务；尚未实现，不等于 Active |
| Active | 已创建正式 Issue，Clarification Gate 为 READY，正在实现或待验收 |
| Planned | 方向已记录但前置条件未满足，不能开始实现 |
| Completed | 实施状态已实现、验收状态已通过，并已由用户确认收口 |

## 任务写法

新任务统一使用 TDD 风格模板：[_template.tdd.md](./_template.tdd.md)。

每个正式 Task 必须写清：

- 目标；
- 背景与当前代码事实；
- 学习重点；
- 范围与明确非目标；
- Red / Green / Refactor；
- 验证命令；
- 可观察验收标准；
- 风险点；
- GitHub 交付和双状态。

## 当前原则

- `docs/tasks/**` 是正式任务设计与状态事实来源。
- 当前任务区只放准备执行的任务，不存放长篇研究资料。
- 不因为某项能力在成熟框架中存在，就默认当前项目立即实现。
- 不为未来尚未验证的能力提前创建完整 Task 树。
- Codex 实现完成只能记录“实施状态：已实现、验收状态：待验收”。
- GPT 技术验收通过后仍需用户确认；确认后才能更新为“验收状态：已通过”。
- 验收确认、任务状态收口、Draft 转 Ready、合并和开始下一 Task 是不同动作，不自动推导。
