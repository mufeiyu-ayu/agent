# 从 Codex 架构迁移到 AI SEO Agent 的学习路线

本文档只关注 `<agent>` 当前阶段如何吸收 Codex 的架构思想。重点是“小步可运行”，不是照搬 Codex 的复杂度。

路径约定：`<codex>` 表示 Codex 仓库根目录，`<agent>` 表示当前 AI SEO Agent 项目根目录。

## 1. 当前项目阶段判断

根据以下文件：

- `<agent>/docs/development-task-plan.md`
- `<agent>/docs/tasks/phase-02-agent-chat-session.md`
- `<agent>/docs/tasks/phase-03-streaming-chat-experience.md`
- `<agent>/docs/work-log.md`
- `<agent>/apps/api/src/seo/seo.service.ts`
- `<agent>/apps/web/src/hooks/useSeoWorkspace.ts`

当前项目已经完成了：

- 阶段 2 的核心数据层：`Conversation` / `Message` 持久化、多会话、按 `conversationId` 构建 history。
- 阶段 3 的基础 streaming：NDJSON、`start/delta/done/error/aborted`、前端 `AbortController`、assistant chunk 增长展示。
- 后端 LLM client 分层：`LLMService` 门面 + `OpenAICompatibleClient` 适配 OpenAI-compatible SDK。

当前最重要的未完成主线：

- 后端真实中断和 `ABORTED` 持久化一致性。
- 多会话 active stream 边界进一步收口。
- 从“stream chat service”逐步升级成“轻量 Agent runtime”。

## 2. 当前已对应 Codex 的哪些概念

| 当前项目 | 对应 Codex 概念 | 已做到什么 |
| --- | --- | --- |
| `Conversation` | `Thread` | 多会话、持久化、刷新恢复、messages 归属 |
| `Message` | `ThreadItem` / UI transcript item | user/assistant message，有 status |
| `MessageStatus` | turn/message lifecycle state | `PENDING`、`STREAMING`、`COMPLETED`、`FAILED`、`ABORTED` |
| `SeoChatRequest` | `turn/start` params 的极简版 | `conversationId`、`message`、`model` |
| `ChatStreamEvent` | `EventMsg` 极简版 | `start/delta/done/error/aborted` |
| `SeoController.chatStream()` | app-server 协议门面的极简版 | HTTP NDJSON、close -> abort |
| `SeoService.chatStream()` | `run_turn` 极简版 | 保存 user、加载 history、创建 assistant 占位、stream 模型、更新最终状态 |
| `LLMService.chatStream()` | `ModelClientSession::stream` 的业务门面 | 屏蔽 SDK 原始 chunk，只 yield text delta |
| `OpenAICompatibleClient.chatStream()` | model provider adapter | OpenAI-compatible stream 适配、错误转换 |
| `useSeoWorkspace.sendMessage()` | UI event consumer | 消费 stream event、更新本地 message、隔离 active conversation |

## 3. 当前缺少的 Agent Runtime 能力

### 3.1 缺少显式 Turn

现在 `assistantMessageId` 事实上承担了 turn anchor，但它不够表达后续工具调用。

后续 tool calling 会出现：

```txt
user message
assistant tool call
tool observation
assistant final message
```

这些都应该归属于同一个 `turnId`。

建议：

- 短期可不建 `AgentTurn` 表，但 stream event 先增加 `turnId`。
- 中期考虑 `AgentTurn` 表记录 `conversationId`、`status`、`startedAt`、`completedAt`、`abortReason`。

### 3.2 缺少内部 RuntimeEvent

当前 `ChatStreamEvent` 直接作为后端业务 event 和前端协议 event。随着工具、审批、observation 加入，它会变得混乱。

建议内部拆分：

```txt
AgentRuntimeEvent
  -> ChatStreamEvent
```

内部 event 可以更接近 runtime：

- `turn.started`
- `message.created`
- `message.delta`
- `message.completed`
- `turn.failed`
- `turn.aborted`
- `tool.call_started`
- `tool.call_completed`
- `approval.required`

外部 NDJSON 可以保持兼容，只做映射。

### 3.3 缺少 ContextBuilder

当前 context 构造分散在 `SeoService.chatStream()`：

```ts
const historyMessages = await this.listRecentChatMessages(input.conversationId)
const llmMessages = buildSeoAgentChatMessages(
  historyMessages.map(message => this.toLlmMessage(message)),
)
```

它能跑通阶段 2/3，但进入工具后会不够：

- tool observation 不一定是普通 assistant message。
- failed/aborted message 是否进入上下文要有规则。
- 当前用户输入必须进入上下文。
- 长历史要有预算。

建议新增 `SeoContextBuilder`：

```txt
DB messages
  -> filter by status
  -> map to ModelMessage
  -> add system prompt
  -> enforce history budget
```

