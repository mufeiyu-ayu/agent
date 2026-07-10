# Phase 07 练习与验收：在每个 checkpoint 杀死进程

## 1. 核心命题

> 任意 checkpoint 前后发生进程崩溃，重建 service/runtime 后，系统都能从数据库选择唯一安全动作；不会重复创建 Run，不会重复执行受保护副作用，也不会留下无法解释的永久 RUNNING。

本阶段的主要测试不是 mock 某个 Prisma 方法“被调用”，而是通过真实测试数据库、故障注入和新 service 实例验证 durable state。

## 2. 测试设施

准备：

- 临时/隔离 PostgreSQL schema。
- `CrashInjector`：在命名 checkpoint 抛出不可恢复测试异常。
- fake provider：按 attempt ID 记录请求和固定响应。
- fake tools：PURE、REQUIRES_IDEMPOTENCY_KEY、NON_RETRYABLE 各一个。
- fake external system：支持 idempotency key 查询和执行计数。
- fake clock：推进 heartbeat/lease/expiry。
- `createRuntime()`：每次返回全新的 service graph，模拟进程重启。
- barrier：并发释放两个 recovery worker。

CrashInjector 只进入测试 adapter/port，不要把 `if (process.env.TEST...)` 散进业务代码。

## 3. TDD Cycle A：请求幂等

### Red

同一 `conversationId + clientRequestId + payload` 并发/顺序调用两次，当前项目会创建两条 user Message 和两个 Run。先写断言失败：

- 返回相同 runId/userMessageId。
- 数据库计数均为 1。
- payload fingerprint 一致。
- 同 key 不同 message/model 返回稳定冲突。

### Green

- shared contract/DTO 增加 clientRequestId。
- 使用唯一约束和事务 create-or-load。
- 冲突后重新查询 canonical Run，不能只捕获所有 Prisma 错误。
- fingerprint 使用稳定 canonical serialization，只包含影响执行语义的字段。

### Refactor

- 将 create-or-load 收到 application/store 边界。
- 不创建通用 idempotency framework；先服务这一个 command。

## 4. TDD Cycle B：RecoveryPlanner 纯状态机

### Red

为 README 中每个 checkpoint 建 snapshot fixture，要求返回唯一 action：

- RUN_CREATED -> start sampling。
- MODEL_ITEM ToolCall + no approval -> evaluate/create approval。
- APPROVED + no execution -> execute tool。
- result recorded + no observation -> project observation。
- final Message + nonterminal Run -> finalize。
- terminal Run -> no-op。
- execution UNKNOWN + NON_RETRYABLE -> enter durable MANUAL_REVIEW，创建可查询 ReviewCase。
- 矛盾状态（COMPLETED Run + RUNNING step）-> diagnose/repair policy，不继续副作用。

### Green

- 实现纯 `plan(snapshot, now)`。
- 输出 stable reason code 和需要的 fact IDs。
- 默认 fail closed。

### Refactor

- 用表驱动 transition 替代长 switch，只在可读性更好时做。
- planner 不访问 Prisma、不调用 tool、不发 event。

## 5. TDD Cycle C：Tool execution key

### Red

使用 fake external system：

1. 第一次执行在外部成功后、结果落库前 crash。
2. 重启恢复。
3. 同 execution key 重试/查询后，外部执行次数仍为 1。
4. result 最终被记录并投影 observation。

为 NON_RETRYABLE 工具建立相同 crash，期望不自动重做，而是 `Run.status=MANUAL_REVIEW` 且存在 PENDING ReviewCase；查询投影能返回 case/reason，任何 fresh runtime/reconciler 都不得自动推进它。验收不能停在 `requiresManualReview=true` 这种 FAILED 行上的 boolean。

### Green

- 在调用外部前持久化 ToolExecution attempt + key。
- 支持 key 的 adapter 将 key 传给外部系统。
- 恢复先 query-by-key 或以相同 key 重试。
- 不支持查询/幂等的工具 fail closed。

### Refactor

