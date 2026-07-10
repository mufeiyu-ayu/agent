# Phase 08 源码阅读：Interrupt、Resume 与连接生命周期

## 1. 阅读问题

> Codex 为什么把 turn/start、interrupt、steer、thread/resume、thread/fork 分成不同操作？运行事件、客户端连接和 Thread 生命周期如何避免被混成一个请求？

本阶段只迁移 interrupt/cancel、resume observation 和并发控制思想，不实现 steer/fork。

## 2. 第一条链：请求为什么进入 submission queue

| Codex 文件 | 重点 | 阅读问题 |
| --- | --- | --- |
| `codex-rs/app-server/src/request_processors/turn_processor.rs` | `turn/start` handler | 协议请求如何变成 `Op::UserInput`？ |
| `codex-rs/protocol/src/protocol.rs` | `enum Op` | user input、interrupt、approval 等为何是并列 operation？ |
| `codex-rs/core/src/session/handlers.rs` | `submission_loop`，约 702 行起 | 单一 dispatch 点如何维护 active turn 顺序？ |
| `codex-rs/core/src/tasks/regular.rs` | `RegularTask` | Task 与一次 protocol request 的生命周期是否相同？ |

提炼：

- 请求进入和 runtime 执行是不同边界。
- 运行期间还会收到 interrupt/approval/steer。
- 单一有序点防止多个 operation 随意改 active state。
- 当前云端不必照搬 channel queue，但需要 command/execution 分离和数据库并发 policy。

## 3. 第二条链：Interrupt

阅读：

- `codex-rs/app-server/src/request_processors/turn_processor.rs` 中 interrupt handler。
- `codex-rs/protocol/src/protocol.rs` 中对应 `Op`。
- `codex-rs/core/src/session/handlers.rs` 中 interrupt dispatch。
- `codex-rs/app-server/tests/suite/v2/turn_interrupt.rs`。

跟踪：

```text
client interrupt request
  -> protocol op
  -> active task cancellation
  -> tool/model cancellation propagation
  -> interrupted lifecycle facts/events
  -> turn terminal projection
```

重点问题：

1. interrupt 是否通过关闭 client transport 触发？
2. active turn 不存在时 interrupt 如何响应？
3. 等待 approval 时 interrupt 会怎样？
4. 已产生部分 output 是否保留？
5. Thread 是否仍可继续后续 Turn？

## 4. 第三条链：Thread Resume

### 协议与生命周期

| Codex 文件 | 阅读目标 |
| --- | --- |
| `codex-rs/app-server/src/request_processors/thread_processor.rs` | cold/running thread resume 的协议入口 |
| `codex-rs/app-server/src/request_processors/thread_lifecycle.rs` | listener、pending resume、snapshot ordering |
| `codex-rs/core/src/thread_manager.rs` | loaded vs persisted thread、resume spawn |
| `codex-rs/thread-store/src/store.rs` | durable history 的读取边界 |
| `codex-rs/app-server/tests/suite/v2/thread_resume.rs` | cold/running resume 的差异，以及 running Thread 的 pending request replay |

观察：

- resume 既可能加载 cold Thread，也可能重新订阅 running Thread。
- app-server 需要协调 snapshot 与 live notifications 的顺序，避免先收到新事件再收到旧 snapshot。
- 客户端连接关闭不意味着 Thread 被删除。
- pending approval 的测试只证明**仍运行/仍加载 Thread**可以把进程内 pending request 再投影给客户端；它不证明 approval 已进入 rollout，也不覆盖进程重启后的 cold recovery。

将这条约束翻译为当前项目：Level 2 先用与 canonical transition 同事务写入的 outbox 取得一致 `lastSequence/snapshot`，replay 到该边界，再切 live tail；或在 Level 1 只查询 canonical terminal/current projection。云端 Approval/ManualReview 必须来自 PostgreSQL durable resource，不依赖 Codex 的内存 waiter。

## 5. 第四条链：Steer 与 Fork 只做概念对比

| 能力 | Codex 测试 | 阅读目的 |
| --- | --- | --- |
| Steer | `app-server/tests/suite/v2/turn_steer.rs` | active Turn 中追加输入，不是新 Run |
| Fork | `app-server/tests/suite/v2/thread_fork.rs` | 复制历史形成新 Thread，ID/lineage 变化 |
| Resume | `app-server/tests/suite/v2/thread_resume.rs` | 继续观察/使用同一 Thread |
| Interrupt | `app-server/tests/suite/v2/turn_interrupt.rs` | 停止当前 Turn，不删除 Thread |

本阶段读测试标题和一条主 case 即可。产出术语表，防止把“用户再发一次消息”叫 resume。

## 6. 第五条链：SDK 如何包装 streamed run 和 abort

阅读 TypeScript SDK：

- `sdk/typescript/src/codex.ts`
- `sdk/typescript/src/thread.ts`
- `sdk/typescript/src/events.ts`
- `sdk/typescript/tests/runStreamed.test.ts`
- `sdk/typescript/tests/abort.test.ts`

阅读问题：

- SDK 是否自己实现 Agent loop？
- abort signal 如何进入已有 runtime/protocol？
- streamed events 如何与最终结果关联？
- 客户端 API 便利层与 server canonical semantics 如何分开？

当前 Vue API 层也应是协议消费端，不拥有 active-run policy。

## 7. 当前项目反向阅读

### 7.1 服务端连接耦合

从 `apps/api/src/seo/seo.controller.ts` 阅读：

```text
POST /chat/stream
  -> create AbortController
  -> response close => abort
  -> for await runtime events
  -> response.write
  -> response.end
```

标出三个耦合：