### 3.4 缺少 ToolDefinition / ToolExecutor / ToolRegistry

当前还没有 tool calling。不要一步到 MCP 或插件系统，先做最小三件套。

建议：

```ts
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: unknown
  riskLevel: 'low' | 'medium' | 'high'
}

export interface ToolExecutionContext {
  conversationId: string
  turnId: string
}

export interface ToolExecutor<TInput = unknown, TOutput = unknown> {
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>
}

export class ToolRegistry {
  constructor(private readonly tools: RegisteredTool[]) {}

  listDefinitions(): ToolDefinition[] {
    return this.tools.map(tool => tool.definition)
  }

  getExecutor(name: string): ToolExecutor | undefined {
    return this.tools.find(tool => tool.definition.name === name)?.executor
  }
}
```

### 3.5 缺少 human-in-the-loop

Codex 的 approval 很复杂，但你当前只需要最小版：

```txt
模型请求 tool
  -> 后端识别 riskLevel
  -> low 自动执行
  -> medium 发 approval_required event
  -> 前端显示确认
  -> 用户确认 / 拒绝
  -> 后端继续或给模型拒绝 observation
```

不要现在做：

- execpolicy DSL。
- OS sandbox。
- Guardian reviewer。
- session-wide approval cache。

## 4. 下一步如何收口 streaming、aborted 持久化、多会话不串线

### 4.1 Streaming 收口原则

当前 `ChatStreamEvent`：

```ts
type ChatStreamEvent =
  | ChatStreamStartEvent
  | ChatStreamDeltaEvent
  | ChatStreamDoneEvent
  | ChatStreamErrorEvent
  | ChatStreamAbortedEvent
```

这是正确的第一版。下一步不要增加协议种类，继续使用 NDJSON。

建议增强：

- 所有 event 增加 `turnId`。
- `start` event 明确 `createdAt`。
- `error` event 明确是否已写入 assistant message。
- `aborted` event 明确 `reason`，例如 `client_closed`、`user_stopped`。

### 4.2 Aborted 持久化

当前 `SeoService.chatStream()` 在 catch 中判断：

```ts
if (assistantMessage && options.signal?.aborted) {
  await this.updateMessageAndTouchConversation(
    assistantMessage.id,
    input.conversationId,
    content,
    MessageStatus.ABORTED,
  )
  yield { type: 'aborted', ... }
}
```

这个方向对，但要验证几个边界：

- 用户在 `start` 之前停止：可能还没有 `assistantMessage`。
- 用户在 delta 后停止：要保留 partial content。
- HTTP 连接断开后，`aborted` event 可能无法送达前端，但数据库仍要落 `ABORTED`。
- 模型 SDK 抛出的 abort error 会被 `OpenAICompatibleClient.toLLMError()` 转为 `LLMNetworkError`，上层要以 `options.signal.aborted` 为准。

建议验收：

```txt
停止按钮点击
  -> fetch abort
  -> controller close signal
  -> llm stream abort
  -> assistant message ABORTED
  -> refresh restore aborted content
```

### 4.3 多会话不串线

当前 `useSeoWorkspace` 已经做了几个关键保护：

- `activeStreamRequestId`
- `activeStreamConversationId`
- `activeStreamAssistantMessageId`
- event.conversationId 校验
- `conversationMessagesCache`
- `messageLoadRunId`

建议继续保持：

```txt
event 写入 UI 前必须校验 conversationId
event 更新 active stream 前必须校验 streamRequestId
message cache 更新必须按 conversationId 分桶
```

后续加 `turnId` 后：

```txt
conversationId + turnId + assistantMessageId
```

共同防串线。

## 5. Tool Calling 最小闭环设计

### 5.1 第一版链路

```txt
用户输入
  -> 保存 user message
  -> 构建 model messages + tool definitions
  -> 模型返回 tool call
  -> 后端解析 tool name / arguments
  -> ToolRegistry 查 executor
  -> 执行工具
  -> 生成 tool observation
  -> observation 加入 model messages
  -> 再请求模型
  -> 保存 assistant final message
  -> stream done
```

### 5.2 工具目录建议

```txt
apps/api/src/agent-tools
  ├── tool-definition.ts
  ├── tool-executor.ts
  ├── tool-registry.ts
  ├── seo-tools.module.ts
  └── tools
      ├── score-meta-description.tool.ts
      ├── extract-keywords.tool.ts
      └── analyze-title.tool.ts
```

### 5.3 事件建议

内部 runtime event：

