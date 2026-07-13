# Phase 01：结构化模型事件契约

> 模块分类：**Core**。当前项目近期需要 provider-neutral 事件边界；本文是学习指南，不自动创建正式任务。

## 1. 阶段问题

当前 `LLMService.chatStream()` 的返回类型是 `AsyncGenerator<string>`。这对纯文本聊天足够，但它会丢失 tool call、finish reason、usage、响应标识等结构。Runtime 只看见字符串，就无法判断模型是在回答用户，还是在请求系统执行工具。

本阶段要解决的问题是：**如何把 provider 原始 chunk 转换成项目自己的稳定 `ModelStreamEvent`，同时保持现有前端 `ChatStreamEvent` 不变？**

这一步相当于前端把第三方组件的原始事件先适配成领域事件：业务层依赖自己的 contract，SDK 升级或 provider 差异只影响 adapter。

## 2. 学习目标

1. 能解释 provider chunk、model event、runtime event、UI stream event 四层为何不同。
2. 设计 TypeScript discriminated union，表达文本、工具调用、usage 和完成值；错误与中断只走 async iterator 的 throw 通道。
3. 正确重组跨多个 chunk 的 tool name 与 JSON arguments。
4. 不把 OpenAI SDK 的 `ChatCompletionChunk` 类型泄漏到 `AgentRuntimeService`。
5. 明确 `finish_reason` 是 provider 信号，不直接等同于整个 AgentRun 完成。
6. 让现有文本 happy/error/abort 基线继续通过。
7. 为 Phase 02 提供一个可确定转换为内部 `ToolCall` 的 model-side candidate。

## 3. 前置条件

- Phase 00 测试基座完成，scripted fake 能按次产生事件并记录 sampling 输入。
- 已理解 `AsyncGenerator`、union exhaustive switch、OpenAI-compatible streaming 的 chunk 概念。
- `start/delta/done/error/aborted` 外部 NDJSON contract 已有回归测试。
- 本阶段只升级模型边界，不要求工具真的存在。

## 4. 当前起点与缺口

| 当前类型/方法 | 能表达 | 丢失信息 |
| --- | --- | --- |
| `ChatMessage` | system/user/assistant 纯文本 | tool call/output、provider metadata |
| `ChatStreamOptions` | model/temperature/maxTokens/signal | tools、tool choice、并行策略 |
| `OpenAICompatibleClient.chatStream()` | content delta | tool_calls、finish_reason、usage |
| `LLMService.chatStream()` | `AsyncGenerator<string>` | 所有非文本事件 |
| `AgentRuntimeEvent` | run + assistant text lifecycle | model/tool 内部过程 |
| `ChatStreamEvent` | 前端需要的文本 lifecycle | 故意不展示内部 tool 过程 |

最危险的做法是在 `AgentRuntimeService` 中直接读取 OpenAI SDK chunk。这样 provider 细节、arguments 累积、finish reason 兼容逻辑会污染 Agent loop。

## 5. 设计

### 5.1 四层事件

```text
OpenAI-compatible SDK chunk
        |
        v  provider adapter
ModelStreamEvent
        |
        v  AgentRuntime reducer / loop
AgentRuntimeEvent
        |
        v  SEO mapper
ChatStreamEvent (NDJSON)
```

- SDK chunk：第三方 wire shape，可能随 SDK/provider 改变。
- ModelStreamEvent：LLM 模块对 runtime 的内部稳定 contract。
- AgentRuntimeEvent：一次 run 的业务生命周期。
- ChatStreamEvent：浏览器公开协议。

### 5.2 建议最小 union

具体字段可在实现任务中微调，但语义必须覆盖：

```ts
export type ModelStreamEvent
  = | { type: 'text_delta'; delta: string }
    | {
      type: 'tool_call_completed'
      providerCallId: string
      name: string
      argumentsJson: string
      index: number
    }
    | {
      type: 'usage'
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    | {
      type: 'response_completed'
      finishReason: ModelFinishReason
      providerResponseId?: string
    }
```

这里刻意没有 `error` / `aborted` variant。`ModelStreamEvent` 是成功读取到的**值通道**；provider HTTP 错误、协议不完整、网络错误和取消通过 async iterator `throw` 传播，再由 runtime 结合原始 `AbortSignal` 分类。不要既 `yield { type: 'error' }` 又 `throw`，否则同一故障会有两个所有者，极易产生重复终态。外部 `ChatStreamEvent.error/aborted` 仍由 runtime 在收口后生成，这与 model contract 不是同一层。

是否额外暴露 `tool_call_delta` 取决于当前 runtime 是否需要展示/记录参数流。第一版更建议 adapter 内部累积，只在一个 call 完整时发 `tool_call_completed`，减少上层必须处理半个 JSON 的状态。如果为了 observability 保留 delta，也必须同时提供 finalize 语义。

### 5.3 finish reason 归一化

建议项目自有类型只保留业务需要的集合，并保留 unknown：

```ts
type ModelFinishReason
  = 'stop'
    | 'tool_calls'
    | 'length'
    | 'content_filter'
    | 'unknown'
```

