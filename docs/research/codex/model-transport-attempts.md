# Model Transport Attempts：Turn、推理、传输重试与降级不是同一层

本文研究 Codex 如何在 Responses HTTP、Responses WebSocket、401 恢复、流中断重试和 HTTP 降级之间划分状态。重点不是“请求失败就重试”，而是一次用户 Turn 中可能同时存在多少种 attempt、哪些事实可以复用、哪些状态必须换代。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. 先区分四种生命周期

Codex 的模型调用不是一个 `fetch()` 可以概括的。至少有四层状态：

| 层级 | 典型所有者 | 可跨越范围 | 主要状态 |
| --- | --- | --- | --- |
| Thread / Codex session | `ModelClient` / `ModelClientState` | 多个用户 Turn | provider、auth、thread ID、prompt cache key、HTTP fallback、缓存的 WebSocket transport state |
| Turn | `ModelClientSession` | 一个用户 Turn 内的多次 sampling/tool follow-up | 新建的 `turn_state: OnceLock`，当前借出的 WebSocket session |
| 逻辑推理 attempt | `InferenceTraceAttempt` | 一次模型 generation | 完整逻辑 request、已完成 output items、completed/failed/cancelled terminal |
| HTTP transport attempt | `run_with_retry` | 建立一次 HTTP/SSE response 前 | 第几次发送、状态码/transport error、backoff |

同一个 Turn 可能经历：

```text
sampling #1
  -> logical inference attempt A
     -> HTTP transport attempt 0
     -> HTTP transport attempt 1
  -> SSE 中途断开
  -> logical inference attempt B
     -> HTTP transport attempt 0
sampling #2 after tool result
  -> logical inference attempt C
```

如果把这些都叫 `retryCount`，日志、计费、幂等和恢复判断会混在一起。

## 2. ModelClient 稳定，Turn 配置显式传入

`ModelClient` 只保留 Thread/session 级稳定状态：provider、认证、thread ID、transport fallback、缓存 WebSocket 等。model、reasoning effort、service tier、Turn metadata和 telemetry context都在调用 `stream()` 时显式传入。

这避免两个常见问题：

- 上一 Turn 的 model/settings 被隐藏 mutable client state带入下一 Turn。
- 重试时调用者不清楚究竟重用了哪一代配置。

对云端 Agent 的直接启发是：`LlmService` 可以长生命周期，但每次 `AgentRun` 必须创建不可变的 request snapshot；不能在 singleton service上临时改 `this.model`。

## 3. 新 Turn 换 sticky token，但可以借用旧物理连接

`ModelClient.new_session()` 每次都创建新的 `turn_state: Arc<OnceLock<String>>`，因此 `x-codex-turn-state` 不跨 Turn。源码注释明确：复用旧 `ModelClientSession` 会把上一 Turn 的 sticky-routing token带入下一 Turn，违反协议。

但新 session会从 `ModelClientState.cached_websocket_session` 取走：

- 已打开的 WebSocket connection。
- `last_request`。
- `last_response_rx`。
- 上次是否来自未记录的 warmup。

Turn结束时 `Drop` 再把它存回共享缓存。所以真实边界是：

```text
physical WebSocket + previous-response compression state：可以跨 Turn
x-codex-turn-state sticky routing：必须每 Turn 换代
```

`agent_websocket` 集成测试也证明第二个用户 Turn可以在同一连接上使用上一响应的 `previous_response_id`。这不是偷偷复用旧 Turn设置，因为是否能增量发送还要通过完整请求兼容检查。

## 4. WebSocket 增量请求是“证明后压缩”，不是默认 delta

`get_incremental_items()` 只有满足以下条件才返回增量：

1. 上次请求存在。
2. model、instructions、tools、tool choice、parallel flag、reasoning、store、stream、include、service tier、prompt cache key和 text controls一致。
3. 上次完整 input加服务端已完成 output items，等于当前 input的严格前缀。
4. 上次响应具有非空 `response_id`。

比较前只清理内部 chat metadata passthrough，避免不影响模型语义的内部元数据阻断复用。`client_metadata` 与 `stream_options` 也不参与 previous-response语义相等判断：前者是本次调用的客户端元数据，后者只控制本次 response delivery。

