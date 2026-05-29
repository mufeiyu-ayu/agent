# Agent 应用开发学习日志

这份日志用于记录本项目学习 Agent 应用开发的过程。每次完成一个阶段性任务后，补充一条记录，重点写清楚：学到了什么、改了哪里、验证结果、下一步练习什么。

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

| 日期 | 阶段 | 本次学习 / 实现 | Agent 关键概念 | 关键入口 | 验证 / 结果 | 复盘 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-25 | 基础模型调用 | 使用 OpenAI SDK 通过 DeepSeek OpenAI-compatible API 发起非流式 chat completion 请求。 | `model`、`messages`、`system prompt`、`user prompt`、API Key 环境变量 | `src/services/deepseek-chat.ts`、`src/Index.ts` | `pnpm typecheck` 通过，`pnpm lint` 通过。 | 先跑通最小闭环是正确节奏，当前不需要引入 Agent 框架。 | 继续把模型调用整理成更稳定的 `LLMService`。 |
| 2026-05-25 | 多轮上下文 | 将模型回复追加为 `assistant` message，并用第二轮用户问题验证上下文延续。 | 多轮对话上下文、`assistant` message、上下文累积 | `src/utils/messages.ts`、`src/Index.ts` | `pnpm typecheck` 通过，`pnpm lint` 通过。 | `messages` 可以先理解为一份对话状态数组，模型本身不记忆历史，历史要由调用方传回去。 | 下一步学习封装层职责：入口示例、LLM 调用、上下文工具应继续拆清。 |
| 2026-05-25 | 学习日志机制 | 新增项目学习日志，并创建项目内 `update-agent-learning-log` skill，后续用于触发日志更新。 | 学习可观测性、阶段复盘、项目记忆、项目级自动化边界 | `docs/learning-log.md`、`AGENTS.md`、`.codex/skills/update-agent-learning-log/SKILL.md` | skill `quick_validate.py` 通过，`pnpm typecheck` 通过，`pnpm lint` 通过。 | 学习 Agent 开发时，过程记录本身也要工程化；项目专属 skill 应跟随项目，不应放进全局配置。 | 后续每次完成阶段性学习任务后，补一条学习日志。 |
| 2026-05-26 | JSON Output | 按 DeepSeek JSON Output 思路，将 SEO 示例改为通过中文 `system prompt` 规定 json 输出格式，并在请求参数中加入 `response_format: { type: 'json_object' }`，再把模型返回的 `content` 解析为业务对象。 | JSON Output、输出格式约束、`response_format`、`JSON.parse`、TypeScript 类型与运行时校验边界 | `src/Index.ts`、`src/services/deepseek-chat.ts`、`src/types/seo.ts`、`src/utils/json-output.ts` | `pnpm typecheck` 通过；此前 `pnpm dev` 已验证可返回合法 JSON 并解析成对象。 | `prompt` 负责描述目标字段，`response_format` 负责约束 JSON 语法，TypeScript 类型不能替代运行时字段校验。 | 补充 `title` / `description` 的运行时校验，再决定是否封装成最小 AI SEO 助手接口。 |
| 2026-05-27 | Tool Calling | 按 DeepSeek 官方 demo 改写 Tool Calls 示例：定义 `get_weather` 工具，第一次请求让模型返回 `tool_calls`，追加 assistant tool call 与 `role: tool` 的工具结果后，再请求模型生成最终回答。 | Tool Calls、`tools`、`tool_calls`、`tool_call_id`、`role: tool`、模型决策与代码执行分离 | `src/Index.ts`、`src/services/deepseek-chat.ts`、`src/tools/weather.ts` | `pnpm typecheck` 通过；`pnpm dev` 已验证官方 demo 风格流程可输出杭州天气最终回答。 | 官方示例的目的不是查天气，而是演示“模型提出工具调用，代码提供工具结果，模型再生成最终回复”的协议闭环。 | 下一步把写死的 `24℃` 替换为本地函数执行，并加入 tool arguments 的解析与运行时校验。 |
| 2026-05-27 | 流式输出 | 将入口示例改为 DeepSeek streaming 调用，新增 `createStreamingChatCompletion`，通过 `for await...of` 逐段读取 `chunk.choices[0]?.delta.content`，并对比实时输出与最终 `fullContent` 拼接结果。 | Streaming、`stream: true`、异步迭代器、chunk、`delta.content`、实时输出与完整内容拼接 | `src/Index.ts`、`src/services/deepseek-chat.ts`、`src/types/deepseek.ts` | `pnpm typecheck` 通过；`pnpm dev` 已验证可以边生成边输出，并在最后得到完整文本。 | `await` 只拿到流对象，真正消费模型输出要靠 `for await...of`；`fullContent += content` 负责拼接，`process.stdout.write` 只负责实时展示。 | 下一步进入最小 NestJS + Vue 集成前，先保留当前 streaming 示例，明确后端未来如何把 chunk 转成 SSE 给前端。 |
| 2026-05-28 | 前后端工程骨架 | 将原先根目录 CLI 学习代码迁移为 pnpm workspace，删除旧 `src/`，新增 `apps/api` Nest 后端和 `apps/web` Vue/Vite 前端，前端通过 axios 请求后端 demo 接口。 | Agent 产品化分层、前端只调用后端、模型密钥应留在服务端、前后端接口边界 | `pnpm-workspace.yaml`、`apps/api/src/app.controller.ts`、`apps/web/src/api/http.ts`、`apps/web/src/App.vue` | `pnpm typecheck`、`pnpm lint`、`pnpm --filter @agent/web build` 通过；`curl` 验证 `localhost:3000/api/demo` 与 `localhost:5173/api/demo` 均返回后端数据。 | 从 API 概念学习进入产品工程时，第一步是把模型调用从单文件示例迁移到后端服务边界，再让前端只依赖 HTTP 接口。 | 在 Nest 中实现最小 AI SEO 助手接口，把 DeepSeek JSON Output 能力接入后端并由 Vue 表单调用。 |
| 2026-05-30 | AI 编程助手迁移规范 | 为 Claude Code 新增项目入口 `CLAUDE.md`，同步 Codex skills 到 `.claude/skills`，新增学习计划讨论 command，并为 Codex / Claude Code 同时新增模块化架构开发 skill。 | 项目记忆、AI coding agent 迁移、plan mode、模块化边界、可维护性约束 | `CLAUDE.md`、`.claude/commands/learning-plan-discussion.md`、`.claude/skills/update-agent-learning-log/SKILL.md`、`.claude/skills/web-frontend-development/SKILL.md`、`.claude/skills/modular-architecture-development/SKILL.md`、`.codex/skills/modular-architecture-development/SKILL.md` | 通过 GitHub 提交创建相关规范文件；未运行本地命令，因为本次只新增 Markdown 规范文件。 | 从 Codex 切换到 Claude Code 时，不能只换工具入口，还要同步项目上下文、协作方式、技能约束和模块化开发边界。 | 用 Claude Code 的 plan mode 讨论并执行 `App.vue` 模块化拆分，再推进最小 AI SEO Agent 接口。 |
| 2026-05-30 | 后端基础设施 | 为 Nest API 配置统一响应结构、全局异常处理、全局校验管道和 request id 中间件，并让前端 HTTP 层自动解包统一响应。 | HTTP 边界、错误恢复、请求校验、日志观测、Agent 接口可调试性 | `apps/api/src/common/interceptors/response-transform.interceptor.ts`、`apps/api/src/common/filters/all-exceptions.filter.ts`、`apps/api/src/common/pipes/app-validation.pipe.ts`、`apps/api/src/common/middleware/request-id.middleware.ts`、`apps/api/src/common/bootstrap/register-app-globals.ts`、`apps/web/src/api/http.ts` | `pnpm typecheck`、`pnpm lint`、`pnpm --filter @agent/web build` 通过；`PORT=3101` 临时启动后 `curl /health` 返回统一成功结构，`curl /not-found` 返回统一错误结构。 | Agent 后端接口不能只关注模型调用，先把响应、校验、错误和请求链路元数据统一起来，后续排查模型参数、JSON Output 和工具调用错误才有稳定入口。 | 新增 `POST /api/seo/generate`，用 DTO 校验输入，再在 Service 中接入 DeepSeek JSON Output。 |

## 记录规则

- 每次记录只写真实发生的学习和改动，不补不存在的结论。
- 优先记录 Agent 概念如何落到代码里，而不是泛泛写“学习了某某概念”。
- 如果出现错误，要记录错误类型、定位思路和解决方式。
- 不记录 API Key、token、密码、私有服务地址等敏感信息。