关键区分：

- `stop`：本次 sampling 通常产生最终回答候选。
- `tool_calls`：本次 sampling 结束，但整个 Agent turn 必须继续。
- `length`：输出被截断，应有明确失败/降级语义，不能假装完整。
- stream 自然 EOF 且没有 completed：协议不完整，应归类异常或显式 incomplete。

### 5.4 tool arguments 累积器

OpenAI-compatible Chat Completions 可能按 `tool_calls[index]` 分片发送 id、function.name 和 function.arguments。adapter 需要按 index 或稳定 call id 维护 buffer：

```text
index 0: id='call_' + '123'
         name='get_' + 'seo_metrics'
         args='{"url":' + '"..."}'
```

不变量：

1. 不同 index 的分片不能串线。
2. 同一个 call 的字符顺序必须保持。
3. name 和 arguments 在完成前可以不完整。
4. 完成时必须有稳定 call id、非空 name、完整 raw JSON 字符串；此时得到的仍是未验证调用信封，不是可执行调用。
5. adapter 不在此处执行工具，也不把 JSON parse 失败伪装成 provider 网络错误。
6. Phase 02 的 router/validator 把未验证信封转换为 validated invocation，只有后者能进入 executor。

建议把边界命名得无法误用：

```ts
interface UnvalidatedToolCallEnvelope {
  providerCallId: string
  toolName: string
  rawArgumentsJson: string
  providerIndex: number
}
```

`ModelStreamEvent.tool_call_completed` 携带的是这个 envelope 的字段。它只能被记录、拒绝或送去验证，不能直接传给工具实现。

### 5.5 请求端 tools 能力

为了让真实 provider 在 Phase 03 返回 tool calls，模型请求选项最终需要工具 specs。Phase 01 只定义 LLM 层可接受的 provider-neutral 输入端口，不建立 registry：

```ts
interface ModelToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
```

Phase 02 的 `ToolDefinition` 再映射为 `ModelToolSpec`。不要让 `OpenAI.ChatCompletionTool` 成为业务 contract。

Phase 03 的单调用闭环还必须在 provider request mapper 显式发送 `parallel_tool_calls: false`。这会减少 provider 同轮返回多个 call 的概率，但不是安全保证；adapter/reducer 仍必须拒绝多个 call。若目标 OpenAI-compatible provider 不支持该字段，能力差异要写进显式 provider profile 并 fail fast，不能悄悄假装已经禁用并行。

### 5.6 Usage 与 terminal 顺序

OpenAI-compatible Chat Completions 要求显式请求流式 usage，例如：

```ts
stream_options: { include_usage: true }
```

启用后，provider 可能在已出现 `finish_reason` 之后再发送 usage-only chunk；该 chunk 的 `choices` 合法地是空数组。adapter 的规则应是：

1. 先独立读取 `chunk.usage`，不能因为 `choices[0]` 不存在就 `continue` 并丢掉 usage。
2. `finish_reason` 只标记首个 choice 已结束，并暂存 reason；不要当场发最终 `response_completed` 后立即停止消费。
3. clean EOF 时，若已观察到 finish reason，先发已收集的 `usage`，最后且只发一次 `response_completed`。
4. EOF 时从未观察到 finish reason，才是 incomplete stream error。
5. provider 明确不支持 `include_usage` 时可以没有 usage event，但该能力差异必须由 provider profile 声明并有测试。

这样才能同时处理 `choices=[]`、usage 晚到和 terminal 唯一性，而不是在第一个 finish chunk 过早结束流。

### 5.7 保持外部事件形状

Runtime 处理 `text_delta` 时继续：

- 拼接 assistant content。
- yield `AgentRuntimeAssistantDeltaEvent`。
- 最终由 SEO mapper 输出现有 `delta/done`。

`usage` 与 `response_completed` 暂时可以仅供内部 reducer 使用，不应无计划地加入外部 NDJSON。任何公开协议变化都应独立评审。

## 6. 建议任务拆分

### Task 01.1：定义 model contract

- 新增项目自有 `ModelStreamEvent`、finish reason、tool candidate 和 usage 类型。
- 在类型注释里写清 provider event 与 runtime event 边界。
- 为 exhaustive reducer 写编译期保护。

### Task 01.2：实现 provider adapter

- 从 OpenAI-compatible chunk 读取 content delta。
- 按 index 累积 tool calls。
- 请求 `include_usage`，独立处理 `choices=[]` 的 usage-only chunk，并在 clean EOF 合成唯一 terminal。
- 归一化 finish reason 和 usage。
- 对缺失 id/name、未完成 stream 给出可诊断错误。
- 只 yield value events；error/abort 从 iterator throw，runtime 是唯一分类者。

### Task 01.3：升级 LLMService

- `LLMService` 对上只返回 `ModelStreamEvent`。
- 决定采用替换旧方法还是提供短期兼容 wrapper；不能长期维护两套独立流逻辑。
- fake 改为 scripted model events，不模拟 SDK chunk。

### Task 01.4：适配 runtime 且保持外部协议

