# App Server Thread Listener、多客户端订阅与卸载恢复

Codex App Server 允许一个进程同时服务多个客户端，也允许多个客户端观察同一个 Thread。它并没有给每个客户端各建一条 Core 事件流，而是为每个已加载 Thread 保留一个 listener，再把 listener 消费到的事件扇出给当时的订阅者。

这看似只是“WebSocket 广播”，实际同时承担了五类职责：

1. Core `CodexThread` 事件只能被一个消费者顺序读取；
2. 多客户端订阅需要动态加入、退出和断线清理；
3. running Thread resume 必须把历史快照与后续 live event 接成一条缝隙尽量小的流；
4. approval、user input 等 server request 要在客户端重连后恢复；
5. 无订阅且空闲的 Thread 要延迟卸载，又不能和新订阅并发撞车。

本文不把 listener 当成普通事件监听器，而把它视为 App Server 内的 **Thread 单写者、事件路由器和租约协调器**。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/app-server/src/thread_state.rs`
- `codex-rs/app-server/src/thread_status.rs`
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs`
- `codex-rs/app-server/src/request_processors/thread_processor.rs`
- `codex-rs/app-server/src/request_processors/turn_processor.rs`
- `codex-rs/app-server/src/outgoing_message.rs`
- `codex-rs/app-server/src/transport.rs`
- `codex-rs/app-server/src/lib.rs`
- `codex-rs/app-server/src/in_process.rs`
- `codex-rs/app-server/src/bespoke_event_handling.rs`
- `codex-rs/app-server/src/request_processors/thread_processor_tests.rs`
- `codex-rs/core/src/codex_thread.rs`
- `codex-rs/core/src/session/mod.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/app-server-transport/src/transport/mod.rs`
- `codex-rs/app-server-transport/src/transport/websocket.rs`

本文描述当前实现，不把 WebSocket、Unix socket、remote control 和 in-process transport 的细节差异误写成稳定协议承诺。

## 2. 先分清六种状态

App Server 的 Thread 生命周期至少横跨六种状态域：

| 状态域 | 主要所有者 | 保存什么 |
| --- | --- | --- |
| Core Thread | `ThreadManager` / `CodexThread` | Agent Session、事件源、运行状态、配置 |
| Listener | `ThreadState` | 当前 Core Thread identity、cancel、command queue、active Turn history |
| Subscription | `ThreadStateManagerInner` | Thread 到 Connection 的多对多关系 |
| UI Status | `ThreadWatchManager` | loaded/running/pending approval/pending input/system error |
| Outbound callback | `OutgoingMessageSender` | App Server 发给客户端且仍待响应的 request |
| Transport connection | App Server transport/router | 初始化、实验能力、通知 opt-out、写队列与断线 |

这些状态不会在一个事务里一起提交。

例如：

```text
Connection断开
  -> transport先移除连接
  -> connection RPC gate尝试drain
  -> request context清理
  -> Thread subscription清理
  -> listener仍可存活
  -> 30分钟后才可能卸载Core Thread
```

所以“客户端已断开”不等于“Thread 已停止”，也不等于“pending approval 已取消”。

## 3. 每个 Thread 只有一个 Core 事件消费者

### 3.1 Listener identity

`ThreadState` 使用 `Weak<CodexThread>` 保存 listener 当前对应的 Core Thread。`listener_matches` 升级 Weak 后用 `Arc::ptr_eq` 比较。

它比较的是对象 identity，不只是 Thread ID：

```text
相同Thread ID + 相同Arc<CodexThread>
  -> 复用现有listener

相同Thread ID + 新Arc<CodexThread>
  -> 取消旧listener，启动新listener
```

这能处理 Thread 被重新装载、替换或旧 shutdown 超时后出现新会话对象的情况。

### 3.2 Listener generation

每次 `set_listener` 都会：

1. 向旧 listener 的 oneshot cancel sender 发信号；
2. `wrapping_add(1)` 增加 `listener_generation`；
3. 建立新的 unbounded command channel；
4. 保存新 `Weak<CodexThread>`；
5. 保存 Skills watcher registration 和 settings baseline。

旧 task 退出时只有在 generation 仍等于自己捕获的值时，才会：

- 注销同步 listener command sender；
- 清空 listener state。

这是典型的 generation fencing。没有这一层，旧 task 的迟到清理可能把新 listener 一起删除。

### 3.3 一个 listener，多个订阅者

listener 循环只调用一次：