```ts
type AgentRuntimeEvent =
  | { type: 'turn.started'; conversationId: string; turnId: string }
  | { type: 'message.delta'; conversationId: string; turnId: string; messageId: string; delta: string }
  | { type: 'tool.call_started'; conversationId: string; turnId: string; toolCallId: string; toolName: string }
  | { type: 'tool.call_completed'; conversationId: string; turnId: string; toolCallId: string; observation: unknown }
  | { type: 'approval.required'; conversationId: string; turnId: string; toolCallId: string; toolName: string; riskLevel: string }
  | { type: 'turn.completed'; conversationId: string; turnId: string; messageId: string }
  | { type: 'turn.failed'; conversationId: string; turnId: string; message?: string }
  | { type: 'turn.aborted'; conversationId: string; turnId: string; reason: string }
```

外部 `ChatStreamEvent` 可以先追加：

- `tool_start`
- `tool_done`
- `approval_required`

### 5.4 第一批工具选择

优先选择纯函数、只读、无副作用工具：

| 工具 | 输入 | 输出 | 风险 |
| --- | --- | --- | --- |
| `score_meta_description` | meta description 文本、目标关键词 | 长度、关键词覆盖、点击吸引力评分、建议 | low |
| `analyze_title_tag` | title 文本、目标关键词 | 长度、关键词位置、重复风险、建议 | low |
| `extract_seo_keywords` | 页面正文或用户描述 | 候选关键词、搜索意图分类 | low |

不要第一版做：

- 真实爬取网页。
- 写入站点 CMS。
- 运行 shell。
- 自动修改线上页面。

## 6. Human-in-the-loop 最小设计

### 6.1 风险分级

```txt
low
  自动执行，只需要 stream tool progress

medium
  需要用户确认

high
  当前直接拒绝或标记暂不支持
```

### 6.2 审批事件

```ts
interface ApprovalRequiredEvent {
  type: 'approval_required'
  conversationId: string
  turnId: string
  toolCallId: string
  toolName: string
  riskLevel: 'medium' | 'high'
  summary: string
}
```

### 6.3 后端状态

第一版可以把 pending approval 放内存，理由是学习阶段最小可运行：

```txt
Map<turnId, PendingApproval>
```

但要明确限制：

- 服务重启后 pending approval 丢失。
- 页面刷新后当前等待态可能丢失。
- 后续可改成 DB 持久化。

### 6.4 用户拒绝时的 observation

不要只终止 turn。更好的学习闭环是给模型一个 observation：

```txt
用户拒绝执行工具：<toolName>。请在不使用该工具的前提下继续回答，或说明需要用户提供哪些信息。
```

这样用户能看到 Agent 如何降级处理。

## 7. UI message、model message、runtime event、tool observation 的区分

### UI message

面向用户展示，结构类似当前：

```ts
interface ConversationMessage {
  id: string
  conversationId: string
  role: 'USER' | 'ASSISTANT'
  content: string
  status: MessageStatus
}
```

它适合展示，但不适合完整表达 tool calling。

### Model message

面向模型请求：

```ts
type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }
```

它要保证 tool call 和 observation 配对。

### Runtime event

面向过程：

```txt
turn.started
message.delta
tool.call_started
approval.required
turn.completed
turn.aborted
```

它不一定持久化。

### Tool observation

面向模型的工具结果：

```ts
interface ToolObservation {
  toolCallId: string
  toolName: string
  output: unknown
  isError?: boolean
}
```

它可能被持久化为调试记录，但不一定直接展示为普通 assistant message。

## 8. 哪些 Codex 设计现在值得学

值得学：

- 多入口共享 runtime。
- Controller/API 只做协议门面。
- `Thread` / `Turn` 生命周期。
- streaming event 而不是同步返回。
- Tool spec 和 runtime 分离。
- runtime event 和 persistent message 分离。
- model history 不等于 UI transcript。
- 不保存所有 delta。
- SDK 复用 runtime。

## 9. 哪些 Codex 设计现在不该学

暂时不学：

- OS sandbox。
- execpolicy DSL。
- shell-escalation。
- MCP 完整协议。
- plugin marketplace。
- 多 Agent。
- remote compaction。
- realtime audio。
- Guardian reviewer。

原因：这些设计解决的是代码 Agent、企业权限、多工具生态或超长复杂任务的问题。你的当前主线是把 AI SEO Agent 的单 Agent chat runtime 打稳。

## 10. 推荐执行顺序

```txt
1. 阶段 3 收口
   - aborted 持久化
   - 多会话不串线
   - error / failed 状态

2. 抽轻量 runtime 边界
   - AgentRuntimeService
   - SeoContextBuilder
   - RuntimeEvent

3. 加 turnId
   - event 全链路携带
   - 前端按 turn 防串线

4. 做第一个只读工具
   - ToolDefinition
   - ToolExecutor
   - ToolRegistry
   - observation follow-up

5. 做 human-in-the-loop
   - approval_required
   - 用户确认/拒绝
   - 拒绝 observation

6. 再升级 context
   - token/字符预算
   - failed/aborted/tool observation 过滤规则
   - 可选 summary
```
