# 当前 AI SEO Agent 能力与差距分析

> 本页以 `master@5f2ad11f2c65425e84392e81048364d55ec626ef` 为当前项目证据基线，修正旧研究资料中“没有 ToolCall / 没有测试 / 没有 Tool boundary”的过期判断。正式任务状态仍以 `docs/tasks/**` 为准；本页只记录研究视角下的能力和缺口。

## 1. 结论

当前项目已经不是“文本型单采样 Demo”的早期状态。它已经具备：

- 会话、消息、NDJSON streaming、停止生成。
- `AgentRun` / `AgentStep` 粗粒度运行记录。
- provider-neutral `ModelStreamEvent`。
- 最小 Tool Contract、Registry、Invocation、Result。
- `test:model-stream` 与 `test:tools` 基础测试。

但它仍然还没有形成真正的 Agent loop，因为缺少这一段闭环：

```text
model tool call
  -> server validate / execute
  -> observation append to model-visible history
  -> second sampling
  -> final answer
```

因此最近路线应该从 **Phase 03：单 Agent Tool Loop** 开始，而不是重复实现 Phase 01 / Phase 02。

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

- `prisma/schema.prisma`
- `apps/api/src/conversations/`
- `apps/web/src/api/conversations.ts`

仍缺：

- 用户 / 租户归属。
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

仍缺：

- 外部 stream contract 自动化测试。
- 服务重启后的状态恢复。
- 多实例下 cancellation 路由。
- tool progress 与 approval 等内部事件投影。

### 2.3 AgentRun / AgentStep

已具备：

- 每次 streaming 用户输入创建 AgentRun。
- 预创建接收消息、加载历史、调用模型、流式回复四个 step。
- run / step terminal status。
- startedAt / endedAt。
- step input/output JSON snapshot。
- 事务创建 Run + 初始 Steps。

仍缺：

- Tool call、Tool result、Approval 的细粒度 steps。
- sampling attempt / execution attempt 表达。
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
- model stream 测试覆盖普通文本、tool loop 未实现 fail-fast、provider error、异常 finish reason、abort。

仍缺：

- 多轮 sampling loop。
- model-visible history union。
- Tool call -> observation -> second sampling。
- loop budget。
- sync endpoint 与 stream endpoint 的统一 runner。
- recorder transaction / runtime 集成测试。

### 2.5 LLM / Model event

已具备：

- `ModelStreamEvent` 内部稳定事件。
- `ModelFinishReason`。
- `UnvalidatedModelToolCall`。
- usage event。
- response_completed event。
- tool call 未接入 loop 时明确失败，不静默丢弃。

仍缺：

- request 侧 tools / tool_choice / parallel_tool_calls mapper。
- provider profile：是否支持 tool calls、include_usage、parallel_tool_calls。
- sync `chat()` 语义与 stream runner 对齐。
- Run 中记录实际模型、usage、finish reason。

### 2.6 Tool Contract / Registry / Invocation

已具备：

- `ToolDefinition` / `RegisteredTool` / `ToolExecutor` / `ToolResult`。
- `ToolRegistryService`：注册、查找、重复名称拒绝、稳定排序 definitions。
- `ToolInvocationService`：unknown tool、JSON parse、schema parse、risk gate、validated invocation、executor 调用。
- 当前阶段对需审批、非低风险、有副作用或联网工具 fail closed。
- `ModelToolSpec` mapper 只暴露模型可见字段。
- tools 测试覆盖 registry、invalid args、risk、abort、异常脱敏等。

仍缺：

- AgentRuntimeService 内的 Tool loop 接线。
- samplingAttemptId 与 callId / executionAttempt 的完整贯通。
- observation 回填到下一轮 model input。
- tool output 截断、timeout、recording。
- 内置真实 SEO 只读工具是否已经完整接入，需要后续按代码再次核验。

### 2.7 Context

已具备：

- `SeoContextBuilder` 独立于 runtime。
- history 有固定上限。
- prompt 与历史组合集中在 SEO 层。

仍缺：

- `ModelInputItem` union。
- tool call / output message 类型。
- token budget。
- context source 和优先级。
- 过大 observation 截断。
- compaction / summary。
- prompt version 与构造结果测试。

