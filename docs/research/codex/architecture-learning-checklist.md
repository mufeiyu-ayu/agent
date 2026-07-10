# Codex 可学习 Agent 架构清单

本清单用于回答“Codex 中有哪些 Agent 架构知识值得系统学习”。它不是一次性开发任务；每一项都需要源码阅读、当前项目映射、最小练习和验收证据。

优先级：

- **P0**：当前 Tool Calling 闭环的直接前置。
- **P1**：单 Agent 可靠运行的必要能力。
- **P2**：云端生产化能力。
- **P3**：稳定后再学的扩展能力。

## A. 系统边界与协议

### A1. 多入口共享 Core Runtime（P1）

- [ ] 能解释 CLI、App、IDE、SDK 为什么不应各自实现 Agent loop。
- [ ] 能区分 entrypoint、protocol facade、application runtime、provider adapter。
- [ ] 能在当前项目中指出 Web 请求进入 runtime 的唯一入口。
- [ ] 能设计未来 cron / webhook 复用 `AgentRuntimeService` 的调用方式。
- [ ] 能用测试证明新入口不会绕过 run/step 持久化。

### A2. 稳定协议与内部类型分离（P0）

- [ ] 能解释 Codex app-server request / response / notification 的区别。
- [ ] 能解释 `ResponseEvent`、`EventMsg`、app-server notification、TurnItem 的层次。
- [ ] 能解释 Item 是有身份/可完成的语义对象，Event 是对象生命周期或增量的传输通知；`OutputItemDone(item)` 也不让二者变成同义词。
- [ ] 能解释当前 `AgentRuntimeEvent -> ChatStreamEvent` mapper 的价值。
- [ ] Tool Calling 第一版不把 provider SDK chunk 直接暴露给 SEO 层。
- [ ] 对外协议升级有兼容策略，不因内部新增 step 强制改前端。
- [ ] NDJSON parser 对未知/非法事件有明确失败行为和测试。

### A3. Capability negotiation 与版本演进（P3）

- [ ] 理解 Codex 为什么在 initialize 阶段协商 capability。
- [ ] 能判断当前项目何时才需要 stream protocol version。
- [ ] 能区分稳定字段、实验字段和内部字段。
- [ ] 不在没有两个真实客户端时过早实现复杂 capability 系统。

## B. 生命周期模型

### B1. Thread / Conversation（P1）

- [ ] 能解释长期会话与一次执行的区别。
- [ ] Conversation 具有明确所有权和访问边界设计。
- [ ] 能区分 active、archived、deleted 等资源状态是否需要落库。
- [ ] 能定义会话加载、恢复和并发写入策略。
- [ ] 能解释删除 Conversation 对 Message / AgentRun / ToolCall 的级联影响。

### B2. Turn / AgentRun（P0）

- [ ] 能用“一次回复任务”解释 AgentRun。
- [ ] 每次用户发送最多创建一个 canonical AgentRun。
- [ ] Run 具有唯一终态：COMPLETED / FAILED / ABORTED。
- [ ] 重复请求不会创建不可辨认的重复 Run。
- [ ] Run 记录模型、配置版本、触发来源和必要的 trace metadata。
- [ ] 能识别服务崩溃后残留 RUNNING 的 Run。

### B3. Task / Runner（P1）

- [ ] 能区分数据库 AgentRun 与执行它的 runner/service。
- [ ] 能说明 Task 为何适合封装调度和 cancellation。
- [ ] 当前 runtime 变复杂时，能识别拆分 `AgentTurnRunner` 的触发条件。
- [ ] 不为了模仿 Codex 提前引入空壳 Task 抽象。

### B4. Item / AgentStep（P0）