若任一条件不满足，就发送完整 `response.create`，不带 `previous_response_id`。因此优化路径的正确设计是：

```text
先证明 current = previous request + completed response + append
再只发送 append
否则退回完整 request
```

不能只比较消息数量或本地 version号。

## 5. 完整逻辑 request 与压缩 wire request 分开记录

WebSocket wire payload可能只包含：

- `previous_response_id`。
- 新增 input items。
- 本次 response controls。

但 rollout replay需要知道模型实际继承的完整上下文。特别是 `generate=false` warmup没有 inference trace；后续真实请求复用 warmup response ID时，Codex会把完整 `ResponsesApiRequest` 写入 inference trace，而不是只写压缩后的 wire delta。

这是非常值得学习的原则：

```text
wire optimization fact != logical model-visible fact
```

审计、回放和评测应记录逻辑请求；网络日志可以另记 delta。只存 wire body会让离线回放缺前置上下文。

## 6. Prewarm 是连接准备，不是正常推理 attempt

WebSocket v2 prewarm发送 `response.create` 且 `generate=false`，等待 `response.completed` 后才让真实请求复用连接和 response ID。它使用 disabled inference trace，也不按普通 generation记录 token usage。

但 prewarm不是零成本控制流：

- 它占用一次 WebSocket连接尝试。
- 失败会交给同一 Turn后续 retry/fallback预算处理。
- 426 Upgrade Required会立即切到 HTTP。
- 启动调用方把普通 prewarm失败视为 best-effort，不阻止 session启动。

因此“非业务预热”也必须进入连接预算和 telemetry，不能悄悄形成无限额的隐藏重试。

## 7. HTTP 建链重试只覆盖拿到 stream response 之前

`ResponsesClient.stream_request()` 先编码请求，再通过 `EndpointSession.stream_encoded_json_with()` 建立 HTTP stream。`codex-client::run_with_retry()` 对以下错误按 provider policy重试：

- 429（当前默认 OpenAI provider关闭此项）。
- 5xx。
- timeout / network transport error。

每次尝试都会重新应用 auth，并单独记录 request telemetry。`max_attempts` 的实现循环是 `0..=max_attempts`，所以字段语义实际上是“最多重试次数”，总发送上限是 `1 + max_attempts`。

一旦拿到 `StreamResponse`，底层 transport retry结束。后续 SSE parse error、idle timeout、`response.failed` 或在 `response.completed` 前关闭，由更高层 sampling retry处理。

这条边界很重要：

```text
request establishment retry：尚未获得可消费 stream
response stream retry：stream 已建立，甚至可能已经产生部分事实
```

两者的幂等风险完全不同。

## 8. POST 建链重试仍不是天然 exactly-once

即使 transport层尚未把 response headers交给调用者，服务端也可能已经接收请求、开始 generation或计费，而客户端只看到了 timeout/network error。当前 Responses请求没有独立 operation key用于证明重发是同一个逻辑 generation。

所以 transport retry提供的是可用性，不是 exactly-once：

- telemetry必须同时有 logical inference attempt ID与 transport attempt number。
- 计费/外部provider对账不能仅按本地 request count。
- 若业务调用有不可重复副作用，不能照搬模型请求的 retry policy。

## 9. 401 恢复是另一层有限状态机

HTTP与WebSocket路径在外层循环中单独处理 401：

1. 构建当前 client setup。
2. 建立 auth telemetry context。
3. 发请求。
4. 若是 401，交给 `UnauthorizedRecovery` 做有限阶段恢复。
5. 成功恢复后重新构建 setup并重发。

HTTP每次 401恢复后的重发都会开启新的 `InferenceTraceAttempt`，并先把失败 attempt记录为 terminal failed。WebSocket handshake的 401在真正开始 inference trace前恢复。

这比在 transport retry里笼统重试所有 401好，因为 token refresh、alternate credential和最终拒绝需要明确阶段，且不能无限循环。

## 10. 流中断会重建 prompt并开启新的逻辑推理

`run_sampling_request()` 对 retryable stream error最多执行 `stream_max_retries` 次重连。第一次尝试使用传入 input；后续从 Session当前 history重新 `clone_history().for_prompt()`，再构建 prompt。

这意味着 retry不是盲目重发原始 bytes，而是以“目前已提交的会话事实”为新基线：

