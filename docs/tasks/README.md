# Tasks

本目录只放当前可执行任务和已完成阶段归档。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| 阶段 5 最小 Tool Calling | In Progress | [phase-05-tool-calling/README.md](./phase-05-tool-calling/README.md) | Task 0-4 已完成并通过验收；Task 5 保持 Planned |
| 阶段 4 Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档为可观测 Agent Run 的基础阶段 |
| 阶段 3 收口 | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已收口 `done/error/aborted` 最终态一致性 |
| 阶段 2 | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 多会话和消息持久化已完成 |

## 任务写法

新任务统一使用 TDD 风格模板：[_template.tdd.md](./_template.tdd.md)。

每个任务必须写清楚：

- 目标
- 范围
- 不做什么
- Red：先定义失败用例或验证缺口
- Green：最小实现
- Refactor：边界整理
- 验证命令
- 验收标准

## 当前原则

- 当前任务区只放要执行的任务，不放长篇研究资料。
- 阶段任务要小，不把 Tool Calling、RAG、多 Agent 混进同一个任务。
- 已完成阶段只保留简洁归档，详细历史看 `docs/work-log.md`。
- `docs/tasks/**` 是任务设计和阶段状态的事实来源；GitHub Issue 只保存一次实施快照并引用对应任务文档。
- 正式实施任务可以按一个清晰 Task 创建一个 Issue 和 Ready PR；讨论、纯学习、本地实验和小型 docs 修正不强制走 PR。
- Codex 实现完成只记录“实施状态：已实现、验收状态：待验收”，不等于任务 Completed。
- 实现未完成、验证失败、任务受阻或等待确认时保留原状态并记录阻塞原因；完成实现和验证后才能更新为“已实现、待验收”并从 Draft 转为 Ready。
- GPT 给出验收通过结论且用户明确确认后，才将“验收状态”更新为“已通过”，并推进阶段状态或归档。
- PR 合并前保留学习验收，确保用户已经理解关键调用链、文件职责和测试边界。