- [ ] 能解释 Codex Item 与当前 AgentStep 不是一对一关系。
- [ ] AgentStep 只记录可观察系统步骤，不记录 chain-of-thought。
- [ ] 每个 step 有 startedAt / endedAt 和唯一终态。
- [ ] Tool Call step 的 input/output 有脱敏和大小限制。
- [ ] 重试是覆盖 step、创建 attempt，还是新 step，有明确规则。
- [ ] UI 是否显示 step 与 step 是否持久化相互独立。

## C. Agent loop 与模型适配

### C1. 结构化 ModelStreamEvent（P0）

- [ ] LLM 层不再只返回 `string` delta。
- [ ] 项目定义 provider-neutral 的文本、tool call、usage、completed **value events**；provider/network/abort 只走 async iterator throw，不同时再产 error value。
- [ ] OpenAI-compatible chunk 只在 client adapter 中解析。
- [ ] tool call arguments 跨 chunk 拼接有测试。
- [ ] 多 tool call、空 content、finish reason 均有明确语义。
- [ ] AbortError / network error / provider error 保持可分类。
- [ ] 流请求显式启用 `include_usage`，能处理 `choices=[]` usage-only chunk，并保证 usage 在唯一 completed 之前。

### C2. 采样循环（P0）

- [ ] Runtime 能区分“最终回答”和“需要执行工具后继续”。
- [ ] 每轮 sampling 有上限，避免无限 tool loop。
- [ ] 模型请求次数、工具调用次数和总耗时有预算。
- [ ] tool observation 写回后会触发下一次 sampling。
- [ ] 没有 tool call 时正常完成最终回答。
- [ ] 模型连续请求同一工具时有防失控策略或预算保护。

### C3. Step Context 快照（P1）

- [ ] 每次 sampling 使用一致的 model、tools、context 和权限视图。
- [ ] 运行中配置变化是否影响当前 Run 有明确规则。
- [ ] 工具可见集合与实际可执行集合不会意外不一致。
- [ ] 能记录足够 metadata 复盘某次模型为何看到这些工具。

### C4. Provider session 与重试（P2）

- [ ] 能区分业务 Run 重试和 HTTP SDK 自动重试。
- [ ] 流式响应断开后的重试不会重复外部副作用。
- [ ] provider timeout、rate limit、5xx 有分类和退避策略。
- [ ] 预算耗尽时返回确定错误，而不是无限重试。

## D. Tool Calling 分层

### D1. ToolDefinition / ToolSpec（P0）

- [ ] 工具名称稳定、唯一、可读。
- [ ] 描述说明何时使用和何时不要使用。
- [ ] 参数 schema 最小且可运行时校验。
- [ ] 输出 contract 可被模型稳定理解。
- [ ] metadata 至少包含 version、sideEffect、riskLevel、timeoutMs、requiresApproval、idempotent。
- [ ] 工具定义不导入 SEO controller 或数据库实现。

### D2. Unvalidated envelope / Validated invocation（P0）

- [ ] provider adapter 先产含 callId/toolName/rawArgumentsJson 的 candidate；sampling reducer 再加入 server-owned samplingAttemptId，形成 `UnvalidatedToolCallEnvelope`。
- [ ] 只有 registry lookup、JSON parse、对应 tool version schema validation 全通过，才构造 typed `ValidatedToolInvocation`。
- [ ] Executor 的类型签名不能接受 envelope/unknown/raw JSON，避免绕过验证。
- [ ] validated invocation 的 toolVersion 来自 server registry，executionAttempt 来自执行边界，不信任模型。
- [ ] callId 在 observation 回填时保持一致。
- [ ] 非法 JSON arguments 被转换为可分类错误。
- [ ] 未注册工具不会执行任意动态代码。
- [ ] 模型不可伪造用户身份、tenantId 或权限字段。

### D3. ToolRegistry（P0）

- [ ] 重复工具名启动时失败或显式报错。
- [ ] registry 能列出模型可见 definition。
- [ ] registry 能按名字解析 executor。
- [ ] 工具 enable/disable 规则与注册本身分开。
- [ ] 测试可注入 fake tool，而不访问真实外部服务。

