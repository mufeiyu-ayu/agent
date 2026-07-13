# Tool Call Execution Pipeline：并发执行、顺序 Observation 与唯一终态

本文研究 Codex 从模型 `ResponseItem` 识别 Tool Call，到 handler执行、取消、hook、Observation写回和下一次 sampling 的完整链路。重点是每层职责和失败/并发不变量，而不是具体 shell 工具。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. 主链不是“解析 JSON 后调用函数”

```mermaid
flowchart LR
  A[Model stream OutputItemDone] --> B[ToolRouter.build_tool_call]
  B --> C[Persist raw call item]
  C --> D[ToolCallRuntime admission]
  D --> E[ToolRegistry lookup]
  E --> F[pre-tool hook]
  F --> G[typed handler/runtime]
  G --> H[post-tool hook]
  H --> I[terminal outcome claim]
  I --> J[FuturesOrdered drain]
  J --> K[Persist tool output]
  K --> L[Follow-up sampling]
```

Codex 把 provider item转换、工具发现、并发策略、hook、执行、生命周期事件和模型 Observation分开。这样新增工具主要落在 spec/handler注册，不需要修改 `run_turn` 主循环。

## 2. ToolRouter 同时冻结 spec 与执行 registry

每个 Step 根据同一个 `StepContext` 构建 `ToolRouter`：

- `model_visible_specs` 发给模型。
- `ToolRegistry` 保存实际 executor。
- ToolCallRuntime持有该 StepContext与router，即使调用稍后才执行也不切到新配置。

这条不变量很关键：

```text
model saw tool spec from generation G
  => call must execute against registry/policy/environment generation G
```

不能在模型输出回来后用“当前最新工具表”重新路由，否则 refresh/permission/environment变化会让 advertised contract 与实际执行分叉。

## 3. 三类 provider call 归一化为 ToolCall

`ToolRouter::build_tool_call()` 处理：

- FunctionCall：保留 namespace/name、raw arguments string、call ID。
- client ToolSearchCall：先解析 search arguments，再映射为固定 `tool_search`。
- CustomToolCall：保留 namespace/name、freeform input、call ID。

server-executed ToolSearchCall 返回 `None`，避免客户端重复执行 provider已经负责的搜索。

统一对象很小：

```ts
type ToolCall = {
  toolName: { namespace?: string; name: string };
  callId: string;
  payload:
    | { kind: "function"; arguments: string }
    | { kind: "custom"; input: string }
    | { kind: "tool-search"; arguments: unknown };
};
```

路由层不应该提前知道每个业务参数 DTO；具体 handler负责 parse。

## 4. Raw call 先持久化，再执行

识别到 ToolCall 后，runtime先 `record_completed_response_item()`，再创建 tool future。注释明确说明这样即使 Turn稍后取消，history/rollout仍保存模型确实请求过该工具。

这区分两类事实：

- Model requested call：模型输出的 durable fact。
- Tool produced output：执行完成后的 observation。

如果把两者放进一个事务式“工具成功记录”，取消/崩溃后会丢失模型为什么走到这里的证据。

但 raw call持久化不代表副作用有 exactly-once保证；崩溃在外部副作用提交后、output持久化前，恢复时仍面临 ambiguous execution。

## 5. 不支持的工具通常回给模型自我修正

Registry找不到 tool name时返回 `FunctionCallError::RespondToModel`。ToolCallRuntime把它转换成带原 call ID的失败 output，而不是让整个 Turn fatal。

同类可恢复错误包括：

- 参数 JSON无法解析。
- 业务参数不合法。
- 资源不存在。
- policy/hook拒绝。
- 工具运行失败但适合让模型换方案。

`Fatal` 只用于 runtime invariant或无法安全继续，例如已匹配 handler却收到不兼容 payload、tool task join失败、内部状态损坏。

这比“任何 tool error 都500”更适合 Agent loop：模型观察失败，决定修参、换工具或向用户解释。

## 6. Call ID 是 Observation配对主键，但入口信任 provider

Tool output用 call ID与模型 call配对。当前 `build_tool_call()` 不校验：

- empty call ID。
- 同一个 response内 duplicate call ID。
- 跨 Step重复 ID。
- ID长度/字符集。

可信 provider通常保证协议，但 custom provider或raw history injection可能破坏它。History normalization按 call ID集合补 missing output、删除 orphan output；重复 ID会让配对语义模糊。

