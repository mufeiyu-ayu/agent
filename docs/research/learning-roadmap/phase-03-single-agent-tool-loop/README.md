# Phase 03：单 Agent Tool Loop

> 模块分类：**Core**。当前项目近期需要这条最小 Agent 闭环；它不是 Multi-agent 或工作流引擎路线。

## 1. 阶段问题

到 Phase 02 为止，系统能看见模型提出的 tool call，也能独立验证和执行工具，但两者还没有组成 Agent。真正的分界线是：**工具结果进入下一次模型输入，模型基于 observation 继续生成最终回答。**

本阶段实现最小、顺序、单 Agent loop：

```text
sampling #1
  -> tool call
  -> validate + execute
  -> append call/output observation
sampling #2
  -> final assistant answer
  -> complete run
```

如果只做到“后端调用工具并把 JSON 返回前端”，仍然不是 Agent loop。

## 2. 学习目标

1. 能解释 sampling、turn、run 三个生命周期为何不同。
2. 把模型输出归约成 `final_answer` 或 `tool_calls` 决策。
3. 维护与 UI Message 分离的 model-visible history。
4. 用同一个 `callId` 配对 tool call 与 observation。
5. 让 observation 进入第二次 sampling，并用测试捕获第二次请求证明。
6. 用显式 loop bounds 防止模型无限调用工具。
7. 让 AbortSignal 贯穿每轮 sampling 与工具执行。
8. 保持现有 `ChatStreamEvent` **类型形状**不变，只向用户展示最终回答；明确承认本阶段为正确区分 mixed text/tool call 会改变 token 到达时机。

## 3. 前置条件

- Phase 00：可编排每轮模型响应并捕获每次输入。
- Phase 01：`ModelStreamEvent` 能表达文本、完整 tool call、usage 和 completed reason。
- Phase 02：ToolRegistry、router、validator、executor 和一个只读工具可独立工作。
- 熟悉 `while` 状态机、async generator 和 AbortSignal。
- 当前只支持单 Agent、顺序执行、低风险无副作用工具。

## 4. 关键不变量

1. 一次 AgentRun 可以包含多次 model sampling。
2. `response_completed(tool_calls)` 只结束本次 sampling，不结束 AgentRun。
3. 每个 tool call 必须有且只有一个同 callId observation。
4. observation 必须出现在下一次 sampling input 中。
5. 未知/无效工具也应形成结构化失败 observation，是否继续由明确策略决定。
6. 最终 answer 必须来自没有待处理 tool call 的 terminal sampling。
7. UI assistant Message 只保存用户可见最终内容，不混入 tool JSON。
8. model history 可以包含 assistant 的中间文本 + tool call/output，而 Conversation Message 当前不必包含；mixed text 不能因为不展示给 UI 就从 model history 丢失。
9. 任何时候 Abort 都只能收口为 ABORTED，不得被随后完成覆盖。
10. 达到最大 sampling/tool call 数时必须停止并产生可诊断终态。

## 5. 设计

### 5.1 把大循环拆成三个小概念

```text
AgentTurnRunner
  ├─ sampleOnce(modelHistory, toolSpecs) -> SamplingDecision
  ├─ executeOneTool(call, serverContext) -> ToolResult
  └─ appendObservation(history, call, result) -> nextHistory
```

第一版可以仍在 `AgentRuntimeService` 内实现，但代码结构要体现这三个步骤。只有复杂度真实出现时再抽新 service，避免“先建十个空类”。

### 5.2 SamplingDecision

```ts
type SamplingDecision
  = | {
    type: 'final_answer'
    textChunks: string[]
    finishReason: 'stop'
    usage?: ModelUsage
  }
    | {
      type: 'tool_call'
      call: UnvalidatedToolCallEnvelope
      intermediateText: string
      usage?: ModelUsage
    }
```

Reducer 收集一轮完整 events 后才做决定。第一版显式拒绝：

- 同一 sampling 多个 tool calls。
- tool call 与 `finishReason=stop` 语义冲突。
- `finishReason=tool_calls` 但没有完整 call。
- `length/content_filter/unknown` 被当作 final success。

### 5.3 model-visible history

