# 术语表

查素材前先对齐词义。每个词只给一句定义、所属层次和第一手源码位置；同一个词在不同层有不同含义时分开列。路径相对 `/Users/ayu/Learn/pi/packages`。

## 两代运行内核

| 术语 | 含义 | 位置 |
| --- | --- | --- |
| Agent（旧内核） | 内存态运行门面：持有 messages、steering/followUp 队列、事件监听；一次 `prompt()` 跑完一个 run | `agent/src/agent.ts:173` |
| agent loop / runLoop | 旧内核的循环：模型 → 完整工具批 → turn_end → steering → 下一轮；外层再查 followUp | `agent/src/agent-loop.ts:156` |
| turn | 一次模型响应加它触发的整批工具结果；`turn_end` 事件的单位 | `agent-loop.ts:243` |
| run | 从 `agent_start` 到 `agent_end` 的一段；产品层再在其后做重试/压缩/续跑，直到 `agent_settled` | `coding-agent/src/core/agent-session.ts:1101` |
| steer / followUp | 两种排队消息：steer 在下一次采样前注入；followUp 只在 agent 本要停下时注入 | `agent.ts:283` |
| QueueMode | `all` 一次取空队列；`one-at-a-time` 每轮只取一条。旧 Agent 默认 one-at-a-time，Harness 默认 all | `agent.ts:231`、`agent/src/harness/runtime/harness.ts:66` |
| AgentHarness（新内核） | 管理一个 Session 内多条 Lane 的 durable 运行宿主；create 只恢复状态不执行副作用 | `agent/src/harness/agent-harness.ts:586` |
| Session | durable 数据容器：entry 树、values/lists、usage ledger、ID 生成器与一条串行 mutation line | `agent/src/harness/session/types.ts:530` |
| Branch | Session 内一个命名指针 `branch.tip`；可以只有数据没有 Lane | `session/types.ts:521` |
| Lane / AgentLane | 附着在同名 Branch 上的执行者：配置、inbox、current operation；一次只跑一个 operation | `agent-harness.ts:546`、`runtime/lane.ts:221` |
| Entry | 不可变会话树节点：`message / compaction / branch_summary / custom`，带 `seq` 与 `parentId` | `session/types.ts:16` |
| operation | 一次被接纳的工作：`run / compaction / navigation`；有 `op.meta`（意图）与 `op.state`（当前叶子） | `session/types.ts:75` |
| accept | 原子接纳：写 prompt entries、消费 inbox、tip、op meta/state、lane state，返回 admission；不执行 | `runtime/lane.ts:498` |
| drive / Drive | 在本进程为一个 operation 安装唯一执行 owner，直到 settled 或 durable wait | `lane.ts:921`、`runtime/types.ts:85` |
| dispatcher | `for(;;) switch(state.at)` 的显式状态分派，13 个叶子 | `runtime/drive.ts:29` |
| checkpoint | run 的边界叶子：处理 inbox、阈值压缩、决定 need_assistant 或 may_finish | `runtime/drive/checkpoint.ts:95` |
| effect_pending | 已持久化“意图”但外部副作用（模型请求 / 工具）结果未知的叶子；重启后进入 recovery | `session/types.ts:263` |
| retry_wait | 带 `notBefore` 的 durable 等待；`waitForRetry:false` 的 drive 直接返回 waiting | `runtime/drive/generation.ts:234` |
| Gate / effect gate | Drive 的同步准入闸：`admit()` 在 aborting/closed 时抛 `AbortRequested`，用于让取消赢过新副作用 | `harness/execution/effect-gate.ts:31` |
| cancel_requested / reconcile | 取消是与 13 个叶子正交的 `control.status`；drive 见到它就走 reconcile 收尾而不开新工作 | `runtime/drive/reconcile.ts:132` |
| settleOperation / continueOperation | 两种 Lane 命令能力：settle 在取消后仍可提交结果；continue 在取消后直接返回 `cancel_requested` | `lane.ts:388`、`lane.ts:451` |
| inbox / InboxItem | Lane 上等待被下一个边界捕获的条目：`steer / followUp / nextRun / write` | `session/types.ts:129` |
| pending entry / frames / tool output | `pi.pending.*` 暂态：排队消息 payload、模型流帧、工具 checkpoint；不是 transcript | `session/values.ts:186` |
| tool journal | 工具子状态机 `planned → effect_pending → outcome_ready → completed`；replay `safe/never` 决定恢复策略 | `session/types.ts:157`、`runtime/drive/tools.ts:523` |
| sourceIndex | 工具调用在 assistant 完整 content 数组中的下标，用于按模型原顺序放置结果 | `session/types.ts:152` |
| materialize / placement | 把连续就绪的工具结果按 sourceIndex 前缀写成 entry 并推 tip | `runtime/drive/tool-placement.ts:280` |
| memo | 一次工具调用范围内的 durable 键值（幂等键、远端 job ID）；outcome_ready 提交时删除 | `runtime/drive/tools.ts:100` |
| deferred（模型响应） | provider 返回异步句柄而非内容；operation 进入 `deferred.suspended`，需显式 poll permit 才查询 | `session/types.ts:281`、`runtime/drive/deferred.ts` |
| deferred tools | 另一个概念：工具在历史某点才变可用（`addedToolNames`） | `ai/src/utils/deferred-tools.ts:8` |
| poll permit | 一次 Drive 最多一次显式 deferred 查询额度（`pollDeferred:true`）；不是用户审批 | `runtime/types.ts:103` |
| summary / structural | compaction 与 branch summary 共用的摘要状态族 `summary.*`，boundary 决定结束后回 checkpoint、finish 或 commit navigation | `session/types.ts:213` |
| navigation | 把 tip 移到另一 entry，可选先摘要离开的分支 | `lane.ts:762` |
| Result / TaggedError | 公开操作不抛错而返回 `{ok, value|error}`；错误带 `_tag` 可序列化 | `harness/result.ts:1` |
| Context（harness/chord） | 显式尾参：abortSignal + telemetry parent；`awaitWithContext` 只取消等待者 | `harness/context.ts`、`chord/src/context/index.ts:98` |
| watch / snapshot / resnapshot | Lane 观察：先抓快照并缓冲事件，`start` 后按序投递；`navigation_end` 需 resnapshot（reducer 返回 `"rebase"`） | `lane.ts:1705`、`runtime/reducer.ts:220` |
| mutation line | Session 的 promise 尾链，串行化完整读-改-写；进程内协调，不是跨机器锁 | `session/mutation-line.ts` |
| commit / Write / seq | 一次事务的写集合（entry/usage/value/list），每条写获得全 Session 单调 seq | `session/commit.ts:82` |
| fault / seal | 存储或 invariant 故障使整个 Harness 进入 fault，封住所有 Lane；需重新打开 | `runtime/harness.ts:309` |