### D4. ToolExecutor（P0）

- [ ] schema validator 在 executor 前完成 untrusted JSON 校验；executor 只接受 validated invocation，并可再做业务约束校验。
- [ ] 业务逻辑不信任模型提供的鉴权上下文。
- [ ] 每个工具有 timeout 和 AbortSignal。
- [ ] execution boundary 主动 race executor/abort/deadline；executor 忽略 signal 或永不 settle 时也能有限收口。
- [ ] timeout 后的 late resolve/reject 不会二次改终态、触发下一轮或制造 unhandled rejection。
- [ ] 错误被分类为 validation、permission、timeout、dependency、internal。
- [ ] 返回结构化 result，不把异常堆栈直接喂给模型。
- [ ] 只读工具也记录耗时和结果摘要。

### D5. ToolRouter（P0）

- [ ] Provider output 到 unvalidated envelope 的转换，以及 envelope 到 validated invocation 的转换，各有唯一集中边界。
- [ ] Router 不执行真实业务逻辑。
- [ ] Router 能处理普通 function call 与未来扩展 call 的差异。
- [ ] 非工具 item 不被误路由。
- [ ] Router 有纯单元测试。

### D6. Observation（P0）

- [ ] Observation 同时服务模型回填和系统审计，但两者视图可不同。
- [ ] 结果过大时有截断或引用策略。
- [ ] 敏感字段在回填和持久化前脱敏。
- [ ] 失败 observation 能告诉模型下一步如何处理，但不泄漏内部实现。
- [ ] call/output 配对不变量有测试。
- [ ] observation 被视为不可信数据；其中的命令式文本不会升级成 system/developer instruction，也不能修改 server-side permission/approval policy。

### D7. 工具并行（P2）

- [ ] 只有声明可并行的只读工具才能并行。
- [ ] 并行数量有上限。
- [ ] 结果写回顺序可预测。
- [ ] 任一调用取消时不会留下不可控后台任务。
- [ ] 第一版保持顺序执行，直到单工具闭环稳定。

## E. Context 工程

### E1. 数据分层（P1）

- [ ] UI transcript、model history、runtime event、persistent fact 四层有明确类型。
- [ ] `Message` 不再被直接等同于所有 model message。
- [ ] tool call / output 不伪装成普通 assistant 文本。
- [ ] 同轮 mixed assistant text + tool call 在 model history 中完整保留，即使中间文本不进入 UI transcript。
- [ ] system / developer prompt 不作为用户消息落库。

### E2. ContextBuilder（P1）

- [ ] SeoContextBuilder 接收结构化 context，而不是只接 ChatMessage[]。
- [ ] prompt、历史、业务数据、tool observations 有确定顺序。
- [ ] 构造结果可测试、可快照、可解释。
- [ ] runtime 不反向依赖 SEO prompt。
- [ ] 同步和 streaming 路径不使用两套不同 context 规则。
- [ ] 同步 endpoint 复用同一 turn runner 并收集 final，或在 tool mode 明确禁用；不保留 direct LLM 旁路。

### E3. Token 预算（P1）

- [ ] 不再只用“最近 12 条”作为唯一规则。
- [ ] 为 system prompt、history、tool output、current input、completion 分配预算。
- [ ] 预算计算失败时有保守策略。
- [ ] 记录本次请求实际或估算 token 使用。
- [ ] tool output 大小在进入模型前受限。

### E4. 历史规范化（P1）

- [ ] 每个 tool call 有对应 observation。
- [ ] 孤立 observation 被拒绝或修复。
- [ ] 不支持的内容模态不会进入 provider 请求。
- [ ] 失败或 aborted 的 assistant placeholder 是否进入 history 有明确规则。
- [ ] history 构造不会把当前用户消息重复加入。

### E5. Compaction / Summary（P2）