当前 `ChatMessage` 只有 system/user/assistant 文本，无法表达 call/output 配对，也无法表达“同一个 assistant item 同时有 content 和 tool call”。Phase 03 应引入项目自有 model input union，例如：

```ts
type ModelInputItem
  = | { type: 'message'; role: 'system' | 'user' | 'assistant'; content: string }
    | {
      type: 'assistant_tool_call'
      content: string | null
      callId: string
      name: string
      rawArgumentsJson: string
    }
    | { type: 'tool_result'; callId: string; name: string; content: string; ok: boolean }
```

Provider request mapper 再把 `assistant_tool_call` 映射成同一个 assistant message 的 `content? + tool_calls`，并把 `tool_result` 映射到 tool role。不要把 tool output 假装成 user message；模型协议中的角色与配对关系必须保留。

这里有意区分两个对象：history 保存模型原始 `rawArgumentsJson` 以忠实回放 call；executor 只收到 Phase 02 的 `ValidatedToolInvocation`。二者共享 callId，但不能混为一个“已经验证所以可以改写历史”的对象。

### 5.4 UI transcript 与 model history

当前数据库 `Message` 是用户可见 transcript。本阶段推荐：

- user Message 照常持久化。
- final assistant answer 照常持久化和 stream。
- intermediate assistant text + tool call/result 暂存在本次 loop 的 model history；中间文本不写 UI Message，但必须作为产生该 call 的 assistant item 一部分回给模型。
- Phase 04 把它们记录为 AgentStep durable facts。

这避免为了最小闭环立刻修改 Message schema，也明确 UI message 不等于 model input item。

### 5.5 中间文本策略

Provider 可能在同一 sampling 同时给文本和 tool call。若立刻把文本作为 `assistant_delta` 发给 UI，随后发现需要工具时无法撤回，最终 Message 也会混入中间思路。

第一版选择一个明确且保守的策略：

1. 每轮 sampling 的文本先缓存在 `textChunks`。
2. 若 decision 是 tool call，中间文本不发送到公开 NDJSON；可只作调试摘要。
3. 若 decision 是 tool call，把中间文本保存在 model history 的 `assistant_tool_call.content`，随后追加同 callId result。
4. 若 decision 是 final answer，在看到 terminal 后再按原 chunk 边界 yield `assistant_delta`。

代价是 final sampling 完成前没有 token-level UI 更新，随后 replay delta 也不是真实时流。**本阶段只保持 `ChatStreamEvent` schema、顺序和最终内容兼容，不宣称 streaming latency/首 token 行为兼容。**若产品不能接受这个行为变化，应在进入 Phase 03 前版本化外部协议，支持可撤回/可区分的 intermediate 与 final item；不能一边提前发未知性质的文本，一边声称现有协议完全兼容。Phase 08 再系统解决流式恢复与 item lifecycle。

### 5.6 Provider 请求的单调用约束

每轮 sampling 都应发送同一组 tool specs，并显式设置：

```ts
parallel_tool_calls: false
```

这是请求偏好，不是 runtime 安全边界：provider 仍可能忽略它，因此 reducer 对多个 call 继续 fail closed。provider profile 若不支持该字段必须明确报兼容性错误或禁用 tool mode，不能悄悄省略后继续宣称“单调用已保证”。

### 5.7 Loop 伪代码

```ts
let modelHistory = buildInitialModelHistory()
let samplingCount = 0
let toolCallCount = 0

while (true) {
  assertNotAborted(signal)
  samplingCount += 1
  assertWithinLimit(samplingCount)

  const decision = await sampleOnce(modelHistory, toolSpecs, signal)

  if (decision.type === 'final_answer') {
    yield* emitFinalChunks(decision.textChunks)
    return decision.textChunks.join('')
  }

  toolCallCount += 1
  assertWithinLimit(toolCallCount)

  const invocation = router.resolveAndValidate(decision.call)
  const result = await executor.execute(invocation, serverContext)
  modelHistory = appendAssistantCallAndResult(
    modelHistory,
    decision.intermediateText,
    decision.call,
    result,
  )
}
```

### 5.8 Observation 是不可信数据

