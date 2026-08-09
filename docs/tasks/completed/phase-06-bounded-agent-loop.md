# 阶段 6：有界单 Agent Loop

状态：**Completed / 已归档**。

完成日期：2026-08-09（Asia/Shanghai）。

本文件是 Phase 6 的最终归档事实来源。详细需求、澄清、Review 与实现过程继续以对应 GitHub Issue / PR 和 Git 历史为准，不在 `docs/tasks/` active 区重复维护第二套状态。

## 阶段目标

阶段 6 将阶段 5 的“最多一次 Tool Call、固定两轮 sampling”升级为服务端受控的 bounded sequential Agent Loop，并完成执行预算、DeepSeek thinking continuation、数据库 deadline、异常竞争与终态一致性的阶段级可靠性收口。

最终运行形态：

```text
用户目标
  -> model sampling
  -> final answer ----------------------> complete
  -> tool call
       -> Runtime 校验 allowlist / budget
       -> Tool Execution
       -> append Tool Call + Observation
       -> model sampling
       -> continue / final
```

后端不硬编码 `search -> detail -> final`；模型负责在已授权能力中提出动作，Runtime 负责授权、验证、执行、预算、取消、终止和持久化事实。

## 交付记录

| 工作项 | 状态 | Issue / PR | 最终结果 |
| --- | --- | --- | --- |
| Task 0：新增 `get_article_detail` | Completed | Issue #25 / PR #26 | 第二个只读 Article Tool；Tool 目录整理为 `core/ + articles/`；merge commit `d3609d3f` |
| 横向前置：运行参数治理 | Completed | Issue #27 / PR #28 | 64K 输入、40 条 Completed 历史、Model Profile、输出 / timeout / Observation 预算治理；merge commit `4a50c18c` |
| Task 1：有界顺序 Agent Loop | Completed | Issue #29 / PR #30 | policy 驱动 3 sampling / 2 Tool Call Loop、双 Article Tool allowlist、DeepSeek thinking continuation；merge commit `904b011d` |
| Task 2：Runtime 可靠性与阶段回归 | Completed | Issue #31 / PR #32 | 数据库 deadline、late-result fencing、原子 terminalization、真实 PostgreSQL reliability；merge commit `691efbcd` |

## 最终建立的能力

### Agent Loop

- Runtime 不再依赖固定 `[1, 2]` sampling 特例；
- 默认 `maxSamplingRounds = 3`、`maxToolCalls = 2`、`runDeadlineMs = 600000`；
- `AGENT_MAX_TOOL_CALLS=0` 时不向模型暴露 Tool；
- 当前 Run allowlist 只开放 `search_articles` 与 `get_article_detail`；
- 支持 direct final、一次 Tool 后 final、两次顺序 Tool 后 final；
- 第三次 Tool Call 不执行、不伪造 Tool Result，Run 以明确 loop-limit failure 结束；
- Tool Call / Tool Result 按真实顺序和 `callId` 配对进入下一轮模型输入。

### Provider continuation

- DeepSeek thinking Tool Call 的 `reasoning_content` 作为当前 Run 内部 continuation data 完整续传；
- reasoning 不进入 UI Message、AgentRuntimeEvent、ChatStreamEvent 或 Safe Raw Data；
- assistant Tool Call 在无中间文本时仍向 Provider 发送非 null `content`；
- 同步与流式业务入口继续共享唯一 `AgentRuntimeService.runTurnStream()`。

### 运行参数与 Observation

最终阶段基线包括：

```text
用户消息上限             64_000 chars
最近可靠历史             40 条 COMPLETED
应用默认输出             65_536 tokens
应用输出硬上限           131_072 tokens
Stream timeout            600_000ms
Run deadline              600_000ms
Search Observation        16_000 chars
Detail Observation        64_000 chars
Observation hard max      128_000 chars
```

Provider 能力、应用策略、Runtime policy 与 Tool policy 保持分层，没有创建万能 constants 文件。

## Task 2：数据库 deadline 与终态一致性收口

Task 1 Review 留下的 Prisma / Recorder 数据库等待问题已在 Task 2 正式处理。

### 单一 Run deadline

Run 创建成功后建立单一 `deadlineAt`。Model sampling、Tool、history、Recorder 与 Message transaction 使用同一 Run remaining-budget / ownership 事实源。

pre-run persistence 仍不属于 Run deadline：

- conversation existence check；
- user Message 初始持久化；
- `AgentRun` 自身创建。

### 数据库边界

- 共享 Pool acquisition 使用当前 `pg` / Prisma 支持的有界等待；
- 当前技术栈不宣称支持 per-operation dynamic remaining-budget 的 acquisition waiter 物理取消；
- late acquisition / late transaction start 通过 cancellation / ownership fencing 隔离，不能继续 normal execution；
- 已取得可控 transaction / statement 边界后，每条 business statement 使用 transaction-local `statement_timeout` / `lock_timeout`；
- PostgreSQL timeout 不超过 operation-start 时的 remaining Run budget；
- 不使用 JS `Promise.race` 伪装 PostgreSQL statement 已取消；
- `SET LOCAL` 在 commit / rollback 后恢复 pooled connection 原 baseline，不给非 Run SQL 注入 application-wide `statement_timeout`。

### Prisma 7.8 late transaction cleanup

