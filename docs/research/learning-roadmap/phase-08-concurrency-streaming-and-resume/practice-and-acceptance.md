# Phase 08 练习与验收：断开网络，但不要丢掉 Run

## 1. 核心命题

> 客户端连接可以任意断开和重建；Run 只受 durable commands、lease 和状态机驱动。重复发送、双标签页、慢消费者和多实例竞态不会创造第二条非法执行链。

先完成 Level 1 canonical reconciliation，再决定是否做 Level 2 event replay。不得用“WebSocket 看起来不断线”替代可靠性测试。

## 2. TDD Cycle A：一会话一个 active Run

### Red

用两个并发请求（不同 clientRequestId）同时向同一 Conversation 发送：

- 当前可能创建两个 RUNNING Run。
- 目标断言：一个成功，一个 `RUN_ALREADY_ACTIVE`；数据库 active count=1。
- 同 clientRequestId 并发则两个响应都指向同一 Run。
- 不同 Conversation 可各自运行。

### Green

- 选定 partial unique index、Conversation.activeRunId CAS 或等价数据库约束。
- 映射唯一冲突为稳定业务错误。
- terminal transition 释放 active relation。

### Refactor

- 将 active policy 集中到 command service/store。
- 不在 Controller 用 `findFirst` + `if` 作为唯一保护。

## 3. TDD Cycle B：Run query projection

### Red

为 RUNNING、WAITING_APPROVAL、MANUAL_REVIEW、COMPLETED、FAILED、ABORTED snapshot 写 contract tests，当前项目没有完整 endpoint/字段时应失败。

要求返回：

- runId/conversationId/status/checkpoint。
- final assistant Message（存在时）。
- active approval summary（存在时）。
- stable error code/message。
- cancelRequestedAt。
- lastEventSequence（**仅**启用 Level 2 transactional outbox/replay 时；Level 1 schema 省略或明确 capability=false）。
- manualReview 脱敏 view（caseId/reasonCode/status/createdAt），不能只返回 `requiresManualReview=true`。

### Green

- 建立只读 projection service/controller。
- server-side scope 过滤。
- 从 canonical facts 组合，不能依赖 live executor。

### Refactor

- 避免返回完整 Step input/output 和 secret。
- 列表/详情视图按真实查询需要拆分。

## 4. TDD Cycle C：断流不取消

### Red

1. 启动一个可控 pending fake model Run。
2. 客户端关闭 stream。
3. 断言当前实现会 abort；目标要求 Run 仍 active。
4. 释放 fake model，Run 最终 COMPLETED。
5. 查询 final Message 成功。

### Green

- response close 只关闭 subscriber。
- executor 由 command/runner 生命周期拥有。
- terminal facts 先持久化再发布。
- 若进程 crash，Phase 07 recovery 接管。

### Refactor

- 将 event sink 从直接 response write 抽成可替换 subscriber port。
- 保留 bounded buffer，不建立无界 EventEmitter listener。

## 5. TDD Cycle D：显式 cancel

### Red

- 关闭 fetch 不取消。
- `POST cancel` 才写 `cancelRequestedAt`。
- 相同 cancel 重放幂等。
- terminal Run cancel 返回原 terminal。
- cancel/complete barrier 竞态只有一个 terminal。
- cancel 后新 runtime 也能观察并停止。

### Green

- cancel command 验权并持久化。
- local signal/notification 只用于加速。
- runner checkpoint/recovery 读取 cancel fact。

### Refactor

- 前端 Stop 调用 cancel API，同时可取消本地 subscription。
- 把“停止观察”和“停止运行”做成不同函数。

## 6. TDD Cycle E：Level 1 Reconciliation

### Red

前端/客户端测试：

- stream EOF 无 done 时，先 query Run。
- query COMPLETED -> 使用 final Message，不显示错误。
- query RUNNING -> 显示 reconnecting/running。
- query WAITING_APPROVAL -> 恢复 ApprovalCard。
- query FAILED -> 使用 stable server error。
- 页面 reload -> 从 Conversation active Run 恢复。

### Green

- API 层加入 getRun/getActiveRun。
- composable 保存 runId 并在 mount/切换时 reconcile。
- optimistic message 与 canonical message 按 ID 合并。

### Refactor

- 把 reconciliation 状态机从大 composable 中提取，仅当职责已明显膨胀。
- 页面组件不写请求竞态逻辑。

## 7. TDD Cycle F：Level 2 Event Replay（可选）

只有 Level 1 全部通过且产品确实需要恢复过程时执行。

### Red

- sequence 从 1 单调递增。
- canonical transition 与对应 RunEventOutbox 在同一事务提交；任一写失败都整体回滚。
- 重连 `after=5` 只收到 >5。
- replay 与 live 边界不漏 6。
- 重复 event 被前端去重。
- terminal event 重放后 stream 正常结束。
- retention 已过期时返回 snapshot-required 语义。
- 慢 subscriber buffer 满时被断开，executor 不阻塞。