- 抽 `ToolExecutionGateway` 只在第二个外部 tool 需要同样协议时进行。
- retry policy 和 executor 分开，避免每个 handler 自己循环。

## 6. TDD Cycle D：Lease 与并发恢复

### Red

两个 fresh runtime 同时扫描同一 stale Run：

- 只有一个 acquire lease 成功。
- 只有一个执行下一 transition。
- lease 未过期时第二个 no-op。
- lease 过期后新 worker 可接管。
- 旧 worker 使用旧 version 再写被拒绝。

### Green

- 条件 update acquire lease。
- 状态迁移验证 owner/version。
- heartbeat 延长 lease；terminal 时释放或忽略。

### Refactor

- 统一 lease 条件，但不引入 Redis lock。
- DB 是当前唯一协调事实源。

## 7. TDD Cycle E：Stale reconciler

### Red

- stale RUNNING 被发现。
- 新鲜 RUNNING 不处理。
- WAITING_APPROVAL 未过期不视为 stale failure。
- MANUAL_REVIEW/PENDING ReviewCase 不视为 stale failure，也不自动重试。
- expired approval 进入对应恢复动作。
- terminal Run 不处理。
- dry-run 不修改数据，只报告 action。

### Green

- query candidates -> acquire lease -> snapshot -> plan -> execute one transition。
- 每次 attempt 记录 `recoveryAttemptId/reason/from/to`。
- 单次批量有上限。

### Refactor

- 先提供 CLI/service method；没有运维需求不急着加 cron/queue。
- 复用相同 runner transition，而不是 reconciler 自己实现业务。

## 8. TDD Cycle F：Persisted cancellation

### Red

1. 写入 `cancelRequestedAt` 后进程立即 crash。
2. 新 runtime 读取 snapshot，不再开始新 sampling/tool。
3. 可取消 in-flight adapter 收到 AbortSignal。
4. 不可取消 side effect 已开始时不虚假标记“未执行”。
5. cancel 在外部已接受副作用、Result 尚未落库时：可查询的外部系统补写真实 Result；不可查询时进入 MANUAL_REVIEW，不能直接 ABORTED。

### Green

- cancel command 幂等写事实。
- runner 在 transition 边界检查。
- execution adapter 把 signal 作为优化；canonical cancel fact 决定恢复行为。
- 把 `CANCEL_REQUESTED_AFTER_SIDE_EFFECT` 与普通 pre-start cancel 分开；前者必须保留 execution receipt/未知证据。

### Refactor

- 将 cancellation check 收口在 runner，不散进每个 service。

## 9. Crash simulation 矩阵

| 编号 | 注入点 | 初次进程留下的事实 | 重启后的唯一动作 | 关键断言 |
| --- | --- | --- | --- | --- |
| X07-01 | create command 前 | 无 | 接受同 key 创建 | Message/Run=1 |
| X07-02 | Message/Run 事务后 | RUN_CREATED | start sampling | 不重复 Message |
| X07-03 | sampling attempt 前 | RUN_CREATED | start sampling | attempt=1 |
| X07-04 | provider 请求后、item 前 | attempt RUNNING | 新 attempt/按策略 | 状态可解释 |
| X07-05 | ToolCall 写入后 | call exists | policy/approval | 不丢 call |
| X07-06 | approval PENDING 后 | waiting facts | wait | tool=0 |
| X07-07 | approval decision 事务提交前 crash | 仍 PENDING | 重试同 decisionId | tool=0；无半个 APPROVED |
| X07-08 | APPROVED 提交后、execution claim 前 | approval only | create/acquire one execution | 不把授权误当执行；execution=1 |
| X07-09 | execution attempt 写入后、外部前 | started | 按 safety 重试 | key 相同 |
| X07-10 | 外部成功后、result 前 | external success | query/retry same key | external count=1 |
| X07-11 | result 后、observation 前 | result exists | project observation | tool 不重做 |
| X07-12 | observation 后、sampling 前 | pair exists | next sampling | pair 合法 |
| X07-13 | final Message 后、Run terminal 前 | message exists | finalize | 不再模型调用 |
| X07-14 | Run terminal 后、response 前 | terminal | no-op/query | 返回旧结果 |
| X07-15 | cancel fact 后、副作用尚未开始 | cancelRequested | abort transition | 不开始工具 |
| X07-16 | 外部已成功、result 前收到 cancel | cancel + execution receipt/可查询结果 | 补真实 result/observation，再按稳定 reason 收口 | 不虚假“未执行”；external count=1 |
| X07-17 | 外部结果未知且不可查询时收到 cancel | cancel + UNKNOWN NON_RETRYABLE | enter MANUAL_REVIEW | 不自动重试；ReviewCase=PENDING |

