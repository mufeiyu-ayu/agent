# 当前 Agent 项目基线与最近路线

## 1. 结论

以 `master@5f2ad11f2c65425e84392e81048364d55ec626ef` 为基线，当前项目已经从“文本流式 Chat Runtime”推进到“具备模型事件边界和最小工具契约的 Agent Runtime 前夜”。

更准确地说：

```text
已完成：模型事件边界 + 工具定义/注册/验证/直接执行
未完成：模型驱动 tool call 后，把 observation 回填到第二轮 sampling
```

所以近期不应继续创建“从零定义 ModelStreamEvent”或“从零建立 ToolRegistry”的任务；应该复盘已完成边界，然后进入 **单 Agent Tool Loop**。

## 2. 已具备能力

### 2.1 会话、消息、流式输出

已具备：

- `Conversation` 长期会话。
- `Message` 用户可见消息。
- USER / ASSISTANT role。
- PENDING / STREAMING / COMPLETED / FAILED / ABORTED 状态。
- PostgreSQL 持久化。
- NDJSON streaming 与 stop generation。

仍缺：

- 用户 / 租户所有权。
- archive / share / permission 等资源语义。
- active run 并发准入规则。
- 多实例 cancellation 路由。

### 2.2 AgentRun / AgentStep

已具备：

- streaming 用户输入创建 `AgentRun`。
- 粗粒度 `AgentStep`：接收消息、加载历史、调用模型、流式回复。
- terminal status、startedAt / endedAt、input/output JSON snapshot。

仍缺：

- sampling attempt 与 tool execution attempt 区分。
- Tool call / observation / approval 的细粒度 durable record。
- stale RUNNING recovery。
- trace id / request id / usage metadata。

### 2.3 模型事件边界

已具备：

- provider-neutral `ModelStreamEvent`。
- `text_delta`、`tool_call_completed`、`usage`、`response_completed` 四类事件。
- `ModelFinishReason`：`stop`、`tool_calls`、`length`、`content_filter`、`unknown`。
- Tool loop 未实现时对 `tool_call_completed` fail-fast，而不是静默忽略。

这意味着旧文档里“provider-neutral model event 尚无”的判断已经过期。

### 2.4 Tool Contract / Registry / Invocation

已具备：

- `ToolDefinition`、`RegisteredTool`、`ToolExecutor`、`ToolResult` 等最小工具类型。
- `ToolRegistryService`：工具注册、查找、重复名称拒绝、稳定排序输出 definitions。
- `ToolInvocationService`：unknown tool、JSON parse、schema parse、risk gate、validated invocation、executor 调用。
- 低风险 / 无副作用 / 不联网 / 无审批工具才允许执行，其他 fail closed。
- `ModelToolSpec` mapper：只暴露模型可见字段。

这意味着旧文档里“Tool contract 无”的判断已经过期。

### 2.5 测试

已具备：

- `test:model-stream`。
- `test:tools`。
- model stream runtime 行为测试。
- tools registry / invocation / invalid args / risk / abort 测试。

仍缺：

- 外部 NDJSON parser contract 测试。
- Tool loop 的两轮 sampling 集成测试。
- recorder transaction / AgentStep 状态测试。
- sync endpoint 与 stream endpoint 共用 runner 的测试。

## 3. 当前真实缺口

| 能力 | 当前成熟度 | 目标成熟度 | 优先级 | 下一步 |
| --- | --- | --- | --- | --- |
| Model event | 已有基础 | provider profile + request mapper 完整 | P1 | 随 Tool loop 补 request tools / `parallel_tool_calls=false` |
| Tool contract | 已有基础 | 可接入 Agent loop | P0 | router / executor 与 runtime loop 连接 |
| Tool loop | 未形成闭环 | call -> observation -> second sampling -> final | P0 | Phase 03 |
| Model history | 纯消息为主 | message + assistant_tool_call + tool_result | P0 | 定义内部 `ModelInputItem` |
| UI transcript | 可用 | 与 model history 明确分层 | P0 | final answer 才进 UI Message |
| Run/Step recording | 粗粒度 | sampling/tool/observation 可审计 | P1 | Phase 04 |
| Context budget | 固定条数 | token/priority/truncation | P1 | 先做 observation byte/token 限制 |
| Permission/HITL | risk metadata fail closed | 可持久审批和 policy | P1 | 写工具前做 |
| Recovery | 基础持久化 | crash reconciliation | P2 | 长任务/多实例前做 |
| MCP/Multi-agent | 无 | 可选扩展 | P3 | 单 Agent 稳定后再评估 |

## 4. 最近三个里程碑

### 里程碑 A：单 Agent Tool Loop

目标：让模型能真正驱动一个只读工具，并用工具结果生成最终回答。

最小闭环：

```text
sampling #1 -> tool_call_completed
  -> ToolInvocationService 验证并执行
  -> append tool_result observation to model history
sampling #2 -> final text
  -> stream / persist final assistant Message
```

验收重点：

- 捕获至少两次 model sampling。
- 第二轮输入包含同 callId 的 tool result。
- tool JSON 不进入 UI assistant Message。
- unknown / invalid / throw 形成结构化 observation 或明确失败。
- abort 只能进入 ABORTED，不能被迟到完成覆盖。

### 里程碑 B：Tool 可靠性与记录

目标：把 tool call 从“运行时临时动作”变成可审计执行事实。

最小能力：

- Tool call record / observation record。
- timeout / cancel / execution error taxonomy。
- output truncation。
- AgentStep terminal exactly-once。
- sensitive data 与大 output 策略。

### 里程碑 C：Context 与恢复基础

目标：避免 tool output 让 context 失控，并为长任务恢复做准备。

最小能力：

- model-visible history 与 UI transcript 分离。
- observation byte/token budget。
- context source / priority。
- stale RUNNING sweep。
- request id / trace id / operation identity。

## 5. 现在不要做什么

现在可以先不用做：

- MCP server 动态接入。
- Plugin marketplace。
- Multi-agent child thread。
- Goal runtime。
- Memory pipeline。
- OS sandbox。
- 通用 workflow engine。
- 完整 RAG 平台。

这些能力可以在 `codex-reference` 中保留为资料，但不应进入近期实现。