- [ ] 先定义触发阈值，再选择摘要算法。
- [ ] 摘要与原始消息分离存储。
- [ ] 摘要保留业务事实、未完成目标和重要 tool observation。
- [ ] 摘要可替换、可追踪来源、可测试。
- [ ] 压缩失败不会破坏当前 Thread。

## F. 持久化与恢复

### F1. Canonical facts（P1）

- [ ] 明确哪些对象是恢复所需事实。
- [ ] 不为每个文本 token 创建数据库行。
- [ ] Tool call、observation、approval、run terminal status 有持久化策略。
- [ ] 大结果采用摘要、对象存储或引用，而不是无限 JSON。

### F2. 幂等（P1）

- [ ] send message 请求支持 clientRequestId / idempotency key。
- [ ] 同一请求重放不会重复创建用户消息和 Run。
- [ ] 写操作工具具有独立幂等键。
- [ ] 重试 observation 不会关联错误的 callId。

### F3. Crash recovery（P2）

- [ ] 启动或定时任务能识别超时 RUNNING。
- [ ] 能把不可恢复 Run 标为 FAILED / INTERRUPTED，并记录原因。
- [ ] 可恢复工具必须明确 checkpoint。
- [ ] 进程重启后客户端能重新查询 canonical state。
- [ ] 不依赖内存 AbortController 作为唯一真实状态。

### F4. Store boundary（P2）

- [ ] Runtime 不直接散落 Prisma 查询。
- [ ] 何时需要 repository/store 抽象有明确触发条件。
- [ ] 查询投影与写入事实分开考虑。
- [ ] 事务边界覆盖需要原子化的 run/message/step 更新。

## G. 中断、并发与背压

### G1. Cancellation（P1）

- [ ] 浏览器断开能传递到 provider 和 tool executor。
- [ ] Abort 后 Message / Run / Step 都进入一致终态。
- [ ] cancellation 是预期控制流，不被记录成普通系统错误。
- [ ] 长工具定期检查 signal 或使用可取消 API。

### G2. Conversation 并发（P2）

- [ ] 同一 Conversation 是否允许多个 active Run 有明确策略。
- [ ] 数据库层或应用层能防止不允许的并发。
- [ ] 客户端重复点击和网络重试不会产生竞态。
- [ ] 多实例部署时不依赖单进程全局变量。

### G3. Queue 与背压（P2）

- [ ] 只有真实负载需要时才引入队列。
- [ ] 队列前先定义任务状态、幂等和取消语义。
- [ ] 每租户/用户并发上限可配置。
- [ ] 超载时返回可重试错误和 Retry-After 语义。

### G4. Steer / Resume / Fork（P3）

- [ ] 能分别解释四种语义，不用一个 continue 代替。
- [ ] 先实现可靠 resume，再考虑 in-flight steer。
- [ ] fork 创建新 Conversation，保留来源关系。
- [ ] 这些能力均有权限和成本控制。

## H. Human-in-the-loop 与安全

### H1. Risk metadata（P1）

- [ ] 工具有只读/写入/外部副作用分类。
- [ ] 风险等级由系统定义，模型不能自行降低。
- [ ] 参数范围会影响风险时，策略能基于解析后的参数判断。

### H2. Approval（P1）

- [ ] approval request 有 runId、callId、工具名、参数摘要和过期时间。
- [ ] WAITING_APPROVAL 是明确运行状态或 step 状态。
- [ ] 同意、拒绝、超时、取消都有终态。
- [ ] 批准只对本次具体调用有效，除非用户明确建立规则。
- [ ] 重复提交 approval decision 保持幂等。

### H3. Authentication / Authorization（P2）

- [ ] 每个 Conversation、Run、Message 查询都绑定用户/租户。
- [ ] 工具访问资源时重新校验 server-side identity。
- [ ] 前端提供的 userId 不作为权威身份。
- [ ] 管理接口和普通用户接口分开。

### H4. Isolation（P2）

