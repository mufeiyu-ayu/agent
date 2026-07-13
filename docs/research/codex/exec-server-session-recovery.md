# Exec Server 会话租约、断线重连与进程输出恢复

Exec Server 的恢复目标不是“让所有 RPC 看起来从未断线”，而是更窄、更可验证的一件事：

> 在一个短暂的连接丢失窗口内，保留同一组子进程，重新绑定通知通道，再用带序号的 retained output 补齐客户端没有确认收到的进程事件。

这套设计把物理连接、逻辑会话、子进程、输出事实和客户端事件投影分开。它可以恢复正在运行的 shell 进程，但不会恢复连接级文件句柄、流式 HTTP body 或任意未完成 RPC。

本文重点回答：

- `sessionId`、`connectionId` 和 `processId` 分别是谁的身份？
- 30 秒 detached TTL 保护什么，又不保护什么？
- 通知在断线期间被丢弃时，客户端怎样从 retained output 补齐？
- 进程启动和 stdin 写入遇到“服务端已提交、响应丢失”时怎样处理？
- 这套方案迁移到云端 Agent Runtime 时，哪些边界值得直接学习？

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/exec-server/src/server/transport.rs`
- `codex-rs/exec-server/src/server/processor.rs`
- `codex-rs/exec-server/src/server/handler.rs`
- `codex-rs/exec-server/src/server/session_registry.rs`
- `codex-rs/exec-server/src/server/process_handler.rs`
- `codex-rs/exec-server/src/local_process.rs`
- `codex-rs/exec-server/src/process.rs`
- `codex-rs/exec-server/src/client.rs`
- `codex-rs/exec-server/src/client_recovery.rs`
- `codex-rs/exec-server/src/client_transport.rs`
- `codex-rs/exec-server/src/client_api.rs`
- `codex-rs/exec-server-protocol/src/protocol.rs`
- `codex-rs/exec-server/src/server/handler/tests.rs`
- `codex-rs/exec-server/src/server/processor.rs` 内嵌测试
- `codex-rs/exec-server/src/client_recovery_tests.rs`
- `codex-rs/exec-server/src/client.rs` 内嵌测试

## 2. 先分清七个状态域

Exec Server 的“连接恢复”横跨七份状态：

| 状态域 | 典型内容 | 所有者 | 能否跨重连 |
| --- | --- | --- | --- |
| Physical Transport | WebSocket、Noise stream、stdio、读写task | 单次连接 | 否 |
| Connection Handler | initialized gate、通知sender、FS handles、HTTP streams | 单次连接 | 否 |
| Logical Session | session UUID、attach状态、ProcessHandler | SessionRegistry | 短期可以 |
| Local Process | PTY/pipe、stdin、retained output、exit/closed | ProcessHandler | 可以 |
| Client Connection State | Connected/Recovering/Failed、RpcClient | ExecServerClient | 重新安装 |
| Client Process Projection | last seq、pending events、write counter | SessionState | 可以 |
| Higher-level Consumer | MCP stdio、shell tool、UI output | 调用方 | 依赖事件恢复结果 |

最关键的边界是：

```text
重连保留 Logical Session + Local Process
重建 Physical Transport + Connection Handler
```

所以“会话恢复”并不等于整个 Exec Server 连接上的所有能力都可恢复。

## 3. 三类身份不是同一个 ID

### 3.1 sessionId：逻辑执行环境句柄

新连接首次 `initialize` 且不带 `resumeSessionId` 时，服务端生成随机 UUID，作为 SessionRegistry 的 key。

该 Session 持有一个 `ProcessHandler`，而 `ProcessHandler` 再持有这次会话创建的所有 Local Process。

`sessionId` 的作用是：

- 在同一个 Exec Server 进程内找到原 SessionEntry；
- 让新物理连接接管原 ProcessHandler；
- 不改变原有 processId 和 retained output。

它不是：

- OS pid；
- 持久数据库主键；
- 跨 Exec Server 重启恢复凭证；
- 自动包含用户、租户或 workspace scope 的 authorization object。

### 3.2 connectionId：防止旧连接迟到清理新连接

每次 attach 尝试都会生成新的随机 `connectionId`。它只存在服务端内存，不进入公开协议。

AttachmentState 同时保存：

- `current_connection_id`；
- `detached_connection_id`；
- `detached_expires_at`。

旧连接的 expiry task 只有在以下条件全部成立时才可删除 Session：

```text
当前没有 active connection
&& detached_connection_id 仍等于旧 connectionId
&& deadline 已到
```

这是一种 generation fencing。仅检查 sessionId 不够，因为同一个 sessionId 可能已经被新连接恢复。

### 3.3 processId：客户端选择的会话内协议 key

`processId` 由客户端提供，并明确不是 OS pid。

它用于：

- start/read/write/signal/terminate 路由；
- connection-global notification 回到正确 SessionState；
- 保持重连前后同一进程的逻辑身份。

服务端在同一 Logical Session 内拒绝重复 processId；进程 Closed 后再保留 30 秒，清理后才可复用。

## 4. Initialize 是连接级握手，也是 Session attach 点

连接建立后必须遵守：

```text
initialize request
  -> attach new/resumed session
  -> initialize response(sessionId)