Agent Runtime应在模型边界校验 call ID非空且在当前 response唯一，内部另分配 `toolExecutionId`，不要让 provider ID同时承担数据库主键、幂等键和审计身份。

## 7. ToolSearch parse error 有丢失 call identity 的特殊边界

Function/Custom call先构造 ToolCall，参数错误通常发生在 handler，因此 failure output保留原 call ID与对应 output类型。

client ToolSearchCall却在 `build_tool_call()` 阶段解析 arguments。若解析失败，错误分支构造的是 `FunctionCallOutput { call_id: "" }`，因为此时 `FunctionCallError`没有携带原 ToolSearch call上下文。

这可能导致：

- 输出类型不是 ToolSearchOutput。
- 空 call ID无法与原 call配对。
- prompt normalization把它视为 orphan并删除，同时又为原 call补 synthetic output。

这是错误类型设计的教训：任何可恢复 parse error都应携带 `callId + payloadKind`，才能生成协议匹配的 Observation。

## 8. 并发规则是 RwLock admission

每个 Tool注册 `supports_parallel_tool_calls()`：

- parallel tool获取共享 read lock。
- non-parallel tool获取独占 write lock。

因此：

- 多个 parallel tools可以同时执行。
- 任一 exclusive tool与所有其他 tool互斥。
- admission wait与handler execution timing分开记录。

这比全串行吞吐更高，也比“模型一次返回多个 call就全部并发”安全。并发能力属于工具声明，不属于模型决定。

需要注意：同一个 RwLock只约束当前 ToolCallRuntime/Step内调用，不自动提供跨 Thread、跨进程或同一外部资源的锁。

## 9. 执行可以并发，Observation按模型顺序写回

每个 tool future push进 `FuturesOrdered`。Future可能并发执行，但 drain按插入顺序 yield结果并持久化 output。

优点：

- 下一次模型 history稳定，与模型输出 call顺序一致。
- 测试和 prompt cache更确定。
- later tool先完成也不会把 Observation插到 earlier call之前。

代价：

- 慢的第一个 tool造成 head-of-line blocking。
- 后续工具的副作用可能已完成，但 output尚未持久化。
- 此时 crash会扩大“外部已提交、内部无receipt”的窗口。

若工具副作用重要，应由每个 handler自己持久化 operation receipt，不能只依赖最终按序写入的模型 output。

## 10. 一次模型响应中的 in-flight 数没有专用上限

每个识别到的 ToolCall都会创建并 spawn dispatch task，收集在 `FuturesOrdered`。当前主路径没有 method-specific：

- max tool calls per response。
- max parallel executions per Thread。
- per-tool weighted capacity。
- aggregate tool wall-clock deadline。

Provider输出/token限制提供间接边界，exclusive lock限制实际并发，但大量 parallel calls仍可能创建很多 task、请求和外部副作用。

云端 Agent需要 admission budget，例如：

```ts
type ToolBudget = {
  maxCallsPerStep: number;
  maxConcurrentWeight: number;
  maxWallTimeMs: number;
  maxObservationBytes: number;
};
```

## 11. Tool start 早于 pre-hook结果

Registry找到匹配 tool并校验 payload kind后，先 `notify_tool_start()`，再运行 pre-tool-use hooks。Hook可以：

- Block。
- Continue原输入。
- Rewrite输入并重建 typed invocation。

若 blocked，handler未执行，但生命周期仍有 Started -> Finished(Blocked)。这能保证 UI不留下永远 InProgress的 item，也让审计知道 admission确实发生。

`ToolCallOutcome::Failed { handler_executed: false }` 进一步区分“执行前失败”和“handler内部失败”。这是比单一 success boolean更有诊断价值的状态。

## 12. Post-hook 不能撤销已完成副作用

handler完成后才运行 post-tool-use hook。Hook若 block：

- lifecycle outcome仍依据真实 handler执行结果标 Completed/Failed。
- 给模型的结果会替换为 hook feedback/error。
- 已发生的文件/网络/进程副作用不会回滚。

源码注释直接强调：PostToolUse block拒绝的是 result，不是已经完成的 tool execution。

因此 Hook policy必须分清：

- 执行前 policy：能阻止副作用。
- 执行后 inspection：只能改变 Observation、触发补偿或标记风险。

不能用 post-hook包装成“安全审批”。

## 13. Cancellation 需要唯一 terminal owner

每个 dispatch创建 `terminal_outcome_reached: AtomicBool`。Registry正常结束和 Runtime取消路径竞争这个 flag：

