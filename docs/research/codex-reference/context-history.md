# Context 与 History：model-visible history 不等于 UI transcript

## 1. 核心结论

Codex 的 Context 设计最值得当前项目学习的一点是：

```text
model-visible history
UI transcript
runtime events
durable rollout facts
analytics / telemetry
```

这些不是同一种数据。把它们混成一个 `messages[]`，在纯聊天阶段可以工作；进入 Tool Calling 后会迅速失控。

## 2. Codex 源码事实

关键路径：

- `codex-rs/core/src/context_manager/history.rs`
- `codex-rs/core/src/context_manager/normalize.rs`
- `codex-rs/core/src/context_manager/updates.rs`
- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/tests/suite/token_budget.rs`

`ContextManager` 内部持有：

- `items: Vec<ResponseItem>`：模型历史。
- `history_version`：历史被 compaction / rollback 重写时递增。
- `token_info`：上下文窗口使用信息。
- `reference_context_item`：用于 diff 的上下文基线。
- `world_state_baseline`：世界状态基线。

`for_prompt()` 会在发送模型前 normalization，删除不适合模型输入的项、修复 call/output 对、按模型能力处理图片等。

## 3. 高价值不变量

### 3.1 Conversation Message 不是 Model History

当前项目的 `Message` 是 UI transcript：用户和 assistant 最终可见消息。

Tool loop 需要的 model history 还包括：

- assistant tool call。
- tool result。
- 中间 assistant text。
- context fragments。
- prompt/system/developer instructions。
- future summary / compaction。

这些不应该全部塞进 `Message.content`。

### 3.2 call/output pairing 是上下文不变量

Codex 在 normalization 中会处理：

- missing function output。
- orphan output。
- 不支持 image input 时替换图片内容。
- tool output truncation。

当前项目最小迁移：

- 每个 tool call 必须有同 callId tool result。
- invalid / unknown tool 也应该生成失败 observation，避免 call 无 output。
- 如果 Run abort，已经完成的 call/output 尽量保持配对；无法完成时要有明确 aborted observation 或 durable error。

### 3.3 Tool output 是 untrusted data

Tool output 可能来自网页、文件、API、RAG 检索或用户输入。它不能被拼进 system prompt，也不能改变权限策略。

当前项目在第二轮 sampling 中应把 observation 映射为 tool role / tool result，而不是 user message 或 system message。

### 3.4 Context budget 要先从 observation 开始

进入 Tool loop 后，最先爆掉上下文的通常不是聊天历史，而是工具输出。

当前项目最小策略：

```ts
type ObservationBudget = {
  maxBytes: number
  maxApproxTokens: number
  truncateMarker: string
}
```

每个 `ToolResult.modelContent` 进入 model history 前要经过：

1. 大小限制。
2. 敏感信息策略。
3. 来源标记。
4. 截断说明。

完整 compaction 可以后置。

## 4. 当前项目迁移路线

### Phase 03：内存 model history

目标：跑通单次 tool loop。

- 从当前 `SeoContextBuilder` 输出初始 messages。
- 转为内部 `ModelInputItem[]`。
- sampling #1 后追加 `assistant_tool_call`。
- tool 执行后追加 `tool_result`。
- sampling #2 产生 final answer。
- 本阶段不持久化完整 model history。

### Phase 04：Tool step recording

目标：记录可审计事实。

- AgentStep 或新表记录 tool call / result。
- 记录 raw arguments、validated input 摘要、tool version、status、error code。
- 不记录敏感完整 payload，或者做字段级脱敏。

### Phase 06：Context budget

目标：避免 history 和 observation 失控。

- 对 message history、tool result、context fragment 分来源设预算。
- 固定优先级：system/developer > current user input > recent tool output > recent messages > older summary。
- 引入 summary / compaction 前先把截断策略测试清楚。

## 5. 前端类比

你可以把 model history 和 UI transcript 的关系类比成：

```text
Pinia internal state / cache / request metadata
  != 页面上渲染的 message list
```

前端组件只展示最终用户可见状态，但内部 store 可能还保存 loading、request id、rollback snapshot、optimistic mutation、error receipt。Agent 的 model history 也是这样：它服务于下一次模型请求，不等于用户要看到的聊天记录。

## 6. 必测用例

| 场景 | 关键断言 |
| --- | --- |
| tool result 不进入 UI Message | 数据库 assistant Message 只有最终回答 |
| tool result 进入第二轮 model input | captured request 中存在 tool role / tool_result |
| mixed text + call | 中间文本进入 assistant_tool_call.content，不展示给 UI |
| malicious observation | 仍是 tool role，不能覆盖 system/developer |
| oversized observation | 被截断并保留来源/截断说明 |
| missing output | 产生失败/aborted observation 或明确 FAILED |

## 7. 暂时不做

- 不立刻实现完整 Codex ContextManager。
- 不做复杂 memory pipeline。
- 不做自动长期摘要。
- 不把每个 token delta 写数据库。
- 不做全量 replay history projection。
