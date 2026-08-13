# AI SEO Agent 学习路线

本文只维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从基础 LLM Chat 到 Session、Streaming、Agent Runtime、最小 Tool Calling、bounded sequential Agent Loop、Runtime reliability，再到 Context Engineering 的连续学习闭环；Admin Console 的真实 Observability Baseline 与安全 Context Inspector 也已经建立。

Phase 7 `Context Engineering` 已完成 GPT 技术验收、用户确认验收，并通过 Issue #46 / PR #47 合入 `master`。Task 0-3 均已 Completed，最终 merge commit 为 `caf3d25b7af0e5b30ae47d3c96faab4138fbdb9e`。

当前状态：

```text
阶段 1-7：Completed
Active Agent Task：无
Minimal Compaction：Gated
Admin Observability：Task 0-3 Completed
Admin Task 4：Planned
下一阶段：尚未定案
```

## 阶段路线

| 阶段 | 状态 | 核心能力 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答 |
| 阶段 2：Session Chat 持久化 | Completed | Conversation / Message 持久化 |
| 阶段 3：Streaming Chat | Completed | NDJSON 流式输出、Abort 与终态一致性 |
| 阶段 4：Agent Runtime 基础 | Completed | `AgentRun` / `AgentStep` 与 Runtime Event |
| 阶段 5：最小 Tool Calling | Completed | 单次 Tool Call、Observation 与第二轮 sampling |
| [阶段 6：有界单 Agent Loop](./tasks/completed/phase-06-bounded-agent-loop.md) | **Completed** | 多轮顺序决策、执行预算、DeepSeek continuation、DB deadline 与终态可靠性 |
| [阶段 7：Context Engineering](./tasks/completed/phase-07-context-engineering.md) | **Completed** | Context 边界、model-aware budget、Dynamic History、Loop Context Governance、Context Inspector |

## Phase 7 最终交付

```text
Task 0：Context Boundary & Snapshot                   Completed / #40 / #41 / 415e866a
Task 1：Model-aware Budget & Dynamic History          Completed / #42 / #43 / 6df72f0
Task 2：Loop-aware Context & Observation Governance   Completed / #44 / #45 / 2f06355c
Task 3：Context Inspector & Phase Baseline            Completed / #46 / #47 / caf3d25b
Minimal Compaction                                    Gated
```

Phase 7 最终建立：

- 单 Run `ModelContext`，明确区分 UI transcript、model-visible context、runtime events 与 durable AgentStep；
- 由 Context Window、输出预留、安全余量和应用输入上限共同决定 input budget；
- DeepSeek V4 官方 tokenizer、本地 full-request token estimation 与 fail-closed；
- 可靠 `COMPLETED` History 的因果上界、keyset candidate read 与 token-budget Dynamic History Selection；
- 每轮 sampling 前重新规划 Context，先排除最旧 History，再治理较旧 Observation；
- `tool_ceiling` 与 `context_budget` 双层 Observation Governance；
- Tool Call / Result pairing、顺序、DeepSeek continuation 与低信任 Tool Context 不变量；
- 安全 Admin Context Inspector，展示 Budget、Sources、Adjustments / Outcome；
- legacy、partial、unknown 或矛盾 metadata 安全降级，不暴露 Prompt、reasoning、raw arguments 或完整 Observation。

最终归档：[`tasks/completed/phase-07-context-engineering.md`](./tasks/completed/phase-07-context-engineering.md)。

## Minimal Compaction 边界

Minimal Compaction 没有被纳入 Phase 7 默认完成条件。当前证据不足以证明必须立即实现 Summary / Compaction，因此继续保持 `Gated`。

只有真实 Inspector 数据持续证明以下问题时，才另建正式 Task / Issue：

- 旧 Context 被频繁驱逐并破坏长任务连续性；
- 相同信息反复重新获取，明显增加成本或延迟；
- Dynamic History 与 Observation 缩减仍无法维持质量；
- 产品明确需要跨长会话保留结构化任务状态。

## Admin Console Observability 支线

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Completed / #33 / #34 / 997d6b84
Task 3：真实 Run Trace UI            Completed / #35 / #36 / 4c689c4c
Task 4：登录 / 权限 / 脱敏           Planned
```

Admin Task 2 + Task 3 已建立真实 Run / Step Read API、Run List / Detail、Execution Timeline、Typed / Generic Inspector、错误边界和浏览器验收。Phase 7 Task 3 已在该基线上增加 Context Inspector，但 Admin Task 4 不自动启动。

## Web Chat UI Follow-up

Issue #37 / PR #38 已完成并合入 `master`，merge commit `415d740507a29ee4bd9b6a4aa26d9c4fbb9668c1`。该独立任务完成了 Chat 原生滚动 viewport、流式跟随、用户上滚暂停、scroll memory 和响应式布局。

## 下一阶段如何决定

当前没有 Active Agent Task，也不提前锁死下一阶段号。后续应基于最新 `master`、真实产品价值、学习收益和作品集完整度重新比较：

1. RAG / Embedding / Hybrid Retrieval；
2. Permission / Approval / Human-in-the-loop；
3. Durable Recovery / Resume；
4. MCP / Plugin / Skill；
5. Planner / Workflow / 并行 Tool Call；
6. Multi-agent；
7. 有真实 Context 压力证据时再讨论 Minimal Compaction。

任何候选方向都不会因为 `docs/research/**` 已经存在相关资料而自动进入正式任务。必须先完成需求讨论、任务规格、Issue 和 Clarification Gate。
