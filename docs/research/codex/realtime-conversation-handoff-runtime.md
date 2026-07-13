# Realtime Conversation、音频背压与 Handoff Runtime

Codex 的 Realtime Conversation 不是“给聊天接口加一条音频字段”，而是 Thread 内并存的第二条实时会话通道。它接收麦克风 PCM、文本与远端事件，也会把语音对话中的复杂任务转交给普通 Agent Turn，再把 Agent 的进度和最终结果送回实时模型。

本文关注五个问题：

1. Realtime session 与普通 Agent Turn 谁拥有状态？
2. WebSocket、WebRTC sideband 与 App Server 之间如何分层？
3. 音频、文本、转写和 Handoff 如何背压？
4. start、replace、close、transport failure 的终态是否唯一？
5. 哪些事实会持久化，哪些只存在于一次 live session？

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/core/src/realtime_conversation.rs`
- `codex-rs/core/src/realtime_context.rs`
- `codex-rs/core/src/realtime_prompt.rs`
- `codex-rs/core/src/session/handlers.rs`
- `codex-rs/core/src/session/mod.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/codex-api/src/endpoint/realtime_websocket/**`
- `codex-rs/codex-api/src/endpoint/realtime_call.rs`
- `codex-rs/protocol/src/protocol.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/realtime.rs`
- `codex-rs/app-server/src/request_processors/turn_processor.rs`
- `codex-rs/app-server/src/bespoke_event_handling.rs`
- `codex-rs/rollout/src/policy.rs`

协议标注为 experimental。本文描述当前源码，不把临时 V1/V2 兼容细节包装成稳定产品承诺。

## 2. 两条会话主链

普通 Agent Turn 的主链是：

```text
App Server request
  -> Session submission
  -> user_input_or_turn
  -> model/tool loop
  -> Agent events
```

Realtime 的主链是：

```text
App Server realtime RPC
  -> Session submission
  -> RealtimeConversationManager
  -> Realtime WebSocket / WebRTC sideband
  -> audio/transcript/realtime events
```

两条主链通过 Handoff 交叉：

```text
Realtime server emits handoff request
  -> transcript wrapped as <realtime_delegation>
  -> route_realtime_text_input
  -> ordinary Agent Turn / active Turn steer
  -> AgentMessage and TurnComplete events
  -> RealtimeConversationManager.handoff_out / handoff_complete
  -> realtime server receives progress/final output
```

因此 Realtime 不是替代 Agent Runtime，而是一个低延迟前台会话和后台 Agent Runtime 之间的桥。

## 3. 状态所有者

### 3.1 每个 Thread 一个 Manager

`RealtimeConversationManager` 在 `Mutex<Option<ConversationState>>` 中只保存一个 live state。它不是全局音频服务，而是 Thread Session 的组成部分。

`ConversationState` 包含：

- audio sender；
- text sender；
- V1/V2 session kind；
- Handoff state；
- input task；
- 可选 fanout task；
- `realtime_active` 原子标记；
- cancellation token。

这里的 `realtime_active: Arc<AtomicBool>` 同时承担 session generation token。注册 fanout 或 transport 自行结束时，代码通过 `Arc::ptr_eq` 确认回调仍属于当前 state，避免旧 session 的迟到 task 清掉新 session。

这是比单纯 `active=true` 更强的 ABA 防护：即使新旧 session 都是 active，Arc identity 仍不同。

### 3.2 Handoff 是另一组子状态

Handoff state 保存：

- 当前 active handoff ID；
- 最近一次 Agent output text；
- background output queue；
- client-managed/automatic 模式；
- response-as-item 与前缀策略；
- V1/V2 kind。

Realtime session 可以存活很久，期间产生多个 Agent Turn。Handoff ID 才是某一次实时委派与 Agent 输出之间的相关性身份。

### 3.3 App Server 不是实时状态权威

App Server 的 RPC 只定位 Thread、附加 listener、检查 feature，然后把 `Op::RealtimeConversation*` 提交给 Core。真正的 running state 在 Core manager，远端 session state在 Realtime Service。

客户端不能只凭 `thread/realtime/start` 的 JSON-RPC response 判断连接已建立。该 response 只说明 Core submission 已接受，后续还要观察：

- `thread/realtime/started` notification；
- WebRTC 的 SDP notification；
- error notification；
- closed notification。

## 4. Start 不是一个瞬间

### 4.1 配置准备

Start 会组合：

- provider 与认证；
- experimental base URL override；
- V1/V2；
- conversational/transcription session mode；
- audio/text output modality；
- voice；
- model；
- session ID；
- backend prompt；
- 可选 startup context；
- WebSocket 或 WebRTC transport。

V1 不允许 text output modality。WebRTC AVAS 路径当前只允许 V1 + conversational mode。

### 4.2 Prompt 的三态覆盖

request prompt 使用 `Option<Option<String>>` 表达三态：

```text
字段缺失
  -> 使用默认 backend prompt

字段显式 null
  -> 空 prompt

字段为字符串（包括空字符串）
  -> 使用请求值
```

config 中非空 experimental prompt 的优先级又高于 request prompt。这个三态协议避免“空字符串”和“没有配置”混为一谈。

### 4.3 Startup context

默认会从以下来源构造启动上下文：

- 当前 Thread 最近消息；
- 最近 Thread metadata；
- 当前与近期 workspace 分组；
- 有界目录扫描。

各 section 有近似 token 预算，调用点传入 5,300 token。值得注意的是，`build_realtime_startup_context` 的 `budget_tokens` 参数当前只用于日志；最终组合依赖各 section 固定预算，没有再按传入总预算做一次统一截断。

更敏感的是，完整 startup context 会以 info 日志输出。它可能包含最近对话、路径和 workspace 摘要。即使目录扫描有界，这仍是明显的本地隐私面。

自定义 request/config prompt 当前也没有看到统一的字节或 token cap。于是“startup section 有预算”不等于整个 Realtime instructions 有硬上限。

### 4.4 替换旧 Session

新 start 先：

1. 从 manager 取走旧 state；
2. cancel 并等待旧 input/fanout task；
3. 再连接新 session；
4. 成功后才把新 state 写回 manager。

优点是同一 Thread 不会同时保留两个受管 session。代价是：

- replace 期间 manager state 是 `None`，并发 audio/text 会报 not running；
- 新连接失败时旧 session 已经结束，不能自动回滚；
- 等待旧 fanout 没有统一 deadline，start replacement 可能被慢 client delivery 卡住。

这是 stop-old-first 的独占切换，不是 prepare-new-then-swap。

## 5. WebSocket 与 WebRTC 两种 Transport

### 5.1 直接 WebSocket

直接模式：

```text
build ws/wss URL
  -> merge provider/extra/default headers
  -> TLS connect
  -> send session.update
  -> return connection
  -> publish Started notification
```

`Started` 发生在 WebSocket 已连接且 `session.update` 已成功写入 socket 后，但不等待远端 `session.updated` event。因此它表示本地 transport ready，不是服务端已确认全部 session config。

### 5.2 WebRTC + sideband WebSocket

WebRTC 模式先把客户端 SDP offer 通过 HTTP 创建 call，得到：

- answer SDP；
- call ID；
- sideband headers。

Core 随后启动后台 task 加入 sideband WebSocket，并立即提交 manager state、Started 与 SDP notification。

因此 WebRTC 的 `Started` 更弱：它可能发生在 sideband 尚未连接时。sideband 连接失败会稍后产生 Error/Closed。

这是一种两平面设计：

- WebRTC media plane 由客户端与 Realtime Service 直接承载；
- Codex 用 sideband WebSocket 接收 transcript/handoff 并回传后台 Agent 结果。

### 5.3 身份与 header

直接 WebSocket 当前需要 API key 形式的 Bearer。解析顺序包括 provider key、experimental bearer、auth key，以及 OpenAI provider 对环境 `OPENAI_API_KEY` 的临时 fallback。

WebRTC call 创建路径不把 API key直接放在 sideband start header 的同一位置，而由 ModelClient/call API 处理认证。

请求还携带 session ID、V1 alpha header 与 originator。自定义 CA 环境变量会用于 Realtime WebSocket TLS，与其他 Codex outbound TLS 保持一致。

自定义 provider/base URL 也意味着 Realtime prompt、startup context、音频和 transcript 可能发送到非 OpenAI 目的地；这是 provider trust boundary，不只是连接配置。

## 6. 五条队列与两种背压

Core manager 建立以下 bounded channel：

| 队列 | 容量 | 满时行为 |
| --- | ---: | --- |
| input audio | 256 frame | `try_send` 丢弃 frame，但向调用方返回成功 |
| input text | 64 | await，直到有空间或 session 关闭 |
| background handoff output | 64 | await |
| parsed output event | 256 | await |
| transcript tail | 1 | await 单个尾部文本 |

WebSocket pump 另有：

| 队列 | 容量 | 用途 |
| --- | ---: | --- |
| outbound command | 32 | 序列化所有 send/close |
| inbound raw message | unbounded | pump 到 parser/event consumer |

### 6.1 音频选择实时性优先

audio queue 满时丢当前 frame，并返回 `Ok(())`。这样麦克风 producer 不会因网络抖动无限堆积旧音频；旧声音晚到往往比少量丢帧更糟。

但成功响应不代表 frame 已送达。当前只在本地 warning 中记录 drop，协议没有：

- dropped frame count；
- sequence number；
- accepted/forwarded watermark；
- client 自适应降采样信号。

对调用方而言，这是“best-effort admission”，不是 delivery receipt。

### 6.2 文本与 Handoff 选择完整性优先

text 和 background output 使用 await send，不主动丢弃。这更适合语义消息，但会把下游阻塞传回 Session submission 或 Agent event mirror。

Realtime audio 和 text 采用不同策略是合理的；关键是协议必须明确谁是 lossy channel。

### 6.3 inbound unbounded 风险

WebSocket pump 把远端原始消息送入 unbounded channel。下游 `events_tx` 是 bounded 256，App Server notification delivery 又可能变慢。

一旦 fanout/event consumer 阻塞：

```text
events_tx 满
  -> realtime input loop停止读取 WebSocket events
  -> raw inbound unbounded channel继续积累
  -> 内存随远端输出增长
```

WebSocketConfig 使用默认值，源码没有在这一层声明产品级单帧/会话总字节预算。底层库的默认限制不能替代业务可解释的 media budget。

## 7. Audio Frame 契约

App Server 暴露的 frame 包含：

```text
data: base64 PCM
sampleRate: u32
numChannels: u16
samplesPerChannel?: u32
itemId?: string
```

输入发送到 Realtime Service 时实际只取 `data`，其余字段不进入 `input_audio_buffer.append`。session config 固定声明 PCM rate，客户端 metadata 主要用于本地 output duration 计算。

当前 admission 未见对 input frame 做统一校验：

- base64 是否合法；
- 单 frame bytes；
- sample rate 是否匹配 session；
- channel count；
- `samplesPerChannel` 与 payload 是否一致；
- frame sequence/时间戳；
- 每秒累计字节。

大字符串会先经过 JSON、Core submission 和 bounded frame queue，再作为 WebSocket JSON 序列化。容量 256 限制了 frame 个数，不限制每个 frame 的大小。

## 8. 单 loop 多路复用

`run_realtime_input_task` 用一个 `tokio::select!` 同时处理：

- cancel token；
- input text；
- background Agent output；
- Realtime server event；
- user audio frame。

任一 handler 返回错误，整个 loop 退出。也就是说：

- 一个 audio write failure 会结束 session；
- 一个 handoff output write failure 会结束 session；
- server Error event 会被转发后结束 session；
- channel 意外关闭也会结束 session。

这是 fail-together 模型，逻辑简单，但没有 per-lane degradation。例如 output audio 仍可用时，单次 background progress send 失败也不会只禁用 handoff lane。

所有 WebSocket send 经单 pump 串行化，因此并发 writer 不会直接竞争 socket sink；send 与 next_event 可以并行，因为 pump 同时 select command 与 inbound stream。

## 9. Transcript 是内存投影

`RealtimeWebsocketEvents` 在内存中维护 `ActiveTranscriptState`：

- entries；
- 上次 handoff 的 entry count；
- 是否开始新的 input/output entry。

delta 会追加到同 role 的最后一项，done 会替换最后一项为最终文本。Handoff 到来时，把自上次 handoff 以来的 transcript slice 放入 event，并推进 watermark。

优点是：

- UI 可收到 delta 与 done；
- Handoff 能带上最近上下文；
- done 可以修正流式识别结果；
- tail flush 不会重复已 handoff 的部分。

当前 transcript vector 没有看到条目数、字符数或会话时长上限。长会话会持续持有完整 entries，即使 `last_handoff_entry_count` 已推进，也不释放旧文本。

## 10. Handoff：Realtime 与 Agent 的事务边界

### 10.1 远端请求转普通 Agent 输入

Handoff event 包含 input transcript、active transcript 与 handoff ID。Core 优先使用显式 input transcript，否则使用 transcript delta，并包装为：

```xml
<realtime_delegation>
  <input>...</input>
  <transcript_delta>...</transcript_delta>
</realtime_delegation>
```

`&`、`<`、`>` 会转义，避免 transcript 破坏 XML-like framing。

随后 fanout task 直接调用 `user_input_or_turn_inner`，使用新的 UUIDv7 sub ID。它不是再经过 App Server RPC，也不是只给 Realtime 模型；它进入正常 Agent admission，所以 active Turn 时会遵循普通 steer/queue 语义。

当前 handoff transcript 在 wrapper 前没有统一 token/byte cap。远端模型输出的长 transcript 会进入普通 Agent input，最终受模型 context 预算影响，但 admission 本身仍可产生大内存与持久化负担。

### 10.2 Agent output 回实时会话

Session 只镜像文本型 AgentMessage/ItemCompleted，不镜像 tool delta、reasoning、warning 等所有事件。单段回传会截到约 1,000 token。

输出根据配置变成：

- handoff update；
- handoff append；
- conversation item；
- standalone handoff；
- completion acknowledgement。

`client_managed_handoffs=true` 时，Core 不自动回传 Agent output，把控制权交给客户端显式 append。

### 10.3 stale progress fencing

V2 发送 progress 前会核对当前 active handoff ID。ID 不一致则丢弃迟到 progress，避免旧 Agent Turn 污染新委派。

普通 session replacement 又使用 `Arc::ptr_eq`。于是有两层 generation：

```text
Realtime session generation = realtime_active Arc identity
Handoff generation = handoff_id
```

这是这套实现最值得学习的部分之一。

### 10.4 Steering 与 response.create

V2 收到第二个 Handoff 时，如果已有 active handoff，会把它当作 steering：

- 给新 call ID 写 function output acknowledgement；
- 请求 Realtime 模型生成 response；
- 不替换 active handoff ID。

`RealtimeResponseCreateQueue` 用：

- `active_default_response`；
- `pending_create`。

把 active response 期间的多次 create 合并为一次 pending create。若 send 返回特定错误前缀“已有 active response”，也会转成 pending，而不是结束 session。

局限是 active 状态依赖 ResponseCreated/Done/Cancelled event 和错误字符串。若终态 event 丢失，queue 可能长期认为 response active；多个 pending request 也只保留一个布尔位，没有 request identity。

## 11. Barge-in 与音频截断

V2 会为 output audio 保存：

- item ID；
- 累计 `audio_end_ms`。

duration 优先使用 `samplesPerChannel`，否则 base64 decode PCM16 bytes 后按 channels/sample rate估算。检测到用户 speech started 时，Core 向 Realtime Service 发送 `conversation.item.truncate`，使服务端 conversation history 与被打断的语音长度尽量一致。

这是对“用户听到了多少”做补偿，但当前 watermark 是 Codex 收到/转发的音频长度，不是客户端扬声器实际播放进度。App Server output audio 可能排队，用户真实听到的更少。

更精确的架构需要客户端 playback acknowledgement：

```text
audio item id + chunk sequence
  -> client played_until_ms
  -> interruption truncates to acknowledged watermark
```

## 12. Event 投影与持久化边界

Core Realtime event 包括：

- SessionUpdated；
- speech started；
- input/output transcript delta/done；
- audio out；
- response created/cancelled/done；
- raw conversation item；
- handoff/noop；
- error。

App Server 把它们投影成 typed notification，但 `ConversationItemAdded` 仍以任意 JSON value 对外，V1/V2 的部分事件也被压成通用 item。

Rollout persistence policy 明确排除：

- RealtimeConversationStarted；
- SDP；
- RealtimeConversationRealtime；
- RealtimeConversationClosed。

这避免音频/base64/delta 把 rollout 撑爆，也保护了部分语音隐私。但后果是冷恢复不能重放 live session、transcript 或精确 close reason。

普通 TurnContext 会记录 sampling 当时的 `realtime_active` 布尔值，用于给 Agent 注入“Realtime 已开始/结束”的上下文变化。它是对 live 状态的历史观察，不是恢复 Realtime transport 的凭据。

## 13. 关闭与终态

### 13.1 用户请求关闭

显式 close：

1. manager 取走 state；
2. `realtime_active=false`；
3. cancel input task；
4. await input task；
5. await fanout task；
6. 发送 `closed(reason=requested)`。

由于 active flag 先变 false，fanout 自己结束时不会再发送第二个 closed，避免常见的双终态。

### 13.2 Transport 自行关闭

fanout 读完 event channel 后：

- 可选路由 transcript tail；
- 原子 swap active=false；
- `finish_if_active` 用 Arc identity 取走当前 state；
- detach 自己的 fanout handle，避免 task await 自己；
- 发送 transport_closed 或 error。

### 13.3 Tail flush

feature knob 开启时，input task 退出会取自上次 Handoff 之后的 transcript tail，用固定说明包装后路由给普通 Agent。这样用户结束语音前最后一句仍可能触发文本 Agent。

它是“session end 后仍产生一个 Agent Turn”的副作用。客户端收到 Realtime Closed 不代表 tail Agent Turn 已完成。

### 13.4 关闭的资源边界

shutdown 没有统一 timeout。input task 的某些 send、fanout 的 client event delivery 或底层 socket write 如果长期不返回，会拖住 close 或下一次 start。

cancel 路径主要通过 drop writer/events 使 `WsStream` 的 pump task abort；没有在 Core stop chain 中显式等待 WebSocket close handshake。快速释放优先于协议优雅关闭。

## 14. 值得学习的实现

### 14.1 Session generation 与 Handoff generation 分离

Arc identity 防旧 session 回调，handoff ID 防旧 task progress。两类 generation 恰好对应两种 ABA 风险。

### 14.2 音频丢弃、文本背压

media 与 semantic message 不采用同一队列策略。实时系统必须区分“过时即可丢”和“必须完整送达”。

### 14.3 Request response 与 lifecycle notification 分离

RPC response 表示 submission accepted，Started/Error/Closed 表示异步运行结果。长连接建立不应假装成同步 CRUD。

### 14.4 Handoff 复用普通 Agent Runtime

语音入口不复制第二套 Tool Loop。复杂任务通过规范化文本进入现有 Turn/Steer/Tool/Approval 管道，再把结果投影回语音会话。

### 14.5 高体积事件不写 Rollout

音频与 transcript delta 是 live projection，不是 canonical Agent history。只有真正路由成普通 UserInput 的 Handoff 才进入普通持久事实链。

### 14.6 Response create 合并

单 active response + 一个 pending bit，能避免 background result 与用户语音同时触发多个互斥 response.create。

## 15. 当前风险与恢复缺口

### 15.1 Audio frame 无单帧与速率预算

bounded queue 只约束数量。base64 巨帧、异常 sample metadata 和持续高带宽输入都缺少 admission budget。

### 15.2 unbounded inbound queue

慢 UI/慢 listener 能让原始 WebSocket message 在内存堆积。应使用 bounded queue、按事件类型 drop/coalesce，并对 transcript/audio 分配独立预算。

### 15.3 transcript 永久增长到 session 结束

已完成 handoff 的旧 entries 不释放。需要 rolling window、durable summary 或按 handoff watermark compact。

### 15.4 Start/Close 无 deadline

replace 先关闭旧 session，新 start 失败无法恢复旧 session；close 又可能被 fanout 卡住。需要 `Starting/Active/Stopping/Failed` operation state与 deadline。

### 15.5 Started 的含义因 transport 不同

WebSocket started 表示 session.update 已写；WebRTC started 甚至不保证 sideband 已连。统一 event 名掩盖了 readiness stage。

### 15.6 Handoff delivery 没有 durable receipt

Realtime events不持久。Handoff 已路由 Agent、Agent 已完成、结果已写回 Realtime 三个阶段没有统一 operation receipt。进程崩溃后无法判断远端听到了哪一版答案。

### 15.7 Startup context 日志泄露

完整上下文 info 日志包含对话和路径。生产环境应只记 bytes、section flags、hash 与 redaction outcome。

### 15.8 Barge-in 缺客户端 playback watermark

服务端截断依据收到的 output audio，不是实际播放。弱网/慢客户端下 conversation history 可能高估用户听到的内容。

### 15.9 Error lane fail-together

任何 lane send failure 都结束全 session。可以考虑区分 media fatal、handoff degraded、client projection dropped 等不同故障域。

## 16. 映射到 AI SEO Agent

当前 AI SEO Agent 暂不需要语音，但 Realtime 的模式可以迁移到“实时前台 + 后台长任务”：

```text
前台聊天/编辑器
  -> 快速确认、进度、steer
  -> 后台 SEO crawl / audit / content generation Run
  -> result 投影回前台
```

### 16.1 推荐状态模型

```ts
type LiveSession = {
  id: string
  conversationId: string
  generation: number
  state: 'starting' | 'active' | 'stopping' | 'closed' | 'failed'
  transportReady: boolean
  backendReady: boolean
  startedAt: string
  closedAt: string | null
}

type Delegation = {
  id: string
  liveSessionId: string
  liveSessionGeneration: number
  agentRunId: string | null
  state: 'requested' | 'routed' | 'running' | 'completed' | 'delivered' | 'failed'
  inputDigest: string
  deliveredOutputDigest: string | null
}
```

Live session generation 与 delegation ID 不应合并。前者防旧连接回调，后者防旧任务结果污染新请求。

### 16.2 事件分级

```text
canonical facts
  session started/closed receipt
  delegation requested/routed/completed/delivered
  Run ID与result digest

ephemeral projections
  transcript delta
  progress text delta
  audio/media chunks
  cursor animation
```

不是所有实时事件都写数据库，但关键跨系统 handoff 必须有 durable receipt。

### 16.3 背压分类

| 数据 | 推荐策略 |
| --- | --- |
| UI cursor/typing/audio delta | lossy，按最新值 coalesce |
| progress snapshot | 保留最新 snapshot，丢中间 delta |
| steer command | 有界排队，带 sequence/Run ID |
| final result | durable outbox + ack |
| approval/request input | durable pending state + deadline |

这样可以避免用一个 WebSocket queue 同时承担“动画帧”和“不可丢业务命令”。

## 17. 最小验证矩阵

### 17.1 Start 与 generation

- 第二次 start 会终止第一次，旧 fanout 不能关闭新 state。
- 新连接失败后状态明确为 Failed，而不是假 Active。
- WebSocket transportReady 与 backendReady 分开上报。
- WebRTC call ready 与 sideband ready 分开上报。
- replace/close 有 deadline，超时后能强制收口。

### 17.2 Audio 背压

- audio queue 满时 drop counter 与 watermark 可观测。
- 单 frame byte cap、sample rate、channels、base64 均校验。
- 每秒/每session bytes 有配额。
- 丢帧不会阻塞 text/stop command。
- 慢 downstream 不会形成 unbounded inbound memory。

### 17.3 Transcript

- delta/done 合并不会重复最后文本。
- handoff watermark 后只带新 tail。
- transcript window/bytes 达限会 compact。
- malicious XML-like text被转义。
- 超长 transcript 在进入 Agent admission 前截断并保留 truncation receipt。

### 17.4 Handoff

- 旧 handoff progress 不会写入新 handoff。
- active Turn 时新 delegation 的 steer 归属可验证。
- Agent completed 但 realtime delivery失败可重试。
- duplicate handoff ID 幂等。
- client-managed 模式不自动双发结果。

### 17.5 Close 与恢复

- requested、transport_closed、error 只有一个 terminal receipt。
- tail flush Run 与 Realtime close 分开标识。
- close 时所有 bounded send 可被 cancellation 打断。
- crash 后不会声称 live session仍可恢复。
- 已完成但未 delivery 的 delegation 能从 durable outbox补发或明确放弃。

### 17.6 隐私

- startup context、transcript、audio 不写普通 info/trace。
- wire logging 默认关闭且有 redaction。
- custom provider 目的地在 UI/receipt 中可见。
- retention policy分别覆盖 raw audio、transcript和Agent delegation。

## 18. 推荐阅读顺序

1. 从 App Server `thread_realtime_*` 请求处理开始，先理解 request response 只是 submission receipt。
2. 阅读 `RealtimeConversationManager::start/start_inner`，画出 state、Arc generation 和 task ownership。
3. 阅读 `run_realtime_input_task`，记录五条 lane 与错误传播。
4. 阅读 codex-api WebSocket pump，观察 bounded command 与 unbounded inbound 的不对称。
5. 阅读 transcript state 与 Handoff wrapper，理解 live delta 如何变成普通 Agent UserInput。
6. 阅读 Session 的 `maybe_mirror_event_text_to_realtime` 和 `maybe_clear_realtime_handoff_for_event`，连接 Agent output 回传链。
7. 阅读 Rollout policy，确认 Realtime events 为什么不可冷重放。
8. 最后阅读 V1/V2 protocol parser 和 WebRTC call，避免把兼容层细节误认成核心架构。

## 19. 结论

Codex Realtime Conversation 的核心不是音频编码，而是两个异步运行系统之间的相关性与背压：

```text
Realtime session generation
  管连接替换与迟到task

Handoff ID
  管一次实时委派与Agent结果

Agent Run ID
  管普通模型/Tool执行

Audio/transcript sequence
  理应管媒体delivery，但当前仍较弱
```

它已经做对了几件关键事：Realtime 复用普通 Agent Runtime、Session/Handoff 两级 fencing、音频丢弃而文本背压、请求接受与生命周期通知分离、高体积实时事件不写 Rollout。

进一步工程化时，应把 queue bytes、session deadline、transcript compaction、playback watermark、backend readiness 和 Handoff durable receipt补齐。对任何“实时前台 + 后台 Agent”的系统，这些约束都比是否使用 WebSocket 或 WebRTC 更决定可靠性。