1. response close 直接改变业务 Run。
2. runtime generator 由单个 HTTP handler 持有。
3. backpressure/response destroyed 会停止消费 runtime。

再回到 `AgentRuntimeService`，观察 abort catch/finally 如何写 Message/Run/Step。提出：如果只是 Wi-Fi 短暂断开，是否应该把业务 Run 判为用户主动 ABORTED？

### 7.2 前端内存状态

在 `apps/web/src/hooks/useSeoWorkspace.ts` 跟踪：

- `activeAbortController`
- `activeStreamRequestId`
- `activeStreamConversationId`
- `activeStreamAssistantMessageId`
- `stopGeneration()`
- stream EOF/error 处理
- 页面 mount/load messages

确认：这些变量刷新即丢，不是 durable state。`streamRequestId` 是否发送到后端，应以 request payload 为准。

### 7.3 Stream parser

阅读 `apps/web/src/api/seo.ts`：

- buffer 如何处理跨 chunk NDJSON。
- invalid event 如何失败。
- EOF 后是否有 sequence/terminal 检查。
- 当前事件是否包含 runId。
- replay 时如何去重还不存在。

### 7.4 Shared contract 与 mapper

阅读：

- `packages/contracts/src/seo.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`

当前内部 `run_started` 有 runId，但外部 `start` 没有 runId。Phase 08 要查询/重连同一 Run，这个隐藏决定是否仍合理必须重新评估。

### 7.5 Conversation 查询

阅读：

- `conversations.service.ts`
- `messages.service.ts`
- `prisma/schema.prisma`

问题：

- 能否查询某 Conversation 的 active Run？
- 当前 schema 能否保证 active Run 唯一？
- terminal Message 查询是否足以做 Level 1 reconciliation？
- Run/Step 的 Controller/query endpoint 是否存在？没有就不能假装前端可恢复。

## 8. Codex -> 云端翻译

| Codex | 当前项目 |
| --- | --- |
| Session submission queue | command boundary + DB active policy + runner |
| active Task cancellation token | persisted cancel + local AbortSignal |
| running Thread listener | stream subscriber |
| thread resume snapshot | Run/Message/Approval canonical projection |
| event notifications | NDJSON RunEvent envelope |
| loaded/persisted Thread | live executor/durable Run |
| fork | 后期新 Conversation + source lineage，不在本阶段 |

## 9. Snapshot + live 的阅读重点

从 `thread_lifecycle.rs` 中找 pending resume 和 response ordering，思考经典竞态：

```text
T1: client 查询 snapshot lastSequence=10
T2: runtime 发布 event 11
T3: client 建立 live subscription
```

如果 T2 发生在查询与订阅之间，event 11 可能丢。解决方式之一：

- 先以持久 sequence replay `after=10`，再 tail。
- 订阅前记录边界，再查询到边界，buffer 边界后的 live event。
- 只做 Level 1 canonical reconciliation，不承诺逐事件无漏。

若选择第一种 Level 2，持久 sequence/event 必须和它描述的 Run/Step/Approval/Message transition 同一个数据库事务写入 transactional outbox。只做“先提交 fact，随后 INSERT event”仍会在两次提交间崩溃并永久漏 sequence，不满足 replay 保证。

必须明确当前阶段选择哪一级，不能模糊宣称“支持 resume”。

## 10. 推荐阅读顺序

1. `turn_processor.rs` start/interrupt。
2. `protocol.rs::Op`。
3. `submission_loop`。
4. `turn_interrupt.rs`。
5. `thread_manager.rs` resume。
6. `thread_lifecycle.rs` running resume ordering。
7. `thread_resume.rs` 两条测试。
8. 当前 Controller -> runtime -> mapper -> parser -> composable。
9. steer/fork tests 只做术语对比。

## 11. 必答问题

### Codex 侧

1. 为什么 interrupt 是 operation 而不是 socket close？
2. loaded Thread 与 client connection 为什么可以独立？
3. running resume 时 snapshot 和 live events 如何排序？
4. running Thread 的 pending approval 为什么能在 resume 后重现？为什么这不能推出 rollout/cold recovery？
5. steer、resume、fork 改变的分别是当前 Turn、观察关系还是 Thread 身份？

### 当前项目侧

1. 当前断流为什么必然 abort Run？这是目标语义吗？
2. 外部 contract 没有 runId，前端怎样查询同一 Run？
3. active-run 唯一如何在数据库层证明？
4. cancel/complete 同时发生时哪个 transition 赢？
5. Level 1 reconciliation 需要哪些 endpoint/字段？
6. 如果做 event replay，snapshot->live 边界如何避免漏事件？
7. 慢 subscriber 如何被隔离而不拖慢模型？

## 12. 可跳过内容

- realtime audio。
- WebSocket transport 具体实现。
- Thread fork 的所有 history slicing 细节。
- multi-agent child Thread residency。
- TUI 如何渲染 resumed items。
- SDK Python 版本，除非需要对比。

## 13. 阅读完成证据

- [ ] 完成 interrupt/reconnect/resume/steer/fork 术语表。
- [ ] 画出 command/execution/observation 三生命周期。
- [ ] 找到 Codex start queue、interrupt、running resume ordering、SDK abort 的证据。
- [ ] 标出当前服务端三处 connection/runtime 耦合。
- [ ] 标出当前前端四个刷新即丢的 active state。
- [ ] 选择并记录 Level 1 或 Level 2 resume 的明确范围。
- [ ] 若选 Level 2，画出 canonical transition + atomic sequence + outbox 同事务以及 publisher crash/retry。
- [ ] 明确 lastEventSequence 只属于启用 replay 的 contract，且 MANUAL_REVIEW 的 durable projection/active policy 已定义。
- [ ] 写出 active-run 数据库约束方案与竞态测试。