- 正常 handler先 claim：取消路径等待/返回真实结果。
- 取消先 claim：Runtime负责发 Aborted terminal lifecycle。
- 另一方不得再发第二个 Finished/Aborted。

这解决最常见的 exactly-once terminal event竞态。

对于 `waits_for_runtime_cancellation` 的工具，取消方不直接 abort task，而是先 claim terminal，再等待 handler完成资源/进程 teardown；最终对模型返回 synthetic aborted output。

其他工具会 abort dispatch task并等待 join收口。

## 14. Cancelled output仍是模型历史的一部分

取消生成：

- shell/unified exec：带 wall time的 `aborted by user`。
- 其他工具：`aborted by user after Xs`。

Runtime随后发送 tool-aborted生命周期，并在 drain中把对应 output写入 history。即使整个 Turn最终返回 `TurnAborted`，已完成的 call/output配对仍尽量保持 history invariant。

这有助于 resume/rollback normalization，避免留下没有 output的 call。

但“用户取消”文本是模型可见 observation，不等于 durable business cancellation receipt；外部副作用是否已部分发生仍需 handler-specific status。

## 15. Sampling完成后先等工具，再发布进度

模型 stream完成后：

1. flush残余assistant text parser。
2. 开始 tool-blocking timing。
3. drain所有 in-flight tool outputs并持久化。
4. 再发 token count。
5. 检查 Turn cancellation。
6. 必要时发 diff并进入 follow-up sampling。

Request-user-input等工具会暂停 Turn。把 token count放在工具完成后，避免客户端在等待用户时收到看似继续推进的进度事件。

这里体现 UI event ordering也是 runtime contract，不只是性能细节。

## 16. 两种失败通道

```ts
type ToolFailure =
  | { kind: "observation"; callId: string; message: string }
  | { kind: "runtime-fatal"; message: string };
```

Observation failure需要：

- 持久化原 call。
- 生成匹配 call ID/type的失败 output。
- 设置 `needsFollowUp = true`。
- 让模型决定下一步。

Fatal failure则终止 sampling/Turn，必须产生明确 terminal error。

当前项目定义 Tool Contract 时，应把 expected business error建模为普通 ToolResult，而不是依赖 throw；只有基础设施不变量破坏才抛 fatal exception。

## 17. 云端 TypeScript 分层

```ts
interface ToolSpecProvider {
  listForStep(context: StepContext): Promise<ToolSpec[]>;
}

interface ToolRegistry {
  resolve(name: ToolName, generation: string): ToolHandler | undefined;
}

interface ToolHandler<TInput, TOutput> {
  parse(raw: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

type ToolExecutionRecord = {
  executionId: string;
  runId: string;
  stepId: string;
  providerCallId: string;
  toolName: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  operationId?: string;
  receipt?: unknown;
};
```

最小实现顺序：

1. provider-neutral ToolCall。
2. registry + typed handler。
3. durable call/output Step。
4. business error回填模型。
5. timeout/cancel唯一终态。
6. 再做并行和hooks。

## 18. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Pairing | empty/duplicate/cross-step call ID、Function/Custom/Search output类型 |
| Registry | unknown tool、known tool wrong payload、refresh generation |
| Parsing | malformed JSON、schema mismatch、tool-search parse failure仍保留call ID |
| Ordering | later tool先完成但history按call顺序、exclusive与parallel交错 |
| Hooks | pre block/rewrite、post block不伪装未执行、hook error |
| Cancellation | handler先完成、cancel先发生、runtime teardown、double terminal |
| Crash | call persisted后执行前、side effect后output前、output commit后response前 |
| Budget | call count、weighted concurrency、deadline、observation bytes |
| Follow-up | failure observation促使模型重试、Fatal终止Turn |

## 19. 对当前项目的学习结论

当前 Phase 5最值得直接迁移的是：

- ToolCall / ToolResult provider-neutral contract。
- 原 call与 output分别持久化。
- expected tool error回填模型，而不是终止整个 Run。
- call ID只做provider配对，内部另有 execution ID。
- tool spec与执行 registry绑定同一 Step generation。

并行、hook和复杂 cancellation可以后置。Codex 的 StepContext snapshot、RwLock admission、FuturesOrdered、terminal atomic claim和pre/post hook语义值得学习；ToolSearch early parse丢call identity、in-flight无专用预算和副作用/output之间的crash window则要显式规避。