- [ ] 模型 API Key 只存在服务端。
- [ ] 不同租户凭证和数据隔离。
- [ ] 外部 HTTP 工具有域名 allowlist、超时和响应大小限制。
- [ ] 日志不记录 secret、完整 token 或敏感原文。
- [ ] 只有引入不可信代码执行时才评估 OS sandbox。

## I. 错误、重试与韧性

### I1. Error taxonomy（P1）

- [ ] provider、tool、validation、permission、timeout、cancellation、persistence 错误分层。
- [ ] 用户文案与内部诊断信息分开。
- [ ] AgentStep.errorMessage 不泄漏 secret。
- [ ] error event 有稳定 code，而不只是一段中文字符串。
- [ ] raw Error/cause/stack 即使只进 server log，也经过 allowlist、限长与脱敏；测试同时检查 DB、observation 和 logger sink。

### I2. Retry policy（P2）

- [ ] 只对明确可重试错误重试。
- [ ] 使用有上限的指数退避和 jitter。
- [ ] tool side effect 前后分别考虑 retry safety。
- [ ] 重试次数和耗时进入 trace。
- [ ] 用户主动取消不会触发重试。
- [ ] provider transport retry、sampling follow-up、tool execution retry 的所有者分开；Phase 04 不自动重试工具，Phase 07 基于 durable outcome 决策。

### I3. Partial failure（P2）

- [ ] 模型成功但持久化失败时有补偿或明确失败状态。
- [ ] 工具成功但 observation 写回失败时不会盲目重做副作用。
- [ ] stream 断开后客户端能通过查询恢复最终事实。

## J. 可观测性与评测

### J1. Trace model（P1）

- [ ] requestId、conversationId、runId、stepId、callId 可关联。
- [ ] 每个 sampling 和 tool execution 有 duration。
- [ ] 记录 model、token usage、tool name、result status，不记录秘密。
- [ ] trace/span 与业务数据库 ID 的关系明确。

### J2. Metrics（P2）

- [ ] Run 成功率、失败率、取消率。
- [ ] 首 token 延迟、总耗时、tool 耗时。
- [ ] 每 Run sampling 次数和 tool 次数。
- [ ] Context token 与 compaction 次数。
- [ ] 每租户成本和限额。

### J3. Evaluation（P2）

- [ ] 建立固定 SEO 任务集。
- [ ] 分开评估最终答案质量和工具选择正确性。
- [ ] Tool arguments、observation 使用、拒绝危险动作都有评分。
- [ ] prompt / model / tool version 变化前后可对比。
- [ ] 评测失败不能只靠人工感觉。

## K. 测试架构

### K1. Unit tests（P0）

- [ ] Tool schema、registry、router、context builder 纯单元测试。
- [ ] 错误分类与 mapper 测试。
- [ ] call/output normalization 测试。

### K2. Runtime integration tests（P0）

- [ ] Fake LLM 先返回 tool call，再返回 final answer。
- [ ] Fake tool 成功、失败、超时、取消。
- [ ] Run/Step/Message 终态一致。
- [ ] 多轮 sampling 上限。
- [ ] Tool observation 确实进入第二轮 model input。
- [ ] 每轮 tool request 显式 `parallel_tool_calls=false`，同时仍测试 provider 违规返回多 call 的 fail-closed 行为。
- [ ] mixed text + tool call 的文本进入 model history、不进入 UI Message。
- [ ] uncooperative executor/late settlement 的 timeout race。

### K3. Contract tests（P1）

- [ ] NDJSON start/delta/done/error/aborted。
- [ ] 非法流事件和提前 EOF。
- [ ] API DTO 校验和全局异常格式。
- [ ] 未来工具事件的兼容性。
- [ ] 若 buffer 到 terminal 才输出 final chunks，验收只称 schema/content compatible，并明确首 token/实时性行为变化。

### K4. Recovery tests（P2）

