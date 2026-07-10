# Phase 04：工具可靠性与运行记录

## 1. 阶段问题

Phase 03 证明了最小 Agent loop，但“跑通一次”不等于可靠：工具可能超时、被用户中止、返回超大结果、抛出敏感异常；同一 Run 也可能有多次 sampling 和多次同类型 step，而当前 recorder 在 run 创建时只预建一组固定步骤，并按 `runId + type` 批量更新。

本阶段解决：**如何让每次 sampling 和 tool execution 都有可审计、可收口、受预算约束的记录，同时不把秘密、巨量 payload 或模型内部思维当作 durable facts？**

它也是现有项目“阶段 5：最小 Tool Calling”的可靠性收口。

## 2. 学习目标

1. 为多轮 loop 设计动态、ID 驱动的 AgentStep 生命周期。
2. 区分 user abort、tool timeout、validation failure、unknown tool、execution failure 和 budget exhaustion。
3. 让同一个 cancellation signal 贯穿 run、sampling 和 tool，但保留 timeout 的独立原因。
4. 对 tool input/output 做脱敏、截断和大小限制。
5. 用 sampling/tool budgets 保证运行必然终止。
6. 明确 retry 所有权：本阶段不自动重试工具，保留 idempotency/attempt 证据供 Phase 07 durable execution 使用。
7. 用数据库记录回答“第几轮、哪个 call、执行多久、为何失败”，但不存 chain-of-thought。
8. 用自动化测试证明任何终态下都没有 PENDING/RUNNING step。

## 3. 前置条件

- Phase 03 黄金路径、错误路径和 abort 路径通过。
- Tool contract 已声明 sideEffect/network/risk metadata。
- 能解释 `Message`（用户可见）与 `AgentStep`（系统执行事实）的差异。
- 理解 AbortSignal、deadline、retryable 与 idempotent。
- 本阶段仍只开放低风险、无副作用工具。

## 4. 当前 recorder 的结构性限制

`AgentRunRecorderService.createRunWithInitialSteps()` 当前预创建：

- `receive_user_message`
- `load_conversation_history`
- `call_llm`
- `stream_assistant_reply`

`startStep/completeStep` 通过 `runId + type + status` 做 `updateMany`。Tool loop 后会出现：

```text
model_sampling #1
tool_execution #1
observation_append #1
model_sampling #2
assistant_output #1
```

同 type 可能重复，因此“type 充当 step identity”不再成立。继续使用 `updateMany` 会出现第二轮找不到 PENDING step、多个 step 被一起更新、错误归因到错误轮次等问题。

## 5. 设计

### 5.1 动态 Step API

建议 recorder 改为按执行发生创建，并返回 step id：

```ts
const step = await recorder.startStep({
  runId,
  type: 'model_sampling',
  sequence,
  input: safeInput,
})

await recorder.completeStep(step.id, { output: safeOutput })
await recorder.failStep(step.id, toolError)
await recorder.abortStep(step.id, reason)
```

Run terminal 收口时，再用事务把所有遗留非终态 step 统一置为相同终态或 `SKIPPED`（若 schema 引入）。第一版可继续用现有状态集合，但必须明确未执行 step 不再预创建，因此无需 PENDING 占位。

### 5.2 Step 顺序与关联

推荐为 `AgentStep` 增加 `sequence Int`，由同一 run 内单调递增，并建立 `(runId, sequence)` 唯一约束。若暂不改 schema，至少返回 step id 并以 `createdAt,id` 排序；但并发/同毫秒下证据较弱。

工具 step 的安全输入建议：

```json
{
  "samplingIndex": 1,
  "callId": "call-url-1",
  "samplingAttemptId": "sampling-1",
  "toolName": "analyze_url_structure",
  "toolVersion": "1",
  "executionAttempt": 1,
  "argumentsSummary": { "urlHost": "example.com" }
}
```

输出建议：

