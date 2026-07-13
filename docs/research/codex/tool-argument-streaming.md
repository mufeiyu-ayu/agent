# Tool Argument Streaming：预览不是执行事实

本文研究 Codex 如何消费模型流式输出的 custom tool input delta，并以 `apply_patch` 为例，在完整 ToolCall 尚未结束前向 UI提供结构化文件变更预览。重点是 provisional projection、最终校验和恢复边界。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. Provider event 只承诺“参数片段”

Responses SSE 的 `response.custom_tool_call_input.delta` 被转换为：

```ts
type ToolCallInputDelta = {
  itemId: string;
  callId?: string;
  delta: string;
};
```

只有 event同时有 delta，并能从 item ID或 call ID得到一个 identity时才产生 Core event。它不是完整 JSON/patch，也不表示 provider最终一定发送 `output_item.done`。

所以 delta只能驱动临时预览，不能直接执行工具或写 durable业务状态。

## 2. Consumer 是 tool-specific capability

`CoreToolRuntime::create_diff_consumer()` 默认返回 `None`。只有明确支持流式参数解释的工具注册 consumer；当前主要例子是 `apply_patch`。

这避免主循环尝试通用地解析半截 JSON。不同工具的增量语法差异很大：

- JSON object可能在最后一个括号前都不合法。
- freeform patch可以按行渐进解析。
- shell command的半截文本不应提前解释/执行。
- 某些参数包含 base64/binary，预览毫无意义。

“是否可安全预览”属于工具能力，不属于 transport的默认行为。

## 3. Consumer 与模型看到的 Step registry同代

模型发出 `OutputItemAdded(CustomToolCall)` 时，runtime用当前 ToolRouter按 namespace/name查找 consumer。ToolRouter绑定本 Step的 registry generation。

因此流式预览与最终执行至少从同一 tool registration出发，避免中途 refresh后新版本 parser接管旧 spec产生的 delta。

如果该 tool未注册 consumer，delta被静默忽略；最终 `OutputItemDone` 仍走完整 ToolCall验证和执行。

## 4. Active consumer 的配对规则

主循环只维护一个 `active_tool_argument_diff_consumer`：

```text
(active call ID, consumer state)
```

收到 delta时：

- event有 call ID且不同于 active call ID：忽略。
- event有匹配 call ID：消费。
- event缺 call ID：回退 active call ID。
- 当前没有 consumer：忽略。

`item_id` 在 Core处理分支中没有参与匹配。Provider adapter要求有 item ID/call ID之一才能产生 event，但后续真正关联只依赖 active call ID。

这适用于 provider按 item顺序串行流式输出的假设；若未来支持多个 custom call参数交错 streaming，单 slot会丢失或覆盖，需要改为 `Map<callId, consumer>`。

## 5. 任意 OutputItemDone 都会 finish当前 consumer

处理 `OutputItemDone` 时，runtime先 `take()` active consumer并调用 `finish()`，然后再识别/执行这个完整 item。

代码没有再次验证完成 item的 call ID是否等于 consumer call ID。这依赖 stream事件严格按 added/delta/done同一 item连续到达。

若 provider出现交错或 malformed顺序，某个非对应 item done也可能提前结束当前 preview consumer。成熟 adapter要么在入口强校验 event sequence，要么以 item/call map维护独立状态机。

## 6. `apply_patch` 使用真正的增量 parser

Consumer内部保存 `StreamingPatchParser`，它不是每次把全部文本重新 parse：

- 保存未完成行 buffer。
- 维护 NotStarted / Started / Add / Delete / Update / Ended 状态。
- 累积 hunks与 environment ID。
- 每个 delta只推进新增字符。

解析出新 hunks后，将其转换为：

```ts
type PatchPreview = Record<
  string,
  | { kind: "add"; content: string }
  | { kind: "delete"; content: string }
  | { kind: "update"; unifiedDiff: string; movePath?: string }
>;
```

这让 UI在模型生成长 patch时逐步显示文件列表和diff，不必等待完整 tool call。

## 7. 500ms节流发送的是最新快照

第一个可用 preview立即发送；距离上次发送不足 500ms时，新 event覆盖 `pending`，不逐条发送。下一次超过 interval或 `finish()` 时发送最后 pending snapshot。

这是 coalescing，而不是丢失语义 delta：每个 event包含当前已解析 changes全量快照。UI可直接 replace provisional preview，无需重放所有字符。

优点：

- 降低 App Server/WebSocket/UI render频率。
- 保留最终最新预览。
- 不要求客户端实现 patch delta reducer。

代价是 event body可能随 patch增长而越来越大；500ms只限制频率，不限制累计 bytes。

## 8. Streaming parser 没有专用资源预算

Parser持有：

- `line_buffer: String`。
- 所有已解析 hunks。
- 每个 add/update的累计内容。
- consumer pending snapshot。

当前没有 parser-local max：

- 总 input bytes。
- 单行 bytes。
- hunk/file count。
- path length。
- preview serialized bytes。

模型输出 token/window提供间接上限，但 UI preview与内存/网络需要独立预算。尤其每次 snapshot包含完整 change map，长 patch可能产生重复序列化和传输放大。

## 9. 增量 parse error只影响预览

`push_delta()` 调用 parser出错时使用 `.ok()?`，该次不发 event；错误没有立刻终止 Turn。`finish()` 虽能返回 `FunctionCallError`，调用点只处理 `Ok(Some(event))`，Err也被忽略。