## 模型层（packages/ai）

| 术语 | 含义 | 位置 |
| --- | --- | --- |
| Models | 模型集合 + 鉴权应用 + 目录刷新；`stream()` 只准备请求，provider 才发出 | `ai/src/models.ts:672` |
| provider / adapter / wire API | provider 组合目录、auth 与一个 api 实现；api 实现负责真实协议（openai-completions、anthropic-messages…） | `ai/src/providers/*`、`ai/src/api/*` |
| lazyStream | 同步返回流、异步做 setup；调用即开始，不等首次 next | `ai/src/api/lazy.ts:46` |
| AssistantMessageEvent / partial | 流事件；`partial` 是共享的“至今为止”累加器，不是事件时刻快照 | `ai/src/types.ts:539` |
| frame / AssistantMessageFrameEncoder | 把共享 partial 变成可持久化的增量帧；done/error 不入帧 | `ai/src/utils/assistant-message-frame.ts:139` |
| stopReason | `pending / stop / length / toolUse / error / aborted / deferred`；终态在 `result()` 里 | `ai/src/types.ts:406` |
| transformMessages | 发送前统一改写：图片降级、跨模型 thinking、工具 ID 归一化、跳过 error/aborted、补合成 tool result | `ai/src/api/transform-messages.ts:64` |
| compat（OpenAICompletionsCompat） | 一个 adapter 覆盖多家兼容服务的开关表；DeepSeek 由 provider 名或 baseUrl 自动检测 | `ai/src/types.ts:568`、`api/openai-completions.ts:1581` |
| retryProviderRequest / retryAssistantCall | 两层重试：前者包 HTTP 首响应前错误（默认 0 次），后者按 error 终态正则重试（永不重试 aborted） | `ai/src/utils/provider-retry.ts:105`、`utils/retry.ts:174` |
| overflow / recoverable length | 上下文溢出的三种判定与“length 低于期望输出上限” | `ai/src/utils/overflow.ts:134` |
| usage / cost tier | input/output/cacheRead/cacheWrite/reasoning；tier 按三者之和匹配 | `ai/src/types.ts:383`、`models.ts:891` |