- [ ] 服务重启前后的 RUNNING recovery。
- [ ] 幂等请求重放。
- [ ] approval 决策重放。
- [ ] 并发发送和取消竞态。

### K5. Opt-in live provider smoke（P1）

- [ ] 默认 CI 仍完全使用 fixture/fake；真实 provider smoke 只有显式环境开关才运行。
- [ ] smoke 使用低成本只读工具、`parallel_tool_calls=false`，验证真实 envelope -> observation -> final 闭环。
- [ ] API key、raw prompt、完整 arguments/result 不进入 snapshot 或日志；随机自然语言不做脆弱全文断言。

## L. 扩展架构

### L1. Built-in tools（P0）

- [ ] 先完成一个纯只读 SEO 工具。
- [ ] 再增加第二个工具验证 registry 不是为单例硬编码。
- [ ] 内置工具与 provider adapter 解耦。

### L2. MCP（P3）

- [ ] 理解 MCP 解决外部工具发现/调用，不解决内部权限。
- [ ] 本地 Tool contract 稳定后再写 MCP adapter。
- [ ] MCP server auth、timeout、tool trust 有边界。
- [ ] 不让外部 tool description 绕过系统 policy。

### L3. Skills / Plugins / Hooks（P3）

- [ ] 能区分可复用指令、可执行工具、生命周期 hook、分发包。
- [ ] 没有真实复用需求时不创建插件市场。
- [ ] hook 失败是否阻断主流程有策略。
- [ ] 扩展有版本、来源和启用状态。

## M. Multi-agent（P3）

- [ ] 子 Agent 有独立 Run / Thread，而不是同一 prompt 的角色扮演。
- [ ] 父任务向子任务传递最小上下文。
- [ ] 子任务结果有结构化 contract。
- [ ] 并发槽位、成本、超时和取消传播可控。
- [ ] 工具权限只能继承相同或更窄范围。
- [ ] 父子关系和状态持久化。
- [ ] 单 Agent 基准优于或等于 Multi-agent 实验前，不进入产品主线。

## N. 云端生产化

### N1. 多租户（P2）

- [ ] schema 有用户/租户归属。
- [ ] 所有查询带 scope。
- [ ] 资源配额和成本可按租户统计。
- [ ] 数据导出、删除、保留策略明确。

### N2. Worker 与执行位置（P2）

- [ ] Web API 与长任务 worker 的边界有触发条件。
- [ ] 不在尚无负载时过早引入分布式系统。
- [ ] 迁移 worker 前先完成幂等、状态机和恢复。

### N3. Rate limit 与成本（P2）

- [ ] 用户、租户、provider 三层限额分开。
- [ ] 预算在请求前检查，运行中持续累计。
- [ ] 达到上限有稳定错误与恢复时间。
- [ ] 工具和模型成本都能归因到 Run。

### N4. Deployment safety（P2）

- [ ] schema migration 与旧实例兼容。
- [ ] graceful shutdown 能终止或交接 active Run。
- [ ] readiness 不在依赖不可用时误报健康。
- [ ] secrets、日志和数据库备份有基本策略。

## O. 作品集与表达

- [ ] 能用一张图解释 Controller -> Runtime -> Model/Tool -> Persistence。
- [ ] 能展示一个完整 Run 的事件和 step 时间线。
- [ ] 能解释为什么没有直接引入 LangGraph / MCP / Multi-agent。
- [ ] 能用测试证明 cancellation、tool loop、approval、recovery。
- [ ] 能比较 Codex 客户端架构与当前云端架构的差异。
- [ ] 能给出下一阶段的真实瓶颈，而不是功能愿望清单。

## 使用方式

1. 每个学习阶段只选择与当前范围对应的条目。
2. 完成条目必须附源码、测试或运行截图/日志等证据。
3. “理解了”不能替代可执行练习。
4. P3 条目不能挤占 P0/P1 的单 Agent 稳定性工作。