initialized notification
  -> 允许 process / filesystem / HTTP methods
```

一个连接只能调用一次 `initialize`。如果 attach 失败，`initialize_requested` 会回滚，允许该连接再次尝试；成功后再次调用则返回 invalid request。

服务端对普通方法有三层 gate：

1. 已请求 initialize；
2. SessionHandle 仍绑定当前 connectionId；
3. 已收到 initialized notification。

旧连接被新连接接管后，即使旧 Handler 仍暂时存活，`require_session_attached` 也会拒绝继续处理方法。

### 4.1 为什么 RPC reader 要在 initialize 前启动

恢复 Session 时，服务端会在 `initialize` 处理中把原 ProcessHandler 的 notification sender 切到新连接。

此时旧进程可能正在高速输出。通知可能早于 initialize response 到达。

客户端因此先启动 RPC event reader，再发 initialize。否则 bounded event channel 可能被恢复后的通知突发填满，反过来阻塞 initialize response，形成握手死锁。

这是一个很值得学习的协议细节：

> 当恢复动作会在响应前重新打开事件生产者时，消费者必须先 ready。

## 5. 服务端 Session attach/detach 状态机

可以把 SessionEntry 简化成：

```text
Attached(connection A)
  -- A shutdown/disconnect --> Detached(A, deadline=now+30s)

Detached(A)
  -- resume before deadline --> Attached(connection B)
  -- expiry for A --> Removed + terminate all processes

Attached(connection B)
  -- stale expiry for A --> no-op