### Green

- 在同一 DB 事务持久化 canonical transition + 原子分配的 per-run sequence + 受限 coarse RunEventOutbox。
- replay then live tail。
- 独立 outbox publisher 可重复发布；客户端按 sequence 去重。
- bounded per-subscriber channel。
- 文本 delta 合并或从 final Message 恢复。

### Refactor

- pub/sub transport 作为 port，DB event sequence/canonical facts 保持权威。
- 没有多实例需求时不急着上 Redis/Kafka。

## 8. 并发测试矩阵

| 编号 | 竞态 | 预期 |
| --- | --- | --- |
| R08-01 | same conversation, different keys | 1 active + 1 conflict |
| R08-02 | same conversation, same key | 同 Run |
| R08-03 | different conversations | 可并行 |
| R08-04 | cancel vs complete | 一个 terminal，不可改写 |
| R08-05 | cancel vs tool start | 最多一次执行，事实准确 |
| R08-06 | approval approve vs cancel | 一个迁移获胜 |
| R08-07 | recovery vs live worker | 一个 lease owner |
| R08-08 | two reconnect subscribers | 都观察同 Run，不启动新执行 |
| R08-09 | terminal + new send | 新 Run 可创建，history 顺序正确 |
| R08-10 | terminal write vs active release | 原子/最终无假 active |
| R08-11 | PENDING manual review vs new send | review Run 保持 active，新 send conflict |
| R08-12 | resolve/abandon review vs new send | 一个迁移获胜；只有旧 Run 真终态后可创建新 Run |
| R08-13 | cancel after external success before local result | 补真实 result 或进入 MANUAL_REVIEW，不虚假 ABORTED |

## 9. Stream/Replay 测试矩阵

| 编号 | 场景 | 关键断言 |
| --- | --- | --- |
| S08-01 | 正常 start/delta/done | sequence/terminal 正确 |
| S08-02 | 网络在 delta 后断开 | Run 继续，query 最终完成 |
| S08-03 | 网络在 terminal publish 前断开 | canonical terminal 可查询 |
| S08-04 | response write 失败 | 只移除 subscriber |
| S08-05 | 慢 subscriber | buffer 有界，executor 延迟不受其控制 |
| S08-06 | EOF + RUNNING | 前端进入 reconnecting，不误报失败 |
| S08-07 | EOF + COMPLETED | 前端应用 final Message |
| S08-08 | invalid event | parser 稳定失败后仍可 reconcile |
| S08-09 | duplicate sequence | 客户端忽略重复 |
| S08-10 | out-of-order | 客户端拒绝/等待缺口并 query |
| S08-11 | replay retention gap | 返回 snapshot required |
| S08-12 | waiting approval reload | 恢复 approval 而非重采样 |
| S08-13 | canonical update succeeds but outbox insert fails | 整个事务回滚，不出现不可重放 transition |
| S08-14 | commit 后 publisher crash | replay 仍读到 sequence，重启 publisher 后可通知 |
| S08-15 | 两 worker 分配 sequence | `(runId,sequence)` 唯一且严格递增，无 `max+1` 竞态 |

## 10. API Contract 测试

- `POST run` 必须返回 runId/clientRequestId 关联。
- active conflict 含 stable code 与 activeRunId，但不泄漏其他租户信息。
- `GET run` terminal/active/waiting/manual-review view schema 稳定。
- `POST cancel` 重放幂等。
- 无权 query/cancel 不泄漏 Run 是否存在。
- replay `after` 非法、过旧、超过 latest 有明确行为。
- 外部事件 envelope 始终带 runId/sequence/occurredAt（如果启用 Level 2）。
- Level 1 未启用 replay 时不要求/不伪造 lastEventSequence；capability contract 有测试。
- 旧客户端对新增事件的兼容策略有测试/版本决定。

## 11. 前端状态机测试

建议用 composable 单元测试或组件集成测试覆盖：

```text
submitting -> running
running -> reconnecting -> running
running -> reconnecting -> completed
running -> cancel_requested -> aborted
running -> waiting_approval -> running
waiting_approval -> reconnecting -> waiting_approval
running -> failed
running -> manual_review
manual_review -> running/completed/failed（仅显式 resolution）
```

断言：

- optimistic user message 不重复。
- canonical assistant Message 替换 placeholder。
- 切换 Conversation 不会把 A 的 event 写到 B。
- 旧 sequence 不改变新状态。
- Stop 不只 abort fetch。
- refresh 后 status 来自 server projection。
- PENDING manual review reload 后仍显示可审计 case，且不会偷偷启动新 Run。