```json
{
  "ok": true,
  "durationMs": 4,
  "outputChars": 182,
  "truncated": false,
  "resultSummary": { "hostname": "example.com", "pathDepth": 2 }
}
```

不默认保存完整 prompt、完整历史、完整 tool output、Error stack 或 secret-bearing URL query values。

### 5.3 Step 粒度

最小可审计集合：

| Step type | 一次发生 | 保存什么 |
| --- | --- | --- |
| `receive_user_message` | 每 run 1 次 | messageId/length |
| `load_conversation_history` | 每 run 1 次 | limit/count |
| `model_sampling` | 每 sampling 1 次 | index/model/toolCount/usage/finish reason |
| `tool_execution` | 每 call 1 次 | callId/name/safe args/result/error/duration |
| `assistant_output` | 最终 1 次 | messageId/contentLength |

`observation_append` 通常可以作为 tool_execution output 的事实，不必单独一条 step；只有恢复或调试确实需要区分时再拆。不要把每个 token delta 写 AgentStep。

### 5.4 错误分类

```ts
type ToolErrorCode
  = 'unknown_tool'
    | 'invalid_arguments'
    | 'aborted'
    | 'timeout'
    | 'execution_failed'
    | 'output_too_large'
    | 'budget_exceeded'
```

错误至少包含：`code`、safe message、retryable；raw cause 不进入 model/DB，若用于 server diagnostics 也必须先限长、脱敏并按 allowlist 记录。建议策略：

| Error | 可给模型 observation | Run 默认终态 | 自动重试 |
| --- | --- | --- | --- |
| unknown_tool | 是 | 可继续一次 | 否 |
| invalid_arguments | 是 | 可继续一次 | 否 |
| timeout | 是/按策略 | FAILED 或模型降级 | Phase 04 不重试 |
| aborted | 否 | ABORTED | 否 |
| execution_failed | 安全摘要 | FAILED/模型降级 | Phase 04 不重试 |
| output_too_large | 截断/摘要 | 可继续 | 否 |
| budget_exceeded | 否 | FAILED | 否 |

### 5.5 Timeout 与 cancellation

项目 Node 版本支持原生 AbortSignal 组合时，优先使用平台能力：

```text
run signal -----------+
                      +--> execution signal
tool timeout signal --+
```

要求：

1. 用户 run signal 触发 -> `aborted`，Run=ABORTED。
2. deadline signal 触发 -> `timeout`，不得误报用户主动停止。
3. executor 必须接收 signal，但 orchestration 不能假设 executor 会遵守；只触发 signal 后继续 `await executor` 不是 timeout。
4. timer/监听器必须清理，测试不能留下 open handle。
5. tool 完成与 timeout 同时发生时，终态通过一次性 state transition 决定，不可既 complete 又 fail。

执行边界必须主动 race，而不是被动等 executor：

```ts
const execution = Promise.resolve().then(() => executor.execute(invocation, context))
const terminal = Promise.race([
  execution,
  rejectOnSignal(runSignal, 'aborted'),
  rejectOnSignal(timeoutSignal, 'timeout'),
])
```

真实实现还要：

- 在 race 之前给 `execution` 挂 late rejection handler，避免超时返回后出现 unhandled rejection。
- outer state 一旦被 abort/timeout 赢得，晚到 resolve/reject 只能形成受控的安全诊断，不能再次 complete/fail step，也不能触发下一轮 sampling。
- 对不观察 signal、永不 settle 的 executor，outer promise 仍必须在 deadline 内结束。
- 记录“local wait ended / underlying operation may still be running”，尤其是外部 HTTP/队列不支持取消时。
- timeout 与 user abort 同时接近时，用明确优先级和 compare-and-set/条件更新确保唯一终态。

### 5.6 Budget

建议显式 `AgentLoopBudget`：

- `maxSamplingRounds`。
- `maxToolCalls`。
- `maxRunDurationMs`。
- `maxToolDurationMs`。
- `maxToolResultChars` 或 bytes。
- 可选 token budget（Phase 06 深化）。

