# Tool Loop：从模型 Tool Call 到 Observation 回填

## 1. 核心结论

Agent 与普通聊天机器人的关键分界线不是“后端会调用函数”，而是：

```text
模型提出 tool call
  -> 系统验证和执行
  -> tool output 作为 observation 回填 model-visible history
  -> 模型基于 observation 再次 sampling
  -> 形成最终回答或继续调用工具
```

如果只是在后端拿到模型结果后调用一个函数，并把 JSON 返回前端，这还不是 Agent loop。

## 2. Codex 源码链路

核心路径：

```text
ResponseEvent::OutputItemDone
  -> handle_output_item_done
  -> ToolRouter::build_tool_call
  -> record_completed_response_item
  -> ToolCallRuntime::handle_tool_call
  -> ToolRegistry::dispatch_any_with_terminal_outcome
  -> ResponseInputItem tool output
  -> drain in-flight futures
  -> record_conversation_items
  -> needs_follow_up = true
  -> run_turn 下一轮 sampling
```

源码入口：

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/stream_events_utils.rs`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/src/tools/parallel.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/context.rs`

## 3. 关键设计不变量

### 3.1 模型只能提出调用，系统拥有执行权

`ToolRouter::build_tool_call` 只把 `ResponseItem` 归一化为小的 `ToolCall`：

```text
toolName
callId
payload(function/custom/tool-search)
```

它不是业务 DTO，也不是 validated invocation。后续必须经过 registry lookup、payload kind 检查、handler parse、policy / hook / sandbox 才能执行。

当前项目迁移：

```text
ModelToolCallCandidate
  -> UnvalidatedToolCallEnvelope
  -> ToolInvocationService
  -> ValidatedToolInvocation
  -> ToolExecutor
  -> ToolResult
```

不要让 executor 接收模型原始 JSON。

### 3.2 Raw call 先作为事实记录，再执行工具

Codex 在识别到 tool call 后，会先记录模型确实请求了这个 call，再创建 tool future。

价值：

- 即使 Turn 后续取消，也能知道模型为什么走到工具阶段。
- call 与 output 是两个事实，不是一个“工具成功记录”。
- crash 在 call 后、output 前会留下可恢复/可诊断窗口。

当前项目 Phase 03 可以先只保存在内存 model history；Phase 04 再持久化 call/output steps。但设计上必须区分：

```text
model requested call
tool produced output
```

### 3.3 Expected tool error 应成为 observation

Codex 对 unknown tool、参数错误、policy 拒绝等可恢复错误，通常生成失败 output 回给模型，让模型修正、换工具或解释失败。

不要把所有工具失败都当作 Run fatal。建议当前项目区分：

```ts
type ToolFailure =
  | { kind: 'observation'; callId: string; message: string }
  | { kind: 'runtime_fatal'; message: string }
```

常见 observation failure：

- unknown tool。
- invalid JSON。
- schema validation failed。
- business resource not found。
- low-risk executor 返回可解释失败。

Fatal failure：

- registry 状态损坏。
- 已通过 handler 匹配却收到不兼容 payload。
- runtime invariant 被破坏。
- 持久化关键事实失败且无法安全继续。

### 3.4 callId 是配对主键，不是全能 ID

Codex 使用 provider call ID 配对 call/output，但这不应同时承担数据库主键、幂等键和审计身份。

当前项目建议：

```text
providerCallId / callId：模型协议配对
samplingAttemptId：第几轮 sampling 产生
executionId：系统内部工具执行记录
operationId：外部副作用业务意图
idempotencyKey：重试去重
receiptId：外部系统提交回执
```

只读工具 Phase 03 可以先不持久化 executionId，但类型设计不要把 callId 扩成所有身份。

### 3.5 执行可以并发，Observation 顺序应稳定

Codex 用并发 future 执行工具，但用 `FuturesOrdered` 按模型输出顺序 drain tool outputs。这样 model history 稳定、测试稳定、prompt cache 更稳定。

当前项目近期策略更简单：

- 每轮只允许一个 tool call。
- 显式请求 `parallel_tool_calls=false`。
- runtime reducer 仍然拒绝同轮多个 call，因为 provider 可能忽略请求偏好。

等单工具闭环稳定后，再考虑并行。

### 3.6 Cancellation 要有唯一 terminal owner

Codex 的 `ToolCallRuntime` 用 `terminal_outcome_reached` 避免正常完成和取消同时产生两个 terminal event。

当前项目迁移：

- AbortSignal 在 sampling 前、tool 前、tool 后、下一轮前都检查。
- 已 ABORTED 后，迟到的 tool result 或 model final 不能覆盖状态。
- executor 抛 `AbortError` 应向上收口为 ABORTED，不伪装成 execution_failed。

## 4. 当前项目 Phase 03 最小方案

### 4.1 Model input union

当前 `ChatMessage` 不足以表达 call/output。建议引入内部类型：

```ts
type ModelInputItem =
  | { type: 'message'; role: 'system' | 'user' | 'assistant'; content: string }
  | {
      type: 'assistant_tool_call'
      callId: string
      name: string
      rawArgumentsJson: string
      content?: string
    }
  | {
      type: 'tool_result'
      callId: string
      name: string
      content: string
      ok: boolean
    }
```

Provider adapter 再把它映射成具体 OpenAI-compatible request。

### 4.2 Sampling decision

第一版 reducer 收集一轮完整 `ModelStreamEvent` 后输出：

```ts
type SamplingDecision =
  | { type: 'final_answer'; textChunks: string[]; finishReason: 'stop' }
  | { type: 'tool_call'; call: UnvalidatedToolCallEnvelope; intermediateText: string }
```

显式拒绝：

- 同轮多个 tool calls。
- `finishReason=tool_calls` 但没有完整 call。
- tool call 与 stop 冲突。
- `length/content_filter/unknown` 当作成功回答。

### 4.3 UI transcript 与 model history 分离

第一版策略：

- user Message 照常写入。
- 第一轮 tool call 的中间文本不发给 UI。
- 中间文本如果存在，进入 `assistant_tool_call.content`。
- tool result 只进 model history。
- 第二轮 final answer 才写 UI assistant Message。

这会改变首 token 时机：final sampling 完成后再 replay delta。可以保持 `ChatStreamEvent` shape，不要声称实时性完全兼容。

## 5. 必测用例

| 场景 | 关键断言 |
| --- | --- |
| happy path | 第一轮 call，工具成功，第二轮输入含同 callId result，最终回答写入 Message |
| invalid args | executor 未被调用，失败 observation 进入第二轮 |
| unknown tool | 无任意执行，模型看到 unknown observation |
| executor throws | 错误脱敏，不泄漏 stack/secret |
| abort sampling | Run/Message ABORTED |
| abort tool | 不启动下一轮 sampling |
| loop limit | 有限结束，FAILED 或 budget-exhausted |
| mixed text + call | 中间文本不进 UI Message，但进入 model history |
| multiple calls | explicit unsupported error |
| prompt injection output | tool result 保持 tool role，不能改 server policy |

## 6. 现在不做

- 不做并行工具。
- 不做 MCP。
- 不做写操作工具。
- 不做工具时间线 UI。
- 不做完整持久化 replay。
- 不做通用 workflow engine。