## 12. Kill/restart 演练

### 演练 A：模型生成中重启 API

1. 创建 Run，记录 runId。
2. 让 fake provider/runner停在 checkpoint。
3. kill 第一实例。
4. 客户端 stream 断开并开始 reconcile。
5. 第二实例 recovery 取得 lease并继续。
6. 客户端最终查询/订阅到 COMPLETED。

### 演练 B：审批等待中刷新

1. Run 进入 WAITING_APPROVAL。
2. 关闭页面/重新打开。
3. 查询 active Run，恢复 ApprovalCard。
4. 批准后同一 Run 继续，没有新 user Message/Run。

### 演练 C：慢消费者

1. subscriber 故意不读取。
2. executor 连续发布多个聚合 delta/coarse events。
3. buffer 到上限后 subscriber 被断开。
4. Run 仍完成，客户端通过 query/replay 恢复。

## 13. 故障注入

| 故障点 | 预期 |
| --- | --- |
| publish event 失败 | canonical state 保留，Run 继续 |
| Run query 暂时失败 | 前端有界退避，不新建 Run |
| subscriber buffer 满 | 单 subscriber 断开，记录 metric |
| cancel notification 丢失 | executor 下一 checkpoint 读 persisted fact |
| active release 事务失败 | recovery/reconciler 修复，不允许第二 active |
| replay store 不可用 | 降级 canonical query，不丢 final result |
| duplicate/out-of-order event | sequence 去重/缺口恢复 |

上表的“publish event 失败”发生在事务提交后的 outbox publisher。若 Level 2 的 outbox row 插入失败，canonical transition 必须同事务回滚，不能降级成一个永远无法 replay 的静默缺口。

## 14. 验收证据模板

```md
### Requirement：连接断开不取消 Run，最终结果可恢复

- Run：...
- Disconnect point：after sequence/delta ...
- Immediately after disconnect：Run status=RUNNING, cancelRequestedAt=null
- Final canonical state：COMPLETED, assistantMessageId=...
- Reconciliation API：GET ... -> ...
- Client result：同一 assistant Message，无重复 Run
- Test：`...reconnect.spec.ts / ...`
- Result：PASS
```

## 15. 阶段验收清单

### 并发

- [ ] 一会话一 active Run 是明确产品规则。
- [ ] 数据库/CAS 保护，不只进程内判断。
- [ ] same key reuse 与 different key conflict 都有测试。
- [ ] terminal 后可安全创建下一 Run。
- [ ] PENDING MANUAL_REVIEW 默认仍占 active slot；resolve/abandon 后才释放。

### 断流与取消

- [ ] disconnect 只停止 observation。
- [ ] cancel 是显式幂等 command。
- [ ] persisted cancel 可跨实例生效。
- [ ] cancel/complete race 有唯一终态。

### Reconnect

- [ ] Level 1 canonical reconciliation 完成。
- [ ] refresh/切换/双标签页可恢复。
- [ ] EOF 先 query，而非默认失败。
- [ ] 若 Level 2：sequence/replay/retention/backpressure 全有证据。
- [ ] 若 Level 2：canonical transition + sequence + outbox 同事务，publisher crash/retry 有证据。
- [ ] Level 1/2 对 `lastEventSequence` 的可选 contract 明确。

### 多实例与压力

- [ ] 两 runner 不重复推进。
- [ ] 多 subscribers 不启动新 execution。
- [ ] 慢 subscriber 不拖慢 Run。
- [ ] kill/restart 演练通过。

### 工程验证

- [ ] unit/integration/API/web tests 通过。
- [ ] workspace typecheck/lint 通过。
- [ ] DB migration/constraint 有真实并发验证。
- [ ] 外部 contract 文档和旧客户端策略已记录。

## 16. Teach-back 复盘

1. 为什么断开 transport 不应默认 cancel？
2. retry command、resume observation、resume execution 分别做什么？
3. 一个 Conversation 为什么先限制一个 active Run？
4. Level 1 与 Level 2 reconnect 的保证差异？
5. snapshot 与 live tail 之间如何避免漏事件？
6. sequence 为什么必须由服务端按 Run 生成？
7. slow subscriber 为什么应被断开而不是让模型暂停？
8. cancel notification 丢失后为什么仍能生效？
9. 为什么 WebSocket 不能替代 durable state？
10. 哪个测试最能证明 reconnect 没有创建新 Run？

## 17. 阶段完成记录

```md
### 我现在能解释
- ...

### 我仍不确定
- ...

### 本阶段选择的 resume level
- Level 1 / Level 2：...
- 理由：...

### 当前项目没有照搬 Codex 的部分
- ...

### Phase 09 需要采集的指标
- reconnect attempts/success：...
- stream disconnects：...
- active conflicts：...
- event lag/dropped subscribers：...
```