- 已收到 `OutputItemDone` 的 item已经进入处理和持久化链，可进入新 prompt。
- 只有 delta、尚未完成的 active item通常只是客户端 provisional显示，不作为完成事实。
- 新 attempt会有新的 inference trace terminal。

该设计避免完整已完成 item被当作不存在，但会产生更复杂的语义：同一 sampling失败后，下一 attempt看到的 input可能已经包含前一 attempt的部分完成结果。

## 11. Stream失败前的工具副作用不会自动回滚

`try_run_sampling_request()` 收到完成的 tool call item后，会立即创建 tool future并放入 `FuturesOrdered`。即使之后 stream返回 error，退出事件循环后仍会 `drain_in_flight()`，等已启动工具完成，再把 sampling error返回外层重试。

因此一个失败 sampling可能已经产生：

- durable tool call事实。
- 文件、进程、网络等外部副作用。
- tool output observation。
- 一个 failed inference attempt。
- 后续新的 sampling attempt。

这是“流重试不能等同于纯函数重算”的直接证据。模型调用的重试层必须与 Tool Call的唯一 terminal、output receipt和外部幂等键协同；只给 LLM request加 retry次数不够。

## 12. Partial output 的事实边界按完成事件切分

`map_response_events()` 只在 `OutputItemDone` 时把 item加入 `items_added`。Inference trace的 terminal记录：

- `Completed`：response ID、usage和已完成 items。
- stream error：mapped error与目前已完成 items。
- consumer drop：cancelled reason与目前已完成 items。
- 无 `response.completed` 关闭：failed与目前已完成 items。

文本 delta、reasoning delta与tool argument preview不进入 `items_added`。因此 trace能区分“用户看过部分字符”和“provider提交了完整 item”。

但 UI仍需显式撤销/标记 failed attempt的 provisional item；否则重试的新 item到来后，用户可能看到两段拼接输出，而持久 history只有后一段完整事实。

## 13. SSE 的 Retry-After 是受限解析，不是通用 header policy

当 `response.failed` 的 error code是 `rate_limit_exceeded` 时，SSE parser尝试从错误 message中匹配 `try again in N s/ms`，将 delay放进 retryable error。sampling retry优先使用这个 requested delay，否则使用本地 exponential backoff。

这个实现比完全忽略服务端等待建议好，但边界明显：

- 只处理特定 error code。
- 从自然语言 message用正则提取。
- 不等同于标准 HTTP `Retry-After` header解析。
- 单位和文案变化可能退回本地 backoff。

云端实现应优先使用结构化 `retryAfterMs` 或标准 header，message parser只能做兼容兜底。

## 14. WebSocket错误会清空 previous-response链

若连接已关闭，`websocket_connection()` 在重连前清空：

- `last_request`。
- `last_response_rx`。
- warmup来源标记。

集成测试证明：前一个请求使用 `previous_response_id` 后若收到 terminal error，下一次新连接会发送完整 create，不再引用旧 response ID。

这是正确的 fail-closed：transport session断裂后，客户端不假设服务端仍保存或认可上一条链。完整 request是恢复基线。

## 15. Fallback 是 session级熔断，不是单次请求分支

当 WebSocket stream retry耗尽，`handle_retryable_response_stream_error()` 先尝试 `try_switch_fallback_transport()`：

1. `disable_websockets` AtomicBool从 false切到 true。
2. 清空当前和缓存 WebSocket state。
3. retry计数归零。
4. 发 Warning事件。
5. 同一逻辑 sampling通过 HTTP继续。

426则不消耗常规 stream retry，立即 fallback。测试还证明 fallback跨后续 Turn保持 sticky，不再探测 WebSocket。

优点是避免每个 Turn反复抖动；代价是一次瞬时故障可能让整个长 session永久降级。当前没有 cooldown、half-open probe或管理员恢复操作。云端连接池若生命周期很长，应把降级原因、时间和重新探测策略显式化。

## 16. 多层预算叠加后，总 attempt数不直观

一个最坏路径可能包含：

```text
startup prewarm connection attempt
+ WebSocket initial sampling attempt
+ stream_max_retries WebSocket attempts
+ HTTP fallback initial logical attempt
+ request_max_retries HTTP transport sends
+ 401 recovery follow-up attempt(s)
+ another stream-level retry cycle after partial SSE
```

