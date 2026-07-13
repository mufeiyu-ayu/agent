# Server Request Routing：当 Agent 反过来向客户端提问

本文研究 Codex App Server 的反向 JSON-RPC：Agent 在 Turn 中向一个或多个客户端发送 approval、request-user-input、MCP elicitation、dynamic tool 等 ServerRequest，并等待客户端响应。重点是 responder authority、pending callback、重连重放、Turn terminal 清理和 UI 收口顺序。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. App Server 同时是 server 与 client

普通方向：

```text
UI -> App Server: turn/start
App Server -> UI: response / notification
```

反向方向：

```text
Core emits approval/elicitation event
App Server -> UI: JSON-RPC ServerRequest(id, params)
UI -> App Server: JSON-RPC response(id, result)
App Server -> Core: Op::...Answer / ...Approval
```

这不是普通 notification。ServerRequest 会暂停某个 runtime continuation，必须有 exactly-one resolution、超时/取消语义和明确 responder 权限。

## 2. 一个 pending callback 保存三类身份

`PendingCallbackEntry` 保存：

- process-global ServerRequest `RequestId`。
- optional Thread ID。
- typed `ServerRequest` 原文。
- oneshot callback sender。

Thread ID让 Turn terminal 时能批量清理，也让 resume 新连接时只重放该 Thread 的 pending request。保存原 request 则可：

- 重放同一个 ID与参数。
- 根据原 request type解析 response做 analytics。
- 生成 resolved notification的关联 ID。

这是正确的 pending-operation record 最小形态；但它只存在进程内内存，不是 crash-safe durable request。

## 3. Request ID 是 process-global，不是 connection-scoped

入站 ClientRequest 使用 `ConnectionRequestId { connectionId, requestId }`，因为不同 WebSocket 都可能从 1开始编号。

反向 ServerRequest 则由 `AtomicI64` 全进程递增，callback map只以 `RequestId` 为 key。客户端回包进入 `process_response()` 时也只传 ID，不绑定发送该响应的 connection ID。

好处是同一 pending request可以广播/重放给多个连接，任何一个响应都能命中同一 callback。

风险是 responder authority 也因此退化为“知道全局 ID并能给 App Server回包的任一连接”。没有校验响应连接是否属于 request投递集合、是否仍订阅该 Thread、是否拥有 approval角色。

## 4. Thread-scoped request 会发给所有当前订阅连接

`ThreadScopedOutgoingMessageSender` 持有 Thread ID和订阅 connection IDs。发送 request 时：

1. 先在 callback map登记 entry。
2. 给每个 subscribed connection发送同一个 request ID。
3. 任一 client的第一份 response `remove_entry()`，成为唯一 winner。
4. 后续重复 response只记录“找不到 callback”。

这提供 first-response-wins 和 exactly-once callback consumption，却没有 responder选举。

如果桌面、IDE、移动端同时订阅同一 Thread，它们都可能展示同一 approval；任一设备都可以批准。产品必须明确这是期望的 shared-control，还是应指定 primary interactive owner。

## 5. Partial send failure 会取消所有 callback

向多个 connection循环发送时，如果前几个成功、后一个失败：

- 记录 send error。
- 从 callback map移除整个 request。
- 已经收到 request的客户端之后响应，会得到 unknown callback。
- oneshot receiver因 sender drop得到 `RecvError`，上层执行 fallback。

这是 fail-closed 倾向，但客户端表面可能仍显示可操作 prompt，直到 resolved/Turn terminal或本地超时。

更好的 fan-out receipt应记录：

```ts
type DeliveryState = {
  requestId: string;
  deliveredTo: string[];
  failedTo: string[];
  responseAuthority: string[];
};
```

只有零个可用 responder时才整体失败；部分失败应撤销已投递 UI，或继续等待并明确 degraded delivery。

## 6. Pending request 可在 resume 时重放

新 connection订阅一个运行中的 Thread 后，App Server 会按 RequestId排序，把该 Thread 所有 pending request重发给它。ID与参数保持不变。

这解决了：

- UI 刷新后重新显示 approval。
- WebSocket短暂断开后恢复交互。
- 第二个客户端接管等待中的请求。

但它只在同一 App Server进程内成立。进程崩溃后 callback、等待中的 Core sender与投递集合都不存在；rollout也不持久化完整 pending request状态。