每个 case 必须销毁第一个 runtime 实例，再从数据库创建第二个；在同一对象里 catch 后继续不算 crash recovery。

## 10. 请求幂等测试矩阵

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| D07-01 | 相同 key/相同 payload 顺序重放 | 同 Run |
| D07-02 | 相同 key/相同 payload 并发 | 同 Run，唯一约束生效 |
| D07-03 | 相同 key/不同 message | conflict |
| D07-04 | 相同 key/不同 model/config | 按 fingerprint 定义 conflict |
| D07-05 | key 空/非法 | DTO validation |
| D07-06 | 不同 conversation 相同 key | 独立（若 scope 为 conversation） |
| D07-07 | 首次响应丢失后重试 | 返回 canonical current state |

## 11. Lease/Recovery 测试矩阵

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| L07-01 | 无 lease | worker A 获取 |
| L07-02 | A lease 未过期 | B 失败/no-op |
| L07-03 | A lease 过期 | B 获取，version 增长 |
| L07-04 | A 旧 version 写 | 拒绝 |
| L07-05 | heartbeat | 只允许 owner 延长 |
| L07-06 | terminal Run | 不获取 lease |
| L07-07 | 两 worker barrier | transition side effect 一次 |
| L07-08 | dry-run | 0 数据变更 |

## 12. 状态一致性不变量

用数据库断言或参数化测试证明：

- COMPLETED Run 必须有 `endedAt` 和 final assistant Message。
- RUNNING/WAITING_APPROVAL/MANUAL_REVIEW Run 不得有 terminal `endedAt`。
- ToolResult 必须关联 ToolCall/Execution。
- Observation 必须关联 ToolResult 与 callId。
- APPROVED approval 对应的 ToolCall 不能被另一 approval 重复授权。
- `TOOL_RESULT_RECORDED` 后 recovery 不返回 execute_tool。
- terminal Run 后任何 resume/retry 都返回 no-op/query。
- manual-review Run 不自动执行副作用。
- PENDING ReviewCase 的 Run query 返回稳定 manualReview projection，scanner/fresh runtime 均 no-op。
- 所有 worker 写入验证 lease/version。

## 13. 故障分类与稳定 reason code

至少覆盖：

```text
PROCESS_INTERRUPTED
STALE_RUN_RECOVERED
IDEMPOTENCY_KEY_REUSED
LEASE_CONFLICT
RECOVERY_STATE_INCONSISTENT
TOOL_EXECUTION_OUTCOME_UNKNOWN
TOOL_NOT_RETRY_SAFE
OBSERVATION_PERSIST_FAILED
CANCEL_REQUESTED
CANCEL_REQUESTED_AFTER_SIDE_EFFECT
MANUAL_REVIEW_REQUIRED
```

用户文案与内部诊断分开；不要把数据库/外部系统 secret 放进 `AgentStep.errorMessage`。

## 14. 运行演练

### 演练 A：请求响应丢失

1. 发送带固定 clientRequestId 的消息。
2. 在服务端已创建 Run 后主动断开客户端。
3. 用相同 key 重试。
4. 查询数据库，证明只有一个 user Message/Run。

### 演练 B：副作用后崩溃

