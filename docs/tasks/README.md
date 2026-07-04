# Tasks

本目录只放当前可执行任务和已完成阶段归档。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| 阶段 4 Agent Runtime | Active | [phase-04-agent-runtime/README.md](./phase-04-agent-runtime/README.md) | 从 Chat 进入可观测 Agent Run |
| 阶段 4 Task 1 | Active | [phase-04-agent-runtime/task-01-agent-run-step-model.md](./phase-04-agent-runtime/task-01-agent-run-step-model.md) | `AgentRun` / `AgentStep` 基础模型 |
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
