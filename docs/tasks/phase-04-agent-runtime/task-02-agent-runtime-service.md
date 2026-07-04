# Task 04-02：抽出 AgentRuntimeService.runTurnStream()

## 目标

把当前集中在 `SeoService.chatStream()` 内的 stream turn 编排，抽到 `AgentRuntimeService.runTurnStream()`。

本任务的目标是整理运行时边界，不改变 UI 行为，也不引入 Tool Calling。

## 背景

Task 04-01 已经完成：

```txt
Conversation / Message
AgentRun / AgentStep
AgentRunRecorderService
```

但当前 `SeoService.chatStream()` 同时负责：

- 校验 conversation。
- 保存 user message。
- 加载 history。
- 构造 LLM messages。
- 创建 assistant message。
- 调用 LLM stream。
- 写 NDJSON event。
- 更新 Message 最终状态。
- 更新 AgentRun / AgentStep 状态。

这说明 Runtime 概念已经出现，但编排边界还没独立出来。

## 范围

- 新增 `AgentRuntimeService`。
- 新增 `runTurnStream()` 方法。
- 将 stream chat 的通用运行时编排从 `SeoService.chatStream()` 中迁出。
- 保留现有 `AgentRunRecorderService`，它只负责 run/step 持久化记录。
- `SeoService.chatStream()` 保持为 SEO agent 的入口，负责传入 SEO prompt/context 构造逻辑。
- 返回给前端的 `ChatStreamEvent` 行为保持不变。

## 不做什么

- 不接 UI。
- 不改变 `ChatStreamEvent` 协议。
- 不做 Tool Calling。
- 不做确认按钮。
- 不做内部 `AgentRuntimeEvent` 抽象；这是 Task 04-03。
- 不抽 `SeoContextBuilder`；这是 Task 04-04。
- 不做 workflow engine。

## 建议接口方向

第一版可以让 runtime 接收一个 model messages 构造函数，避免把 SEO prompt 写死进 runtime：

```ts
interface RunTurnStreamInput {
  conversationId: string
  userContent: string
  model?: string
  signal?: AbortSignal
  historyLimit: number
  buildModelMessages: (historyMessages: ChatMessage[]) => ChatMessage[]
}
```

`SeoService.chatStream()` 只做薄封装：

```ts
return this.agentRuntimeService.runTurnStream({
  conversationId: input.conversationId,
  userContent: input.message,
  model: input.model,
  signal: options.signal,
  historyLimit: CHAT_HISTORY_LIMIT,
  buildModelMessages: buildSeoAgentChatMessages,
})
```

最终接口以实际代码为准，但必须保持：

- Runtime 不依赖 SEO 专用 prompt。
- Runtime 不依赖前端组件。
- Runtime 可以继续产出当前 `ChatStreamEvent`。

## Red：先定义失败用例

实现前先确认当前问题：

- [ ] `SeoService.chatStream()` 同时包含业务入口和 runtime 编排。
- [ ] run/step 状态切换散落在 SEO service 里。
- [ ] 后续 Tool Calling 如果直接加进 `SeoService`，会让该 service 继续膨胀。
- [ ] 当前没有一个明确的 `runTurnStream()` 边界来承载未来 tool loop / approval / runtime event。

## Green：最小实现

### 1. Service 边界

- [ ] 新增 `AgentRuntimeService`。
- [ ] 在 `AgentRuntimeModule` 中注册并导出 `AgentRuntimeService`。
- [ ] `AgentRuntimeService` 依赖：
  - `PrismaService`
  - `LLMService`
  - `AgentRunRecorderService`
- [ ] `SeoService` 注入 `AgentRuntimeService`。

### 2. 迁移 stream 编排

- [ ] `runTurnStream()` 内部负责创建 user message。
- [ ] `runTurnStream()` 内部负责创建 assistant streaming message。
- [ ] `runTurnStream()` 内部负责加载 history。
- [ ] `runTurnStream()` 内部负责调用 `LLMService.chatStream()`。
- [ ] `runTurnStream()` 内部负责 done/error/aborted 的 message 和 run/step 收口。
- [ ] `SeoService.chatStream()` 只传入 SEO 相关参数和 model messages 构造函数。

### 3. 行为保持

- [ ] 前端收到的 `start/delta/done/error/aborted` event 字段不变。
- [ ] `assistantMessage.status` 最终态不变。
- [ ] `AgentRun.status` 最终态不变。
- [ ] `AgentStep` 四个基础 step 仍按 Task 04-01 规则记录。

## Refactor：整理边界

- [ ] `AgentRunRecorderService` 只做持久化记录，不承载 LLM 调用。
- [ ] `AgentRuntimeService` 承载一次 turn 的执行编排。
- [ ] `SeoService` 承载 SEO agent 入口和 prompt/context 注入。
- [ ] 不把 SEO 专用逻辑写进 `agent-runtime` 目录。

## 验证命令

```bash
pnpm --filter @agent/api typecheck
pnpm typecheck
pnpm lint
```

如果本任务改动 Prisma 以外文件，不需要新 migration。

## 手动验收路径

1. 创建或进入一个 conversation。
2. 发送普通 stream chat，确认前端流式输出正常。
3. 查询数据库，确认生成 1 条 `AgentRun` 和 4 条基础 `AgentStep`。
4. 点击停止生成，确认 assistant message 和 run 都是 `ABORTED`。
5. 制造模型错误，确认 assistant message 和 run 都是 `FAILED`。

## 验收标准

- [ ] `SeoService.chatStream()` 明显变薄。
- [ ] `AgentRuntimeService.runTurnStream()` 成为一次 stream turn 的主编排入口。
- [ ] 当前 UI 行为不变。
- [ ] 当前数据库 run/step 行为不变。
- [ ] `typecheck`、`lint` 通过。

## 完成状态

状态：待实现。