## 产品层（packages/coding-agent）

| 术语 | 含义 | 位置 |
| --- | --- | --- |
| AgentSession | 产品运行门面：持有旧 Agent、会话树、模型选择、资源、扩展、重试、压缩 | `coding-agent/src/core/agent-session.ts:314` |
| agent_end vs agent_settled | 前者是一次低层循环结束，产品层还可能重试/压缩/续跑；后者才是回到空闲 | `agent-session.ts:1101` |
| SessionManager（旧 JSONL） | 树形历史文件：`id/parentId/type`，首条 assistant 到达才落盘 | `core/session-manager.ts:1029` |
| buildSessionContext | 沿 parentId 回溯 leaf，把最新 compaction 投影为“摘要 + 保留段”，得到模型上下文 | `session-manager.ts:461` |
| extension / ExtensionEvent | 可执行 TS 扩展与约 30 类事件；`tool_call` 可阻断 | `core/extensions/types.ts:1086` |
| skill / prompt template | 文本资源：skill 只在 system prompt 列索引，正文按需读取；模板做参数替换 | `core/skills.ts`、`core/prompt-templates.ts` |
| project trust | 是否加载项目目录内的 settings/扩展/技能；CLI 确认流程，SDK 默认信任 | `core/project-trust.ts:46` |
| resource loader / precedence | 聚合各来源资源，项目显式 > 项目自动 > 用户显式 > 用户自动 > package | `core/package-manager.ts:188` |
| print / json / rpc / interactive | 四种 I/O mode，共享同一 AgentSession | `main.ts:111` |

## 多端与实验宿主（server / client / protocol / chord / experimental）

| 术语 | 含义 | 位置 |
| --- | --- | --- |
| presentation | 一个 UI 实例（TUI、未来浏览器页）；只观察不拥有执行 | `experimental/*` |
| serverId / sessionId / attachmentId | 逻辑 server 身份 / durable Session 身份 / 本次附着的临时能力标识 | `protocol/src/protocol.ts:40` |
| attachment（public / private） | SessionRouter 给客户端的 public ID；WorkerManager 另生成 private ID，经 lease 映射 | `server/src/session-router.ts:167`、`experimental/session-worker-manager.ts:212` |
| lease | public attachment 到 worker private scope 的映射句柄，release 时先等在途 service call | `session-router.ts:234` |
| coordinator | 稳定 Unix 端点，只转发；server 可换代而 worker 存活 | `experimental/coordinator.ts:43` |
| server generation | 一代 server 进程的 bookkeeping；被替换时 `detach()` 丢弃记录不停 worker | `session-worker-manager.ts:439` |
| worker | 持有真实 Session + Harness + ExecutionEnv 的进程；用 proper-lockfile 拿会话文件 owner | `experimental/session-worker.ts:533` |
| demand / retirement hold | worker 存活条件：有 presentation demand、有 active operation、或有在途请求 hold | `session-worker.ts:302` |
| facet | Chord 的组合单元：同步 `setup` 声明 provide/use，按依赖拓扑激活、逆序释放 | `chord/src/facets/host.ts:388` |
| service / singleton / keyed | Chord 服务契约与实例模式；跨进程经 `ServiceCall` 泛化调用 | `chord/src/services/wire.ts:89` |
| replicated state / delta | 服务的可复制 JSON 状态：provider `publish()` flush 出 Op 批，replica 按 sequence 应用，缺号即清空 | `chord/src/services/state.ts:6`、`chord/src/delta/index.ts` |
| Transcript | worker 侧把 `lane.watch` 快照与事件 reduce 成 replicated state，客户端只订阅它 | `experimental/services/transcript-provider.ts:20` |
| ByteTransport / ByteConnection | 客户端与服务端的字节传输插槽；Unix 与 Radius 都是实现 | `client/src/transport.ts:1` |
| Radius | 外部 relay：带鉴权 WebSocket，把多个 connection 复用为 Server 连接 | `experimental/radius-relay.ts` |
| mini | 另一套更小的实验宿主：自有 RPC、每 presentation 单独 watch、最后一个断开即停 worker | `experimental/mini/*` |
| TODO_CONTEXT | 公开 protocol 层尚无 principal 的占位 Context；不是认证 | `server/src/server.ts:280` |
