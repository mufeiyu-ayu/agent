# Phase 07 源码阅读：Codex 如何选择持久化事实并恢复 Thread

## 1. 阅读问题

> Codex 如何从运行事件中筛选 canonical items，如何 append/flush/load，并怎样从持久历史恢复一个新的 Session？这些原则如何转换为 PostgreSQL Run/Step/Tool facts？

目标是学习“从事实重建”，不是复制 rollout JSONL 或本地文件布局。

## 2. 定位命令

```sh
rg -n "is_persisted_rollout_item|persisted_rollout_items" \
  /Users/ayu/Desktop/codex/codex-rs/rollout/src \
  /Users/ayu/Desktop/codex/codex-rs/thread-store/src

rg -n "resume_thread_from_rollout|resume_thread_with_history|flush_rollout" \
  /Users/ayu/Desktop/codex/codex-rs/core/src/thread_manager.rs
```

## 3. 第一条链：哪些 item 值得持久化

### 3.1 Rollout policy

| Codex 文件 | 重点 | 阅读问题 |
| --- | --- | --- |
| `codex-rs/rollout/src/policy.rs` | item/event 筛选 | 为什么 delta/begin 不必全部落盘？ |
| 同文件 | response item 分支 | 哪些 message/tool facts 会保留？ |
| `codex-rs/rollout/src/persistence_metrics.rs` | filter 前后大小 | 筛选策略如何被度量？ |
| `codex-rs/rollout/src/persistence_metrics_tests.rs` | kept/dropped tests | 哪些行为由测试锁定？ |

为每种当前项目数据分类：

```text
必须恢复：user/final assistant message、ToolCall、ToolResult、Approval、Run terminal
可重建：ContextPlan、查询 projection
仅传输：text delta、临时 started event
仅诊断：debug log、stack trace（脱敏）
```

### 3.2 Recorder

| Codex 文件 | 重点符号 | 阅读问题 |
| --- | --- | --- |
| `codex-rs/rollout/src/recorder.rs` | `RolloutRecorder` | 写入队列、flush、persist 的边界 |
| `codex-rs/rollout/src/recorder_tests.rs` | persist/flush/error cases | 失败后 buffer 是否可重试？persist 是否幂等？ |
| `codex-rs/rollout/src/compression.rs` | materialize/append | 存储格式变化时怎样保护可读性？ |

重点阅读 tests 中：

- 第一次 record 前不必 materialize。
- `flush` 后事实可见。
- 重复 `persist()` 幂等。
- 写入失败后 buffered item 不丢失。

这些不是要求当前项目实现同样 writer，而是在提醒：事务提交/响应返回/状态可查询的顺序必须被测试。

## 4. 第二条链：ThreadStore 抽象

### 4.1 Store trait 与本地实现

| Codex 文件 | 阅读目标 |
| --- | --- |
| `codex-rs/thread-store/src/store.rs` | Thread create/read/list/live writer 的中立边界 |
| `codex-rs/thread-store/src/types.rs` | store 输入/输出与 runtime 类型的关系 |
| `codex-rs/thread-store/src/live_thread.rs` | loaded/live Thread 如何追加 canonical items |
| `codex-rs/thread-store/src/local/live_writer.rs` | resume/append/flush/persist 的具体顺序 |
| `codex-rs/thread-store/src/local/read_thread.rs` | history 如何加载和兼容旧记录 |
| `codex-rs/thread-store/src/in_memory.rs` | 测试/替代实现的价值 |

阅读问题：

1. 为什么 ThreadStore 不等于 Session/runtime？
2. live writer 与 cold read 为什么分开？
3. append 返回前是否 flush，为什么？
4. metadata projection 与 canonical history 如果不同步，哪一个优先？
5. in-memory store 保护了哪些可测试边界？

当前项目的对应不是“再建一个 ThreadStore 抽象”，而是评估 `RunStore/ToolExecutionStore/ApprovalStore` 何时能集中事务与条件更新。

## 5. 第三条链：从持久历史恢复 Runtime