```

### 5.1 新建 Session

不带 resumeSessionId：

1. 生成 session UUID；
2. 创建 ProcessHandler；
3. 把新连接 notification sender 注入 LocalProcess；
4. 记录 active connectionId；
5. 写入 SessionRegistry。

### 5.2 恢复 Session

带 resumeSessionId：

1. 在 registry map 查找 SessionEntry；
2. 不存在则返回 unknown session；
3. deadline 已到则先从 map 移除，再在锁外 shutdown ProcessHandler；
4. 仍有 active connection 则返回专用 `session already attached` 错误；
5. 否则替换 notification sender；
6. 用新 connectionId 清空 detached generation 和 deadline。

SessionRegistry map 锁把“检查、移除或接管”线性化。Process shutdown 在锁外等待，避免一个慢终止阻塞所有 Session attach。

### 5.3 detach

Handler shutdown 会：

1. cancel connection-owned background tasks；
2. 等待这些 task 结束；
3. shutdown connection-owned FileSystemHandler；
4. 若 SessionHandle 仍属于自己，执行 detach。

detach 在 AttachmentState 锁内先检查 connectionId。若旧连接已被替换，迟到 shutdown 不会清空新连接的 sender。

成功 detach 后：

- notification sender 设为 None；
- 进程继续运行；
- 记录旧 connectionId 与 30 秒 deadline；
- spawn expiry task。

### 5.4 active attach 冲突不是永久失败

客户端断线检测和服务端断线检测各自运行。新连接可能先到，而旧 Handler 还没完成 detach。

此时 resume 得到 `SESSION_ALREADY_ATTACHED`。客户端把它列为可重试错误，每 100ms 再试，而不是把它误判为 session 已丢失。

## 6. 30 秒 TTL 是内存进程保活窗口

生产环境中：

- Detached Session TTL：30 秒；
- Closed Process retention：30 秒；
- Client Session recovery timeout：25 秒。

客户端故意把恢复总预算设为 25 秒，为服务端 30 秒窗口留出时钟起点和调度差异余量。

这三个窗口保护不同对象：

| 窗口 | 保护对象 | 到期动作 |
| --- | --- | --- |
| Detached Session TTL | 整个 ProcessHandler | registry remove + terminate剩余进程 |
| Closed Process retention | 单个已Closed进程的最终状态 | 从process map删除 |
| Client recovery timeout | 一次逻辑恢复尝试 | Connection进入Failed，失败所有in-flight work |

### 6.1 精确截止时刻没有额外 grace

attach 时若 `now >= detached_expires_at`，即使 expiry task 尚未运行，也会主动删除并 shutdown Session，然后返回 unknown session。

所以 TTL 是语义deadline，不只是后台清理建议。

### 6.2 仅内存恢复

SessionRegistry、ProcessHandler、retained output 都在内存中。Exec Server 进程崩溃或重启后，sessionId 无法恢复原子进程。

这一点与 Thread rollout 或数据库恢复完全不同。

## 7. 断线期间通知关闭，但事实继续积累

LocalProcess 的 notification sender 是可替换的 `RwLock<Option<RpcNotificationSender>>`。

detach 后 sender 为 None：

- 不再尝试向死连接 push process/output；
- 子进程 stdout/stderr/PTY 读取 task 继续运行；
- output 仍写入 retained deque；
- next sequence 继续递增；
- exit 和 closed 仍写入本地状态与事件日志。

这体现了清晰分层：

```text
process output fact != push notification delivery
```

通知是低延迟投影，retained state 才是短期恢复事实。

## 8. 单调序号统一 Output、Exited 与 Closed

每个 RunningProcess 从 `next_seq = 1` 开始，以下事件共享同一个序号空间：

- stdout/stderr/pty output chunk；
- exited；
- closed。

典型顺序是：

```text
1 output(stdout)
2 output(stderr)
3 exited(exitCode=0)
4 closed
```

`Exited` 表示拿到进程退出码；`Closed` 表示两个输出stream都已结束，之后不会再产生output。

两者必须分开，因为进程退出通知和pipe drain的完成顺序不是同一件事。

### 8.1 服务端产生顺序与网络到达顺序不同

output、exit、closed由不同异步task产生。虽然序号在 process map 锁内分配，但通知发送发生在释放锁之后。

因此网络可能先收到 seq=4，再收到 seq=3 或尾部output。

客户端不能按到达顺序发布，必须按seq重排。

## 9. 服务端 retained output

每个进程最多保留 1 MiB output bytes：

```text
VecDeque<RetainedOutputChunk>
retained_bytes <= 1 MiB（通过头部淘汰逼近）
```

新增chunk后若超预算，从最旧chunk开始逐项淘汰。

这里的预算按完整chunk淘汰，因此单个大chunk可在插入后被立即淘汰；队列最终甚至可能为空，但 next_seq 仍保留事实进度。

### 9.1 process/read

读取参数包括：

- `afterSeq`：只返回更大的seq；
- `maxBytes`：本次响应预算；
- `waitMs`：没有新事实时long poll。

响应包括：

- retained output chunks；
- `nextSeq`；
- exited/exitCode；
- closed；
- failure；
- sandboxDenied。

当未指定 maxBytes 时，`nextSeq`直接反映进程全局next_seq，而不仅是最后返回chunk后一位。恢复算法正是用它判断“服务端已经前进到哪里”。

### 9.2 maxBytes 不是严格单chunk上限

为了保证有进展，只要当前响应还没有chunk，第一个匹配chunk即使超过 maxBytes 也会被返回。

所以 maxBytes 是分页目标，不是对单条消息的硬安全上限。

### 9.3 read本身没有显式truncated标记

协议没有返回 earliestRetainedSeq 或 outputLost 字段。

如果 afterSeq 太旧，调用方只能从序号缺口和 nextSeq 推断历史已被淘汰。内置 recovery 会严格检查并失败，但普通直接调用者需要自己处理这一语义。

## 10. 客户端连接状态机

一个逻辑 ExecServerClient 维护：

```text
Connected(Arc<RpcClient>)
Recovering
Failed(message)
```

### 10.1 单飞恢复

RPC reader发现 disconnected 或 notification protocol error 时，会携带“失败的 RpcClient 对象identity”请求恢复。

只有当前 ConnectionStatus 仍指向同一个 Arc 才能从 Connected 切到 Recovering。

这避免：

- 两个断线事件同时启动两次恢复；
- 旧 reader 的迟到错误把刚安装的新 RpcClient 再次置为Recovering；
- stale recovery 覆盖更新的连接。

### 10.2 Wait 与 FailFast

客户端有两种调用策略：

- Wait：Recovering 时等待 connection_changed，恢复后继续；
- FailFast：立即返回“environment is recovering”。

它们共享同一 Inner，不是两份连接。

调用方可以根据交互语义选择：后台工作可等待，用户即时探测可快速失败。

### 10.3 恢复总流程

```text
transport disconnected
  -> Connected -> Recovering
  -> 立即失败所有HTTP body streams
  -> 等待active process starts收口
  -> 获取已有sessionId
  -> 新建physical transport
  -> 启动新RPC reader
  -> initialize(resumeSessionId)
  -> initialized
  -> 逐进程process/read补事件
  -> 安装新RpcClient
  -> Recovering -> Connected
