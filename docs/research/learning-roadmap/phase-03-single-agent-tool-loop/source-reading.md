# Phase 03 源码阅读：Codex 如何从一次采样继续下一次采样

## 1. 阅读目标

沿 Codex `run_turn` 的最小主链理解 `needs_follow_up`：模型请求工具时，当前 response 完成，但 turn 继续。阅读后应能把它翻译为 TypeScript while loop，而不是复制 Codex 的 Session、hooks、compaction 全部复杂度。

## 2. 前置条件

- Phase 01 能解释 ResponseEvent。
- Phase 02 能解释 ToolRouter/Registry。
- 先读本阶段 [README.md](./README.md) 的 loop 伪代码。

## 3. Codex 阅读路线

### Step 1：从函数注释理解 loop

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/session/turn.rs`

定位 `run_turn`（当前快照约 142 行）。函数前注释已经给出核心模型：

- 模型返回 function call -> 执行 -> output 下一轮回填。
- 模型只返回 assistant message -> turn complete。

先只读注释和外层 `loop`，跳过 skills/plugins/hooks/compaction。

### Step 2：寻找 needs_follow_up

同一文件搜索：`model_needs_follow_up`、`needs_follow_up`、`if !needs_follow_up`。

记录状态变化：

1. `run_sampling_request` 返回本轮结果。
2. tool output 或 server signal 使 model_needs_follow_up=true。
3. pending user input 也可能使 turn 继续。
4. false 才进入 stop/complete 路径。

当前项目 Phase 03 只迁移 tool follow-up，不迁移 pending input/steer 与 stop hooks。

### Step 3：看一次 sampling 如何消费事件

定位 `run_sampling_request` 和后方消费 `ResponseEvent` 的循环（当前快照约 1888 以后）。重点：

- `OutputItemDone(item)`。
- `ResponseEvent::Completed`。
- `OutputTextDelta`。
- 最终 `SamplingRequestResult { needs_follow_up, last_agent_message }`。

观察“本轮事件 reducer”与“外层 Agent loop”是两层。当前项目也应避免在每个 SDK chunk 内直接递归调用下一轮模型。

### Step 4：看工具结果怎样回 history

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/stream_events_utils.rs`

搜索 tool call item 的处理、tool output record 和 `needs_follow_up`。记录：完整 response item 被记录进 conversation history，tool future 完成后 output 也记录，因此下一轮 prompt 能看到配对。若 assistant item 同时含文本与 function call，文本属于该 model-visible item；“不展示给 UI”不等于“从 model history 删除”。

### Step 5：看配对不变量

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/context_manager/history.rs`

只搜索 function call/output、normalize、orphan。重点不是 compaction，而是：

- call 缺 output 会怎样补/移除。
- output 找不到 call 为什么危险。
- history 面向模型，不等于 UI transcript。

### Step 6：用测试证明第二轮请求

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/tests/suite/tool_harness.rs`

读当前快照第一个测试 `shell_command_tool_executes_command_and_streams_output`：第一轮 mock Responses SSE 返回 `shell_command` function call，Codex 运行已注册的真实 shell handler，第二轮 mock response 返回 assistant；测试捕获第二轮 request，并用 `call_output()` 检查同 `call_id` 的 `function_call_output` 和内容格式。它不是“纯 fake executor 单元测试”，而是 mock provider + runtime/handler integration。当前项目迁移的是“按次响应 + 捕获第二轮 request”的验收形状，不复制 shell 副作用。

这就是当前 Phase 03 的黄金验收模式。

## 4. 当前项目阅读路线

### A. 找到当前单次 sampling

文件：`apps/api/src/agent-runtime/agent-runtime.service.ts`

标记：

- `llmMessages` 只构造一次。
- `for await` 只调用 `chatStream` 一次。
- stream 结束后直接 completed。
- 第一个文本 delta 会 complete callLlm/start stream step。

写出要改成 loop 后哪些变量是 run-scoped，哪些是 sampling-scoped：

| Run scoped | Sampling scoped |
| --- | --- |
| runId, assistantMessageId, final content, signal | textChunks, candidates, usage, finishReason |
| initial history, hard budgets | sampling index |

### B. 找 model messages 限制

文件：

- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/seo/seo-context-builder.service.ts`
- `apps/api/src/seo/prompts/seo-agent.prompt.ts`

当前只有 role/content。写出新增 call/result item 后，哪一层构造 system/business context，哪一层追加 runtime observation。

同时检查 mixed output：内部类型必须能把 assistant content 与 tool call 保存在同一个 sampling item 语义中；不能因为中间文本未发 UI 就丢弃。Observation 永远保持 tool data role，不能被 prompt builder 拼成 developer/system instruction。

### C. 看现有持久化过渡

文件：`apps/api/src/agent-runtime/agent-run-recorder.service.ts`

当前 steps 在创建 run 时固定预创建。思考：为什么 Phase 03 不应强行把多轮 sampling 塞成多个同 type 的 `startStep`？记录 Phase 04 需要的动态 step 模型。

## 5. 最小调用链图

```text
SeoService.chatStream
  -> AgentRuntime.runTurnStream
     -> build initial ModelInputItem[]
     -> registry.listDefinitions
     -> sampleOnce #1
        -> ModelStreamEvent reducer
        -> tool decision
     -> router.resolve/validate
     -> executor.execute
     -> append call + result
     -> sampleOnce #2
        -> final decision
     -> emit assistant deltas
     -> persist final Message/Run