```text
conversation.next_event()
```

拿到事件后再读取当前 Thread 的 connection ID 快照，构造 `ThreadScopedOutgoingMessageSender`，把同一个翻译后事件发送给所有订阅者。

因此：

- Core 不为每个客户端保存独立 cursor；
- 客户端之间共享一个 App Server 消费位置；
- listener 是顺序翻译点；
- 订阅只是扇出集合，不是独立 durable stream。

这避免多个消费者竞争 `next_event()`，也让 active Turn 拼装、status 更新和 server request 顺序统一经过一个写者。

## 4. Subscription 是多对多关系

### 4.1 正向和反向索引

`ThreadStateManagerInner` 同时保存：

```text
threads[thread_id].connection_ids
thread_ids_by_connection[connection_id]
```

加入或退出订阅时两边一起更新，并通过 `watch::Sender<bool>` 发布“是否至少有一个连接”。

反向索引让 Connection 断开时不需要扫描所有 Thread；正向索引让事件扇出不需要扫描所有 Connection。

这是值得学习的双索引设计，但它仍只是进程内状态，不是 durable subscription ledger。

### 4.2 只有初始化完成的连接能加入

`try_ensure_connection_subscribed` 和 `try_add_connection_to_thread` 都先检查 Connection 是否仍在 `live_connections`。

这解决一个常见竞态：

```text
thread_created事件排队
  -> Connection先断开
  -> 迟到的auto-attach执行
```

若没有 live check，已经关闭的 Connection 会被重新写回订阅表。当前测试明确覆盖了这个边界。

### 4.3 Unsubscribe 不关闭 listener

`thread/unsubscribe` 只删除当前 Connection 与 Thread 的关系，并返回：

- `Unsubscribed`；
- `NotSubscribed`；
- Core Thread 已不存在时返回 `NotLoaded`，同时清理残留 App Server state。

最后一个订阅者退出后，listener 仍然继续存在。它会等待 Thread 同时满足“无订阅”和“非 Active”满 30 分钟，再进入卸载。

因此 unsubscribe 的语义是：

> 当前客户端不再接收后续 Thread 事件。

它不是 interrupt、shutdown、archive 或 delete。

### 4.4 Connection close 也不立即卸载

Connection close 会移除该 Connection 的全部 Thread membership，并返回“现在已经无订阅者”的 Thread ID。

调用方只对 Core 中已不存在的 Thread立即做残留清理。仍加载的 Thread不会因为最后一个客户端断开就马上关闭，而是交给 listener 的延迟卸载状态机。

这让桌面端临时刷新、WebSocket 抖动或 remote client 重连时，不必重建整个 Agent Session。

## 5. 新 Thread 的自动订阅范围

App Server 主循环订阅 `thread_created` broadcast。每当 Core 创建 Thread，它会收集 **所有已经 initialize 的 Connection**，并对它们调用 `try_attach_thread_listener`。

这意味着新 Thread 的默认可见性不是“只属于发起创建的客户端”：

```text
任一入口创建Thread
  -> App Server观察thread_created
  -> 所有initialized connections自动订阅
```

显式 `thread/start`、fork、cold resume 又会为发起 Connection 主动 attach；随后 `thread_created` 路径可能再 attach 其他 Connection。相同 Core Thread identity 下 listener 创建是幂等的，但订阅集合会扩展。

这个设计适合“多个桌面窗口共同观察同一 Agent daemon”，却也带来明确的 authority 结论：

- Thread subscription 是观察能力，不是创建者 ownership；
- 任何已初始化且自动订阅的客户端都可能看到该 Thread 的 typed events；
- server request 也可能发给这些订阅者；
- 如果不同 Connection 代表不同信任主体，仅靠 App Server initialize 不能形成租户隔离。

App Server 的多客户端模式应理解为同一安全域内的协作观察，而不是多租户授权模型。

### 5.1 Child Thread 继承 raw events 开关

`try_attach_thread_listener` 读取新 Thread 的 `parent_thread_id`。如果存在父 Thread，它会读取父 ThreadState 的 `experimental_raw_events`，把值用于 child auto-attach。

因此 raw event opt-in 可以沿 parent-child 创建链传播，而不是只属于创建 child 的某个 Connection。

## 6. Raw event opt-in 是 Thread 级 sticky bit

Connection 请求 experimental raw events 时，`try_ensure_connection_subscribed` 会把：

```text
ThreadState.experimental_raw_events = true
```

