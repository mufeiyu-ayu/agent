# Tool Loop：从一次 Tool Calling 到有界连续行动

## 1. 核心结论

Agent 与普通聊天机器人的关键分界线不是“后端会调用函数”，而是：

```text
模型提出 Tool Call
  -> 系统验证和执行
  -> Tool Result 作为 Observation 回填 model input
  -> 模型基于 Observation 再次 sampling
  -> 形成最终回答或继续调用工具
```

阶段 5 已经完成“一次 Tool Call -> Observation -> 第二轮 sampling -> final answer”。阶段 6 要继续学习：模型如何根据第一步 Observation 决定第二步动作，以及 Runtime 如何让循环在明确边界内结束。

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

- `codex-rs/core/src/session/turn.rs`；
- `codex-rs/core/src/stream_events_utils.rs`；
- `codex-rs/core/src/tools/router.rs`；
- `codex-rs/core/src/tools/parallel.rs`；
- `codex-rs/core/src/tools/registry.rs`；
- `codex-rs/core/src/tools/context.rs`。

阶段 6 只迁移顺序单 Agent Loop 的不变量，不复制并行执行、MCP 或完整恢复机制。

## 3. 关键设计不变量

### 3.1 模型只能提出调用，系统拥有执行权

模型输出先归一化为未验证调用：

```text
Model Tool Call
  -> UnvalidatedToolCallEnvelope
  -> ToolInvocationService
  -> validated invocation
  -> ToolExecutor
  -> ToolResult
```

Executor 不得直接接收模型原始 JSON。服务端负责：

- 工具是否存在；
- 参数是否合法；
- 工具是否允许执行；
- timeout 和 Abort；
- Tool Result 如何投影给模型；
- 是否还能继续下一轮。

### 3.2 Tool Call 与 Tool Result 是两个事实

必须区分：

```text
模型请求了什么
工具实际产生了什么
```

每个 Tool Call 必须先于对应 Tool Result，并通过同一 `callId` 配对。不能只保留 Result，也不能执行完工具却不把 Result 回填给模型。

阶段 6 暂不新增独立 canonical ToolCall / ToolResult 数据表，但当前 Run 内的 `ModelInputItem[]` 和 `AgentStep` 必须保持调用顺序与终态一致。

### 3.3 Expected Tool Error 可以成为 Observation

并非所有工具失败都必须终止整个 Run。

适合作为模型可见 Observation 的场景：

- 搜索零结果；
- 资源不存在；
- 参数校验失败；
- unknown tool；
- 低风险工具返回可解释业务失败。

通常应终止 Runtime 的场景：

- Registry 或 Runtime invariant 损坏；
- 持久化关键终态失败；
- 模型服务不可用且无法安全继续；
- 用户 Abort；
- 执行达到服务端硬上限。

最终分类必须由正式 Issue 和测试固化，不能依赖错误文案字符串。

### 3.4 `callId` 只负责模型协议配对

不要把一个 ID 承担所有身份：

```text
callId：Tool Call / Result 配对
samplingAttemptId：哪次模型调用产生该 call
executionAttempt：第几次工具执行
operationId：未来副作用业务意图
idempotencyKey：未来重试去重
receiptId：未来外部回执
```

阶段 6 只需要前两到三种身份，不提前实现写操作幂等与 receipt。

### 3.5 当前只做顺序执行

Codex 支持并发 Tool Call，但当前项目第一版有界 Loop 保持：

- 每轮最多一个 Tool Call；
- `parallel_tool_calls=false`；
- Runtime 仍显式拒绝同轮多个 Call；
- 多个工具跨 Sampling 轮次顺序执行；
- Observation 按真实发生顺序追加。

这样可以先学清执行状态与终止语义，不把并发问题混入阶段 6。

### 3.6 Cancellation 必须有唯一终态所有者

- Sampling 前、Tool 前、Tool 后和下一轮前检查 AbortSignal；
- Run 已 `ABORTED` 后，迟到的 Tool Result 或模型 final 不能覆盖状态；
- Tool timeout 与用户 Abort 保留不同错误类型；
- 已开始的 Sampling / Tool Step 都必须进入终态；
- 不允许同一 Run 同时被记录为 `COMPLETED` 与 `ABORTED`。

## 4. 当前项目基线

当前 Runtime 支持：