```

任一步遇到不可重试错误，或总时间超过25秒，进入 Failed，并失败所有process Session与HTTP stream。

## 11. Transport recovery策略

### 11.1 普通 WebSocket

重连复用原 endpoint，只把 sessionId 注入新的 initialize。

重试间隔固定为100ms，直到成功、不可重试错误或25秒deadline。

### 11.2 Noise Rendezvous

Noise恢复保留 harness identity，但每次物理连接都向registry获取新的单次bundle：

- WebSocket URL authorization；
- environment ID；
- executor registration ID；
- pinned executor public key；
- harness key authorization。

这些字段作为一个原子bundle使用，不能跨registry response混搭。

Registry暂时不可用时采用500ms起步、最高5秒的指数退避，并按sessionId和attempt加入确定性jitter，减少环境集中恢复时的惊群。

### 11.3 stdio不恢复

stdio transport只服务一个连接。结束后processor直接shutdown整个 SessionRegistry，所有进程终止。

客户端也不会为stdio配置 reconnect strategy。

因此同一套Exec API在不同transport上具有不同恢复能力，调用方不能只看trait签名假设一致。

## 12. 进程事件恢复算法

新连接initialize成功后，客户端对所有 `recoverable=true` 的 SessionState逐个执行：

```text
process/read(
  processId,
  afterSeq = lastPublishedSeq,
  maxBytes = none,
  waitMs = 0
)
```

### 12.1 为什么通知和read可以并行

新RPC reader在initialize前就已启动，所以恢复期间可能同时收到：

- 服务端重绑后push的新通知；
- process/read返回的retained旧输出。

客户端用同一个 OrderedSessionEvents 合并两路输入：

- `last_published_seq`：已经对上层可见的连续前缀；
- `pending: BTreeMap<seq, event>`：提前到达、尚有缺口的事件；
- `exit_published`；
- `closed_published`；
- failure。

重复或小于等于last seq的事件被忽略，不会重复发布。

### 12.2 只发布连续前缀

收到任何带序号event时：

1. 插入pending；
2. 从 `lastPublished+1` 开始循环取；
3. 连续就发布到 ExecProcessEventLog；
4. 遇到第一个缺口停止。

Closed 即使先到，也只留在pending。只有它前面的output和exit都发布后，才真正对消费者发布Closed并删除process route。

### 12.3 从ReadResponse重建terminal events

ReadResponse只直接返回output chunks；exit/closed是状态字段，没有各自独立seq。

客户端用 `targetSeq = nextSeq - 1` 重建：

- closed=true时，Closed必须位于targetSeq；
- exited=true且尚无Exit event时，允许补一个唯一缺失序号作为Exited；
- 若closed序号与recovered output冲突，协议失败；
- 若缺失不止一个、无法唯一解释，判定retention gap。

这是一种受约束的推断，不是无条件猜测。

### 12.4 retention gap失败关闭

如果1 MiB retained output 已淘汰了客户端缺失的chunk，算法不会跳过缺口继续展示后半段。

它会：

1. 返回“events are no longer retained”协议错误；
2. 尝试terminate该进程；
3. 从client session map移除；
4. 对消费者发布Failed事件；
5. polling read得到合成的closed failure response。

这里选择一致性优先：宁可明确失败，也不把缺行输出伪装成完整记录。

## 13. 客户端事件投影也有双重预算

客户端为每个process维护两个不同buffer：

### 13.1 对消费者的Replay EventLog

- 最多256个事件；
- 最多1 MiB retained bytes；
- 新subscriber先读replay，再接live broadcast；
- subscriber lagged时应回退到 process/read。

### 13.2 等待缺口的Reorder Buffer

- 最多256个future events；
- 最多1 MiB pending bytes；
- 单个event超过1 MiB直接失败；
- 恰好关闭当前缺口的event可以在buffer满时被接受，因为它会同步触发drain。

Replay解决“新订阅者错过旧事件”，Reorder解决“同一连接内事件乱序”，两者不能混为一个队列。

## 14. stdin 写入的幂等窗口

网络断线存在经典歧义：

```text
client send write(bytes, writeId)
server writes bytes to child stdin
response lost
client cannot know whether commit happened
```

Codex 的处理是：

1. SessionState为每次逻辑write生成递增writeId；
2. transport关闭后，Session::write等待恢复；
3. 重试时复用同一writeId和同一bytes；
4. 服务端每个process保留最近4096个已接受writeId；
5. 重复ID直接返回Accepted，不再写stdin。

### 14.1 服务端提交顺序

服务端先reserve stdin channel permit，再次检查writeId：

- 若另一个并发请求已经提交同ID，直接Accepted；
- 否则同步 `permit.send(bytes)`；
- 在任何下一次await之前记住writeId。

这样请求handler即使在发送后被取消，也不会留下“已写入但ID尚未记录”的await窗口。

### 14.2 不是无限期exactly-once

缓存只有4096项。非常旧的writeId被淘汰后再次出现，可能重复写入。

因此更准确的语义是：

> 在同一Process存活且writeId仍在bounded dedupe window内，提供at-most-once stdin提交。

## 15. 进程启动的ambiguous commit处理

`process/start`不能像stdin write一样简单重试，因为重复processId会被服务端拒绝，而第一次start可能已经成功，只是响应丢失。

客户端采用“保守清理，不自动认领”策略。

### 15.1 start前先注册不可恢复SessionState

start流程先：

1. 确认当前RpcClient仍是active connection；
2. 增加active_process_starts；
3. 注册 `recoverable=false` 的SessionState；
4. 后台发送start RPC。

收到成功响应后才把recoverable设为true。

### 15.2 recovery先等start收口

断线恢复不会立刻扫描process，而是等待active process starts全部结束。

否则可能发生：

- recovery读到服务端已创建进程；
- start调用方仍收到失败；
- 同一个进程同时被当成成功和失败。

### 15.3 响应丢失时cleanup

若start遇到transport closed：

- 不把未确认的SessionState当作recoverable process；
- 恢复连接后循环调用terminate；
- 最后移除client route。

若start其实已成功，它会被清理；若从未创建，terminate返回not running。

这牺牲“尽量保住进程”，换来调用方不会接管一个自己从未确认创建成功的副作用。

### 15.4 调用方取消也清理

即使服务端start成功，如果结果channel接收方已经消失，后台task也会把recoverable改回false并清理进程。

这避免caller cancellation留下无人拥有的子进程。

## 16. in-flight RPC并没有统一自动重试

Session::read和Session::write有专门恢复循环；terminate cleanup也使用可等待恢复的路径。

但通用RPC并不会因为断线自动重放：

- environment/info；
- filesystem读写；
- signal；
- 普通HTTP request；
- 任意未来新增方法。

原因是这些操作的幂等性不同。框架没有用“自动重试所有请求”制造重复副作用。

特别是旧连接中的long-poll read：服务端read完成后还会再次检查SessionHandle是否仍属于当前connection，若已被恢复连接接管，就拒绝旧响应。这避免两个连接同时消费同一process状态。

## 17. 只恢复process，不恢复Connection Handler资源

ExecServerHandler本身属于物理连接，shutdown时会关闭：

- active streamed HTTP body tasks；
- FileSystemHandler中的连接级状态；
- 旧notification sender。

客户端开始recovery时也会立即失败所有HTTP body streams。

所以恢复矩阵更准确地是：

| 能力 | 断线后结果 |
| --- | --- |
| 已启动Local Process | 30秒内可恢复 |
| process output | 1 MiB保留窗口内可补齐 |
| process exit/closed | 进程保留窗口内可重建 |
| stdin write | 复用writeId安全重试，受4096窗口限制 |
| ambiguous process start | 恢复后终止，不自动认领 |
| streamed HTTP body | 立即失败，不resume |
| connection-owned FS open handle | shutdown，不resume |
| arbitrary in-flight RPC | 按方法处理，不统一重放 |

“Session”在这里主要是process continuity domain，不是所有连接资源的统一事务容器。

## 18. 两层重连不要混淆

代码中还有 `LazyRemoteExecServerClient`，它提供环境级lazy startup和reconnect singleflight。

需要区分：

### 18.1 Inner session recovery

- 同一个逻辑ExecServerClient；
- 使用已有sessionId；
- 恢复同一批process；
- ConnectionStatus在Recovering中等待；
- 25秒内完成。

### 18.2 Lazy client reconnect

- 旧逻辑client已经Failed；
- 后续调用共享一次新的connect attempt；
- 成功后替换current_client；
- 通常得到新的Logical Session；
- 旧client中的process已向消费者失败。

前者是“续上原会话”，后者是“环境还能重新建立一条新会话”。

## 19. 完整时序示例

```text
Client A                    Exec Server                    Child Process
   | initialize(new)             |                              |
   |---------------------------->| create session S             |
   |<------ sessionId=S ---------|                              |
   | initialized                 |                              |
   | process/start P             |----------------------------->|
   |<------ started P -----------|                              |
   |<------ output seq=1 --------|<------- stdout --------------|
   |                             |                              |
   X transport lost              |                              |
                                 | detach A, sender=None         |
                                 |<------- stdout 2,3 -----------|
                                 | retain seq=2,3                |
                                 |                              |