代码没有保存每个 Connection 的 raw-events capability，也不会在该 Connection unsubscribe 或断开时把它恢复为 false。

listener 对 `RawResponseItem` 的判断发生在事件进入扇出前：

```text
Thread sticky raw flag = false
  -> 整个事件被丢弃，不发给任何订阅者

Thread sticky raw flag = true
  -> 发给当前全部订阅者
```

于是一次 opt-in 会改变整个 Thread 后续的事件面，并影响后来加入的客户端。transport 层仍会过滤被协议标记为 experimental 的 notification，但 raw 开关本身不是 per-connection consent。

这是典型的 capability scope 漂移：请求参数看起来属于某次 Connection 调用，落地状态却属于共享 Thread。

## 7. Listener 的四路调度

listener task 使用 `tokio::select! { biased; ... }`，优先级是：

1. cancel；
2. listener command；
3. Core event；
4. unload watcher。

### 7.1 Cancel 最高优先级

新 generation 替换旧 listener、Thread teardown 或 App Server shutdown 时，cancel 能先于其余工作被观察。

不过正在执行的某个 command/event handler 是串行 await 的；cancel 不能抢占 handler 内部已经开始的等待，只能在下一次 select 时生效。

### 7.2 Command queue 是 unbounded

listener command 包括：

- running Thread resume response；
- goal updated/cleared/snapshot；
- server request resolved 通知。

它使用 unbounded channel。生产者不需要等待容量，但高频 command 可以无限堆积内存。

由于 select 是 biased 且 command 优先于 Core event，只要 command 持续 ready，event 和 unload 分支都可能饥饿。

### 7.3 Core event 串行翻译

事件路径会依次：

1. 更新当前 active Turn history；
2. 判断 raw event sticky flag；
3. 获取订阅者 ID 快照；
4. 执行 bespoke event translation；
5. await outbound send 或 server request。

这保证单 listener 内的翻译顺序，却把慢翻译、慢发送和回调建立都放在 Core event 消费关键路径上。

### 7.4 Unload 最低优先级

即使 30 分钟计时已经到期，持续的 command/event 仍可能推迟 unload 分支。它是 opportunistic cleanup，不是严格 deadline。

## 8. 事件快照与订阅竞态

每个 Core event 在翻译前取一次 `subscribed_connection_ids` 快照。这个快照是 `HashSet` 收集出的 Vec，没有稳定排序要求。

因此存在两个自然竞态：

### 8.1 加入发生在快照之后

新 Connection 已完成 subscribe，但 listener 已经为当前事件取完旧快照：

```text
event dequeued
  -> subscriber snapshot [A]
  -> B subscribes
  -> event只发给A
```

B 不会自动补收这个 live event，除非 resume snapshot 或 pending request replay另有覆盖。

### 8.2 退出发生在快照之后

Connection B unsubscribe 后，已持有 `[A, B]` 快照的 event 仍可能发送给 B。

如果 transport 已断开，router 会丢弃 targeted message；如果只是 unsubscribe 且连接仍活着，B 可能收到一个迟到事件。

当前订阅没有 subscription generation、event sequence 或 delivery cursor，客户端不能用协议字段严格证明“这是 unsubscribe 前产生的最后一个事件”。

## 9. Running Thread Resume 如何缩小快照缝隙

### 9.1 为什么不能普通地先读历史再订阅

若 running Thread resume 按下面执行：

```text
读取history
  -> 返回response
  -> 加入subscription
```

读取历史之后、订阅之前产生的事件会永久漏掉。

### 9.2 Resume command 经过 listener

running Thread 路径会先确保 listener task 存在，然后把 `SendThreadResumeResponse` 放入 listener command queue。

因为 listener command 与 Core event由同一 task串行处理，它可以在单写者顺序中完成：

1. 从 ThreadState 取得 active Turn snapshot；
2. 把持久历史与 active Turn 合并；
3. 计算实际 Core running 状态和 UI status；
4. 在 `pending_thread_unloads` 锁下检查 closing；
5. 原子地把请求 Connection 加入订阅表；
6. 返回 resume response；
7. 按需向该 Connection 发送 token usage；
8. 发送 goal snapshot；
9. replay pending server requests；
10. 必要时触发 idle lifecycle。

随后 listener 才继续消费下一个 Core event。

这是一个很好的设计：不需要给 Core event stream 增加 durable cursor，也能把“快照+订阅”放进同一个串行化域。