budget 来源于 server config，不从模型 arguments 接收。每轮开始前检查；工具完成后再次检查总时长。

### 5.7 Output 限制与脱敏

三种不同对象：

1. raw executor result：短暂内存对象。
2. model observation：限制长度、结构化、移除 secret。
3. durable step summary：更小，只保留审计字段。

建议先 serialize 后按 UTF-8 bytes/字符明确限制；截断时添加 deterministic marker 和原始长度。不能直接 `string.slice()` 后声称仍是合法 JSON；可使用 envelope：

```json
{
  "truncated": true,
  "originalChars": 120000,
  "preview": "..."
}
```

### 5.8 Retry 所有权与延后

Phase 04 **不实现自动 tool retry**。原因是单进程 `catch -> 再执行` 无法处理“工具其实成功、只是 response/observation/进程在确认前失败”的不确定状态，写工具会因此重复副作用。

本阶段只做：

- `ToolDefinition.idempotent` 是 server-owned 声明。
- 每条 tool step 记录 `executionAttempt=1`、samplingAttemptId、toolVersion。
- provider adapter/SDK retry 与 tool execution retry 分开；当前 SDK `maxRetries=0` 的事实继续保留，不能把 sampling loop 当 HTTP retry。
- Phase 07 在 checkpoint、idempotency key、outcome reconciliation 与 crash recovery 都明确后，才决定是否创建新的 attempt。

当前纯 `analyze_url_structure` 不需要 retry；不要为了“看起来可靠”增加一次毫无恢复语义的重复调用。

### 5.9 日志与 cause 也必须脱敏

`cause` 只供 server diagnostics 不代表可以原样记录。统一规则：

- model observation、AgentStep、用户 error 只使用 allowlist safe fields。
- structured log 记录 error class/stable code/correlation ids；原始 message/stack 先做长度限制和 secret redaction，必要时完全不记录。
- 不把整个 Error、raw arguments、raw result 作为 logger metadata 展开。
- 测试捕获 logger sink，断言 bearer token、API key、URL credential/query secret 同时不出现在 DB、observation 和日志。

## 6. 任务拆分

### Task 04.1：动态 recorder

- create/start/complete/fail/abort by step id。
- sequence/attempt metadata。
- run terminal 事务收口遗留 steps。
- 迁移现有固定 step tests。

### Task 04.2：ToolExecutionService/边界

- timeout/cancellation 组合。
- 主动 race 不配合取消的 executor，并隔离 late settlement。
- error taxonomy。
- safe result normalization。
- duration/size 统计。

### Task 04.3：Loop budget

- sampling/tool/time/output 上限。
- budget exceeded 明确错误。
- 不允许配置由模型覆盖。

### Task 04.4：持久化与阶段 5 收口

- 每 sampling/tool execution 动态 step。
- terminal path 无非终态残留。
- 更新真实任务 checklist 与证据（执行时，不在研究文档伪造完成）。

## 7. Red-Green-Refactor

### Red

1. 两次 sampling 创建同 type steps，现有 `updateMany` 无法区分。
2. 工具永不 resolve，run 永不结束。
3. 工具返回 1MB 字符串，全部进入 prompt/DB。
4. executor throw 含 secret，错误被原样持久化。

### Green

1. 按 step id 动态记录。
2. timeout/abort 主动 race，executor 即使不处理 signal 也有限结束。
3. result normalization + truncation + redaction。
4. run terminal transaction 收口。

### Refactor

1. 将 ToolExecutionService 与 Agent loop 分离，前者只管一次调用。
2. 共享 terminal transition helper，避免 complete/fail/abort 重复条件。
3. 不引入通用 workflow/event-sourcing 框架。

## 8. 测试矩阵

