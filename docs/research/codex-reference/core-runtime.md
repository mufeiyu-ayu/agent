# Core Runtime：从产品入口到 run_turn

## 1. Codex 解决的问题

Codex 不是“Controller 直接调一次模型”的结构。它把一次用户请求拆成多个稳定层：

```text
Product entry
  -> protocol facade
  -> ThreadManager
  -> CodexThread / Session
  -> submission queue
  -> Task / RegularTask
  -> run_turn
  -> sampling loop
  -> events + durable facts
```

这种分层的价值是：多个产品入口可以共享同一个 runtime，用户请求可以排队、取消、恢复、fork，工具和 context 可以在 Turn 内演进，而外部协议仍保持稳定。

## 2. 源码事实

### 2.1 产品入口不是 Runtime

主要路径：

- `codex-rs/cli/src/main.rs`
- `codex-rs/app-server/src/message_processor.rs`
- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server/src/request_processors/**`
- `codex-rs/core/src/thread_manager.rs`

App Server 协议定义了 `thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/steer`、`turn/interrupt` 等方法。协议层负责校验、转换和回执，不直接承担 Agent loop。

### 2.2 Thread 是长期工作线

`ThreadManager` 负责创建、恢复、fork 和管理内存中的 threads。源码中 `ThreadManager` 持有：

- loaded `CodexThread` map。
- `ThreadStore`。
- model manager。
- environment manager。
- skills / plugins / MCP manager。
- extension registry。

这说明 Thread 不只是聊天记录 ID，而是运行环境、持久化、扩展、权限和上下文的聚合边界。

当前项目映射：

| Codex | 当前项目 | 迁移判断 |
| --- | --- | --- |
| Thread | `Conversation` | 已有最小会话身份，但缺 owner、archive、active run 投影 |
| ThreadManager | 暂无同等对象 | 未来可由 application service + repository + runner 组合承担 |
| ThreadStore | PostgreSQL + Prisma | 当前还没有完整 replay / resume 语义 |

### 2.3 Turn 是一次工作边界

`Op::UserInput` 不是直接模型请求，而是提交给 Session 的 submission queue。`turn/start` 请求会变成内部 `Op::UserInput`，再由 `submission_loop` 消费并创建 `RegularTask`。

核心路径：

```text
turn/start
  -> TurnRequestProcessor
  -> Op::UserInput
  -> CodexThread.submit
  -> Session submission channel
  -> submission_loop
  -> RegularTask::run
  -> run_turn
```

对当前项目的启发：

- HTTP request accepted 不等于 AgentRun 已经 started。
- streaming endpoint 可以先保持同步执行，但一旦引入 queue / worker / reconnect，就要显式区分 accepted、running、terminal。
- 同一 Conversation 是否允许并发 Run，必须成为明确策略，不能靠偶然实现。

### 2.4 StepContext 是单次 sampling 的能力快照

`StepContext` 包含：

- `TurnContext`。
- environment snapshot。
- selected capability roots。
- MCP runtime snapshot。
- 当前 sampling 的 MCP tool list。
- 当前环境下的 AGENTS.md。

关键不变量：

```text
model saw tool spec / environment / capability generation G
  => returned call must execute against generation G
```

不能在模型输出回来后用“当前最新工具表”重新解释它。否则工具 schema、权限或环境变化会导致模型看到的 contract 与实际执行 contract 分裂。

当前项目最小迁移：

- Phase 03 可以不立刻实现完整 `StepContext` 类。
- 但每轮 sampling 应构造一个不可变 `samplingContext`，至少包含：model id、tool definitions、tool registry generation、conversationId、runId、signal。
- 第二轮 sampling 必须显式携带前一轮 call/output，而不是重新从 UI messages 拼接。

## 3. run_turn 的核心不变量

`run_turn` 的主循环不是一次模型调用。它会：

1. 运行 pre-sampling compaction。
2. 捕获第一轮 StepContext。
3. 记录 context updates 和 user input。
4. 构造 model-visible input。
5. 调用 `run_sampling_request`。
6. 处理 response events。
7. 如果有 tool call 或 pending input，则继续下一轮。
8. 如果没有 follow-up，运行 stop hooks 并完成 Turn。

关键点：

- `ModelClientSession` 是 Turn-scoped，可在 Turn 内复用 transport / sticky routing，不跨 Turn 泄漏。
- `needs_follow_up` 是 Agent loop 的核心控制信号。
- `response_completed(tool_calls)` 只说明本轮 sampling 结束，不说明整个 Turn 完成。
- pending user input、tool output、auto compaction 都可能触发下一轮。

当前项目最近应迁移的不是完整 submission queue，而是这个最小循环：

```ts
while (true) {
  const decision = await sampleOnce(modelHistory, samplingContext)

  if (decision.type === 'final_answer') return final

  const result = await invokeTool(decision.call)
  modelHistory = appendToolObservation(modelHistory, decision.call, result)
}
```

## 4. 当前项目迁移建议

### 近期要做

- 抽出 `sampleOnce` 概念，即使代码仍在 `AgentRuntimeService` 内。
- 引入 model-visible history union，支持 assistant tool call 和 tool result。
- 为每轮 sampling 生成 server-owned `samplingAttemptId`。
- 给 loop 设置硬上限：`maxSamplingRounds`、`maxToolCalls`。
- 保持外部 `ChatStreamEvent` 类型不变，先只输出 final answer。

### 暂时不用做

- 不做完整 `ThreadManager`。
- 不做跨进程 submission queue。
- 不做 resume / fork。
- 不做多客户端 listener。
- 不做 StepContext 的全部 environment / MCP / AGENTS.md 能力。

## 5. 验收问题

不看文档时应能回答：

1. 为什么 `turn/start` 不应该直接等于模型请求？
2. Thread、Turn、Task、StepContext 分别解决什么问题？
3. 为什么一次 AgentRun 可以包含多次 sampling？
4. 为什么 model saw 的 tool specs 必须和实际执行 registry 同代？
5. 当前项目 Phase 03 为什么不需要先实现完整 queue？