所以 replayable within connection lifecycle 不等于 recoverable across process crash。

## 7. `serverRequest/resolved` 是多客户端 UI 收口信号

第一份 response被 callback consumer拿到后，各业务 handler先调用 `resolve_server_request_on_thread_listener()`：

1. 向 Thread listener command channel发送 ResolveServerRequest。
2. listener向当前订阅连接广播 `serverRequest/resolved { threadId, requestId }`。
3. 等通知发送流程完成。
4. handler再 drop active guard并向 Core提交 answer/decision。

测试要求 resolved notification 先于后续 item/completion event。这能让所有没有抢到响应权的 UI先关闭旧 dialog，再渲染工具继续执行的事件。

这是很成熟的产品协议：response winner是点对点的，resolved是所有投影副本的广播 tombstone。

## 8. Resolved 只表示“不再等待”，不表示结果

通知只携带 Thread ID和 Request ID，没有：

- 哪个连接响应。
- accepted / declined / cancelled。
- auto fallback还是人工决定。
- resolvedAt。
- 对应 item/call ID。

这样可以避免把敏感回答广播给其他连接，但其他 UI也无法解释“为何关闭”。如果产品需要审计，应把 private decision receipt与public resolved tombstone分开，而不是把完整答案塞进广播。

## 9. Listener 不可用时，resolved notification 会丢失

如果 Thread listener未运行或 command channel关闭：

- helper只记录 error并返回。
- callback已被移除。
- 业务 handler仍可继续把 decision提交 Core。
- 其他客户端可能保留 stale prompt。

这说明 runtime resolution与UI projection resolution是两次提交。当前没有重试队列或 durable resolved tombstone让重连客户端纠正。

更稳的顺序是先持久化 resolution fact，再由 listener投影；新订阅者用 pending/resolved revision reconciliation，而不是只依赖瞬时 notification。

## 10. Turn terminal 会批量取消 Thread 请求

在 TurnStarted、TurnComplete 和 TurnAborted 等边界，App Server会 `abort_pending_server_requests()`：

- callback map按 Thread ID删除所有 entry。
- 向等待者发送 structured internal error。
- error data含 `turn_transition` reason。
- 业务 handler可据此区分 lifecycle cancel与普通 client error。

这个清理很重要：旧 Turn approval不能跨到新 Turn继续生效，避免 stale capability。

Start 时也再次清理是防御式做法：即使上一 terminal event的清理漏掉，新 Turn不会继承旧 pending request。

## 11. 不同 request type 对取消采取不同 fail-safe

通用 transport只交付 raw JSON result/error；业务 handler各自解析并选择 fallback：

| 类型 | Turn transition | 普通 client error / malformed |
| --- | --- | --- |
| Request User Input | 直接return，不再回答旧 Turn | 提交空 answers |
| MCP elicitation | 转为 Cancel | 转为 Decline |
| File change approval | 直接return | Denied |
| Command approval | lifecycle路径停止 | Denied / failed completion |
| Permission request | 返回无grant或停止 | 权限交集/fail-closed |

这是正确方向：transport error不能统一翻译为“同意”或空成功，安全决策默认 fail-closed。

但 fallback语义分散在多个 handler，新增 ServerRequest type时容易漏审。应建立每类 request的 declarative failure policy或一致测试矩阵。

## 12. Typed validation发生在 callback consumer，不在 transport边界

`notify_client_response()` 从 map取出 entry后，会尝试把 raw result转成原 request对应的 ServerResponse用于 analytics；即使解析失败，raw result仍通过 oneshot发送给业务 handler。

各 handler再 `serde_json::from_value()`，malformed时各自 fallback。

优点是 transport保持通用，支持多种 request/response schema。缺点是：

- response callback已经被消费，无法让客户端修正后重答。
- analytics parse与业务 parse可能不是同一错误处理。
- schema validation和semantic validation分散。

更清晰的边界是：callback map保存 typed decoder/policy，原子完成 validate -> consume；invalid response可以明确 terminal reject或在 deadline内允许 retry。

## 13. Generic routing没有统一 deadline

OutgoingMessageSender 本身没有为 callback设置：

- timeout/deadline。
- 最大 pending count。
- per-Thread pending count。
- client response rate limit。
- request payload bytes budget。

