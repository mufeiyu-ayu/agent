# Phase 04 源码阅读：执行策略、持久化筛选与终态收口

## 1. 阅读目标

本文件用三条 Codex 路线回答：一次工具执行如何受策略约束、哪些事件值得持久化、测试如何保护终态。当前云端项目不复制 OS sandbox，但要迁移 orchestration 顺序、错误分类和 durable fact 筛选思想。

## 2. 前置条件

- Phase 03 loop 已跑通。
- 已读本阶段 [README.md](./README.md) 的动态 step 与错误分类。
- 能区分取消请求、超时、执行失败和策略拒绝。

## 3. Codex 阅读路线 A：ToolOrchestrator

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/orchestrator.rs`

定位 `ToolOrchestrator` 和执行主方法。按注释/代码顺序记录：

```text
approval decision
  -> sandbox selection
  -> first attempt
  -> classified failure
  -> optional elevated/retry path
```

学习点：

- policy decision 在执行前发生。
- attempt 有独立 duration/result。
- retry 不是 catch-all，而受错误类型、审批和策略约束。
- result 与 telemetry 在同一 orchestration boundary 汇合。

先核对适用范围：当前快照由 shell、apply_patch、unified exec 等需要 approval/sandbox 的本地 runtime 显式创建 `ToolOrchestrator`；MCP、动态工具等并非全部自动经过它。它不是 `ToolRegistry` 后的全局万能中间件。当前项目若设计统一 `ToolExecutionService`，那是云端迁移选择，不应写成 Codex 所有工具的既成事实。

当前项目翻译：

```text
validate + risk gate
  -> timeout/cancel signal
  -> race(executor attempt, user abort, deadline)
  -> normalize error/result
  -> safe observation + durable summary
```

明确跳过 Codex guardian、OS sandbox 和 permission profile。本阶段也跳过 retry/elevation：Codex 的 retry 是 sandbox/approval 语境中的特定流程，不应直接泛化成任意业务工具自动重试；当前项目把 durable retry 决策留到 Phase 07。

## 4. Codex 阅读路线 B：Cancellation 与并发

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/parallel.rs`

即使当前不做并行，也要观察 ToolCallRuntime 如何携带 cancellation token、如何等待 in-flight calls、如何把 output 返回 sampling。重点记录“一次 run 的 cancellation 必须进入工具”的不变量。

不要迁移 futures 集合或并发调度；只迁移 signal 贯穿和结果 drain 的概念。

## 5. Codex 阅读路线 C：Durable facts

### C1. 持久化策略

文件：`/Users/lihaoran/Desktop/codex/codex-rs/rollout/src/policy.rs`

定位：

- `should_persist_response_item`
- `should_persist_event_msg`

列出被保留和被丢弃的代表项。理解：高频 begin/delta/UI 临时事件不必全部写 rollout；完整 message、tool call/output、关键终态才可恢复/审计。

### C2. Recorder

文件：`/Users/lihaoran/Desktop/codex/codex-rs/rollout/src/recorder.rs`

只读 record/flush/canonical item 相关方法。观察 recorder 与 policy 分离，以及写入失败如何处理。

### C3. Recorder tests

文件：`/Users/lihaoran/Desktop/codex/codex-rs/rollout/src/recorder_tests.rs`

选择三个测试：

- 首个 recordable item 才 materialize。
- canonical items 顺序。
- compacted/tool/message 等代表事实可恢复。

当前项目 PostgreSQL 不需要 JSONL 双写；学习“筛选事实与验证顺序”。

