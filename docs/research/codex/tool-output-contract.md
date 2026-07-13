# Tool Output Contract：模型结果、Telemetry、Hook 与 Code Mode 是四个视图

本文研究 Codex 工具 handler返回值如何同时服务模型 Observation、日志/遥测、PostToolUse hook和 Code Mode。重点是同一个执行结果为什么不能只用一个 `string` 表示，以及各视图的截断和信任边界。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. ToolOutput 不是 DTO，而是投影策略

`ToolOutput` trait要求实现：

- `to_response_item()`：给下一次模型请求的 Observation。
- `log_preview()`：给 telemetry/trace 的受限摘要。
- `success_for_logging()`：执行成功度。
- `post_tool_use_*()`：给 hook的稳定输入/响应。
- `code_mode_result()`：给 JS/Code Mode调用者的结构化值。
- `contains_external_context()`：是否污染后续 memory生成资格。

同一个 handler result可以有不同消费者和不同预算。把所有用途都复用 `JSON.stringify(result)` 会造成：

- 模型上下文爆炸。
- 日志泄漏完整敏感输出。
- hook拿到被截断、无法判断的字符串。
- UI/Code Mode无法使用结构化字段。
- 外部数据失去provenance。

## 2. AnyToolResult 保留 call与payload上下文

Registry执行后返回：

```ts
type AnyToolResult = {
  callId: string;
  payload: ToolPayload;
  result: ToolOutput;
  postToolUsePayload?: unknown;
};
```

`ToolOutput` 本身不保存 provider call ID。转换为模型 Observation时由 runtime重新传入 call ID与原 payload，从而决定生成：

- FunctionCallOutput。
- CustomToolCallOutput。
- ToolSearchOutput。

这避免 handler硬编码 provider wire variant，也让同一业务 output适配 Function/Custom入口。

## 3. 单文本与结构化 content items 自动选择 wire shape

`FunctionToolOutput` 可以返回文本、图片等 `FunctionCallOutputContentItem[]`：

- 恰好一个 InputText时，序列化为简单 text body。
- 多项/非纯文本时，保留 ContentItems数组。

这是向后兼容与多模态能力之间的折中。业务 handler不必手工判断 provider wire格式。

但调用者必须意识到“同一输出的 body类型可能因 item数量变化”；客户端和持久化层应依赖 tagged union，而不是永远假设 string。

## 4. `success` 与文本内容分开

FunctionToolOutput有 `success: Option<bool>`：

- `Some(true)`：明确成功。
- `Some(false)`：明确失败。
- `None`：未声明/兼容旧行为，logging默认按成功。

这比让模型从 `error` 文本猜状态好。失败仍然是有效 Observation，可以触发模型修正，而不是基础设施exception。

但 Optional三态会造成不同消费者默认值漂移。当前 `success_for_logging()` 把 None当 true；provider或UI如何解释 None需保持一致。云端业务 contract最好让成功/失败显式必填，兼容层再处理旧 None。

## 5. Telemetry preview有独立小预算

Core tool outputs的日志预览最多：

- 2 KiB UTF-8安全截断。
- 64行。
- 超限追加固定 truncation notice。

这与模型 output预算分离，是正确设计。日志只需定位问题，不应复制全部命令输出或MCP payload。

仍需注意：

- 截断不是secret redaction。
- 前2 KiB恰好可能包含token、路径或用户数据。
- 某些 tool自行实现 preview；遗漏统一policy会泄漏。
- tool input在另一条trace路径可能仍记录完整 `payload.log_payload()`。

预算和脱敏是两个正交控制面。

## 6. Exec output 保留 raw bytes，模型只看受限文本

`ExecCommandToolOutput` 保存：

- raw output bytes。
- process/session ID、chunk ID、exit code、wall time。
- collection阶段已省略的 bytes。
- original token count。
- model max output tokens与Turn truncation policy。

给模型时：

1. UTF-8 lossy转换。
2. 取 `min(requested max tokens, Turn policy budget)`。
3. 加入 collection omission marker。
4. 若仍超限，再做 head/tail格式化截断。
5. 保留 wall time、exit/process状态等控制信息。