部分具体功能在更上层实现 auto timeout，例如 request-user-input；其他 approval可能依赖 Turn interrupt/connection/lifecycle来解除。

单个 map使用 Mutex保证一致性，但并不提供资源治理。恶意或失联客户端可以让多个 Turn长期等待、callback持续占内存并持有 active guard。

## 14. Connection close 不等于 request cancel

`OutgoingMessageSender::connection_closed()` 清理的是该 connection发起、尚未响应的入站 ClientRequest trace contexts。反向 ServerRequest callback不绑定某个 responder connection，因此不会因一个连接关闭自动取消。

这对多订阅者接管是必要的：桌面关了，IDE仍可回答。但若唯一 responder离线，系统也无法仅从 callback entry判断是否该 timeout或转交。

需要把 delivery membership与 business ownership分开：

```ts
type PendingInteraction = {
  requestId: string;
  ownerRunId: string;
  eligibleResponders: string[];
  deliveredConnections: string[];
  deadlineAt: string;
};
```

## 15. Request ID 极端 wrap/collision边界

Server request ID由 `AtomicI64.fetch_add()` 生成。当前插入 callback map时不检查旧 entry是否被替换。正常运行不可能短期耗尽 i64，但它仍说明 ID allocator没有显式 non-zero/wrap/collision invariant。

更实际的问题是 process restart后计数从 0重置：旧客户端若保留未清 dialog并连接新进程，视觉上可能再次遇到相同数字 ID。Thread ID、server instance generation或随机 operation ID能避免跨进程 ABA。

## 16. 一个更完整的交互 contract

```ts
type InteractionRequest = {
  interactionId: string;
  runId: string;
  runGeneration: number;
  kind: "approval" | "user-input" | "elicitation";
  eligibleResponderIds: string[];
  createdAt: string;
  deadlineAt: string;
  payload: unknown;
};

type InteractionResolution = {
  interactionId: string;
  status: "accepted" | "declined" | "cancelled" | "expired";
  responderId?: string;
  resolvedAt: string;
  runGeneration: number;
  receiptVersion: number;
};
```

服务端流程：

1. durable insert pending interaction。
2. 事务提交后广播 request。
3. response校验 responder authority、Run generation、deadline与schema。
4. CAS `pending -> resolved`，第一份合法响应胜出。
5. 广播不含敏感答案的 resolved tombstone。
6. runtime消费 durable resolution。
7. reconnect按 revision拉取 pending snapshot，process restart继续工作。

## 17. 当前 SEO Agent 的迁移顺序

当前最小 Tool Calling 阶段不需要通用反向 RPC框架。实现 Human-in-the-loop 时再按顺序引入：

1. 单一 Web客户端、单一 pending approval。
2. approval绑定 `AgentRun.id + ToolCall.id`。
3. DB中明确 Pending/Approved/Denied/Expired。
4. response做 owner、tenant、generation和状态 CAS。
5. reconnect从 DB恢复 pending snapshot。
6. 多设备 first-wins与responder policy最后再做。

不要先照搬 Codex 的多连接广播，也不要把内存 Promise/oneshot当作可恢复业务事实。

## 18. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Delivery | 零连接、单连接、多连接、partial send failure |
| Authority | 非订阅连接、权限撤销连接、第二设备抢答 |
| Exactly-once | 两个响应并发、重复response、malformed后重答 |
| Lifecycle | Turn complete/abort/start时pending清理 |
| Ordering | resolved tombstone先于后续item/terminal event |
| Reconnect | 同进程重放、listener缺失、process restart |
| Timeout | deadline、client离线、active guard释放 |
| Privacy | resolved广播不泄漏答案，audit receipt受权限控制 |
| Capacity | per-Run/per-user/global pending上限与payload bytes |

## 19. 学习结论

Codex 最值得学习的是：callback在发送前登记、first-response-wins、Thread-scoped pending重放、terminal边界批量撤销、resolved tombstone与后续事件的有序广播、不同安全操作 fail-closed。

需要谨慎借鉴的是：response不绑定connection/responder、partial fan-out导致已投递请求失效、进程内状态不可恢复、generic deadline/cap缺失、typed validation分散和resolved projection的瞬时性。

反向 RPC不是“弹个确认框”，而是一条跨 runtime、transport、UI副本和生命周期的可取消事务。
