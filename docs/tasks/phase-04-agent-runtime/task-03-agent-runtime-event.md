# Task 04-03：定义内部 AgentRuntimeEvent 并映射到 ChatStreamEvent

## 目标

把 `AgentRuntimeService.runTurnStream()` 的内部运行时事件和前端 NDJSON 协议解耦。

本任务的目标是让 Runtime 产出内部 `AgentRuntimeEvent`，再由 SEO 层映射成当前前端使用的 `ChatStreamEvent`。

这一步不是为了新增 UI 功能，而是为后续 Tool Calling、Approval、Runtime timeline 做边界准备。

## 背景

Task 04-02 已经把 stream turn 主编排抽到：

```txt
apps/api/src/agent-runtime/agent-runtime.service.ts
```

但当前 `AgentRuntimeService.runTurnStream()` 仍然直接 yield `ChatStreamEvent`。

这会导致两个问题：

```txt
Agent Runtime 仍然依赖前端 stream 协议
未来 tool / approval / step event 很难表达为现有 ChatStreamEvent
```

当前前端协议是：

```txt
start
delta
done
error
aborted
```

后续 Runtime 内部还需要表达：

```txt
run_started
step_started
step_completed
tool_call_requested
tool_call_completed
approval_required
approval_resolved
```

因此需要先建立内部事件层。

## 范围

- 定义内部 `AgentRuntimeEvent` 类型。
- 修改 `AgentRuntimeService.runTurnStream()`，让它 yield `AgentRuntimeEvent`。
- 新增一个 mapper，把 `AgentRuntimeEvent` 映射成当前 `ChatStreamEvent`。
- 保持 `SeoController` 和前端收到的 NDJSON event 不变。
- 保持 `AgentRun` / `AgentStep` 数据库行为不变。

## 不做什么

- 不改前端代码。
- 不改 `packages/contracts/src/seo.ts`。
- 不把 `runId` 暴露给前端。
- 不做 Tool Calling。
- 不做 Approval。
- 不做 AgentStep 前端时间线 UI。
- 不改 Prisma schema。
- 不新增 migration。
- 不重构非 stream 的 `SeoService.chat()`。

## 推荐目录结构

```txt
apps/api/src/agent-runtime/
  agent-runtime.module.ts
  agent-runtime.service.ts
  agent-runtime.types.ts
  agent-run-recorder.service.ts

apps/api/src/seo/
  seo.service.ts
  seo-chat-stream-event.mapper.ts
```

职责划分：

| 文件 | 职责 |
| --- | --- |
| `agent-runtime.types.ts` | 定义 `RunTurnStreamInput` 和 `AgentRuntimeEvent` |
| `agent-runtime.service.ts` | 产出内部 `AgentRuntimeEvent`，不再 import `@agent/contracts` |
| `seo-chat-stream-event.mapper.ts` | 把内部 runtime event 映射为 `ChatStreamEvent` |
| `seo.service.ts` | 调用 runtime，并将 runtime event 映射后 yield 给 controller |

## 建议事件类型

第一版只覆盖当前已有 stream 能力，不提前实现 tool/approval：

```ts
export type AgentRuntimeEvent
  = | AgentRuntimeRunStartedEvent
    | AgentRuntimeAssistantDeltaEvent
    | AgentRuntimeRunCompletedEvent
    | AgentRuntimeRunFailedEvent
    | AgentRuntimeRunAbortedEvent

export interface AgentRuntimeRunStartedEvent {
  type: 'run_started'
  runId: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string
}

export interface AgentRuntimeAssistantDeltaEvent {
  type: 'assistant_delta'
  runId: string
  conversationId: string
  assistantMessageId: string
  contentDelta: string
}

export interface AgentRuntimeRunCompletedEvent {
  type: 'run_completed'
  runId: string
  conversationId: string
  assistantMessageId: string
  content: string
  generatedAt: string
}

export interface AgentRuntimeRunFailedEvent {
  type: 'run_failed'
  runId?: string
  conversationId: string
  assistantMessageId?: string
  message: string
}

export interface AgentRuntimeRunAbortedEvent {
  type: 'run_aborted'
  runId?: string
  conversationId: string
  assistantMessageId: string
  content: string
}
```

命名可以根据实现微调，但必须保持两点：

- Runtime 内部事件不使用 `start/delta/done/error/aborted` 这些前端协议名。
- Runtime 内部事件可以携带 `runId`，但 mapper 暂时不把 `runId` 发给前端。