默认值还分别来自 provider info：`stream_max_retries = 5`、`request_max_retries = 4`，并各自有最多100的配置 hard cap。虽然每层都有界，但系统没有一个统一的 Turn级 deadline、generation count或cost budget来直接回答“这次用户输入最多会发几次模型请求”。

成熟云端 Agent应增加上层总预算：

```ts
type AttemptBudget = {
  deadlineAt: string;
  maxLogicalGenerations: number;
  maxTransportSends: number;
  maxFallbacks: number;
  maxEstimatedCostUsd?: number;
};
```

子层预算只能更严格，不能让各自都“合法”却叠加成不可接受的总成本。

## 17. Turn state 的 first-write-wins 需要可观测冲突

HTTP response header、WebSocket handshake header和WebSocket event都可能提供 `x-codex-turn-state`。实现统一调用 `OnceLock.set()`，第一次成功后，后续值被忽略。

first-write-wins能保持同一 Turn sticky routing稳定，但当前 `_ = set(...)`不报告冲突。如果服务端在同一 Turn返回不同 token，客户端会继续使用第一个值，却缺少诊断证据。

更完整的实现应：

- 相同值重复出现：计数但不告警。
- 不同值出现：记录 protocol violation、request/response ID和来源transport。
- 永远不自动覆盖已生效值。

## 18. 推荐的云端状态模型

```ts
type GenerationAttempt = {
  id: string;
  runId: string;
  samplingIndex: number;
  generationIndex: number;
  transport: "http" | "websocket";
  logicalPromptHash: string;
  wireMode: "full" | "previous-response-delta";
  status: "started" | "completed" | "failed" | "cancelled";
  completedItemIds: string[];
};

type TransportAttempt = {
  generationAttemptId: string;
  index: number;
  authGeneration: number;
  startedAt: string;
  status?: number;
  errorCode?: string;
  retryDelayMs?: number;
};
```

`AgentRun` 不应因为 transport重发就新建；`GenerationAttempt` 也不应因为底层同一请求的 network retry就重复。三个 identity分别服务产品生命周期、模型语义和网络诊断。

## 19. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Turn隔离 | 新 Turn不携带旧 turn-state；可安全复用物理连接 |
| Incremental | prefix成立、instructions/tools/model变化、metadata变化、missing response ID |
| Trace | full request与wire delta不同；warmup不计普通 inference attempt |
| HTTP retry | initial + max retries总数、每次auth应用、5xx/network、429 policy |
| 401 | refresh成功、alternate credential、重复401终止、attempt trace终态 |
| Partial stream | delta后断开、item done后断开、tool call done后断开、completed后consumer drop |
| Tool副作用 | stream失败时in-flight tool仍收口；retry不重复执行已完成call |
| WebSocket | 426立即降级、closed connection清链、error后full create |
| Fallback | retry耗尽后HTTP、后续Turn保持fallback、显式reprobe策略 |
| Budget | 多层attempt叠加仍受Turn deadline/transport总数/cost cap |
| Sticky state | header/event同值、冲突值、跨Turn泄漏 |
| UI | failed provisional output撤销，重试输出不与旧delta拼接 |

## 20. 对当前项目的学习结论

当前项目做最小 Tool Calling时，不必立即实现 WebSocket previous-response优化；应先把 identity和事实边界设计正确：

1. `AgentRun` 是用户请求生命周期。
2. `GenerationAttempt` 是一次逻辑模型推理。
3. `TransportAttempt` 是同一推理的底层发送。
4. 完成 item可以持久化，delta只是临时投影。
5. Tool副作用必须有独立call ID、terminal和receipt，不能依赖“sampling会重试”。
6. 所有子层retry共同受Run级deadline与cost budget约束。

Codex 最值得学习的是 session/Turn状态分离、完整逻辑请求与wire delta分离、增量复用前严格证明、failed/cancelled/completed attempt终态、partial item边界、401专用恢复和WebSocket fail-closed降级。需要改进/避免的是 `max_attempts` 命名与总数含义错位、多层预算缺统一上限、session级fallback无reprobe、turn-state冲突静默，以及模型POST重发和Tool副作用仍缺端到端幂等证明。
