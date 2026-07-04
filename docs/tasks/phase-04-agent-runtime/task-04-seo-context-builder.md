# Task 4：抽出 SeoContextBuilder

## 目标

新增 `SeoContextBuilder`，让 SEO Agent 的 model messages 构造从 `SeoService` 中独立出来。第一版只包装现有 `buildSeoAgentChatMessages()`，不改变当前 stream 行为。

## 背景

阶段 4 已经抽出了 `AgentRuntimeService.runTurnStream()` 和内部 `AgentRuntimeEvent`。但 `SeoService.chatStream()` 仍直接传入 `buildSeoAgentChatMessages`，这会让后续页面数据、关键词、工具结果、SEO 分析上下文继续堆进应用服务层。

## 范围

- 新增 `apps/api/src/seo/seo-context-builder.service.ts`。
- 在 `SeoModule` 注册 `SeoContextBuilder`。
- 让 `SeoService` 通过 `SeoContextBuilder` 构造 SEO Agent model messages。
- 同步阶段 4 任务文档、路线图和工作记录。

## 不做什么

- 不做 Tool Calling。
- 不改 UI。
- 不改前端协议。
- 不改 `ChatStreamEvent`。
- 不改 Prisma schema，不新增 migration。
- 不新增 `AgentRun` / `AgentStep` 字段。
- 不改变当前 stream 行为。
- 不把 SEO prompt 放进 `AgentRuntimeService`。
- 不让 `agent-runtime` 目录依赖 `seo` 目录。

## Red：先定义失败用例

- [x] `SeoService.chatStream()` 直接依赖 `buildSeoAgentChatMessages`，SEO 上下文构造没有独立边界。
- [x] 后续 SEO 上下文扩展会污染 `SeoService` 或 `AgentRuntimeService`。
- [x] 阶段 4 缺少 Task 4 TDD 文档和对应看板状态。

## Green：最小实现

- [x] 新增 `SeoContextBuilder`，提供 `buildModelMessages()`。
- [x] `SeoContextBuilder` 第一版只包装现有 `buildSeoAgentChatMessages()`。
- [x] `SeoModule` 注册 `SeoContextBuilder`。
- [x] `SeoService.chatStream()` 通过 `SeoContextBuilder` 传入 `buildModelMessages`。
- [x] `SeoService.chat()` 同步复用 `SeoContextBuilder`，避免非 stream 入口继续直接依赖 prompt 构造函数。

## Refactor：整理边界

- [x] `AgentRuntimeService` 继续只接收 `buildModelMessages: (historyMessages) => ChatMessage[]`。
- [x] `AgentRuntimeService` 不 import SEO prompt、SEO builder、SEO service。
- [x] `SeoService` 保持 SEO chat 应用服务职责，只连接 API 与 runtime。
- [x] 本任务不改 contracts、前端、Prisma schema。

## 验证命令

```bash
pnpm --filter @agent/api typecheck
pnpm typecheck
pnpm lint
git diff --check
```

## 验收标准

- [x] `SeoContextBuilder` 存在并由 `SeoModule` 注册。
- [x] `SeoService.chatStream()` 不再直接依赖 `buildSeoAgentChatMessages`。
- [x] `AgentRuntimeService` 不依赖 SEO 目录。
- [x] 当前 stream 输出协议不变。
- [x] 当前 `AgentRun` / `AgentStep` 落库行为不变。
- [x] 没有 Prisma migration。
- [x] 没有前端改动。
- [x] `typecheck`、`lint`、`git diff --check` 通过。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 抽 builder 时误改 stream 协议 | 只移动 model messages 构造入口，不改 mapper 和 contracts |
| runtime 反向依赖 SEO | 保持依赖方向为 `SeoService -> SeoContextBuilder -> prompt` 与 `SeoService -> AgentRuntimeService` |
| 非 stream chat 与 stream chat 上下文不一致 | 两个入口都复用 `SeoContextBuilder` |

## 完成状态

状态：已完成。

验证结果：

- `pnpm --filter @agent/api typecheck` 通过。
- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `git diff --check` 通过。