## 映射规则

新增 mapper，例如：

```ts
export function toChatStreamEvent(event: AgentRuntimeEvent): ChatStreamEvent {
  switch (event.type) {
    case 'run_started':
      return {
        type: 'start',
        conversationId: event.conversationId,
        userMessageId: event.userMessageId,
        assistantMessageId: event.assistantMessageId,
      }

    case 'assistant_delta':
      return {
        type: 'delta',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        contentDelta: event.contentDelta,
      }

    case 'run_completed':
      return {
        type: 'done',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        content: event.content,
        generatedAt: event.generatedAt,
      }

    case 'run_failed':
      return {
        type: 'error',
        conversationId: event.conversationId,
        ...(event.assistantMessageId ? { assistantMessageId: event.assistantMessageId } : {}),
        message: event.message,
      }

    case 'run_aborted':
      return {
        type: 'aborted',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        content: event.content,
      }
  }
}
```

## Red：先定义失败用例

实现前先确认当前问题：

- [ ] `AgentRuntimeService` 直接 import `ChatStreamEvent`。
- [ ] `runTurnStream()` 直接产出前端协议事件。
- [ ] Runtime 内部没有独立事件类型承载未来 tool/approval/step event。
- [ ] SEO 层没有明确的 runtime event -> chat stream event 映射边界。

## Green：最小实现

### 1. 类型定义

- [ ] 在 `agent-runtime.types.ts` 中新增 `AgentRuntimeEvent` union。
- [ ] 新增 `run_started` event。
- [ ] 新增 `assistant_delta` event。
- [ ] 新增 `run_completed` event。
- [ ] 新增 `run_failed` event。
- [ ] 新增 `run_aborted` event。
- [ ] `RunTurnStreamInput` 保持在同一文件中。

### 2. Runtime 改造

- [ ] `AgentRuntimeService` 不再 import `ChatStreamEvent`。
- [ ] `runTurnStream()` 返回 `AsyncGenerator<AgentRuntimeEvent>`。
- [ ] 原本 yield `start` 的位置改为 yield `run_started`。
- [ ] 原本 yield `delta` 的位置改为 yield `assistant_delta`。
- [ ] 原本 yield `done` 的位置改为 yield `run_completed`。
- [ ] 原本 yield `error` 的位置改为 yield `run_failed`。
- [ ] 原本 yield `aborted` 的位置改为 yield `run_aborted`。
- [ ] run/step/message 状态收口逻辑保持不变。

### 3. SEO 映射层

- [ ] 新增 `apps/api/src/seo/seo-chat-stream-event.mapper.ts`。
- [ ] 实现 `toChatStreamEvent(event: AgentRuntimeEvent): ChatStreamEvent`。
- [ ] `SeoService.chatStream()` 内部消费 `AgentRuntimeEvent`，yield 映射后的 `ChatStreamEvent`。
- [ ] `SeoController` 不需要修改。

## Refactor：边界要求

- [ ] `agent-runtime` 目录不依赖 `@agent/contracts` 的 `ChatStreamEvent`。
- [ ] `agent-runtime` 目录不依赖 `seo/prompts`。
- [ ] `SeoService` 继续是 SEO agent 的 API service。
- [ ] mapper 是纯函数，不访问数据库，不调用 LLM。
- [ ] 前端收到的 NDJSON 字段完全不变。

## 验证命令

```bash
pnpm --filter @agent/api typecheck
pnpm typecheck
pnpm lint
git diff --check
```

## 手动验收路径

1. 创建或进入一个 conversation。
2. 发送普通 stream chat，确认前端仍然收到：
   - `start`
   - `delta`
   - `done`
3. 查询数据库，确认 `AgentRun` 和 4 个基础 `AgentStep` 行为不变。
4. 点击停止生成，确认前端仍然收到 `aborted`。
5. 制造模型错误，确认前端仍然收到 `error`。

## 验收标准

- [ ] `AgentRuntimeService.runTurnStream()` 返回内部 `AgentRuntimeEvent`。
- [ ] `AgentRuntimeService` 不再直接产出 `ChatStreamEvent`。
- [ ] `SeoService.chatStream()` 仍返回 `AsyncGenerator<ChatStreamEvent>`。
- [ ] 当前前端 stream 行为不变。
- [ ] 当前 run/step 落库行为不变。
- [ ] `typecheck`、`lint` 通过。

## 完成状态

状态：待实现。