`RollbackSafePrismaPg` 只补足 Prisma 7.8 transaction-start timeout / late-discard 下的真实 `ROLLBACK` + release 边界；真实 PostgreSQL 测试确认：

- late `BEGIN` 最终只执行一次 `ROLLBACK`；
- connection 只 release 一次；
- connection 可复用；
- 不遗留 `idle in transaction`。

### Terminal ownership

正常完成路径在一个窄 transaction 内原子推进：

```text
Assistant Message -> COMPLETED
assistant_output Step -> COMPLETED
AgentRun -> COMPLETED
          -> COMMIT
```

失败 / Abort cleanup 也在独立、短且有上界的 transaction 内原子收口 Message、unfinished Steps 与 Run。

Run deadline / user Abort 使用 first-cause 语义：

- user-first -> `ABORTED`；
- deadline-first -> `FAILED`；
- completion commit ownership 已安全取得后，迟到 Abort / deadline 不再反向覆盖完成路径。

若 COMMIT 在内部等待上界内没有得到确定结果，Runtime 使用 `DatabaseCommitOutcomeUnknownError` 暴露“结果未知”，不伪造 completed / failed，也不启动可能与真实 COMMIT 竞争的 cleanup。

## Phase 6 最终不变量

- 模型可以直接回答，不被强迫调用工具；
- 每轮最多一个 Tool Call，不支持并行；
- Sampling / Tool Call / Run deadline 由服务端控制；
- Tool Call 与 Tool Result 按 `callId` 配对；
- Tool Result 始终是低信任数据；
- `PENDING / STREAMING / FAILED / ABORTED` 不进入可靠聊天历史；
- 当前用户输入在模型历史中恰好出现一次；
- Tool failure、Tool timeout、DB timeout、Abort、Run deadline 与 loop limit 有明确语义；
- Message / AgentRun / 已开始 AgentStep 不允许被 late normal-path write 覆盖终态；
- UI Message 不持久化内部 Tool Exchange 或 reasoning；
- 外部 Chat / NDJSON 协议继续保持 `start / delta / done / error / aborted` 五类事件。

## 最终验证证据

PR #32 最终验收基线：head `76f82a42aa52e31d035f3f7987b4465b26d784b9`，merge commit `691efbcd927682d2a435c2bd6125225ae27a18fb`。

```text
Tool Loop           39 / 39
Model Stream        54 / 54
Agent Recorder      14 / 14
Tools               40 / 40
SEO                 10 / 10
DB Reliability      11 / 11

API typecheck        PASS
API lint             PASS
Web typecheck        PASS
workspace typecheck  PASS
git diff --check     PASS
```

真实 PostgreSQL 环境：Docker `postgres:16-alpine`，PostgreSQL 16.14。

11 项数据库验证覆盖：

1. Run `SET LOCAL` 在 commit / rollback 后恢复真实 pooled-session baseline；
2. `pg_sleep` 被 PostgreSQL `statement_timeout` 真正取消，SQLSTATE `57014`；
3. advisory lock wait 被 `lock_timeout` 真正取消，SQLSTATE `55P03`；
4. caller acquisition 等待有界，同时如实记录底层 waiter 可能继续排队；
5. late `BEGIN` 在 Prisma discard 后真实 `ROLLBACK` / release；
6. late acquisition 不进入业务 callback、不产生 probe write、不留 idle transaction；
7. completion commit ownership 后 delayed COMMIT success；
8. delayed COMMIT failure 回滚且无持久化写入；
9. durable COMMIT 后 adapter response-loss 映射为 outcome unknown，普通 PostgreSQL failure 不误判；
10. 普通 transaction COMMIT in-flight 时 caller deadline 保持有界；
11. completion COMMIT 超过内部 outcome 上界时不伪造 rollback，迟到 settlement 被消费。

GitHub 没有对应 Actions CI；以上测试数量来自 Codex 本地与真实 PostgreSQL 验证记录，GPT 已结合最终 PR diff 完成技术验收，用户已明确确认阶段收口与合并。

## 已接受的能力边界

以下不是 Phase 6 缺陷，而是明确后置能力：

- 共享 Pool acquisition waiter 当前不能按每个 Run remaining budget 物理取消；
- transaction bootstrap 中 `pool.connect / BEGIN / 首条 timeout setup` 不宣称拥有 dynamic statement cancellation；
- PostgreSQL `statement_timeout` 不约束 COMMIT；
- transport 断开或 terminalization COMMIT outcome 不确定时，Run 可能暂时保留 `RUNNING`；
- terminalization 本身数据库不可用时，不伪造已经持久化成功。

这些场景若未来需要自动恢复，应单独设计 Durable Recovery / resume / retry，而不是继续扩张 Phase 6。

## 本阶段明确未做

- 并行 Tool Call；
- Planner / Workflow DSL / Graph Runtime；
- RAG、Embedding、向量数据库；
- 长期 Memory / Context compaction；
- 写工具、Permission、Approval、HITL；
- Durable Recovery、跨进程 Resume；
- MCP、Plugin、Skill、Hook；
- Multi-agent；
- 通用 Agent Framework / LangGraph 类抽象。

## 阶段收口

Phase 6 完成后，Agent 主线当前没有自动进入新的正式阶段。

后续必须重新基于最新 `master`、真实学习收益和产品需求选择下一方向；`docs/research/**` 中的 Context、RAG、Recovery、HITL、MCP、Multi-agent 等资料只作为候选研究，不自动成为下一 Task。