随后完整 `OutputItemDone` 仍进入 apply_patch handler，handler对最终完整 input重新严格解析。无效 patch最终会返回 `RespondToModel`，不会执行。

这是合理的 fail-soft preview / fail-closed execution：临时解析器失败不应因 provider分片方式直接杀死 Turn，最终执行边界必须重新验证完整输入。

但 silent preview failure对诊断不友好；至少应记录 structured telemetry，并明确清除/标记 UI中的旧 provisional preview。

## 10. Preview 早于 hook、approval、permission与写入

PatchApplyUpdated来自模型参数生成阶段。此时尚未完成：

- 完整 patch parse。
- pre-tool hook。
- approval。
- sandbox/permission/path校验。
- 文件系统写入。
- post-tool inspection。

因此 UI必须标成“模型正在拟定变更”，不能用已应用颜色、成功图标或写入工作区状态。

模型可能：

- 最终生成无效 patch。
- 被 pre-hook block。
- 被用户拒绝。
- 因路径权限失败。
- 执行到一半 partial commit。

Preview只是 intent projection，不是 effect projection。

## 11. App Server 把 call ID投影成 item ID

Core `PatchApplyUpdated { call_id, changes }` 映射为 v2 `fileChange/patchUpdated`：

- thread ID来自 event context。
- turn ID来自 event context。
- `itemId = callId`。
- changes转换为 v2协议。

复用 call ID让 UI能把 preview与最终 FileChange item关联，但再次说明 provider call ID承担了产品 item identity。若 call ID为空/重复，两个卡片可能覆盖。

更稳的 projection应保存内部 `toolExecutionId`，provider call ID只是字段之一。

## 12. Preview event故意不持久化

Rollout policy把 `PatchApplyUpdated` 分类为 transient，与 text delta、exec output delta类似。Cold resume不会重放半截 patch预览。

这符合 durable fact原则：

- partial model bytes不是完成事实。
- 进程崩溃后原 sampling无法安全从同一字节继续。
- 最终 raw ToolCall与Tool output/终态才用于恢复。

UI reconnect若 Turn仍 active，可以依赖 live snapshot/后续 event；若已失去 transient preview，宁可暂时不展示，也不能把旧半截 patch伪装成最终变更。

## 13. Preview 更新与最终 item不是同一个状态机事件

当前 preview notification用 `fileChange/patchUpdated`，最终 apply_patch会产生 FileChange item start/complete。客户端需要自行处理：

```text
no item
  -> provisional preview snapshots
  -> item started
  -> item completed(success/failure)
  -> turn terminal
```

如果 preview parse失败或工具被block，未必有“preview cleared”专用 event。客户端应在 call对应的 terminal tool/item/Turn事件上收口 provisional state，并设置超时/owner generation guard。

## 14. 不要用预览驱动副作用

错误示例：

```ts
socket.on('fileChange/patchUpdated', ({ changes }) => {
  applyToEditor(changes)
})
```

正确做法：

```ts
socket.on('fileChange/patchUpdated', ({ itemId, changes }) => {
  previews.set(itemId, { status: 'provisional', changes })
})

socket.on('item/completed', ({ item }) => {
  if (item.type !== 'fileChange') return
  previews.set(item.id, { status: item.status, changes: item.changes })
})
```

编辑器真实内容只从文件系统 observation或confirmed item更新，不能从模型意图更新。

## 15. 云端 Agent 的通用 contract

若 SEO工具有长参数生成，例如批量关键词计划，可使用通用 provisional event：

```ts
type ToolInputPreviewEvent = {
  runId: string;
  stepId: string;
  executionId: string;
  revision: number;
  complete: false;
  preview: unknown;
};

type ToolExecutionTerminalEvent = {
  executionId: string;
  status: "succeeded" | "failed" | "cancelled" | "blocked";
  complete: true;
  result?: unknown;
};
```

约束：

1. preview revision单调递增。
2. 客户端只接受同 Run/Step/execution generation的新 revision。
3. preview schema与最终 input schema可以不同，但要版本化。
4. execution再次验证完整 input。
5. preview有总bytes/rate/item budget。
6. 任一 terminal事件清除 provisional state。
7. preview不进入 canonical durable history，必要时只保存统计/错误。

## 16. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Sequence | added→delta→done、delta无consumer、wrong call ID、missing call ID |
| Interleave | 两个custom call交错、非tool item done提前出现 |
| Chunking | 每字符、按行、marker跨delta、UTF-8边界 |
| Throttle | 500ms内合并、finish flush pending、客户端replace快照 |
| Parse | 中途错误后最终合法/非法、preview失败不执行 |
| Lifecycle | pre-hook block、approval deny、cancel、Turn abort清preview |
| Identity | empty/duplicate call ID、stale上一Turn preview |
| Budget | 巨大单行、很多hunk/path、snapshot bytes与发送频率 |
| Recovery | reconnect不把transient preview当最终事实 |

## 17. 对当前项目的学习结论

当前最小 Tool Calling不需要参数流预览。先把完整 ToolCall parse、执行、Observation回填和错误终态做对。

未来若某个工具参数很长且预览确有产品价值，再学习 Codex这四点：

- tool-specific incremental consumer。
- 同 Step registry generation。
- 节流后的结构化最新快照。
- 最终执行重新验证完整输入。

不要把所有 JSON参数都做流式解析，也不要把 preview持久化成业务事实。Codex 当前单 active consumer、silent parse error、call ID复用和缺少资源预算则是扩展时必须补齐的边界。
