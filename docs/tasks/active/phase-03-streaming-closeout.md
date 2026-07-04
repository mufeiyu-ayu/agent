# 阶段 3 收口：Streaming Chat 最终态一致性

## 目标

把阶段 3 从“基础链路可用”收口到“完成、失败、中断都能稳定落库和恢复”。

这不是新增功能任务，而是进入 Agent Runtime 前的稳定性门槛。

## 背景

当前项目已经接入：

- 后端 `POST /api/seo/chat/stream` NDJSON stream。
- 前端 `streamChatWithSeoAgent()`。
- `start / delta / done / error / aborted` 事件。
- 前端停止生成基础链路。

但在进入阶段 4 前，必须确认不会残留 `STREAMING`，否则后续 `AgentRun` / `AgentStep` 会建立在不稳定状态上。

## 范围

- `SeoController.chatStream()` 的 close / abort 处理。
- `SeoService.chatStream()` 的 `COMPLETED / FAILED / ABORTED` 状态落库。
- 前端停止生成后的本地状态和刷新恢复。
- 多会话切换时 stream event 防串线。

## 不做什么

- 不做 Tool Calling。
- 不做 AgentStep UI。
- 不做确认按钮。
- 不引入 WebSocket。
- 不重构完整 Runtime。

## Red：先定义失败用例

- [x] 用户点击停止生成后，数据库里 assistant message 不应残留 `STREAMING`。
- [x] 模型调用失败后，assistant message 应为 `FAILED`。
- [x] 正常完成后，assistant message 应为 `COMPLETED`。
- [x] A 会话生成中切到 B，会话内容不能串。
- [x] 刷新页面后，完成、失败、中断状态都能恢复展示。

## Green：最小实现

- [x] 确认 HTTP close 会触发 `AbortController.abort()`。
- [x] 确认 LLM SDK 调用收到 `AbortSignal`。
- [x] 在 catch/finally 中按 signal 和错误类型写入最终状态。
- [x] 保留 aborted 时已经生成的 partial content。
- [x] 前端只把 event 写入对应 `conversationId` 的消息缓存。

## Refactor：整理边界

- [x] 把状态判断收敛成清晰的小函数，避免多处判断 `signal.aborted`。
- [x] 保持 `SeoService.chatStream()` 行为稳定，为阶段 4 抽 runtime 做准备。

## 验证命令

```bash
pnpm typecheck
pnpm lint
```

如果改动 Prisma 或 contracts：

```bash
pnpm prisma:generate
pnpm exec prisma validate
```

## 验收标准

- [x] 正常生成：最终状态是 `COMPLETED`。
- [x] 模型错误：最终状态是 `FAILED`。
- [x] 用户停止：最终状态是 `ABORTED`。
- [x] 不存在永久停留在 `STREAMING` 的 assistant message。
- [x] 多会话切换不会串消息。
- [x] 刷新页面后能恢复最终状态。

## 完成状态

状态：已完成。