```

现有 `SeoService.chat()` 是另一条 direct `LLMService.chat()` 路径。目标图必须再画一条同步投影：它消费同一个 Agent turn runner 到 terminal 并返回 final response；在迁移完成前，tool-enabled sync request 应显式不可用，不能形成第二套 loop/context/persistence 规则。

## 6. 不照搬清单

- 不迁移 Codex pending input/steer。
- 不迁移 compaction。
- 不迁移 skills/plugins/hooks。
- 不迁移 parallel tool futures。
- 不迁移 OS sandbox。
- 不迁移全部 ResponseItem；只实现当前 model/tool item。
- 不把 in-memory Session 作为云端 durable state 的最终方案。
- 不把 Codex 的实时 item/delta 语义误套到本阶段；当前 buffer 策略只保留外部 schema/content，牺牲首 token 实时性。

## 7. Red-Green-Refactor 阅读练习

### Red

- 用当前 runtime 画出第一轮 tool call 后错误结束的位置。
- 写出第二轮 request 应含的精确 items。

### Green

- 把 Codex needs_follow_up 翻译为一个布尔/decision union。
- 给 while loop 写三个退出条件：final、abort/error、budget exceeded。
- provider request mapper 每轮显式设置 `parallel_tool_calls=false`，但 reducer 仍 fail-closed 拒绝多 call。

### Refactor

- 将 per-sampling reducer 与 outer loop 分离。
- 删除所有当前不需要的 Codex side branches。

## 8. 测试矩阵

| 源码结论 | 当前测试 |
| --- | --- |
| tool call 使 follow-up | 第一轮 call 不触发 run complete |
| output 入 history | 捕获第二轮 input 含 result |
| call/output 配对 | 同 callId 断言 |
| final answer 才结束 | 第二轮 stop -> run completed |
| cancellation 贯穿 | sampling/tool/next-loop abort |
| loop 必须有界 | repeated call script 有限结束 |
| mixed text 不丢 | 第二轮 assistant tool-call item 同时含 content/call |
| untrusted observation | instruction-like output 保持 tool role，policy 不变 |
| sync/stream 同源 | sync endpoint 复用 runner，无 direct LLM 旁路 |

## 9. 验收证据

- [ ] 标出 Codex `run_turn` outer loop 与 sampling reducer 两层。
- [ ] 找到 `needs_follow_up` 的设置和退出位置。
- [ ] 从 tool harness 抄录为“语义步骤”，不复制 Rust 代码。
- [ ] 画出当前项目新调用链。
- [ ] 列出 run-scoped/sampling-scoped 变量。
- [ ] 明确 model history 与 Message 的差异。
- [ ] 列出至少五项不迁移能力。
- [ ] 明确 buffer 策略改变 token 到达时机，只称 schema/content compatible。
- [ ] 标出 `SeoService.chat()` 的旁路并写下统一 runner 策略。
- [ ] 核对 tool harness 第一个测试的真实 handler 与断言，不误称 fake executor。

## 10. 非目标

- 不通读 turn.rs 全文件。
- 不研究 compaction、hooks、steer、realtime。
- 不读 shell 工具具体执行。
- 不做性能优化。
- 不做持久化恢复。

## 11. 源码路径速查

### Codex

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/stream_events_utils.rs`
- `codex-rs/core/src/context_manager/history.rs`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/tests/suite/tool_harness.rs`

### 当前项目

- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/seo/seo-context-builder.service.ts`
- `apps/api/src/seo/prompts/seo-agent.prompt.ts`

## 12. 复盘问题

1. outer loop 与 event reducer 为什么必须分开？
2. Codex 哪些条件也会 needs_follow_up，但当前暂不实现？
3. call/output 进入 model history 后，为什么不一定进入 Message 表？
4. 第二轮 request 捕获比“最终回答看起来正确”更强在哪里？
5. 哪些变量跨 sampling 保留，哪些每轮清空？
6. 为什么不能在 SDK delta handler 内直接递归 sampling？
7. 当前固定 AgentStep 设计在哪个点暴露局限？
8. 为什么 UI 不展示中间文本不代表模型下一轮也不应看到它？
9. sync endpoint 与 stream endpoint 使用不同 runner 会造成哪些语义漂移？
