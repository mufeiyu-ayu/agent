# 当前 AI SEO Agent 能力与差距分析

## 1. 结论

当前项目已经不是简单的“模型 API Demo”。它有真实会话、流式协议、持久化运行记录和内部 runtime 边界。但它仍属于 **文本型单采样 Agent Runtime 基础阶段**：

- 模型只能返回文本。
- Runtime 一次请求只做一次 sampling。
- 没有 ToolCall / Observation 类型。
- 没有自动化测试。
- 没有云端身份、租户、幂等、恢复和资源治理。

因此最合理的路线不是直接跳到 MCP、RAG 或 Multi-agent，而是先把“单 Agent Tool loop”做成可测试、可持久化、可取消的闭环。

## 2. 当前能力证据

### 2.1 会话与消息

已具备：

- `Conversation` 长期会话。
- `Message` 用户可见消息。
- USER / ASSISTANT role。
- PENDING / STREAMING / COMPLETED / FAILED / ABORTED 状态。
- 会话和消息的 PostgreSQL 持久化。
- 会话列表、消息读取、重命名和删除。

证据：

- `prisma/schema.prisma:60-92`
- `apps/api/src/conversations/`
- `apps/web/src/api/conversations.ts`

仍缺：

- 用户/租户归属。
- archive、share、权限等资源语义。
- 并发 active run 规则。
- 客户端请求幂等键。

### 2.2 Streaming 与停止生成

已具备：

- 后端 NDJSON stream。
- `start / delta / done / error / aborted` 外部事件。
- 浏览器 fetch + ReadableStream 按行解析。
- AbortController 从前端传到 provider。
- 连接关闭时触发中断。
- 消息、Run、Step 的 aborted 收口。

证据：

- `packages/contracts/src/seo.ts:12-61`
- `apps/api/src/seo/seo.controller.ts:34-69`
- `apps/web/src/api/seo.ts:20-152`
- `apps/web/src/hooks/useSeoWorkspace.ts:195-335`

仍缺：

- stream contract 自动化测试。
- 服务重启后的状态恢复。
- 多实例下 cancellation 路由。
- tool progress 与 approval 等内部事件。

### 2.3 AgentRun / AgentStep

已具备：

- 每次 streaming 用户输入创建 AgentRun。
- 预创建接收消息、加载历史、调用模型、流式回复四个 step。
- run / step terminal status。
- startedAt / endedAt。
- step input/output JSON snapshot。
- 事务创建 Run + 初始 Steps。

证据：

- `prisma/schema.prisma:94-160`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts:7-82`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts:136-247`

仍缺：

- Tool Call、Observation、Approval steps。
- attempt / retry 表达。
- Run 查询 API 或运行时间线 UI。
- 僵尸 RUNNING recovery。
- input/output 大小和敏感数据策略。
- request id / trace id / model usage metadata。

### 2.4 Runtime 边界

已具备：

- `AgentRuntimeService.runTurnStream()` 作为 streaming 主编排入口。
- `AgentRuntimeEvent` 与 `ChatStreamEvent` 分离。
- SEO mapper 保持外部协议稳定。
- SEO prompt 通过 callback 注入，不让 runtime 依赖 SEO module。

证据：

- `apps/api/src/agent-runtime/agent-runtime.service.ts:35-285`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
- `apps/api/src/seo/seo.service.ts:86-105`

仍缺：

- 多轮 sampling loop。
- provider-neutral model event。
- ToolRouter / Registry / Executor。
- context budget。
- runtime 单元/集成测试。
- application service 与 persistence query 的进一步边界。

### 2.5 LLM 适配

已具备：

- `LLMService` 是业务门面。
- OpenAI-compatible SDK 细节收敛到 client。
- 非流式和流式调用。
- timeout、AbortSignal 和基础错误分类。
- provider base URL/API key 与默认模型在服务端配置；请求可通过 `SeoChatDto.model -> AgentRuntimeInput.model -> LLM options` 由客户端覆盖具体 model id。

证据：

- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/clients/openai-compatible.client.ts`
- `apps/api/src/llm/llm.errors.ts`

关键缺口：

- `ChatMessage` 只有 system/user/assistant + string content。
- request params 没有 tools / tool_choice。
- stream 只读取 `chunk.choices[0]?.delta.content`。
- completion 只接受 `message.content`，tool call 会被当作无效内容。
- provider usage、finish reason、tool call 没有内部类型。
- SDK maxRetries 固定为 0，项目也没有上层 retry policy。
- streaming 尚未请求 `stream_options.include_usage`，也没有处理 `choices=[]` usage-only chunk 的 terminal 顺序。
- model override 虽然可从客户端传入，但允许集合、租户策略和 Run 中实际模型记录仍需明确；不能误写成“模型只来自环境变量”。

这说明 Tool Calling 的第一处改动应从 LLM boundary 开始，而不是先在 SEO Service 里写 switch。

### 2.6 Context

已具备：

- `SeoContextBuilder` 独立于 runtime。
- history 有固定上限。
- prompt 与历史组合集中在 SEO 层。

证据：

- `apps/api/src/seo/seo-context-builder.service.ts`
- `apps/api/src/seo/seo.service.ts:18`
- `apps/api/src/agent-runtime/agent-runtime.service.ts:71-87`

仍缺：

- token budget。
- tool call / output message 类型。
- context source 和优先级。
- 过大 observation 截断。
- compaction / summary。
- prompt version 与构造结果测试。
- 同步 `chat()` 仍绕开 AgentRuntimeService，形成双路径。

Tool loop 阶段的明确策略应是：同步 `chat()` 消费与 stream endpoint 相同的 turn runner 到 terminal 并返回 final；若暂时做不到，则对 tool-enabled sync request 明确 fail closed。继续 direct `LLMService.chat()` 会让同步请求绕过 AgentRun、工具、context 和错误收口。

### 2.7 前端

已具备：

- 会话工作台。
- 本地 optimistic user message。
- 流式 assistant message。
- stop generation。
- 多会话缓存和状态恢复到数据库结果。

仍缺：

- Run/Step timeline。
- Tool call / result UI。
- Approval UI。
- stream reconnect / server state reconciliation。
- 多端并发更新。

当前 Tool Calling 第一版明确可以不改前端，先保证外部 stream contract 不破坏。

### 2.8 测试与质量

已具备：

- TypeScript strict 检查。
- workspace typecheck。
- ESLint。
- Prisma validation/generation 流程。

严重缺口：

- 仓库中没有任何 `.test` / `.spec` 文件。
- 没有 fake provider。
- 没有 recorder transaction 测试。
- 没有 runtime 状态机测试。
- 没有 NDJSON parser contract 测试。
- 没有端到端测试。

Tool Calling 会把一次线性流扩展为循环状态机。如果不先补测试基座，后续 Approval、Context、Recovery 都会建立在不可证明的行为上。

### 2.9 云端基础

当前只有本地 Postgres docker-compose，没有证据证明已经实现：

- 用户登录与鉴权。
- 租户隔离。
- API rate limit。
- 任务队列和 worker。
- Redis / distributed lock。
- deployment manifests。
- telemetry backend。
- secret manager。
- backup / retention。

这些不是阶段 5 的前置，但必须进入中后期云端路线。

## 3. 差距矩阵

| 能力 | 当前成熟度 | 目标成熟度 | 优先级 | 最小下一步 |
| --- | --- | --- | --- | --- |
| Session Chat | 可用基础 | 权限明确的 Thread | P2 | 后期加 owner/tenant |
| Streaming | 可用基础 | 可测试、可恢复 stream | P1 | contract test |
| Run/Step | 可观察基础 | 可恢复状态机 | P1 | tool steps + recovery policy |
| Model adapter | 文本-only | 结构化 ModelEvent | P0 | 定义 event union |
| Tool contract | 无 | definition/call/result | P0 | types + validation |
| Tool loop | 无 | 多轮受预算采样 | P0 | fake LLM 两轮测试 |
| Approval | 无 | 可持久化等待/决策 | P1 | risk metadata 后实现 |
| Context budget | 固定条数 | token/priority policy | P1 | budget interface |
| Compaction | 无 | 可追踪 summary | P2 | 先定义触发/事实 |
| Idempotency | 无 | 请求与副作用幂等 | P1 | clientRequestId |
| Recovery | 无 | crash reconciliation | P2 | stale RUNNING sweeper |
| Observability | step 基础 | trace/metrics/eval | P1/P2 | correlation ids |
| Automated tests | 无 | 单元+集成+contract | P0 | test runner + fake adapters |
| Multi-tenant | 无 | 数据与成本隔离 | P2 | auth/ownership design |
| MCP/plugins | 无 | 可选扩展层 | P3 | 内置工具稳定后再做 |
| Multi-agent | 无 | 有边界的 child runs | P3 | 单 Agent 成熟后实验 |

## 4. 风险排序

### 近期最高风险

1. 在 `AgentRuntimeService` 中直接解析 OpenAI SDK tool chunk，破坏 provider 边界。
2. 只做 `ToolRegistry`，但没有 observation 回填和第二轮 sampling。
3. Tool Calling 没有测试，导致 Run/Step 收口出现隐藏状态。
4. 把 tool result 当普通 assistant text，污染 UI message 和 model history。
5. 在只读工具阶段就扩协议和前端 timeline，扩大范围。
6. 把 provider 的 raw call envelope 命名成 ToolCall 后直接送 executor，跳过 registry lookup/schema validation。
7. 缓冲到 terminal 后仍声称 streaming 行为完全兼容，忽略首 token/实时性变化。

### 中期风险

1. 写操作工具没有幂等和审批。
2. 多实例部署仍依赖内存 AbortController。
3. 固定 12 条 history 在 tool output 增长后失控。
4. input/output JSON 保存敏感或超大数据。
5. 没有用户/租户边界却开放外部工具。

## 5. 推荐最近三个里程碑

### 里程碑 A：可测试的模型事件边界

- 引入测试框架。
- 定义 `ModelStreamEvent`。
- fake stream 覆盖 text/tool/usage/completed 值，并用 iterator throw 覆盖 provider error/abort；不建立第二套 error value channel。
- 现有外部 NDJSON 行为不变。

### 里程碑 B：单只读工具闭环

- ToolDefinition / Unvalidated envelope / Validated invocation / Result。
- Registry / Executor / Router。
- 第一轮 tool call，执行，observation 回填，第二轮 final text。
- Run/Step terminal state 全部可断言。
- 每轮请求显式 `parallel_tool_calls=false`，mixed text 在 model history 保留但不进 UI。

### 里程碑 C：可靠性收口

- loop budget。
- tool timeout/cancel/error taxonomy。
- 主动 race 不配合 AbortSignal 的 executor 与 late settlement。
- idempotency key。
- stale RUNNING 检测设计。
- trace correlation。
- 不在此里程碑自动 retry 工具；记录 idempotency/attempt，Phase 07 再基于 durable outcome 决策。

完成这三个里程碑，当前项目才真正从“可观测 Chat Runtime”进入“可验证 Agent Runtime”。
