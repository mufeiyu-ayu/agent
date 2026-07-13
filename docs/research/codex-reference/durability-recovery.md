# Durability 与 Recovery：持久事实、恢复和幂等边界

## 1. 核心结论

Codex 的持久化设计不是“把每个流式 delta 存下来”，而是围绕可恢复、可审计的关键事实组织：

```text
Thread identity
Turn lifecycle
Response items
Tool call/output pairing
Context / world-state updates
Metadata projection
Flush / shutdown / resume / fork
```

当前项目已经有 PostgreSQL `Message` / `AgentRun` / `AgentStep` 基础，但还没有真正的 replay、resume、crash reconciliation 和 operation receipt。

## 2. Codex 源码事实

关键路径：

- `codex-rs/thread-store/src/store.rs`
- `codex-rs/thread-store/src/types.rs`
- `codex-rs/thread-store/src/live_thread.rs`
- `codex-rs/core/src/session/mod.rs`
- `codex-rs/core/src/session/rollout_reconstruction*`
- `codex-rs/core/src/stream_events_utils.rs`

`ThreadStore` 是 storage-neutral persistence boundary，包含：

- `create_thread`
- `resume_thread`
- `append_items`
- `persist_thread`
- `flush_thread`
- `shutdown_thread`
- `discard_thread`
- `load_history`
- `read_thread`
- `list_threads`
- `list_turns`
- `list_items`
- `archive_thread`
- `delete_thread`

这说明 Codex 把 live runtime 与 durable store 分开。存储可以是 local rollout，也可以通过接口换成其他实现。

## 3. 可迁移设计

### 3.1 持久化服务于恢复和审计，不服务于复制传输过程

流式 delta 是传输事件，不是主要持久事实。当前项目应优先持久化：

- Run started / terminal。
- user input。
- final assistant answer。
- tool requested call。
- tool produced output / error / abort。
- approval requested / decided。
- operation receipt。

不要为了“看起来完整”把每个 token delta 入库。

### 3.2 call 和 output 是两个事实

crash window 必须显式承认：

```text
call persisted
  -> process crashes before tool execution
  -> 可以恢复为未执行或失败 observation

external side effect committed
  -> process crashes before output persisted
  -> ambiguous commit，需要 operation receipt / reconciliation
```

只读工具可以简单处理；写工具必须有 operation identity 和幂等策略。

### 3.3 flush 是边界，不是装饰

Codex 区分 append、persist、flush、shutdown、discard。当前项目的数据库事务也要明确：

- 哪些状态必须和 Message 一起提交。
- 哪些 Step 可以稍后补充。
- 连接断开时 Run 应该 ABORTED、FAILED，还是继续后台执行。
- 服务重启后如何处理 RUNNING。

### 3.4 resume / fork 是高阶能力，近期只学思想

当前项目暂时不需要完整 Thread fork，但需要理解其核心思想：

- resume：从 durable history 恢复同一工作线。
- fork：复制历史前缀，形成新工作线。
- rollback：回到某个历史点，不能让副作用假装回滚。

对 AI SEO Agent，近期只需要：

- stale RUNNING sweep。
- Run terminal reconciliation。
- tool execution id / receipt。
- idempotency key。

## 4. 当前项目近期最小方案

### Phase 04：Tool durable facts

建议新增或扩展记录：

```ts
type ToolExecutionRecord = {
  executionId: string
  runId: string
  stepId?: string
  callId: string
  samplingAttemptId: string
  toolName: string
  toolVersion: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'aborted'
  inputSummary?: unknown
  outputSummary?: unknown
  errorCode?: string
  startedAt?: Date
  endedAt?: Date
}
```

先不必单独建表；可以先映射到 AgentStep 的 input/output JSON。但类型语义要清楚。

### Phase 07：Recovery policy

最小策略：

- 服务启动时扫描 오래 RUNNING 的 AgentRun。
- 没有后台 worker 的 Run 标为 FAILED 或 ABORTED，并记录 recovery reason。
- 如果 tool execution 有 committed receipt，则不能盲重试。
- 如果只有 call 无 output，生成失败/aborted observation 或要求用户重新运行。

### 写工具前：Operation identity

任何外部副作用工具都需要：

```ts
operationId
idempotencyKey
owner scope
payloadHash
attempt
receipt
status
```

否则 crash 后无法区分：

- 没执行。
- 执行了但 response 丢了。
- 执行失败。
- 重试会重复副作用。

## 5. 必测用例

| 场景 | 关键断言 |
| --- | --- |
| Run started 后 provider 抛错 | Run / Message / Step 全部 terminal FAILED |
| Abort 后 provider late final | 不能覆盖 ABORTED |
| tool call 后 executor 抛错 | 有失败 observation 或失败 record |
| tool 执行中 abort | terminal exactly once |
| stale RUNNING | sweeper 收口且记录 reason |
| same idempotency key same payload | 返回原 receipt |
| same idempotency key different payload | conflict，不执行 |
| external committed then timeout | 进入 Unknown / reconcile，不生成新 key 盲重试 |

## 6. 暂时不做

- 不做完整 rollout JSONL。
- 不做 Thread fork。
- 不做多 DB state runtime。
- 不做后台 worker lease，除非引入真正异步长任务。
- 不做通用 Saga 框架。
