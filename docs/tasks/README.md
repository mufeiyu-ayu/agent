# Tasks

本目录只放当前可执行任务、下一阶段规划和已完成阶段归档。研究资料不放在这里。

## 当前看板

阶段 5 最小 Tool Calling 已完成并归档。经代码与 `docs/research/**` 对照后，下一条 Agent 主线已经确认为阶段 6 `Context Engineering 基础`。

当前没有 `Active` 正式实现任务：阶段 6 Task 0 已标记为 `Next`，表示它是下一项需要创建独立 Issue 的正式任务；Task 1-5 仍为 `Planned`。本次规划没有创建 Issue、分支或 PR，也没有进入代码实现。

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| 阶段 6 Task 0：Context 基线、契约与测试夹具 | **Next** | [phase-06-context-engineering/task-00-context-baseline-and-contract.md](./phase-06-context-engineering/task-00-context-baseline-and-contract.md) | 下一项正式任务；Issue 未创建，实施状态未开始 |
| 阶段 6 Task 1-5 | Planned | [phase-06-context-engineering/README.md](./phase-06-context-engineering/README.md) | history normalization、budget、Observation policy、Runtime integration、回归收口；必须按前置顺序逐个推进 |
| Admin Console Task 1 | Completed | [admin-console.md](./admin-console.md) | Issue #21 / PR #22；静态 Run List / Run Detail UI 已实现并通过验收 |
| Admin Console Task 0 | Completed | [admin-console.md](./admin-console.md) | Issue #19 / PR #20；`apps/admin` 基础壳已实现并通过验收 |
| Admin Console Task 2-4 | Planned | [admin-console.md](./admin-console.md) | 可并行产品支线；尚未创建 Issue，不代表阶段 9 已启动 |
| 阶段 5 最小 Tool Calling | Completed | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | Task 0-5 与 Issue #14 已完成并通过验收；PR #17 已合并，阶段已归档 |
| 阶段 4 Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档为可观测 Agent Run 的基础阶段 |
| 阶段 3 收口 | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已收口 `done/error/aborted` 最终态一致性 |
| 阶段 2 | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 多会话和消息持久化已完成 |

## 阶段 6 任务顺序

```text
Task 0：Context 基线、契约与测试夹具（Next）
  -> Task 1：History 资格、规范化与配对不变量
  -> Task 2：Token 预算、来源优先级与安全裁剪
  -> Task 3：Tool Observation 的 Context 策略
  -> Task 4：ContextPlan 接入共享 Agent Runtime
  -> Task 5：Context 回归、评估与阶段收口
```

执行规则：

- Task 0 是下一项正式 Task，但只有 Issue 创建并通过 Clarification Gate 后才能进入实现。
- 一个 Issue 只对应一个 Task，不把 Task 0-5 合并成一个大 Issue。
- Task 1-5 必须等待前置 Task 完成验收，不能预先标记 Active。
- Task 5 技术验收通过后仍需用户确认，才能把阶段 6 标记 Completed 或开始阶段 7。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Next | 已确认是下一项要创建 Issue 的任务；尚未实现，不等于 Active |
| Active | 已创建正式 Issue，Clarification Gate 为 READY，正在实现或待验收 |
| Planned | 已规划但前置条件未满足，不能开始实现 |
| Completed | 实施状态已实现、验收状态已通过，并已由用户确认收口 |

## 任务写法

新任务统一使用 TDD 风格模板：[_template.tdd.md](./_template.tdd.md)。

每个任务必须写清楚：

- 目标
- 背景与当前代码事实
- 学习重点
- 范围
- 不做什么
- Red：先定义失败用例或验证缺口
- Green：最小实现
- Refactor：边界整理
- 验证命令
- 可观察的验收标准
- 风险点
- GitHub 交付和双状态

## 当前原则

- 当前任务区只放要执行的任务，不放长篇研究资料。
- 阶段任务要小，不把 Context、RAG、Memory、Recovery、HITL 或 Multi-agent 混进同一个 Task。
- 已完成阶段只保留简洁归档，详细历史看 `docs/work-log.md`。
- `docs/tasks/**` 是任务设计和正式状态的事实来源；GitHub Issue 保存一次准备实施的任务快照并引用对应任务文档。
- 正式功能、API、数据库、Agent Runtime、Tool Calling、权限和阶段状态变更必须按一个 Task 一个 Issue 推进。
- 讨论、源码阅读、本地实验和已经确认的学习规划可以不创建 Issue，但不能因此把任务写成“进行中”或“已完成”。
- Codex 实现完成只能记录“实施状态：已实现、验收状态：待验收”。
- GPT 技术验收通过后仍需用户确认；确认后才能更新为“验收状态：已通过”并推进阶段状态。
- 验收确认、任务状态收口、Draft 转 Ready、合并和开始下一 Task 是不同动作，不自动推导。
- Admin Console Task 2-4 仍需分别创建独立 Issue，不因阶段 6 被标记 Next 而自动推进，也不替代 Agent 主线。