```text
sampling #1
  -> final answer
  或
  -> search_articles
       -> observation
       -> sampling #2
       -> final answer
```

阶段 5 已具备：

- `ModelInputItem` message / assistant_tool_call / tool_result；
- `SamplingDecision` final_answer / tool_call；
- Tool Registry 与统一 Invocation；
- Observation 规范化；
- 动态 model_sampling / tool_execution Step；
- timeout、Abort 和 terminal consistency；
- 同步与流式共享 Runtime。

尚未具备：

- 第二个有依赖关系的只读工具；
- 多次顺序 Tool Call；
- 独立 Loop Policy；
- 多步骤成功、超限和重复决策测试。

## 5. 阶段 6 的目标 Loop

概念流程：

```text
sampling
  -> final answer ? 完成
  -> tool call
       -> validate
       -> execute
       -> append observation
       -> sampling
       -> 继续或完成
```

代表性路径：

```text
sampling #1
  -> search_articles
  -> observation #1
sampling #2
  -> get_article_detail
  -> observation #2
sampling #3
  -> final answer
```

但模型也可以：

- 第一轮直接回答；
- 搜索后直接回答；
- 搜索零结果后解释无结果；
- 详情不存在时选择其他候选或结束；
- 在服务端上限内继续行动。

Runtime 不得硬编码固定的 `search -> detail -> answer` Workflow。

## 6. 有界执行策略

最小策略方向：

```ts
interface AgentLoopPolicy {
  maxSamplingRounds: number
  maxToolCalls: number
  toolTimeoutMs: number
  runDeadlineMs?: number
}
```

关键规则：

- Sampling 和 Tool Call 数量分别计数；
- final answer 立即结束；
- Tool Call 达到上限时不执行；
- Sampling 达到上限仍无 final answer 时明确失败；
- 模型不能通过 Prompt 或 Tool Result 修改服务端限制；
- 上限失败不能伪装成正常回答；
- 具体数值由 Task 1 Issue 与测试确定。

## 7. Model Input 与 UI Message

阶段 6 保持：

- user Message 正常持久化；
- Tool Call 中间文本不作为最终 Assistant 气泡；
- Tool Result 只进入 model input；
- 最终答案才写入 Assistant Message；
- 多个 Tool Exchange 按实际顺序保留；
- 当前用户输入恰好一次；
- Tool Result 始终是低信任数据，不能覆盖 system policy。

本阶段不建设完整 Token Budget、摘要或 Compaction。

## 8. 必测用例

| 场景 | 关键断言 |
| --- | --- |
| direct answer | 不调用工具，Run 正常完成 |
| one tool | `search_articles -> final` |
| two tools | `search_articles -> get_article_detail -> final` |
| zero result | 不伪造文章，模型得到空结果 Observation |
| detail not found | 成为受控业务 Observation |
| invalid args | Executor 未被调用，失败语义明确 |
| unknown tool | 不执行任意代码 |
| executor throws | 错误脱敏，不泄漏 stack / secret |
| timeout | Tool Step 与 Run 按策略收口 |
| user abort | 不启动迟到的下一轮 sampling |
| sampling limit | 有限结束，不能伪装成功 |
| tool-call limit | 超限 Call 不执行 |
| mixed text + call | 中间文本不进入最终 UI Message |
| multiple calls in one round | 当前明确拒绝 |
| prompt injection output | Tool Result 保持 tool role，不能修改 server policy |
| trace order | Sampling / Tool Execution sequence 与实际发生一致 |

## 9. 当前不做

- 并行 Tool Call；
- 写操作工具；
- Permission / HITL；
- Durable Recovery；
- 完整 Context Engineering；
- MCP；
- Multi-agent；
- 通用 Workflow Engine；
- 完整持久化 replay。

## 10. 学习验收

阶段 6 完成后，应能不看文档回答：

1. Tool Calling 与 Agent Loop 有什么区别？
2. 为什么一个 Run 可能包含多次 Sampling？
3. 模型和 Runtime 分别控制什么？
4. Expected Tool Failure 为什么可能继续 Loop？
5. 为什么要分别限制 Sampling 与 Tool Call 次数？
6. 如何避免 Abort 被迟到完成覆盖？
7. Agent 测试为什么不能只检查 HTTP 200 和最终文本？