- runtime 只消费 `text_delta` 形成现有 assistant delta。
- 对尚未进入 Phase 03 的 `tool_call_completed` 明确 fail-fast 或 feature-gated 行为，不能静默丢弃。
- 原有 mapper 与前端 contract 测试保持绿色。

## 7. Red-Green-Refactor

### Red

1. 用两个 SDK chunks 构造一个 tool call，证明当前 `chatStream()` 什么也 yield 不出来。
2. 写跨 index 分片测试，证明简单使用 `choices[0].delta.tool_calls[0]` 会串线。
3. 写 runtime 文本回归，准备检测升级后的破坏。

### Green

1. 先只支持 `text_delta` 与 `response_completed(stop)`。
2. 再加入一个单 tool call 的 arguments 拼接。
3. 最后加入 usage、unknown finish reason 与 malformed stream。

### Refactor

1. 把 SDK -> model event 的转换留在 client/adapter。
2. 累积器成为纯状态对象，单独测试，不依赖 Nest。
3. 若只有一个 provider，不建立 provider factory/marketplace。

## 8. 测试矩阵

| 场景 | Provider chunks | Model events | Runtime/外部期望 |
| --- | --- | --- | --- |
| 纯文本 | `你`,`好`,stop | text,text,completed | 现有 delta/done 不变 |
| 空文本 stop | no content,stop | completed | done content 为空或按既有规则 |
| 单工具单 chunk | 完整 id/name/args | tool completed,completed(tool_calls) | 暂不执行，显式未支持 |
| 单工具多 chunk | id/name/args 分片 | 一个完整 tool event | arguments 字符完全一致 |
| 两个工具交错 | index 0/1 交错 | 两个各自完整 event | 不串线、顺序可预测 |
| usage | `include_usage` + `choices=[]` terminal chunk | usage 在 completed 前 | 不泄漏 raw SDK type |
| length | finish_reason=length | completed(length) | runtime 不宣称成功完整回答 |
| unknown | 新 provider reason | completed(unknown) | 可诊断且向前兼容 |
| incomplete EOF | 无 terminal | error/incomplete | 不静默完成 |
| abort | signal during chunks | 取消异常/结束 | Phase 00 abort 基线不破坏 |
| provider failure | SDK iterator throw | 不产 error value，原异常分类后上抛 | runtime 只收口一次 |

## 9. 验收证据

- [ ] `ModelStreamEvent` 定义及职责注释。
- [ ] provider adapter 的 chunk fixture tests。
- [ ] 单 tool arguments 跨至少 3 个 chunk 的测试。
- [ ] 两个 tool calls 交错分片不串线的测试。
- [ ] finish reason 全分支测试。
- [ ] `include_usage=true` 请求断言、`choices=[]` usage-only chunk 与 usage-before-completed 顺序测试。
- [ ] incomplete EOF 的明确语义。
- [ ] ModelStreamEvent 没有 error/aborted variant，iterator throw 只被 runtime 分类一次。
- [ ] fake model 已从 string script 升级为 model event script。
- [ ] Phase 00 happy/error/abort 回归仍通过。
- [ ] `ChatStreamEvent` 类型与前端解析不变。
- [ ] typecheck、lint、test、`git diff --check` 输出。

## 10. 非目标

- 不实现 ToolRegistry 或真实 SEO tool。
- 不执行模型提出的任何工具调用。
- 不把 raw tool arguments 写入数据库。
- 不做 parallel tool execution。
- 不把 usage 展示到前端。
- 不设计 MCP 或动态插件格式。
- 不把 `finish_reason=tool_calls` 当作 AgentRun 完成。

## 11. 源码路径

### 当前项目

- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/clients/openai-compatible.client.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
- `packages/contracts/src/seo.ts`

### Codex

- `/Users/lihaoran/Desktop/codex/codex-rs/codex-api/src/common.rs`：`ResponseEvent`。
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/client_common.rs`：`Prompt` 与 `ResponseStream`。
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/client.rs`：provider stream 映射与 terminal 处理。
- `/Users/lihaoran/Desktop/codex/codex-rs/protocol/src/models.rs`：`ResponseItem`。
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/session/turn.rs`：消费 `ResponseEvent`，不要在本阶段通读整个文件。
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/client_tests.rs`：adapter/stream tests。

## 12. 复盘问题

1. 为什么 tool arguments 应先保留 raw JSON 字符串，而不是在每个 delta 上 parse？
2. provider response completed 与 AgentRun completed 的差异是什么？
3. adapter 在哪里结束，router 在哪里开始？
4. 如果只测完整单 chunk tool call，会漏掉什么真实问题？
5. 为什么 usage 不应该直接加到 `ChatStreamEvent`？
6. 遇到未知 finish reason，抛错与归一化为 unknown 的取舍是什么？
7. runtime 收到 tool event 但 Phase 03 尚未完成时，静默忽略为什么危险？
8. 为什么观察到 finish reason 后仍不能立刻停止消费 stream？
9. 为什么 model value channel 与 iterator error channel 必须只有一个故障所有者？