Client B                        |                              |
   | initialize(resume S)        |                              |
   |---------------------------->| attach B, sender=B            |
   |<------ sessionId=S ---------|                              |
   | initialized                 |                              |
   | process/read(P, after=1)    |                              |
   |---------------------------->|                              |
   |<------ chunks 2,3 ----------|                              |
   | publish continuous 1..3     |                              |
```

若seq=2已因1 MiB预算淘汰，而服务端只保留seq=3，Client B会报告recovery gap，不会只展示seq=3。

## 20. 值得学习的实现

### 20.1 物理连接与逻辑会话解耦

SessionRegistry让ProcessHandler不属于WebSocket task。连接断开不等于立即终止所有业务进程。

### 20.2 connection generation fencing

connectionId保护detach、expiry和stale handler，解决同sessionId被多代连接复用后的ABA问题。

### 20.3 通知不是事实来源

断线时关闭push，事实仍进入retained state；恢复时通过read追平。

### 20.4 单调序号覆盖lifecycle

Output、Exited、Closed共享序号，客户端可以证明自己拥有连续前缀，而不只是“似乎收到了最终状态”。

### 20.5 有界buffer配显式失败

服务端、客户端replay和reorder都有预算。超出能力后明确失败，而不是无限内存或静默缺数据。

### 20.6 ambiguous commit按操作类型处理

- stdin：operation ID + bounded dedupe；
- start：未确认则补偿terminate；
- output：seq + replay；
- HTTP stream：直接失败；
- active attach：可重试冲突。

这比一个全局“retry=true”更可靠。

### 20.7 先启动消费者再恢复生产者

RPC reader先于resume initialize启动，处理恢复握手期间的通知突发和背压。

### 20.8 client/server TTL留安全余量

client 25秒、server 30秒，而不是两个组件都卡同一deadline。

## 21. 已确认的风险与限制

### 21.1 Plain WebSocket的sessionId近似bearer handle

SessionRegistry自身只检查随机sessionId和attach状态，不绑定用户、租户或workspace principal。

plain WebSocket listener默认绑定loopback并拒绝带Origin header的HTTP请求，这降低浏览器跨站连接风险；但listen URL可以配置为其他地址，listener层没有额外application auth。

Noise Rendezvous在外层提供registry authorization、key pinning和加密通道，但SessionRegistry本身仍不表达principal scope。

迁移到云端时不能只依赖高熵runId恢复，必须校验tenant/user/environment ownership。

### 21.2 Session和Process都只有30秒，但时钟独立

进程在detach期间退出后，会启动自己的Closed retention timer；Session也有detach timer。

客户端25秒预算通常早于两者，但极端调度、长时间runtime pause或输出恢复耗时仍可能撞上边界。

### 21.3 recovery逐进程串行

`recover_processes`遍历Session snapshot逐个read。大量并发process时，前面的慢RPC会消耗全局25秒预算，后面的进程可能没有公平恢复机会。

通知reader虽已并行运行，但没有per-process恢复并发上限或优先级。

### 21.4 1 MiB按字节，不按语义

高速日志可在短断线内淘汰关键开头。协议没有spill-to-disk或output artifact。

### 21.5 ReadResponse缺显式event records

Exit和Closed只以状态字段返回，客户端要从nextSeq与缺口推断terminal seq。

当前算法有严格冲突检查，但协议若直接返回retained terminal event records，恢复语义会更直接。

### 21.6 closed process清理后unknown process不可恢复

如果进程已Closed且30秒后从process map删除，即使Session尚可attach，process/read也返回unknown process。客户端会尝试terminate、发布Failed，而不是恢复最终结果。

### 21.7 accepted write ID只有内存bounded cache

4096项淘汰后不再去重；Exec Server重启后全部丢失；writeId也没有跨client generation的全局namespace。

### 21.8 output sequence不提供持久ack

服务端不知道客户端真正消费到哪一seq，只保留固定1 MiB。它不能按ack安全回收，也不能为慢客户端动态扩大窗口。

### 21.9 notification sender切换不是事件屏障

sender在attach时直接替换。旧sender中已经排队但尚未发送的通知可能仍在旧connection pipeline中；新连接靠seq去重和read恢复，而不是依赖sender切换绝对无重叠。

### 21.10 普通WebSocket固定100ms重试可能放大故障

Noise registry路径有指数退避+jitter，普通WebSocket恢复则固定100ms。大量客户端同时断线时可能形成连接风暴。

### 21.11 shutdown逐Session等待

SessionRegistry shutdown取走所有entries后逐个await ProcessHandler shutdown。虽然不再持有registry锁，但大量进程的终止尾延迟会串行累积。

### 21.12 恢复成功缺少业务级receipt

ConnectionStatus变回Connected表示transport、initialize和process recovery都完成，但没有公开逐process recovery summary：

- 哪些process补了多少bytes；
- 是否有重复通知；
- 恢复耗时；
- 哪个process接近retention上限。

目前更多依赖内部错误和telemetry，不利于上层做精细UI解释。

## 22. 对当前 AI SEO Agent 的迁移建议

当前项目不应复制本地PTY细节，但应学习“事实、连接、投影、租约”分层。

### 22.1 云端对应关系

| Exec Server | AI SEO Agent建议 |
| --- | --- |
| sessionId | AgentRun execution generation / resume token |
| connectionId | SSE/WebSocket subscriber generation |
| processId | ToolCall / long-running operation ID |
| retained output | durable RuntimeEvent / AgentStep事实 |
| output seq | run-local monotonic event sequence |
| notification sender | SSE subscriber sink |
| detached TTL | subscriber lease，不是Run TTL |
| writeId | tool side-effect idempotency key |
| Failed event | durable/stream terminal failure projection |

### 22.2 Run不应随SSE断开而取消

浏览器刷新或网络切换只应detach subscriber：

```text
Run continues
RuntimeEvent persists
new subscriber resumes after lastEventId
```

是否取消Run必须是显式 `cancelRun(runId, generation)`，不能由transport close隐式决定。

### 22.3 durable event优先于内存retention

云端任务比30秒更长，也可能跨进程部署。关键AgentStep和tool result应持久化到PostgreSQL，再用SSE作为投影。

delta可有界缓存，但完成事实、审批结果、工具副作用和最终输出不能只在内存deque。

### 22.4 恢复必须绑定ownership

任何resume请求都要验证：

```text
run.tenantId == auth.tenantId
&& run.userId/role允许读取
&& generation仍有效
```

高熵runId只能防猜测，不能替代授权。

### 22.5 不同操作使用不同恢复策略

建议明确分类：

| 操作 | 断线恢复策略 |
| --- | --- |
| 只读状态查询 | 安全重试 |
| SSE event delivery | lastEventId + replay |
| Tool side effect | operationId + durable dedupe receipt |
| Run start | clientRequestId + create-once result |
| Approval response | requestId + first valid resolution wins |
| 外部HTTP stream | 失败重开或转artifact，不伪装resume |

### 22.6 recovery receipt进入可观测性

云端可返回：

```ts
interface RunResumeReceipt {
  runId: string
  connectionGeneration: string
  requestedAfterSeq: number
  replayedThroughSeq: number
  hasGap: boolean
  runStatus: 'running' | 'completed' | 'failed' | 'cancelled'
}
```

这比客户端仅凭“连接又开了”更容易排障。

## 23. 建议的 TypeScript 学习实验

可以先做纯内存lab，不进入正式产品代码：

### 23.1 Lease fencing

实现：

```ts
type Attachment =
  | { state: 'attached'; connectionId: string }
  | { state: 'detached'; connectionId: string; expiresAt: number }
