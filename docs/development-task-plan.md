# AI SEO Agent Development Task Plan

本文件只保留为旧入口兼容。当前路线、正式状态和执行任务已经收敛到：

- [docs/README.md](./README.md)：文档总入口
- [docs/roadmap.md](./roadmap.md)：阶段路线与当前优先级
- [docs/tasks/README.md](./tasks/README.md)：正式任务看板
- [docs/tasks/phase-06-context-engineering/README.md](./tasks/phase-06-context-engineering/README.md)：下一阶段任务规划

## 当前主线

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答链路已完成 |
| 阶段 2：Session Chat 持久化 | Completed | Conversation / Message 与多会话持久化已完成并归档 |
| 阶段 3：Streaming Chat | Completed | NDJSON streaming、abort 与最终态一致性已完成并归档 |
| 阶段 4：Agent Runtime 基础 | Completed | AgentRun / AgentStep、Runtime 和 Context Builder 初始边界已完成并归档 |
| 阶段 5：最小 Tool Calling | Completed | Tool contract、只读工具、Observation、第二轮 sampling、可靠性与统一 Runtime 已完成并归档 |
| 阶段 6：Context Engineering 基础 | **Next：已规划，待启动** | Task 0 是下一项要创建 Issue 的正式任务；当前没有 Active 实现 |
| 阶段 7：Durable Facts 与 Recovery 基础 | Planned | 等阶段 6 完成后再规划 canonical facts、operation identity、receipt 与恢复语义 |
| 阶段 8：真实写工具 + Permission + HITL | Planned | 等真实写操作和 durable 前置能力成立后再规划 |
| 阶段 9：Observability / Evaluation / Portfolio | Planned | 汇总 Admin、评估、成本、错误分类和作品集能力 |

## 下一项任务

```text
阶段 6 Task 0：Context 基线、契约与测试夹具
```

入口：

[docs/tasks/phase-06-context-engineering/task-00-context-baseline-and-contract.md](./tasks/phase-06-context-engineering/task-00-context-baseline-and-contract.md)

状态说明：

- 已确认是下一项正式 Task；
- 尚未创建 Issue、分支或 PR；
- 尚未进入实现；
- Task 1-5 保持 Planned，不能自动推进。

## 维护规则

- 新任务不再写入本文件，只维护兼容入口和当前阶段摘要。
- 具体执行任务统一写入 `docs/tasks/`。
- 深度研究与历史学习路线统一放入 `docs/research/`。
- 已完成阶段只保留简洁归档，不再占用当前任务入口。
- 本文件若与 `docs/tasks/**` 或 `docs/roadmap.md` 冲突，以 `docs/tasks/**` 为正式状态事实来源。