模型看到的是“可继续决策的摘要”，不是 terminal完整 transcript。

## 7. 两层 truncation必须都可见

Exec可能先在输出收集阶段丢 bytes，再在模型上下文阶段截断。Codex分别记录：

- `output_omitted_bytes` marker：上游collection已经丢了多少。
- `original_token_count` + warning：模型投影又截断了多少。

如果只显示最后一层“truncated”，模型/开发者可能误以为原始完整数据仍能通过扩大token budget取回。双层标记让数据完整度更诚实。

当前项目工具结果也应区分：

```ts
type OutputCompleteness = {
  sourceTruncated: boolean;
  sourceOmittedBytes?: number;
  modelProjectionTruncated: boolean;
  durableArtifactId?: string;
};
```

## 8. MCP 的模型投影与 Code Mode结果不同

MCP output给模型时：

- 加入 wall time header。
- 对多模态item处理 original image detail能力。
- 使用 function output truncation policy。

但 `code_mode_result()` 返回 raw `CallToolResult` JSON，不复用模型投影截断。注释明确：context-injection form要截断，Code Mode consumer仍拿原始结果。

这是有意的能力差异，却也可能成为预算绕行：同一MCP工具从Direct与Code Mode调用，调用者可见大小不同。

需要为每个消费面单独设总bytes/memory预算，不能以“模型history会截断”推导内部JS runtime也安全。

## 9. Exec Code Mode也可能看到完整 raw output

`ExecCommandToolOutput.code_mode_result()` 在显式 `max_output_tokens` 存在时截断；否则直接把全部 raw bytes转成字符串。

因此 Direct Tool的Turn policy上限并不自动约束 Code Mode。长命令输出可能：

- 增大JS cell result。
- 扩大后续嵌套tool/模型prompt组装。
- 增加内存复制。

Code Mode是另一种内部调用协议，不应被视为“绕过Responses历史所以无context成本”。

## 10. `log success` 不等于业务状态完整

Exec output当前 `success_for_logging()` 返回 true，即使 exit code非0；因为 tool invocation本身成功拿到了进程结果。命令业务成功与否保存在 exit code，模型自行解释。

这是合理但容易混淆的分层：

```text
tool transport succeeded
process exited non-zero
business objective may have failed
```

一个 boolean无法同时描述三层。更完整的 telemetry应拆分：

```ts
type ToolOutcome = {
  runtimeStatus: "completed" | "failed" | "cancelled";
  domainStatus?: "success" | "failure" | "unknown";
  code?: string | number;
};
```

## 11. PostToolUse 可以看到与模型不同的值

不同 output type决定 hook-facing payload：

- MCP hook可拿原始 CallToolResult与原 tool input。
- FunctionToolOutput可提供专门 `post_tool_use_response`。
- Exec仅在特定非background/hook-command条件下提供截断文本。
- ApplyPatch提供字符串结果。

这让 hook不必反解 provider ResponseItem。但也意味着 hook数据面可能比模型面更大、更敏感。

Hook是host process命令时尤其要有独立：

- allowlist。
- bytes cap。
- secret redaction。
- timeout。
- schema version。

不能因为模型output已截断，就把raw hook payload当安全。

## 12. PostToolUse feedback形成“日志真实、模型改写”的双视图

若 post-hook返回 feedback但不block，Registry用 `PostToolUseFeedbackOutput`包装：

- `log_preview()`与`success_for_logging()`委托原始 output。
- `code_mode_result()`仍返回原始 output。
- `to_response_item()`改为 hook feedback文本。

因此：

```text
execution/log/code-mode fact = original result
next model observation       = hook feedback projection
```

这是非常细致的设计：post-hook可以指导模型，但不会篡改“工具真实执行结果”的telemetry。

缺口是普通 rollout只持久化最终 model-visible ResponseItem，未必保留原始 output与hook改写之间的完整映射。审计重要时应同时保存 raw receipt、projection和transform reason。

