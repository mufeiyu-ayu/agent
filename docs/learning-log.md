# Agent 应用开发学习日志

这份日志只记录 Agent 应用开发相关的学习过程。重点写清楚：学到了哪个 Agent 概念、这个概念如何通过最小练习验证、下一步要练什么。

普通项目进度、默认工程搭建、UI 调整、依赖安装、提交记录和非 Agent 相关代码改动不写入本文件；这些内容应记录到 `docs/work-log.md`。

## 学习路线看板

| 顺序 | 阶段 | 状态 | 成功标准 |
| --- | --- | --- | --- |
| 1 | DeepSeek / OpenAI-compatible API 基础调用 | 已完成 | 能通过 TypeScript 调用模型并拿到非流式回复 |
| 2 | `messages`、`model`、`stream`、`system prompt`、`user prompt` | 已完成 | 能解释多轮对话上下文如何通过 `messages` 维护 |
| 3 | 基础 `LLMService` 封装 | 已完成 | 模型调用入口清晰，可复用，可替换配置 |
| 4 | 最小 AI SEO 助手接口 | 准备中 | 能通过一个接口输入页面主题并返回 SEO 建议 |
| 5 | JSON Output | 进行中 | 能让模型稳定返回结构化 JSON，并在代码层校验 |
| 6 | 流式输出 | 进行中 | 能理解并实现 token 级或 chunk 级响应 |
| 7 | Tool Calling | 进行中 | 能区分模型决策、后端执行工具、工具结果回传模型 |
| 8 | 完整 Agent 流程 | 未开始 | 能串起规划、工具、状态、错误恢复和人工确认 |

## 日志记录

| 日期 | 阶段 | 本次学习 | Agent 关键概念 | 练习入口 / 材料 | 理解验证 | 复盘 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-25 | 基础模型调用 | 使用 OpenAI SDK 通过 DeepSeek OpenAI-compatible API 发起非流式 chat completion 请求。 | `model`、`messages`、`system prompt`、`user prompt`、API Key 环境变量 | `src/services/deepseek-chat.ts`、`src/Index.ts` | `pnpm typecheck` 通过，`pnpm lint` 通过。 | 先跑通最小闭环是正确节奏，当前不需要引入 Agent 框架。 | 继续把模型调用整理成更稳定的 `LLMService`。 |
| 2026-05-25 | 多轮上下文 | 将模型回复追加为 `assistant` message，并用第二轮用户问题验证上下文延续。 | 多轮对话上下文、`assistant` message、上下文累积 | `src/utils/messages.ts`、`src/Index.ts` | `pnpm typecheck` 通过，`pnpm lint` 通过。 | `messages` 可以先理解为一份对话状态数组，模型本身不记忆历史，历史要由调用方传回去。 | 下一步学习封装层职责：入口示例、LLM 调用、上下文工具应继续拆清。 |
| 2026-05-26 | JSON Output | 按 DeepSeek JSON Output 思路，将 SEO 示例改为通过中文 `system prompt` 规定 json 输出格式，并在请求参数中加入 `response_format: { type: 'json_object' }`，再把模型返回的 `content` 解析为业务对象。 | JSON Output、输出格式约束、`response_format`、`JSON.parse`、TypeScript 类型与运行时校验边界 | `src/Index.ts`、`src/services/deepseek-chat.ts`、`src/types/seo.ts`、`src/utils/json-output.ts` | `pnpm typecheck` 通过；此前 `pnpm dev` 已验证可返回合法 JSON 并解析成对象。 | `prompt` 负责描述目标字段，`response_format` 负责约束 JSON 语法，TypeScript 类型不能替代运行时字段校验。 | 补充 `title` / `description` 的运行时校验，再决定是否封装成最小 AI SEO 助手接口。 |
| 2026-05-27 | Tool Calling | 按 DeepSeek 官方 demo 改写 Tool Calls 示例：定义 `get_weather` 工具，第一次请求让模型返回 `tool_calls`，追加 assistant tool call 与 `role: tool` 的工具结果后，再请求模型生成最终回答。 | Tool Calls、`tools`、`tool_calls`、`tool_call_id`、`role: tool`、模型决策与代码执行分离 | `src/Index.ts`、`src/services/deepseek-chat.ts`、`src/tools/weather.ts` | `pnpm typecheck` 通过；`pnpm dev` 已验证官方 demo 风格流程可输出杭州天气最终回答。 | 官方示例的目的不是查天气，而是演示“模型提出工具调用，代码提供工具结果，模型再生成最终回复”的协议闭环。 | 下一步把写死的 `24℃` 替换为本地函数执行，并加入 tool arguments 的解析与运行时校验。 |
| 2026-05-27 | 流式输出 | 将入口示例改为 DeepSeek streaming 调用，新增 `createStreamingChatCompletion`，通过 `for await...of` 逐段读取 `chunk.choices[0]?.delta.content`，并对比实时输出与最终 `fullContent` 拼接结果。 | Streaming、`stream: true`、异步迭代器、chunk、`delta.content`、实时输出与完整内容拼接 | `src/Index.ts`、`src/services/deepseek-chat.ts`、`src/types/deepseek.ts` | `pnpm typecheck` 通过；`pnpm dev` 已验证可以边生成边输出，并在最后得到完整文本。 | `await` 只拿到流对象，真正消费模型输出要靠 `for await...of`；`fullContent += content` 负责拼接，`process.stdout.write` 只负责实时展示。 | 下一步进入最小 NestJS + Vue 集成前，先保留当前 streaming 示例，明确后端未来如何把 chunk 转成 SSE 给前端。 |

## 记录规则

- 每次记录只写真实发生的 Agent 概念学习，不补不存在的结论。
- 可以记录用于验证概念的最小代码入口，但不要记录普通业务进度、默认工程搭建、UI 调整、依赖安装和提交信息。
- 优先记录 Agent 概念如何落到最小练习里，而不是泛泛写“学习了某某概念”。
- 如果出现 Agent 相关错误，要记录错误类型、定位思路和解决方式。
- 不记录 API Key、token、密码、私有服务地址等敏感信息。