Tool output 来自网页、外部服务或其他不可信来源。即使 observation 内容包含“忽略之前指令”“调用写工具”“泄漏系统提示”等命令式文本，也只能放在 tool-result data role 中：

- 不拼进 system/developer prompt。
- 不允许 observation 修改 tool policy、tenant scope、approval 或预算。
- 下一轮模型即使受间接 prompt injection 影响，server-side router/policy 仍必须拒绝越权动作。
- 测试用恶意 instruction-like output 证明 role 没升级、敏感操作没有执行。

“告诉模型不要听”只能是纵深防御，不能替代 server policy。

### 5.9 同步 Endpoint 策略

当前 `POST /seo/chat` 直接调用 `LLMService.chat()`，会绕过 AgentRun、tool loop 和 observation。Phase 03 不允许保留两套语义：

1. 抽出同一个 turn runner/state machine 作为唯一执行路径。
2. `/seo/chat/stream` 转发 runner events。
3. `/seo/chat` 消费同一 runner 到 terminal，只返回最终 `SeoChatResponse`，因此它没有实时 delta，但有完全相同的 tool/context/persistence 规则。
4. 若本阶段无法完成同步入口迁移，就对 tool-enabled 请求显式禁用/返回稳定的不支持错误；不能继续走单次 `llmService.chat()` 并伪装成等价 Agent。

### 5.10 最小上限

即使 Phase 04 才完善预算，本阶段也必须有硬上限，例如：

- `maxSamplingRounds = 4`。
- `maxToolCalls = 3`。
- 每轮只允许一个 call。

数值应配置在 runtime 内部策略，不由模型参数提供。达到上限时 run FAILED 或明确 budget-exhausted，不返回虚假完成答案。

### 5.11 Run/Step 的过渡策略

现有 recorder 预创建一个 `call_llm` 和一个 `stream_assistant_reply` step。Phase 03 为保持 schema 最小，可以：

- 让 `call_llm` 表示整个多 sampling loop。
- 仅在最终 answer 决策后 complete `call_llm` 并启动 stream step。
- 不在第一轮中间文本时启动 stream step。
- Phase 04 再把每次 sampling/tool call 记录成可重复 step。

不能每轮调用现有 `startStep(call_llm)`，因为它只更新 PENDING 的单条 step；第二轮会静默不记录。

## 6. 任务拆解

### Task 03.1：ModelInputItem 与 provider request mapper

- 能表达 message、mixed assistant text+call、result。
- ToolDefinition 映射为 request tools。
- 每轮设置 `parallel_tool_calls=false`，并用 request capture 断言。
- provider request test 捕获 call/output 配对。

### Task 03.2：Sampling reducer

- 收集 ModelStreamEvent。
- 用当前 server-owned samplingAttemptId 把 model candidate 包装成 unvalidated envelope。
- 输出 final 或 single tool call decision。
- 拒绝矛盾、缺失和多 call 情况。

### Task 03.3：最小 loop

- registry specs 进入每轮 sampling。
- unvalidated envelope 经 router lookup/parse/schema validation 成为 invocation 后才进入 executor。
- observation 追加到内存 model history。
- 第二次 sampling 产 final。
- 同步 endpoint 复用同一 runner，或对 tool mode 显式 fail closed。

### Task 03.4：状态与取消

- loop hard bounds。
- abort 检查位于 sampling 前、tool 前、下一轮前。
- error/abort 复用现有 Run/Message 收口。
- 外部 NDJSON 不新增 tool events。

## 7. Red-Green-Refactor

### Red

1. scripted model 第一轮返回 tool call、第二轮返回 final；当前 runtime 在第一轮结束或忽略 call。
2. 捕获第二轮 request，找不到 observation。
3. 模型无限返回 tool call，测试不能结束。

### Green

1. 先让单 call -> success observation -> final 跑通。
2. 加 unknown/invalid tool result。
3. 加 abort、恶意 observation 与 hard limit。

### Refactor

1. 从 `runTurnStream` 抽 `sampleOnce`，前提是测试已证明边界。
2. model history append 做纯函数，集中保护 call/output 不变量。
3. 不抽通用 workflow engine。

## 8. 测试矩阵