### 5.1 ThreadManager

| Codex 文件 | 符号/位置 | 阅读目标 |
| --- | --- | --- |
| `codex-rs/core/src/thread_manager.rs` | `ThreadManager` | loaded threads 与 durable threads 的关系 |
| 同文件 | `resume_thread_from_rollout`，约 746 行 | resume 入口需要哪些输入 |
| 同文件 | `resume_thread_with_history`，约 766 行 | history 如何进入新 Session |
| 同文件 | `Codex::spawn` 附近 | runtime service 如何重新初始化 |
| 同文件 | interrupted boundary helpers，约 1816 行后 | mid-turn snapshot 如何收口成一致历史 |

提炼：

- resume 创建/装载新的运行对象，不恢复旧 future。
- 先加载 canonical history，再初始化 Session services。
- 不完整 Turn 需要明确 interrupted boundary。
- loaded runtime 可卸载，Thread 身份仍存在。

### 5.2 App-server resume

阅读：

- `codex-rs/app-server/src/request_processors/thread_processor.rs`
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs`
- `codex-rs/app-server/tests/suite/v2/thread_resume.rs`

观察协议层职责：找到 Thread、组合 snapshot/response、注册 listener。对 pending approval 要做严格区分：app-server 测试中的 replay 面向**仍运行/仍加载 Thread 的进程内 pending request**；rollout/cold resume 没有等价 durable Approval resource。不要把 running listener 行为写成磁盘恢复保证，也不要把这些行为全部塞进当前 Nest Controller。

## 6. 第四条链：异常中断与边界

建议选读：

- `codex-rs/app-server/tests/suite/v2/turn_interrupt.rs`
- `codex-rs/app-server/tests/suite/v2/thread_resume.rs`
- `codex-rs/app-server/tests/suite/v2/thread_rollback.rs`
- `codex-rs/core/src/session/turn_tests.rs`

寻找：

- interrupt 后哪些 item 被保留。
- resume 后是否重复 user input。
- running Thread 的 pending approval request 如何由内存 waiter 重投影，以及为什么这不能证明 cold recovery。
- 不完整 Turn 如何标记。
- rollback/compaction 后 history 是否仍合法。

## 7. 当前项目反向阅读

### 7.1 Run 创建与状态写入

| 当前文件 | 重点问题 |
| --- | --- |
| `apps/api/src/agent-runtime/agent-runtime.service.ts` | 一次请求有哪些不可原子的 crash windows？ |
| `apps/api/src/agent-runtime/agent-run-recorder.service.ts` | complete/fail/abort 的事务覆盖哪些表，漏哪些事实？ |
| `prisma/schema.prisma` | 哪些字段能识别 stale RUNNING？哪些不够？ |
| `apps/api/src/seo/seo.service.ts` | 同步入口为何无法复用 Run recovery？ |

沿实际顺序逐行标注：

```text
assert conversation
create user Message
create Run + initial Steps
load history
create assistant placeholder
start LLM
stream deltas
update final Message
complete Step
complete Run
```

在每两步之间插入“进程立即退出”，记录数据库会留下什么。这张 crash window 表是本阶段最重要的阅读产物。

### 7.2 Request contract

阅读：

- `packages/contracts/src/seo.ts`
- `apps/api/src/seo/dto/seo-chat.dto.ts`
- `apps/web/src/hooks/useSeoWorkspace.ts`

确认当前没有 `clientRequestId`。前端虽然生成 `streamRequestId/createClientMessageId`，但是否真正发送给服务端、是否有唯一约束，需要以代码为准。不要把前端本地 ID 误认为后端幂等已经实现。

### 7.3 Cancellation

阅读 `seo.controller.ts` 与 `AgentRuntimeService` catch/finally：

- AbortSignal 来自单个 response close。
- 进程重启后 signal 不存在。
- 多个客户端或后台执行时，连接断开是否等于业务 cancel 需要重新定义。
- Message/Run/Step abort 目前在哪些路径写入，若写入中崩溃会怎样？

### 7.4 Tool/Approval/Context facts

结合 Phase 02-06 的实际实现再阅读：

- ToolCall 是否在执行前落库？
- ToolExecution attempt 是否有 execution key？
- result 与 observation 是否区分？
- Approval decision 与工具执行间有什么 crash window？
- `APPROVED` 已写、ToolExecution claim 未写以及 claim 已写、外部调用未发出是两个不同 crash window；Approval 不是 execution receipt。
- ContextPlan 是否能完全从 facts 重算？
- Summary activation 是否有版本冲突保护？

## 8. 翻译表

| Codex 机制 | 当前云端实现 |
| --- | --- |
| rollout canonical item policy | 数据库事实清单与字段级持久化策略 |
| append + flush | Prisma transaction 提交后才发布可见事件/响应 |
| ThreadStore load | RunStore 读取一致 recovery snapshot |
| Session resume | 新 runner 从 checkpoint/context 重建 |
| interrupted boundary | stale Run recovery reason/checkpoint |
| local thread writer | API/worker executor + lease |
| persisted Thread ID | Conversation/Run ID |

## 9. 推荐阅读顺序

### 第一遍：事实选择

1. rollout `policy.rs`
2. `persistence_metrics_tests.rs`
3. 当前 schema
4. 列 canonical/rebuildable/transport/diagnostic 四类数据

### 第二遍：写入边界

1. rollout `recorder.rs`
2. recorder persist/flush/error tests
3. thread-store `live_writer.rs`
4. 当前 recorder service 事务

### 第三遍：恢复

1. `thread_manager.rs::resume_thread_from_rollout`
2. `resume_thread_with_history`
3. `thread_resume.rs`
4. 当前 runtime crash window 表

## 10. 必答问题

### Codex 侧

1. 为什么 rollout policy 不保存所有 delta？
2. `flush` 和 `persist` 的测试保护了什么？
3. ThreadStore 与 loaded Session 为什么分开？
4. resume 为什么从 history spawn，而非复用旧 async task？
5. mid-turn persisted suffix 为什么需要 interrupted boundary？

### 当前项目侧

1. 同一 POST 重试会创建多少 Message/Run？
2. 创建 Message 后、Run 前崩溃如何避免孤立输入？
3. 工具 side effect 已发生但 result 未写时，依据什么决定重试？
4. 哪些字段足以判断一个 RUNNING 是否 stale？
5. recovery worker 如何保证只有一个实例取得执行权？
6. final Message 已落库但 Run 仍 RUNNING 时，恢复器应做什么？
7. 哪些状态必须人工核对，为什么 fail closed？
8. manual review 如何成为 durable Run/ReviewCase 状态、查询投影和显式 resolution，而不是日志/boolean？
9. cancel 到达时外部副作用已成功但 Result 未写，恢复器如何避免虚假 ABORTED？

## 11. 可跳过内容

- rollout 压缩文件格式细节。
- SQLite 索引、搜索和分页优化。
- legacy rollout 所有兼容分支。
- remote thread store 与云同步实现。
- fork/subagent lineage 的完整逻辑。
- 当前不需要的本地文件权限处理。

## 12. 阅读完成证据

- [ ] 完成当前 Runtime 全 crash window 表。
- [ ] 将所有数据分成 canonical/rebuildable/transport/diagnostic。
- [ ] 能画出 request idempotency 与 tool idempotency 两层。
- [ ] 能说明 Codex resume 为什么不是恢复旧调用栈。
- [ ] 找到 rollout policy、recorder failure、ThreadStore load、resume test 四类证据。
- [ ] 写出 RecoverySnapshot -> RecoveryAction 草图。
- [ ] 明确至少三种必须 fail closed/manual review 的状态。
- [ ] 明确 Codex pending approval replay 只覆盖 running in-memory Thread，不把它当 rollout/cold recovery。
- [ ] 为 manual review durable 状态/投影/active policy 与 cancel-after-side-effect 写出设计。