### 9.3 它保证什么

它能保证：

- resume command 前已被 listener 处理的事件，其可见结果应反映在 history/active Turn/status 中；
- 加入订阅完成后，后续由 listener 处理的事件会包含新 Connection；
- response 先于该 resume 流程显式发送的 token usage、goal snapshot 和 request replay。

### 9.4 它不保证什么

它不是 durable exactly-once stream：

- 持久 history 与 ThreadState active Turn 是两个来源；
- Connection 在 response写出后立即断开，仍可能没收到后续 snapshot/replay；
- listener event fanout没有 event sequence/ack；
- transport queue接收不等于客户端应用已处理；
- resume 期间 command在 unbounded queue中可能等待很久；
- send response后若 token usage或goal snapshot失败，不会回滚已经加入的订阅。

准确说，它提供的是 **listener 单写者下的有序切换**，不是持久消息系统的事务消费。

## 10. Cold Resume 与 Running Resume 不完全相同

Cold resume 会创建新的 Core Thread，先 attach listener，再重建 response history、更新 status，最后发送 response和后续投影。

Running resume 不允许按请求覆盖已加载 Thread 的运行配置。若发现 overrides与现有 config不一致：

- 无订阅、Idle且Core不Running时，会先尝试 shutdown旧缓存 Thread，再走 cold resume；
- 仍有订阅、仍运行，或 shutdown失败/超时时，保留 live Thread并记录 overrides被忽略。

这体现了 live authority 优先：一个仍可被其他客户端观察的 Thread 不能被某个 resume请求偷偷替换配置。

但 running resume仍会调用 `set_app_server_client_info`。这会引出下一类共享状态问题。

## 11. 客户端身份和能力会写入共享 Thread

App Server 每个 Connection 在 initialize 时保存自己的 client name、version、experimental capability 和 notification opt-out。

然而 thread/start、running resume、cold resume、fork以及 turn/start会把当前请求 Connection 的：

- `app_server_client_name`；
- `app_server_client_version`；
- Xcode 26.4 MCP elicitation auto-deny兼容结果；
- turn/start的 OpenAI form elicitation support；

写入共享 Core Session或其 MCP runtime。

Session settings update 对 `Some(name/version)` 是覆盖式的；MCP elicitation auto-deny也是manager级开关。后一个请求者可能改变前一个请求者正在共享的 Thread 行为。

可以把它概括为：

```text
Connection capability
  在transport过滤层是per-connection

写入CodexThread后的client compatibility
  是last-writer-wins共享状态
```

如果两个客户端版本或能力不同，Thread 内没有一个明确的 capability intersection、owner Connection或generation绑定。

在云端 Agent 设计中，应避免把请求端能力直接写成 Conversation全局状态。更稳妥的做法是：

- transport渲染能力保留在Connection；
- Turn capability冻结在AgentRun snapshot；
- 共享Thread策略只能由显式owner/管理员修改；
- 多观察者的能力不能隐式覆盖执行者能力。

## 12. App Server 发给客户端的 Request 是“任一订阅者响应”

### 12.1 同一个 Request ID 扇出

approval、request user input、dynamic tool等 server request通过 `ThreadScopedOutgoingMessageSender.send_request` 发出。

实现只创建一个全局递增 Request ID和一个 oneshot callback，然后把相同 request clone发送给订阅快照中的每个 Connection。

因此多客户端下不是每个 Connection拥有独立 request：

```text
Request R42
  -> Connection A
  -> Connection B
  -> Connection C

第一个提交R42 response的人
  -> take callback
  -> 决定Core等待结果

其余response
  -> callback已不存在，只记录warning
```

这是 first-responder-wins，而不是 creator-only、leader-only或quorum。

### 12.2 Request ownership 与 Thread subscription相同

请求不会根据“谁发起 Turn”选择 owner，而是发给 event处理时的 Thread订阅者快照。

所以自动订阅的其他客户端可能：

- 看到 approval 内容；
- 比发起客户端更早响应；
- 在发起客户端断开后接管响应。

这提高了可恢复性，但要求全部订阅者处于同一信任域。

### 12.3 Pending callback 不随单个 Connection断开删除

`OutgoingMessageSender.connection_closed` 只删除该 Connection尚未完成的 **client→server RPC request context**，不会删除 Thread级 **server→client pending callback**。

这是刻意区分的两种方向：