| 类别 | Case | 关键断言 |
| --- | --- | --- |
| step | 2 samplings | 两条不同 id/sequence 的 model_sampling |
| step | 1 tool | callId/name/duration/safe summary |
| step | complete race | 只能一个终态 |
| step | run fails | 无 PENDING/RUNNING |
| timeout | tool hangs | timeout code，有限结束 |
| timeout | executor ignores signal forever | outer wait 有限结束，晚任务不能改终态 |
| abort | user abort before timeout | ABORTED，不是 timeout |
| race | completion near deadline | 单一确定终态 |
| race | late resolve/reject after timeout | 无重复 transition/next sampling/unhandled rejection |
| error | secret in throw | DB/model observation 无 secret |
| log | raw cause contains secret | DB/model/log sink 均无 secret |
| output | oversized | envelope + truncated=true |
| output | unicode boundary | 不产生非法字符/破损 JSON |
| budget | tool call limit | 不执行超限 call |
| budget | sampling limit | 不发起超限 sampling |
| retry ownership | any failure | executionAttempt 始终 1，不发生自动重试；决策留 Phase 07 |

## 9. 验收证据

- [ ] 同一 Run 可记录两条独立 `model_sampling` steps。
- [ ] tool step 按 step id 转换，不再以 type 当 identity。
- [ ] happy path steps 顺序可重建。
- [ ] timeout 与 user abort 测试终态不同。
- [ ] executor 完全忽略 AbortSignal/永不 settle 时，outer execution 仍按 deadline 收口。
- [ ] late resolve/reject 不改变 terminal state、不发下一轮、不产生 unhandled rejection。
- [ ] tool/run budget 每一项有边界测试。
- [ ] oversized output 与 Unicode 测试。
- [ ] secret redaction 测试。
- [ ] Phase 04 no-retry ownership test：任意工具错误执行次数均为 1，attempt metadata 完整。
- [ ] logger capture 证明 raw cause/stack/arguments/result 的秘密不泄漏。
- [ ] 所有 completed/failed/aborted case 均无非终态 step。
- [ ] tool JSON 不写 Message，durable step 只存 safe summary。
- [ ] 阶段 5 Tool Calling 真实验收链路记录。
- [ ] Prisma generate/validate（若 schema 变更）、test/typecheck/lint/diff-check 结果。

## 10. 非目标

- 不做用户审批资源；Phase 05。
- 不做 OS sandbox。
- 不做多租户 RBAC/配额；Phase 10。
- 不做并行 tool calls。
- 不做跨进程 crash resume；Phase 07。
- 不把每个 delta 落库。
- 不存模型 chain-of-thought。
- 不做前端 step timeline。

## 11. 源码路径

### 当前项目

- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `prisma/schema.prisma`
- `packages/contracts/src/agent-run.ts`
- `apps/api/src/llm/llm.errors.ts`
- `docs/tasks/phase-05-tool-calling/README.md`

### Codex

- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/orchestrator.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/parallel.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/context.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/tool_dispatch_trace.rs`
- `/Users/ayu/Desktop/codex/codex-rs/rollout/src/policy.rs`
- `/Users/ayu/Desktop/codex/codex-rs/rollout/src/recorder.rs`
- `/Users/ayu/Desktop/codex/codex-rs/rollout/src/recorder_tests.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/context_manager/history.rs`

## 12. 复盘问题

1. 为什么 `type` 不能继续充当 AgentStep identity？
2. 哪些 tool 数据是 durable fact，哪些只应短暂存在？
3. user abort 与 timeout 都用 AbortSignal，怎样保留不同语义？
4. truncation 为什么要用 envelope，而不是直接切 JSON 字符串？
5. provider transport retry、Agent sampling follow-up 与 tool execution retry 分别由哪一层拥有？
6. 为什么本阶段即使工具声明 idempotent 也不自动 retry？Phase 07 还需增加哪些 durable facts？
7. 哪条测试最能证明 run/step 状态机不会留下僵尸状态？
8. 这一阶段从 Codex 学了什么，又刻意没有复制什么？
9. 为什么触发 AbortSignal 后继续 await 一个不配合的 executor 不构成 timeout？
