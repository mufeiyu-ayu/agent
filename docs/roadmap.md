# AI SEO Agent 学习路线

本文只维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从基础 LLM Chat 到 Session、Streaming、Agent Runtime、最小 Tool Calling，再到 bounded sequential Agent Loop 与 Runtime reliability 的连续学习闭环；Admin Console 的真实 Observability Baseline 也已经建立。

Phase 7：Context Engineering 当前为 **Active**。Task 0 `Context Boundary & Snapshot`、Task 1 `Model-aware Budget & Dynamic History` 与 Task 2 `Loop-aware Context & Observation Governance` 均已完成 GPT 技术验收、用户确认验收并合入 `master`。Task 3 `Context Inspector & Phase Baseline` 已按 Issue #46 实现，当前等待 GPT 技术验收；Phase 7 尚未收口。

当前状态：

```text
阶段 1-6：Completed
阶段 7：Context Engineering / Active
Task 0：Context Boundary & Snapshot / Completed / #40 / #41 / 415e866a
Task 1：Model-aware Budget & Dynamic History / Completed / #42 / #43 / 6df72f0
Task 2：Loop-aware Context & Observation Governance / Completed / #44 / #45 / 2f06355c
当前任务：Task 3 / Context Inspector & Phase Baseline / Active / #46 / 已实现、待验收
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
| [阶段 7：Context Engineering](./tasks/phase-07-context-engineering/README.md) | **Active** | model-visible context 边界、model-aware budget、动态 History、Loop Context、Context Inspector |

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
Task 0：Context Boundary & Snapshot                   Completed / #40 / #41 / 415e866a
Task 1：Model-aware Budget & Dynamic History          Completed / #42 / #43 / 6df72f0
Task 2：Loop-aware Context & Observation Governance   Completed / #44 / #45 / 2f06355c
Task 3：Context Inspector & Phase Baseline            Active / #46 / 已实现、待验收
Compaction：Gated Follow-up                           不自动启动
```

### Task 0

先建立独立 Context boundary 和安全 Snapshot，保持当时的 `historyLimit = 40`、Observation 上限、Chat / NDJSON 协议与数据库行为不变。目的只是把散落的 model input assembly 收敛成一个明确边界，并锁定 direct-final / Tool Loop 的 Context 不变量。

Task 0 已完成：Issue #40、PR #41；GPT 基于最新实现、AC-01～AC-09、Codex Review 和验证结果完成技术验收，用户于 2026-08-10 明确确认通过；PR #41 已合入 `master`，merge commit `415e866af4d4007b6bed43cd1f6e3df590575706`，Issue #40 已关闭。

### Task 1

让现有 `ModelProfile.contextWindowTokens` 真正进入输入预算；History 从固定条数策略升级为 token-budget 驱动的动态选择。

Task 1 已完成：Issue #42、PR #43；建立 `262_144` application input cap、`16_384` safety margin、DeepSeek V4 TokenEstimator、本地 tokenizer artifact、current User 因果上界、newest-first keyset candidate 分页与 recency-first whole-message selection。第一轮 Codex Review 的 3 个 P2 已在 `620a2d0` 修复并全部 resolved；第二轮 Review 未发现新的主要问题。GPT 技术验收与用户确认验收均通过，PR #43 已合入 `master`，merge commit `6df72f02242a1b8a23920d64c471ce721ccf558b`，Issue #42 已关闭。

### Task 2

把 Context Budget 扩展到完整 bounded Agent Loop。Tool Call / Result 按配对单元维护，每轮 sampling 前重新核对 Context usage；现有 per-tool Observation 字符上限与 global hard max 继续作为 safety ceiling，而不是唯一 Context 策略。

Task 2 已完成：Issue #44、PR #45；建立 DeepSeek V4 full-request estimator、逐轮 Sampling Context Plan、follow-up History 再选择、Observation 双层治理、安全 Context Plan 摘要与 overflow / estimator failure 的 fail-closed 行为。GPT 基于最新 head `810b4b717ad65c950ee6b7b51de70e6f41fb83da`、Issue #44、PR diff、Review finding 修复、独立 Codex Review 与完整验证记录完成技术验收；用户于 2026-08-13 明确确认按 Completed 状态收口。PR #45 已合入 `master`，merge commit `2f06355ccfbe86d5b7492d770250b776e5da79f1`，Issue #44 已关闭。

### Task 3

把 Context 预算和选择结果安全投影到现有 Observability Baseline，建立 Context Inspector。展示预算、估算使用量、来源、included / excluded / truncated reason，不展示完整 Prompt、reasoning、raw Tool payload 或敏感数据。

Task 3 已按 Issue #46 完成 `READY` Clarification Gate 与实现：现有 durable safe metadata 经 Admin Read Projection 形成 per-sampling Context Inspector，并以自动回归和真实 API / Run 浏览器证据验证。实施状态为已实现，验收状态为待验收。

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

当前 Active Agent Task 为 Phase 7 Task 3 `Context Inspector & Phase Baseline`。Issue #46 已实现、待验收；Task 3 与 Phase 7 仍不得视为 Completed，Minimal Compaction 继续保持 `Gated`。