```text
client -> app-server RPC
  绑定ConnectionRequestId，断线即不再能返回

app-server -> subscribed clients request
  绑定Thread，可等待其他客户端或重连客户端
```

如果最后一个 Connection断开，pending request可以在 Thread仍加载的30分钟窗口内继续存在。

### 12.4 Resume 会 replay pending request

running resume完成 response、usage和goal snapshot后，会读取该 Thread所有 pending request，按 Request ID排序，再发给新加入 Connection。

排序保证 replay内部稳定，但 replay 与新产生 request之间没有 durable log transaction。listener串行 command能控制大部分顺序，outbound channel和transport仍是异步边界。

### 12.5 Resolve notification 也经过 listener排序

server request完成后，`resolve_server_request_on_thread_listener`把 `ResolveServerRequest` command放回listener并等待 oneshot completion。listener向当前订阅者发送 `serverRequest/resolved` 后再确认完成。

这样 resolved notification不会随意越过同一listener里的事件翻译。

但这个等待没有deadline。若listener command channel仍存在、task却卡在慢handler或outbound背压，调用者可以无限等待。

## 13. Outbound 路由与背压

### 13.1 两级有界队列

App Server主要经过两级channel：

```text
所有producer
  -> OutgoingEnvelope channel，容量128
  -> 单outbound router
  -> 每Connection writer channel
```

WebSocket writer容量是32K，普通共享 `CHANNEL_CAPACITY` 是128。不同transport对慢客户端采取不同策略。

### 13.2 可断开的远端连接

带 disconnect token的Connection使用 `try_send`。writer queue满时不等待，而是：

1. 记录slow connection warning；
2. 从outbound router移除该Connection；
3. 请求transport断开。

这是隔离慢客户端的正确方向：一个远端观察者不应无限拖住所有Thread event。

### 13.3 不可主动断开的连接

没有disconnect token的writer使用 `send().await`。其队列满时，单outbound router会等待。

router一旦停住：

```text
OutgoingEnvelope 128容量耗尽
  -> listener send await
  -> Core event停止消费
  -> 其他Thread和Connection的消息也可能被连带延迟
```

这是共享router的故障半径。单客户端 stdio/in-process场景可以接受更强背压；多客户端场景依赖transport具有主动断开慢消费者的能力。

### 13.4 Targeted 与 Broadcast 的差异

Broadcast只向 `initialized=true` 的Connection发送，并应用：

- experimental notification过滤；
- exact notification method opt-out。

Targeted envelope直接查目标Connection并发送，不再次检查initialized。正常Thread订阅加入本身已要求Connection initialized，所以多数thread-scoped路径仍受前置门约束。

### 13.5 发送成功不等于客户端处理成功

普通notification只表示消息进入router/writer队列。少数路径使用 `write_complete_tx` 等待transport writer确认写出，但也不等于客户端应用已接收、反序列化或提交UI状态。

因此协议缺少 per-event delivery receipt；恢复仍依赖Thread snapshot和pending request replay，而不是每条notification ack。

## 14. ThreadStatus 是派生状态，不是事件日志

`ThreadWatchManager` 从以下 runtime facts推导status：

- `is_loaded`；
- `running`；
- pending permission request计数；
- pending user input request计数；
- system error标记。

优先级是：

```text
NotLoaded
  < Active(running或有pending request)
  < SystemError
  < Idle
```

更准确地说，代码先检查NotLoaded，再检查Active，再检查SystemError，否则Idle。于是pending approval/input会让Thread保持Active，即使模型当前并未运行。

### 14.1 Active guard

permission或user input开始时，RAII guard增加对应 `u32` counter；Drop时spawn异步任务减少，使用saturating arithmetic防止下溢。

它避免异常返回漏清计数，但有两个观察边界：

- Drop后的减少是异步的，短时间status仍可保持Active；
- `clear_active_state`先归零后，迟到guard Drop只会saturating到0，不能识别旧generation。

### 14.2 Watch channel会合并中间状态

Thread status通过 `watch` 发布。慢订阅者只看到最新值，不会收到每次中间变化。

这适合“当前状态投影”，不适合审计“曾经等待过几次approval”。后者必须来自durable AgentStep/event log。

### 14.3 Running count不等于Active Thread数

全局 `running_turn_count` 只统计 `runtime.running`，不统计仅有pending approval/user input的Active Thread。

因此：

```text
ThreadStatus = Active(WaitingOnUserInput)
running_turn_count = 0
```

