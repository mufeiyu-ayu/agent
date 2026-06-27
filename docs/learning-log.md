# Agent 学习路线
| 阶段 | 状态 | 关键结论 |
| --- | --- | --- |
| 基础调用 | 已完成 | 练过模型调用、messages、LLMService、JSON Output、错误恢复、事件级 streaming |
| 第一阶段 | 已完成 | 固定字段 SEO 生成器更像表单工具，不适合作为下一阶段主线 |
| 当前学习 | 进行中 | 自然语言 SEO Agent：system prompt、普通 chat messages、Session Chat、受控 history、Streaming Runtime |
| Session Chat | 已完成 | `conversationId` 是多轮对话上下文边界；真实 chat 入口先保存 USER message，再读取当前 conversation 最近 messages 组装 LLM messages，最后保存 ASSISTANT message |
| Memory Layer | 已建立 | 阶段 2 把 `DB / Storage = 数据源` 落到工程里：前端只展示 active conversation 的 messages，后端负责按 session 构建上下文，避免 UI state 充当历史来源 |
| 下一步 | 准备做 | 阶段 3：把 LLMService 的模型侧 stream 接入后端业务流事件，再让前端逐 chunk 渲染 |
| 记录规则 | 持续遵守 | 只记录 Agent 概念学习；普通项目进度写 `docs/work-log.md` |

## 学习记录

| 日期 | 阶段 | 本次学习 | Agent 关键概念 | 练习入口 / 材料 | 理解验证 | 复盘 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-27 | Streaming Runtime | 在 `LLMService` 下沉 OpenAI SDK 适配层，新增 `chatStream()` 并只向上层 yield 文本 delta | OpenAI-compatible Chat Completions、SDK streaming chunk、AsyncGenerator、AbortSignal、LLM 错误边界、适配层封装 | `apps/api/src/llm/llm.service.ts`、`apps/api/src/llm/clients/openai-compatible.client.ts`、`apps/api/src/llm/llm.errors.ts` | `pnpm --filter @agent/api typecheck`、`pnpm --filter @agent/api lint`、`pnpm typecheck`、`pnpm lint` 通过 | LLMService 应只暴露本项目自己的消息和文本 delta；SDK chunk、HTTP 错误映射、超时和 baseURL 配置都应留在模型适配层 | 在 `SeoService` 中把 `chatStream()` 包装成 `start / delta / done / error / aborted` 业务事件 |