## 13. External context 是输出级 provenance bit

`ToolOutput.contains_external_context()` 默认 false。Web search明确 true，Skills工具的 JsonToolOutput显式 `.with_external_context()`。当配置要求 external context禁用memory generation时，Registry在 output产生后标记 Thread memory mode polluted。

这比通过 tool name猜来源更好：同一个扩展工具可按实际结果声明 provenance。

但它仍是单个 boolean：

- 新工具忘记override就fail-open。
- 无法区分web、用户上传、另一个tenant、受信内部数据库。
- provenance不随最终 FunctionCallOutput显式持久化。
- State DB标记失败是best-effort时，恢复可能失去污染事实。

更好的模型是 typed trust label：

```ts
type ContextProvenance = {
  origin: "user" | "web" | "connector" | "internal";
  trust: "untrusted-data" | "trusted-data" | "instruction";
  sourceId?: string;
  tenantId?: string;
};
```

## 14. 历史层还会再次截断 Function output

ToolOutput生成 ResponseInputItem后，会转换为 ResponseItem并进入 `record_conversation_items()`。ContextManager记录时对 Function/Custom tool output按Turn truncation policy再次处理，并预留JSON serialization overhead。

这提供最后一道context安全网，但可能形成两次不同算法/预算的截断：

- handler-specific output projection。
- generic history truncation。

测试和observability需要记录每层budget/removed count，否则模型为什么看不到某段内容很难解释。

## 15. 图片 output 也有多层处理

结构化 Function output可含 InputImage：

- output type生成 content items。
- MCP层规范 original detail能力。
- history准备层decode/resize data URL，失败替换placeholder。
- model不支持image时，prompt normalization再剥离。

所以“Tool返回图片”不等于“模型看到了图片”。最终model-effective prompt才是消费事实。

工具结果receipt应保留 artifact identity；模型投影只引用适合当前model的尺寸/格式。

## 16. 一个更适合云端 Agent 的输出模型

```ts
type ToolExecutionResult<T> = {
  runtimeStatus: "completed" | "failed" | "cancelled";
  domainStatus: "success" | "failure" | "unknown";
  data: T;
  provenance: ContextProvenance;
  completeness: OutputCompleteness;
  artifacts: Array<{ id: string; mediaType: string; bytes: number }>;
};

type ModelObservation = {
  callId: string;
  text: string;
  success: boolean;
  truncated: boolean;
  artifactRefs: string[];
};
```

由专门 projector生成：

- `toModelObservation(result, modelBudget)`。
- `toAuditRecord(result)`。
- `toUiProjection(result)`。
- `toTelemetryPreview(result, redactionPolicy)`。

不要让业务handler自己拼最终prompt字符串并同时拿它当数据库记录。

## 17. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Wire | Function/Custom单文本、多content items、ToolSearch output |
| Status | explicit true/false/unknown、nonzero exit、runtime failure |
| Truncation | collection cap、model cap、history cap、notice与原token count |
| Surfaces | Direct vs Code Mode vs hook vs telemetry大小和schema |
| Hook | feedback只改model projection、block后保留真实execution outcome |
| Provenance | external context标记、遗漏默认、DB写失败、cold resume |
| Image | data URL resize失败、unsupported modality、artifact receipt |
| Privacy | secret出现在首2KiB、structured field redaction、raw hook payload |
| Crash | raw result已提交但model observation未持久化 |

## 18. 对当前项目的学习结论

当前项目最小 Tool Calling阶段无需复制 Codex所有 output类型，但应至少区分：

1. durable raw ToolResult。
2. 给模型的受限 Observation。
3. 给UI的状态/摘要。
4. telemetry的脱敏preview。

Codex 最值得学习的是 ToolOutput作为projection strategy、call/payload后绑定、structured content、独立telemetry预算、双层truncation可见性和post-hook双视图。需要改进/避免的是 Direct与Code Mode预算不一致、external context单boolean且默认fail-open、Optional success默认和raw/projection transform缺少完整审计receipt。