App Server graceful restart可以据此认为没有正在运行的assistant turn，即使某些Thread仍等待用户决定。

这是合理的产品选择，但不能把running count解释成“所有未完成AgentRun数”。

### 14.4 Status与event观察顺序修正

resume构造Thread response时还会检查 active Turn snapshot和Core `AgentStatus::Running`。若watcher仍显示Idle/NotLoaded但存在live in-progress Turn，`resolve_thread_status`会临时升级为Active。

这承认status watcher与listener event之间没有原子快照，并在读模型中做保守修正。

## 15. 延迟卸载状态机

### 15.1 两个连续条件

`UnloadingState` 同时订阅：

- 是否还有Connection；
- ThreadStatus是否Active。

只有两者都为false时才计算卸载目标：

```text
max(无订阅开始时间, 非Active开始时间) + 30分钟
```

这意味着两个条件都必须连续满足30分钟。期间任一状态变回true，计时基线都会更新。

### 15.2 Pending approval会阻止卸载

因为pending permission/user input会使ThreadStatus Active，所以无人连接时仍在等待审批的Thread不会在30分钟后直接卸载。

这是保护可恢复交互的重要细节：pending callback和Core等待状态都被保留，重连后可以 replay request。

代价是如果永远没有客户端回来，Thread也可能长期占用资源。当前没有“无订阅pending request最长保留时间”的独立上限。

### 15.3 Core状态二次确认

计时触发后，listener还会读取 `conversation.agent_status()`。若Core实际仍Running，它会重置观察到的inactive时间并继续等待。

这是对watcher漏事件或观察顺序差异的防御，避免仅凭派生status误杀正在运行的Thread。

### 15.4 Attach 与 unload互斥

attach和running resume订阅都在持有 `pending_thread_unloads` mutex时检查closing并修改订阅。

unload触发也在同一mutex下：

1. 再次确认没有订阅且不Active；
2. 插入Thread ID到pending set；
3. 后续attach看到closing并拒绝。

这个锁充当很小的线性化点，防止：

```text
unloader判断无人订阅
  || 新Connection同时attach
  -> 仍把刚attach的Thread关掉
```

虽然代码需要允许“持有Mutex跨await”的clippy例外，但这里的目的明确：订阅加入与closing lease必须串行。

## 16. 卸载提交不是完整事务

`unload_thread_without_subscribers` 的顺序是：

```text
cancel Thread pending server requests
  -> remove ThreadState、subscription和listener
  -> spawn Core shutdown，最多等待10秒
  -> shutdown成功：remove Core Thread + watch state + broadcast ThreadClosed
  -> submit失败/timeout：清pending closing标记，Core Thread留在manager
```

### 16.1 优点

- shutdown前先取消无法回答的客户端request；
- 先清listener，避免shutdown期间继续把事件发给不存在的订阅者；
- 10秒上限避免cleanup永久阻塞；
- 成功后才发送ThreadClosed；
- pending closing set让并发resume得到明确retry错误。

### 16.2 Partial state

若 shutdown submit失败或10秒timeout：

- Core Thread仍可能加载；
- App Server ThreadState、listener和subscription已经删除；
- pending server request已取消；
- closing flag被清除；
- 后续attach可为现有Core Thread重新创建ThreadState/listener。

这是一种可恢复partial state，但“留下loaded Thread”不等于保持原交互上下文完整。尤其 pending callback已不可恢复。

### 16.3 ThreadClosed 是global notification

成功idle unload发生时，本来就没有Thread订阅者。代码使用global broadcast发送 `ThreadClosed`，让所有initialized Connection都能更新loaded Thread列表。

这说明notification audience分成两类：

- Turn/item等内容事件：Thread-scoped subscribers；
- Thread目录生命周期：global initialized clients。

前端不能假设所有包含 `threadId` 的notification都只会发给已订阅该Thread的Connection。

## 17. Listener clear 的边界

`ThreadState.clear_listener` 会：

- 发送cancel；
- 清command sender；
- reset当前Turn history；
- 清Core Thread weak pointer；
- 释放Skills watcher registration。

它不会重置 `experimental_raw_events`，也不会显式清：

- pending interrupts；
- pending rollback；
- turn summary；
- last terminal Turn ID；
- last settings之外的其他ThreadState字段。

完整 `remove_thread_state` 会把整个ThreadEntry从manager移除，因此这些字段随Arc最终释放。单纯 `clear_all_listeners` 则保留ThreadEntry和subscription bookkeeping，只清listener相关字段。

