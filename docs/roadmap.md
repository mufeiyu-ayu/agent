# AI SEO Agent 学习路线

本文只维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从基础 LLM Chat 到 Session、Streaming、Agent Runtime、最小 Tool Calling，再到 bounded sequential Agent Loop 与 Runtime reliability 的连续学习闭环。

当前状态：

```text
阶段 1-6：Completed
当前 Agent 主线：无 Active Task
下一正式 Agent 阶段：尚未定案
Admin Observability 支线：Task 2 Active / Issue #33
```

阶段 6 已于 2026-08-09 完成最终技术验收并合入 `master`。最终归档见 [`tasks/completed/phase-06-bounded-agent-loop.md`](./tasks/completed/phase-06-bounded-agent-loop.md)。

## 阶段路线

| 阶段 | 状态 | 核心能力 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答 |
| 阶段 2：Session Chat 持久化 | Completed | Conversation / Message 持久化 |
| 阶段 3：Streaming Chat | Completed | NDJSON 流式输出、Abort 与终态一致性 |
| 阶段 4：Agent Runtime 基础 | Completed | `AgentRun` / `AgentStep` 与 Runtime Event |
| 阶段 5：最小 Tool Calling | Completed | 单次 Tool Call、Observation 与第二轮 sampling |
| [阶段 6：有界单 Agent Loop](./tasks/completed/phase-06-bounded-agent-loop.md) | **Completed** | 多轮顺序决策、执行预算、DeepSeek continuation、DB deadline 与终态可靠性 |

## 阶段 6 最终建立

- 第二个只读 Article Tool：`get_article_detail`；
- Tool 基础设施与 Article 业务工具分层；
- 用户输入、历史、Model Profile、输出、timeout 与 Observation 预算治理；
- policy 驱动 bounded sequential Agent Loop；
- 默认 `3` 次 sampling / `2` 次 Tool Call / `600s` Run deadline；
- `search_articles` 与 `get_article_detail` Run allowlist；
- DeepSeek `reasoning_content` continuation 与非 null assistant Tool Call content；
- direct final、一次 Tool、两次顺序 Tool、loop limit、Tool timeout、Run deadline、Abort 的确定性行为；
- 单一 Run `deadlineAt` 与 remaining-budget 传播；
- PostgreSQL transaction-local `statement_timeout` / `lock_timeout`；
- bounded pool acquisition 与 late acquisition / late result ownership fencing；
- Message / assistant Step / AgentRun 的原子 completion 与 bounded terminalization；
- COMMIT outcome unknown 的显式语义，不伪造成功或失败；
- 真实 PostgreSQL reliability 验证与阶段级回归矩阵。

## 阶段 6 最终交付顺序

```text
Task 0：get_article_detail
  -> 横向配置治理 Issue #27
  -> Task 1：有界顺序 Agent Loop
  -> Task 2：Runtime reliability / regression
  -> Phase 6 Completed
```

关键交付：

| 工作项 | Issue / PR | Merge commit |
| --- | --- | --- |
| Task 0 | #25 / #26 | `d3609d3f` |
| 横向配置治理 | #27 / #28 | `4a50c18c` |
| Task 1 | #29 / #30 | `904b011d` |
| Task 2 | #31 / #32 | `691efbcd` |

## 阶段 6 已接受的能力边界

| 已完成 | 明确后置 |
| --- | --- |
| 顺序 Agent Loop 与 Tool Execution | 并行 Tool Call、Planner、Workflow DSL |
| Sampling / Tool Call / Run 执行预算 | Durable Recovery、跨进程 Resume |
| Tool Call / Result 配对与顺序 | 完整 ContextPlan、自动摘要、Compaction |
| Model / Tool / DB timeout 与 Abort 语义 | 写工具、Permission、Approval、HITL |
| Run / Step Trace 与终态一致性 | RAG、Embedding、长期 Memory |
| DeepSeek thinking continuation | MCP、Plugin、Skill、Multi-agent |
| statement / lock wait 真实 DB timeout | per-operation pool waiter 物理取消 |

这些后置项不是 Phase 6 未完成事项。只有后续出现真实产品需求、可靠性问题或明确学习目标时，才重新评估为正式 Agent Task。

## Admin Console Observability 支线

Admin Console 不是 Phase 7，也不会改变 Agent 主线仍“无 Active Task”的事实。

当前执行顺序已经确定：

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Active / Issue #33
Task 3：真实 Run Trace UI            Planned
Task 4：登录 / 权限 / 脱敏           Planned
```

Task 2 / 3 的正式文档：

- [`tasks/admin-console/task-02-run-query-api.md`](./tasks/admin-console/task-02-run-query-api.md)
- [`tasks/admin-console/task-03-real-trace-ui.md`](./tasks/admin-console/task-03-real-trace-ui.md)

本支线的近期目标是先建立真实 Observability Baseline。Task 2 验收完成后再启动 Task 3；Task 3 完成后，后台作为后续 Agent 能力的开发者控制台增量演进，例如 Context Inspector、Retrieval Inspector、Approval Inspector 或 Recovery Inspector。

## 下一 Agent 阶段如何决定

当前不预设 Phase 7，也不从 `docs/research/**` 自动选择下一阶段。

完成当前 Admin Observability 基线不等于自动启动某个 Agent Phase。下一次主线规划仍应基于当时最新 `master`，再根据以下证据选择一个最小可验收方向：

1. 当前 Runtime 暴露出的真实工程瓶颈；
2. 产品需要新增的 Agent 能力；
3. 对 Agent 应用开发能力提升的学习收益；
4. 能否定义清晰的代码范围、失败边界和验收标准。

在完成这一步之前，Agent 主线保持“无 Active Task”。