```

验证旧expiry callback不能删除已由新connectionId接管的run。

### 23.2 Ordered replay

输入乱序事件：

```text
seq 1 output
seq 4 closed
seq 3 exited
seq 2 output
```

断言消费者只看到1、2、3、4。

### 23.3 Ambiguous command

模拟服务端已执行副作用但响应丢失，分别验证：

- 无operationId会重复；
- durable operationId可返回原receipt；
- bounded cache淘汰后语义退化。

### 23.4 Replay gap

只保留seq 5..10，客户端请求afterSeq=2。断言系统返回明确gap，不静默从5继续。

## 24. 验收问题

- [ ] 能区分transport、connection handler、logical session和process生命周期。
- [ ] 能解释为什么sessionId之外还需要connectionId。
- [ ] 能解释为什么resume前必须先启动notification consumer。
- [ ] 能解释Output、Exited、Closed为什么共享序号但分成三类事件。
- [ ] 能解释1 MiB retention不足时为什么选择Failed而不是跳过。
- [ ] 能解释stdin writeId解决了哪种ambiguous commit，以及4096窗口的限制。
- [ ] 能解释process/start为何未确认时选择terminate补偿。
- [ ] 能列出不会随Session恢复的connection-owned资源。
- [ ] 能把本地Session恢复翻译为云端Run事件重放与subscriber lease。
- [ ] 能说明resume token为什么不能替代tenant authorization。

## 25. 结论

Exec Server 恢复机制最值得学习的不是“WebSocket重连”，而是以下组合：

```text
逻辑Session与物理Connection分离
+ connection generation fencing
+ 有界retained facts
+ 单调event sequence
+ notification/read双路径合并
+ operation-specific ambiguous commit策略
+ 明确的恢复deadline与失败终态
```

它也清楚暴露了边界：这是30秒内、内存级、process-focused的恢复，不是跨进程持久工作流，也不是所有RPC的透明重试层。

对云端Agent最重要的迁移不是复制其TTL数值，而是把Run事实放到连接之外，把subscriber当作可替换投影，并让每类副作用拥有自己的幂等与恢复协议。