App Server shutdown随后还会shutdown全部Core Threads，所以这个中间态通常很短；若把 `clear_all_listeners`复用于热重启，必须理解它不是完整ThreadState reset。

## 18. Skills watcher与listener同寿命

listener启动前会基于当前 Thread config和environment selections注册Skills watcher。registration保存在ThreadState，clear listener时释放。

这使 watcher与实际消费Thread event的listener代际绑定，避免旧 listener被替换后仍保留过期watch registration。

不过 watcher注册发生在确认当前 listener identity之前。并发调用 `ensure_listener_task_running` 时，后到调用可能先完成一次多余registration，发现listener已匹配后靠局部值Drop清理。

这是安全但可能浪费工作的“先准备、锁内commit”模式。

## 19. 优质设计总结

### 19.1 单写者串行化快照与live events

running resume不是靠时间猜测，而是把快照/订阅操作放入唯一listener command queue，显著缩小历史与live event之间的缝隙。

### 19.2 `Arc::ptr_eq` + generation双重fencing

对象identity判断是否复用，generation判断旧task是否仍有清理authority，能抵抗同Thread ID下的listener替换和迟到退出。

### 19.3 Subscription双索引

Thread→Connections服务fanout，Connection→Threads服务断线清理，避免热点路径全表扫描。

### 19.4 Closing set作为小型线性化点

attach/resume与idle unload共享 `pending_thread_unloads` mutex，使“最后一次无订阅判断”和“禁止新订阅”成为一个可推理边界。

### 19.5 Pending request可重放

server→client request按Thread保存，不绑定最初Connection。断线后重新resume可以恢复approval/user input，而不是让Core永久等一个已经消失的socket。

### 19.6 派生status与durable事实分离

watch channel只保存当前UI状态，history/rollout保存可恢复事实。没有为了UI方便把每次状态跳变都伪装成持久业务事实。

### 19.7 慢远端客户端主动断开

多客户端transport用 bounded writer queue和 `try_send`，满时断开单个慢连接，控制共享outbound router的故障半径。

## 20. 当前风险与改进方向

### 20.1 建立明确的Connection/Thread authority

当前自动订阅所有initialized Connection，并让任一订阅者 first-response-wins。若未来支持不同用户或权限域，应增加：

- Thread owner/ACL；
- observer与operator角色；
- approval responder selection；
- server request中明确的eligible responder集合；
- audit中记录实际response Connection identity。

### 20.2 Raw event opt-in改为per-connection

Thread sticky bit应改成：

```text
subscription[connection].raw_events_enabled
```

listener仍可只消费一次Core event，但扇出时按Connection capability过滤。最后一个raw subscriber退出后不应影响普通订阅者。

### 20.3 为event增加sequence/generation

至少可以在App Server层提供：

- listener generation；
- Thread event sequence；
- resume snapshot watermark；
- subscription generation。

客户端由此能丢弃unsubscribe后的迟到event、检测live gap，并把UI bug从“猜顺序”变成可验证协议。

### 20.4 给listener command queue设置容量和公平性

可以考虑：

- bounded queue；
- resume/resolve等控制命令分级；
- 每轮最多处理N条command后让出给Core event；
- unload到期后提高cleanup优先级；
- command enqueue失败返回明确overloaded错误。

### 20.5 给ordered resolve设置deadline

等待 listener completion的调用应有deadline和可观测指标。超时后需要区分：

- command未入队；
- 已入队未执行；
- notification已进outbound但未写出。

### 20.6 Client compatibility不要last-writer-wins

共享Thread中的client name、form support和MCP auto-deny应按执行Turn冻结，或由显式controller Connection拥有。observer resume不应改变正在运行Session的兼容策略。

### 20.7 Unload做成可恢复阶段状态

当前先删App Server state再shutdown Core。更稳的状态机可以是：

```text
Open
  -> Closing(generation, deadline)
  -> CoreShutdownAcknowledged
  -> AppStateRemoved
  -> Closed notification
```

若超时，仍保留足够listener/subscription generation信息用于恢复，而不是只留下Core Thread。

### 20.8 Pending interaction增加retention policy

pending approval阻止idle unload是正确的，但仍应有：

- 最大无人订阅时长；
- timeout后的明确interrupted/error事实；
- 重连UI可见的deadline；
- 取消原因和actor记录。

### 20.9 Outbound隔离到per-connection或per-thread