## 6. Codex 阅读路线 D：Output 与 history

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/context_manager/history.rs`

搜索 truncation、tool output、normalize。记录：

- 过大 output 为什么影响 context。
- orphan call/output 如何修复或移除。
- model history 的限制与 durable rollout 的限制不一定相同。

当前项目 Phase 04 应分别设置 model observation 与 AgentStep summary 上限。

## 7. 当前项目阅读路线

### A. Recorder 身份问题

文件：`apps/api/src/agent-runtime/agent-run-recorder.service.ts`

逐个看 `createRunWithInitialSteps`、`startStep`、`completeStep`、`failRun`、`abortRun`，回答：

1. 第二个 `call_llm` step 如何创建？当前没有。
2. 两个相同 type step 如何单独结束？当前 `updateMany` 做不到。
3. failRun 怎样区分具体 attempt？当前只知道 type。
4. completeRun 发现 unfinished 只 warn，是否足以维护不变量？

### B. Schema

文件：`prisma/schema.prisma`

关注 AgentStep：type 是 String，适合扩展；但无 sequence/attempt/callId 结构字段。决定哪些放顶层列、哪些放 JSON。高频查询/唯一性字段应考虑列；仅审计摘要可放 JSON。

### C. Error 现状

文件：`apps/api/src/llm/llm.errors.ts`

现有 LLM error 已区分 auth/rate/network/server。ToolError 不应复用所有 LLM 类，但可以学习 code + safe message + detail/cause 分层。

继续追问：`cause` 最终由哪个 logger 打印？“不回给模型”不代表可原样进日志。当前项目应只记录 allowlist code/class/correlation ids；若保留 message/stack，先限长和脱敏，且测试 logger sink 不含 token、credential、raw args/result。

### D. Runtime terminal

文件：`apps/api/src/agent-runtime/agent-runtime.service.ts`

画出 try/catch/finally 终态路径，检查动态 tool steps 加入后：

- active step 是一个 type 还是 step id？
- catch 怎样 fail 当前 step？
- finally 怎样避免重复终态？
- timeout 怎样不被 `isAbortSignalTriggered(input.signal)` 错判为 user abort？
- executor 忽略 signal、永不 settle 时，谁主动让 outer wait 在 deadline 结束？答案必须是 execution boundary 的 race，而不是 executor 自觉。
- timeout 后 executor 晚到 resolve/reject 时，谁吞吐受控诊断并阻止第二次 terminal transition？

## 8. 云端翻译表

| Codex | 当前项目 |
| --- | --- |
| Approval requirement | Phase 05 risk policy，当前只 low allow |
| Sandbox selection | 当前无不可信代码执行，不迁移 |
| CancellationToken | AbortSignal + timeout signal |
| attempt telemetry | tool step duration/attempt/error code |
| rollout policy | AgentStep safe summary policy |
| rollout canonical items | PostgreSQL Message/Run/Step facts |
| output truncation | model observation + durable summary 双限制 |
| retry/elevation | Phase 04 不迁移；记录 idempotent/attempt，Phase 07 决定 durable retry |

## 9. Red-Green-Refactor 阅读练习

### Red

- 用当前 recorder 模拟 `model_sampling #1/#2`，说明 `updateMany` 的错误。
- 设计一个含 `sk-live-secret` 的 thrown Error，追踪当前会写到哪里。

### Green

- 写动态 step API 状态图。
- 写 tool execution orchestration 六步图。
- 写 durable summary allowlist。

### Refactor

- 将 Codex approval/sandbox 分支删除后，保留最小 orchestration skeleton。
- skeleton 必须主动 race executor/abort/deadline，并隔离 late settlement。
- 不为未来并行提前做 distributed tracing framework。

## 10. 测试矩阵

| 源码结论 | 当前测试 |
| --- | --- |
| attempt 身份预留 | Phase 04 每次 executionAttempt=1；多 attempt 留 Phase 07 |
| cancellation 贯穿 | abort during executor |
| timeout 不信任 executor | ignores signal forever 仍有限结束 |
| late settlement | timeout 后 resolve/reject 不改终态、无 unhandled rejection |
| retry ownership | idempotent/retryable 也只执行一次 |
| durable facts 筛选 | delta/raw stack 不入 DB |
| diagnostics redaction | raw cause secret 不入 logger sink |
| canonical 顺序 | steps sequence 单调且唯一 |
| truncation | 大 output 变 envelope |
| terminal consistency | 所有 run 终态无 unfinished step |

## 11. 验收证据

- [ ] 画出 Codex orchestrator 顺序与当前翻译顺序。
- [ ] 阅读 rollout policy 并列出保留/丢弃代表事实。
- [ ] 完成 recorder 当前限制四问。
- [ ] 写出 dynamic step state diagram。
- [ ] 写出 model observation 与 durable summary 两套限制。
- [ ] 指出 OS sandbox/JSONL rollout/parallel 三项不迁移理由。
- [ ] 形成 timeout/abort/error 对照表。
- [ ] 用调用点证明 ToolOrchestrator 不是所有 Codex tools 的全局必经层。
- [ ] 写出 uncooperative executor 的主动 race 与 late settlement 处理图。

## 12. 非目标

- 不读 sandbox platform implementation。
- 不研究 guardian/approval UI。
- 不复制 rollout JSONL。
- 不做并行执行。
- 不研究所有 telemetry backend。
- 不进入 crash recovery。

## 13. 源码路径速查

### Codex

- `codex-rs/core/src/tools/orchestrator.rs`
- `codex-rs/core/src/tools/parallel.rs`
- `codex-rs/core/src/tools/context.rs`
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`
- `codex-rs/rollout/src/policy.rs`
- `codex-rs/rollout/src/recorder.rs`
- `codex-rs/rollout/src/recorder_tests.rs`
- `codex-rs/core/src/context_manager/history.rs`

### 当前项目

- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/llm/llm.errors.ts`
- `prisma/schema.prisma`
- `packages/contracts/src/agent-run.ts`

## 14. 复盘问题

1. Codex ToolOrchestrator 的哪些步骤在云端 SEO 工具仍成立？
2. rollout policy 为什么不是“所有事件都存”？
3. AgentStep JSON input/output 是不是天然安全？为什么不是？
4. timeout signal 与 run signal 怎样组合又怎样区分来源？
5. sequence 应为数据库列还是 JSON 字段？查询和不变量如何影响选择？
6. completeRun 只 warning unfinished steps 有什么风险？
7. 什么时候工具 retry 会制造重复副作用？
8. Codex ToolOrchestrator 为什么不能被概括为“所有工具统一执行入口”？
9. raw cause 只进日志时为什么仍然必须脱敏？
