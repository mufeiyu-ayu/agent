# Core Runtime：从产品入口到有界 Agent Loop

## 1. Codex 解决的问题

Codex 不是“Controller 直接调用一次模型”的结构。它把一次用户任务拆成多个稳定层：

```text
Product entry
  -> protocol facade
  -> Thread / Session
  -> submission
  -> Task / Turn
  -> sampling loop
  -> tool execution
  -> events + durable facts
```

这种分层让多个产品入口共享同一个 Runtime，并使取消、恢复、工具、Context 和外部协议各自拥有明确边界。

当前项目不复制完整 Codex Runtime，只选择性迁移阶段 6 需要的 Loop 不变量。

## 2. Codex 源码事实

### 2.1 产品入口不是 Runtime

主要路径：

- `codex-rs/cli/src/main.rs`；
- `codex-rs/app-server/src/message_processor.rs`；
- `codex-rs/app-server-protocol/src/protocol/common.rs`；
- `codex-rs/app-server/src/request_processors/**`；
- `codex-rs/core/src/thread_manager.rs`。

协议层负责校验、转换和回执，不直接承担 Agent Loop。当前项目已经采用相似边界：Controller / SeoService 负责 HTTP 投影，`AgentRuntimeService.runTurnStream()` 负责执行。

### 2.2 Thread 是长期工作线

Codex `ThreadManager` 管理 Thread 创建、恢复、fork、持久化、模型和扩展能力。当前项目只具备最小映射：

| Codex | 当前项目 | 当前判断 |
| --- | --- | --- |
| Thread | `Conversation` | 已有最小会话身份和 Message 持久化 |
| Turn / Task | `AgentRun` | 当前一个请求对应一个 Run |
| Step | `AgentStep` | 记录 sampling、tool execution 等事实 |
| ThreadStore | PostgreSQL + Prisma | 尚无 replay / resume 语义 |
| ThreadManager | 无同等对象 | 当前不需要建立完整 manager |

### 2.3 一次 Run 不等于一次 Sampling

Codex 的 `run_turn` 会反复：

1. 构造本轮 model-visible input；
2. 发起 sampling；
3. 处理模型事件；
4. 若有 Tool Call，执行工具并记录 Observation；
5. 若 `needs_follow_up`，进入下一轮 sampling；
6. 没有后续动作时完成 Turn。

关键不变量：

- `response_completed(tool_calls)` 只表示本轮 sampling 完成，不表示整个任务完成；
- 一个 Turn / Run 可以有多次 sampling；
- Tool Result 是触发下一轮决策的 Observation；
- Runtime 而不是模型拥有最大执行次数和终止权。

### 2.4 StepContext 是单次 Sampling 的能力快照

Codex 的 `StepContext` 会固定本轮模型看到的模型、工具、环境和能力版本。

核心约束：

```text
model saw tool contract generation G
  => returned call must execute against compatible generation G
```

当前阶段不实现完整 `StepContext`，但每轮 sampling 至少要明确：

- requested model；
- tool definitions；
- runId / conversationId；
- samplingAttemptId；
- AbortSignal；
- Loop policy；
- 之前已发生的 Tool Call / Result。

## 3. 当前项目现状

阶段 5 已经完成：

```text
sampling #1
  -> final answer
  或
  -> search_articles
       -> observation
       -> sampling #2
       -> final answer
```

代码中的固定 `[1, 2]` 循环是 Agent Loop 的最小特例，但不是可复用的多步骤 Loop。

当前缺口：

- 只有一个模型可见工具；
- 最多一次 Tool Call；
- 第二轮仍请求工具时直接失败；
- Sampling / Tool Call 上限不是独立策略对象；
- 尚未覆盖 `search -> detail -> final`；
- 多步骤 Trace 和超限语义尚未验证。

## 4. 阶段 6 要迁移的最小循环

概念结构：

```ts
while (samplingRounds < policy.maxSamplingRounds) {
  const decision = await sampleOnce(modelInput, samplingContext)

  if (decision.type === 'final_answer') {
    return completeRun(decision)
  }

  assertToolCallBudget(policy)

  const result = await invokeTool(decision.call)
  modelInput = appendToolExchange(modelInput, decision.call, result)
}

throw new AgentLoopLimitExceededError()
```

这里真正要学习的是：

- sampling 与 Tool Execution 的层级；
- final answer 与 follow-up 的判断；
- Sampling 上限和 Tool Call 上限；
- timeout、Abort 和 Run deadline；
- Expected Tool Failure 与 Runtime Fatal 的区别；
- 所有已开始 Step 的终态收口；
- 外部流式协议与内部循环解耦。

## 5. 模型与 Runtime 的职责

### 模型负责

- 选择直接回答还是调用工具；
- 在允许工具中选择动作；
- 生成 Tool Call 参数；
- 根据 Observation 决定继续或结束。

### Runtime 负责

- 决定工具是否可见；
- 校验工具名、参数和风险；
- 控制 timeout 和 Abort；
- 记录 Sampling 与 Tool Execution；
- 追加合法 Tool Result；
- 控制最大循环次数；
- 将失败映射为 Observation 或 Runtime Fatal；
- 收口 Message / Run / Step；
- 拒绝无限循环和伪造成功。

## 6. 当前阶段不迁移的 Codex 能力

- 完整 `ThreadManager`；
- submission queue；
- resume / fork / replay；
- 多客户端 listener；
- 完整 StepContext 环境快照；
- MCP / Skills / Plugins；
- 并行 Tool Call；
- 自动 Context Compaction；
- Multi-agent child tasks。

这些能力继续作为研究资料，不自动进入后续阶段。

## 7. 阶段 6 验收问题

不看文档时应能回答：

1. 为什么一个 `AgentRun` 可以包含多次 sampling？
2. `response_completed(tool_calls)` 为什么不等于 Run 完成？
3. 模型和 Runtime 分别拥有哪部分控制权？
4. 为什么必须分别限制 Sampling 和 Tool Call 次数？
5. Workflow 写死步骤与 Agent 根据 Observation 决策有什么区别？
6. Tool timeout、用户 Abort 和 Loop Limit 为什么是不同终止原因？
7. 为什么当前不需要复制 Codex 的完整 ThreadManager？