共享128容量envelope queue让某些transport的慢writer可能影响全部Thread。可用：

- per-connection mailbox；
- notification coalescing；
- delta丢弃/终态保留策略；
- per-thread公平调度；
- queue depth和disconnect metric。

## 21. 映射到当前 NestJS Agent 项目

当前项目不需要复制Codex多客户端daemon，但应该提前分清以下边界。

### 21.1 WebSocket订阅不是AgentRun ownership

建议数据模型：

```text
Conversation
  长期业务会话

AgentRun
  一次运行事实与最终状态

RunEvent
  可恢复、带seq的事件日志

SocketSubscription
  短期连接投影，不作为业务权威
```

浏览器刷新只重建SocketSubscription，不创建新的AgentRun，也不隐式改变运行配置。

### 21.2 Snapshot + cursor再进入live

云端比本地Codex更适合使用数据库cursor：

```text
事务读取Run snapshot + latestSeq
  -> 返回snapshot
  -> 客户端从latestSeq+1订阅/replay
  -> 再切live stream
```

这样不必完全依赖单进程listener命令队列，也能跨NestJS实例恢复。

### 21.3 HITL要有明确responder authority

Approval记录至少应包含：

- `requestId`；
- `agentRunId`；
- `status`；
- eligible actor/user/role；
- `respondedBy`；
- expected version；
- expiresAt；
- idempotency key。

不要把同一个approval广播给所有socket后让“第一个response”自然成为权限模型。

### 21.4 Delta可丢，终态必须可恢复

可以对text delta做有界内存fanout和慢客户端断开，但以下事件应持久化或可重建：

- Run started；
- Tool call requested；
- Approval requested/resolved；
- Tool completed/failed；
- Run completed/failed/interrupted；
- 最终Assistant message。

### 21.5 运行能力冻结到AgentRun

模型、工具集、权限、客户端支持能力和协议版本在Run开始时形成snapshot。新浏览器resume只改变渲染能力，不覆盖正在运行Run的执行策略。

### 21.6 延迟清理用lease而非内存Timer

多实例NestJS下，30分钟内存watcher不能成为唯一authority。应在数据库保存：

- last subscriber time仅作hint；
- run status；
- pending HITL；
- worker lease和heartbeat；
- cleanup eligibility timestamp；
- cleanup generation。

定时worker通过CAS领取cleanup lease，确认generation和状态未变后再终止runtime。

## 22. 可直接采用的验收问题

实现Streaming和HITL时，可以用下面问题自审：

1. 两个浏览器同时观察一个Run时，谁有权审批？
2. 发起浏览器断线后，approval由谁接管？
3. 新订阅建立时，snapshot和live delta之间会不会漏事件？
4. unsubscribe后是否可能收到迟到event，客户端如何识别？
5. text delta队列满时丢什么，Run terminal event是否仍保证到达？
6. WebSocket写成功是否被误当成业务ack？
7. socket断开会不会错误地cancel仍应继续的AgentRun？
8. 最后一个订阅者离开后，pending HITL是否阻止cleanup？
9. cleanup和新resume并发时，线性化点在哪里？
10. worker shutdown超时后，数据库、runtime和订阅状态如何恢复？
11. 客户端能力是否会覆盖共享Conversation或正在运行的Run？
12. 是否有event seq、snapshot watermark和幂等resume cursor？

## 23. 结论

Codex App Server Thread listener的核心价值不在“把事件发到WebSocket”，而在它建立了一个可推理的单写者域：Core event、running resume、goal update和request resolved都经过同一listener顺序；订阅关系另行维护；延迟卸载再通过closing set与新attach互斥。

它最值得学习的部分是：

- listener identity与generation fencing；
- snapshot + subscription放入单写者队列；
- Thread/Connection双索引；
- pending server request跨Connection replay；
- Active status保护等待审批的无人订阅Thread；
- 慢远端Connection的主动隔离。

也要明确它的适用前提：多个Connection属于同一安全域。自动订阅所有初始化客户端、Thread级raw sticky bit、任一订阅者first-response-wins、共享Thread client capability last-writer-wins，都不能直接照搬成云端多用户Agent权限模型。

对当前项目最重要的转换是：把Codex进程内listener的顺序保证，升级为数据库中的Run event sequence、snapshot watermark、HITL responder authority和cleanup lease。这样才能让Vue刷新、NestJS多实例、Worker重启和用户权限同时成立。