| 场景 | 第 1 轮 | 工具 | 第 2 轮 | 关键断言 |
| --- | --- | --- | --- | --- |
| happy | call(valid) | success | final | 第二轮含同 callId output |
| invalid args | call(bad) | 不执行/失败 observation | final 修正回答 | executor 未被调用 |
| unknown tool | call(missing) | unknown observation | final | 无任意执行 |
| tool throws | call | safe failure result | final/失败按策略 | stack 不进模型 |
| abort sampling | waiting | - | - | Run/Message ABORTED |
| abort tool | call | waiting + signal | - | 不开始下一轮 |
| loop limit | 每轮 call | success | 仍 call | 有限结束，FAILED |
| mixed text+call | text + call | success | final | 中间文本不进 UI Message，但进入第二轮 assistant_tool_call.content |
| multiple calls | 2 calls | 不执行 | - | explicit unsupported error |
| final only | final | - | - | schema/content 相同；明确不保证首 token 时机 |
| prompt injection output | call | result 含命令式文本 | final/拒绝 | tool role 不升级、server policy 不变 |
| sync endpoint | call | success | final | 同一 runner/steps；无直连 LLM 旁路 |

## 9. 验收证据

- [ ] test 捕获至少两次 model sampling。
- [ ] 第二次 sampling input 中存在 tool call 与同 callId result。
- [ ] mixed text + call 的中间文本存在于第二轮 model history，但不存在于 UI Message。
- [ ] observation 内容来自真实 executor 输出，不是测试手写绕过。
- [ ] final assistant answer 来自第二轮且写入 Message。
- [ ] tool JSON 不进入 UI assistant Message。
- [ ] `response_completed(tool_calls)` 不会 complete AgentRun。
- [ ] invalid/unknown/throw/abort/limit tests。
- [ ] 外部 ChatStreamEvent shape 无变化；验收明确记录首 token/实时性行为已变化，不写“完全兼容”。
- [ ] 每轮 request 捕获到 `parallel_tool_calls=false`，多 call 仍由 reducer 拒绝。
- [ ] 同步 endpoint 走同一 runner，或 tool mode 明确不可用；不存在 direct LLM 旁路。
- [ ] 恶意 observation 仍是 tool data，不能改变 server policy 或触发未授权工具。
- [ ] Run/Step 无 PENDING/RUNNING 残留。
- [ ] test/typecheck/lint/diff-check 结果。

## 10. 非目标

- 不执行同轮多个/并行 tool calls。
- 不记录细粒度 tool AgentStep；Phase 04。
- 不做 timeout、output truncation；Phase 04。自动 tool retry 留到 Phase 07 durable execution/recovery。
- 不做 approval；Phase 05。
- 不持久化完整 model history 或 checkpoint。
- 不展示工具时间线 UI。
- 不做 queue/worker 或 resume。
- 不解决通用 prompt injection；本阶段只建立 role 边界与 server-side policy 不变量。

## 11. 源码路径

### 当前项目

- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/clients/openai-compatible.client.ts`
- `apps/api/src/seo/seo-context-builder.service.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
- `prisma/schema.prisma`

### Codex

- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/session/turn.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/stream_events_utils.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/router.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/parallel.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/context_manager/history.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/tests/suite/tool_harness.rs`

## 12. 复盘问题

1. 为什么一次 Run 可以有两次 sampling，却只有一条最终 assistant Message？
2. Observation 为什么必须和 call 用 callId 配对？
3. 为什么不能把 tool result 拼成 user message？
4. 中间文本先 buffer 的收益与代价是什么？
5. 哪个测试真正证明了 Agent loop，而不是工具独立执行？
6. 达到 loop limit 后为什么不能把当前 partial text 当成功？
7. 现有 `call_llm` step 如何临时表示整个 loop？Phase 04 为什么要改？
8. 如果模型同轮返回两个 calls，第一版为什么选择拒绝而不是“顺手并行”？
9. 为什么本阶段只能宣称事件 schema 兼容，不能宣称 streaming 行为兼容？
10. 同步 endpoint 若继续直连 `LLMService.chat()`，会破坏哪些 Run/tool/context 不变量？
