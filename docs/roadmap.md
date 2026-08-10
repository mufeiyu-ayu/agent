# AI SEO Agent 学习路线

本文只维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从基础 LLM Chat 到 Session、Streaming、Agent Runtime、最小 Tool Calling，再到 bounded sequential Agent Loop 与 Runtime reliability 的连续学习闭环；Admin Console 的真实 Observability Baseline 也已经建立。

经过基于最新 `master` 的阶段讨论，下一正式 Agent 主线已经定案为 **Phase 7：Context Engineering**。Task 0 的正式 Issue #40 已创建；首轮 Clarification Gate 因 Draft / Ready PR 规则和 docs 状态漂移返回 `BLOCKED`，对应阻塞决策与流程文档已经同步。Task 0 在重新 Gate 为 `READY` 前仍保持 `Next`，因此当前没有 Active Agent Task。

当前状态：

```text
阶段 1-6：Completed
阶段 7：Context Engineering / Next
当前 Agent 主线：无 Active Task
下一正式 Task：Phase 7 Task 0 / Context Boundary & Snapshot / Next
Issue：#40 已创建
Gate：首轮 BLOCKED；阻塞决策已同步，等待重新 Gate
Admin Observability：Task 0-3 Completed
Admin Task 4：Planned
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
| [阶段 7：Context Engineering](./tasks/phase-07-context-engineering/README.md) | **Next** | model-visible context 边界、model-aware budget、动态 History、Loop Context、Context Inspector |

## 阶段 6 最终建立

- 第二个只读 Article Tool：`get_article_detail`；
- Tool 基础设施与 Article 业务工具分层；
- 用户输入、历史、Model Profile、输出、timeout 与 Observation 预算治理；
- policy 驱动 bounded sequential Agent Loop；
- 默认 `3` 次 sampling / `2` 次 Tool Call / `600s` Run deadline；
- `search_articles` 与 `get_article_detail` Run allowlist；
- DeepSeek `reasoning_content` continuation；
- direct final、一次 Tool、两次顺序 Tool、loop limit、Tool timeout、Run deadline、Abort 的确定性行为；
- 单一 Run `deadlineAt` 与 remaining-budget 传播；
- PostgreSQL transaction-local statement / lock timeout；
- late-result ownership fencing；
- Message / AgentStep / AgentRun 原子终态收口；
- COMMIT outcome unknown 的显式语义；
- 真实 PostgreSQL reliability 验证。

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

这些后置项不是 Phase 6 未完成事项。Phase 7 只接手其中与 Context Engineering 直接相关的部分，不顺手推进其他能力。

## Phase 7：Context Engineering

正式规划：[`tasks/phase-07-context-engineering/README.md`](./tasks/phase-07-context-engineering/README.md)。

阶段目标不是“把模型 Context Window 尽量填满”，而是让系统能够明确、可测试、可观察地决定：**这一轮模型应该看到什么、能看到多少、为什么包含或排除这些信息。**

当前规划：

```text
Task 0：Context Boundary & Snapshot                   Next / Issue #40 / 待重新 Gate
Task 1：Model-aware Budget & Dynamic History          Planned
Task 2：Loop-aware Context & Observation Governance   Planned
Task 3：Context Inspector & Phase Baseline            Planned
Compaction：Gated Follow-up                           不自动启动
```

### Task 0

先建立独立 Context boundary 和安全 Snapshot，保持当前 `historyLimit = 40`、Observation 上限、Chat / NDJSON 协议与数据库行为不变。目的只是把散落的 model input assembly 收敛成一个明确边界，并锁定 direct-final / Tool Loop 的 Context 不变量。

Task 0 已创建正式 Issue #40。首轮 Gate 返回 `BLOCKED` 后，GPT 已明确两项决策：正式功能 PR 采用 Draft 生命周期；Task 0 在 Gate `READY` 前仍为 `Next`，不得因 Issue 已创建提前写成 Active。对应协作规范与 task / roadmap 状态已经同步，下一动作是重新执行 Gate。

### Task 1

让现有 `ModelProfile.contextWindowTokens` 真正进入输入预算；History 从固定条数策略升级为 token-budget 驱动的动态选择。`SEO_CHAT_HISTORY_LIMIT` 若保留，只作为候选查询 / safety cap，不再代表最终模型 Context 的语义。

### Task 2

把 Context Budget 扩展到完整 bounded Agent Loop。Tool Call / Result 按配对单元维护，每轮 sampling 前重新核对 Context usage；现有 per-tool Observation 字符上限与 global hard max 继续作为 safety ceiling，而不是唯一 Context 策略。

### Task 3

把 Context 预算和选择结果安全投影到现有 Observability Baseline，建立 Context Inspector。展示预算、估算使用量、来源、included / excluded / truncated reason，不展示完整 Prompt、reasoning、raw Tool payload 或敏感数据。

### Compaction 边界

Minimal Compaction 当前不属于 Phase 7 Baseline 的默认完成条件。只有 Task 1-3 的真实数据证明动态选择仍不足以维持长会话连续性、成本、延迟或质量时，才另建 Task / Issue 讨论 Summary / Compaction；不直接复刻 Codex 完整 `ContextManager`。

## Admin Console Observability 支线

Admin Console 不是 Phase 7 本身。Task 3 只会利用现有 Observability Baseline 增量增加 Context Inspector，不会为了后台展示反向修改 Runtime Domain Model，也不会自动启动 Admin Task 4。

当前状态：

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Completed / #33 / #34 / merge 997d6b84
Task 3：真实 Run Trace UI            Completed / #35 / #36 / merge 4c689c4c
Task 4：登录 / 权限 / 脱敏           Planned
```

Task 2 + Task 3 已建立完整的开发者 Observability Baseline：

```text
AgentRun / AgentStep / Message
        ↓
Admin Read Contract
        ↓
真实 Query API
        ↓
Run List / Run Detail
        ↓
Typed Inspector + Generic Inspector
        ↓
Computer Use 可验证的真实浏览器 Console
```

正式文档：

- [`tasks/admin-console/task-02-run-query-api.md`](./tasks/admin-console/task-02-run-query-api.md)
- [`tasks/admin-console/task-03-real-trace-ui.md`](./tasks/admin-console/task-03-real-trace-ui.md)

## Web Chat UI Follow-up

Issue #37 / PR #38 已完成并合入 `master`，merge commit `415d740507a29ee4bd9b6a4aa26d9c4fbb9668c1`。

本次独立收口了：

- Chat 原生滚动 viewport；
- 新一轮用户消息定位；
- 流式输出的底部跟随 / 用户上滚暂停 / 回到底部恢复；
- scroll memory；
- `ctrl + wheel` / 多指触控意图边界；
- Chat / Sidebar / Header / Composer 响应式布局。

该 UI follow-up 不改变 Agent 主线阶段状态。

## Phase 7 之后如何决定

当前只确认 Phase 7，不提前把后续候选方向锁死成固定阶段号。

Phase 7 Baseline 收口后，再基于最新 `master`、真实产品需求和学习收益重新比较：

1. RAG / Embedding / Hybrid Retrieval；
2. Permission / Approval / HITL；
3. Durable Recovery / Resume；
4. MCP / Plugin / Skill；
5. Planner / Workflow / 并行 Tool Call；
6. Multi-agent；
7. 若 Context 证据充分，再决定 Minimal Compaction 是否需要单独收口。

当前没有 Active Agent Task。下一正式动作是让 Codex 针对 Issue #40 重新执行 Clarification Gate；只有 Gate 为 `READY` 后，Task 0 才进入 Active。