### 2.8 前端

已具备：

- 会话工作台。
- 本地 optimistic user message。
- 流式 assistant message。
- stop generation。
- 多会话缓存和状态恢复到数据库结果。

近期可以不改：

- Phase 03 可先不展示工具过程，只保证最终回答和协议 shape 不破坏。

仍缺：

- Run/Step timeline。
- Tool call / result UI。
- Approval UI。
- stream reconnect / server state reconciliation。
- 多端并发更新。

## 3. 差距矩阵

| 能力 | 当前成熟度 | 目标成熟度 | 优先级 | 最小下一步 |
| --- | --- | --- | --- | --- |
| Session Chat | 可用基础 | 权限明确的 Thread | P2 | 后期加 owner/tenant |
| Streaming | 可用基础 | 可测试、可恢复 stream | P1 | contract test + runner 统一 |
| Run/Step | 可观察基础 | 可恢复状态机 | P1 | tool steps + recovery policy |
| Model event | 已有基础 | request/response 双向 provider-neutral | P1 | tools request mapper |
| Tool contract | 已有基础 | 可被 Agent loop 消费 | P0 | runtime 接线 |
| Tool loop | 无闭环 | 多轮受预算 sampling | P0 | fake LLM 两轮测试 |
| Model history | 纯 message 为主 | message/call/result union | P0 | `ModelInputItem` |
| Approval | metadata fail closed | 可持久等待/决策 | P1 | risk + approval request |
| Context budget | 固定条数 | token/priority policy | P1 | observation budget |
| Compaction | 无 | 可追踪 summary | P2 | 先定义触发/事实 |
| Idempotency | 无 | 请求与副作用幂等 | P1 | operation identity |
| Recovery | 无 | crash reconciliation | P2 | stale RUNNING sweeper |
| Observability | step 基础 | trace/metrics/eval | P1/P2 | correlation ids |
| Automated tests | 已有 model/tools 基础 | 单元+集成+contract | P0/P1 | tool loop integration |
| Multi-tenant | 无 | 数据与成本隔离 | P2 | auth/ownership design |
| MCP/plugins | 无 | 可选扩展层 | P3 | 内置工具稳定后再做 |
| Multi-agent | 无 | 有边界的 child runs | P3 | 单 Agent 成熟后实验 |

## 4. 近期最高风险

1. 已有 ToolInvocationService，但在 Phase 03 中绕开它，直接把模型 raw JSON 交给 executor。
2. 只执行工具，却没有把 observation 回填到第二轮 sampling。
3. 把 tool result 写进 UI assistant Message，污染用户 transcript。
4. `response_completed(tool_calls)` 被误判为整个 AgentRun completed。
5. 缓冲到 terminal 后仍声称 streaming 行为完全兼容，忽略首 token/实时性变化。
6. sync endpoint 继续 direct `LLMService.chat()`，绕过 AgentRun、工具、context 和错误收口。
7. 没有 loop budget，模型无限调用工具。
8. Abort 后迟到的工具结果或模型结果覆盖 ABORTED。

## 5. 推荐最近三个里程碑

### 里程碑 A：单 Agent Tool Loop

- `ModelInputItem` 能表达 message、assistant tool call、tool result。
- provider request mapper 能发送 tools，并设置 `parallel_tool_calls=false`。
- sampling reducer 能输出 final answer 或 single tool call decision。
- tool call 经 `ToolInvocationService` 验证和执行。
- observation 进入第二轮 sampling。
- final answer 写入 UI Message。
- invalid / unknown / throw / abort / loop limit tests。

### 里程碑 B：Tool 可靠性收口

- tool call/result 记录到 AgentStep 或独立 record。
- timeout / cancel / error taxonomy。
- output truncation。
- trace correlation。
- Run/Step terminal exactly-once。

### 里程碑 C：Context 与恢复基础

- observation budget。
- context source / priority。
- prompt version。
- stale RUNNING recovery。
- operation identity / idempotency key。

完成这三个里程碑，当前项目才真正从“具备工具边界的 Chat Runtime”进入“可验证 Agent Runtime”。