1. fake external system 接受 execution key 并记录成功。
2. 在 ToolResult 写库前 crash。
3. 新进程运行 recovery。
4. 证明外部 count=1，result/observation 被补全。

### 演练 C：stale sweep

1. 创建多个新鲜、stale、waiting、terminal Run。
2. 先 dry-run 输出计划。
3. 实际处理。
4. 对比每个 Run 的 action 与终态。

### 演练 D：取消晚于副作用

1. fake external system 已用 execution key 接受写入，但阻塞本地 Result 落库。
2. 写入 cancel fact，销毁第一 runtime。
3. 可查询 adapter 场景：第二 runtime query-by-key，补写 Result/Observation，证明外部 count=1 且最终投影明确提示 cancel 到达过晚。
4. NON_RETRYABLE/不可查询场景：第二 runtime 创建/复用 PENDING ReviewCase，Run=MANUAL_REVIEW，连续两次 reconciler 都不再次调用外部系统。

## 15. 验收证据模板

```md
### Requirement：外部成功、Result 未写时恢复不重复副作用

- Crash point：AFTER_EXTERNAL_SUCCESS_BEFORE_RESULT
- Run/toolCall/execution：...
- External idempotency key：...
- Before restart：external count=1, result rows=0
- Recovery action：query_or_retry_same_key
- After restart：external count=1, result rows=1, observation rows=1
- Test：`...crash-recovery.spec.ts / ...`
- Result：PASS
- Remaining risk：真实 provider 的 idempotency 保留时长待验证
```

## 16. 阶段验收清单

### Canonical facts

- [ ] 每个 checkpoint 的事实与下一动作已登记。
- [ ] 高频 delta 未被误当恢复事实。
- [ ] Context 可由 facts 重建。
- [ ] 大 output 有引用/截断策略。

### 幂等

- [ ] request key + fingerprint 有唯一约束和冲突语义。
- [ ] tool execution key 独立于 request key。
- [ ] side effect retry safety 明确。
- [ ] NON_RETRYABLE fail closed。

### Recovery

- [ ] RecoveryPlanner 纯函数覆盖 crash matrix。
- [ ] stale scanner 区分 waiting 与僵尸 running。
- [ ] lease/version 防双 worker。
- [ ] persisted cancel 可跨进程观察。
- [ ] manual review 状态可查询。
- [ ] manual review 有 durable case、脱敏投影、active policy 与显式 resolution；不是 FAILED+boolean。

### 测试

- [ ] 每个 crash case 使用 fresh runtime。
- [ ] approval decision 后 crash 与 cancel-after-side-effect 均使用 fresh runtime 验证。
- [ ] 并发测试使用 barrier/真实唯一约束。
- [ ] Prisma transaction tests 通过。
- [ ] typecheck/lint/diff-check 通过。
- [ ] 没有仅靠 mock 调用次数宣称 durable。

## 17. Teach-back 复盘

1. “exactly once”为什么通常不是合适承诺？
2. clientRequestId 和 toolExecutionKey 分别解决哪种重复？
3. checkpoint 与 heartbeat 有什么不同？
4. 为什么 result 已写后只补 observation？
5. 外部成功但结果未知时，PURE、带 idempotency key、NON_RETRYABLE 三类如何处理？
6. stale RUNNING 为什么不能一律改 FAILED？
7. DB lease 与 Redis lock 相比，当前为什么先选前者？
8. 当前最危险的 crash window 是哪一个，测试证据是什么？
9. 队列为何不会自动解决重复执行？
10. 哪个 case 能证明恢复是“从事实重建”而非 catch 后继续？

## 18. 阶段完成记录

```md
### 我现在能解释
- ...

### 我仍不确定
- ...

### 最危险 crash window 与防线
- ...

### 当前项目没有照搬 Codex 的部分
- PostgreSQL 替代 rollout JSONL：...
- 未引入 workflow engine：...

### Phase 08 前置
- [ ] Run 可查询 canonical projection
- [ ] active execution 有 lease/version
- [ ] cancel 有 persisted fact
- [ ] 同 request 可安全重放
```
