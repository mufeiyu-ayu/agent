# packages/ai 导图

`@agent/ai`：模型客户端。零 Nest、零 Prisma、零业务概念；只认「一个 OpenAI-compatible 端点 + 一份模型行能力事实」。新增 / 移动 / 删除这里提到的文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 文件

```txt
src/index.ts                          # 公开导出面，业务层只从这里 import
src/types.ts                          # 模型输入项 / 流事件 / usage / 工具定义等内部类型
src/config.ts                         # LLMClientConfig（key / baseUrl）、LLMModelProfile（模型行能力）、resolveChatRequestConfig
src/errors.ts                         # LLMError 族：网络 / 401 / 402 / 429 / 4xx / 5xx / 协议异常
src/provider-metadata.ts              # /models 与 /user/balance 的响应形状
src/api/openai-completions.ts         # 客户端主体：请求拼装（thinking / reasoning_effort / tools）、重试、错误转换、SDK 边界
src/api/openai-completions-stream.ts  # 把 SDK chunk 归一成项目事件：text_delta / tool_call_* / usage / response_completed
src/api/openai-completions-tool-calls.ts   # Tool Call 碎片拼接
src/api/openai-completions-raw-capture.ts  # debug：捕获原始请求 / 响应
```

## 不变量

- 只有一套 wire 协议（Chat Completions）；直连 Anthropic / Gemini 原生接口时才加第二套，现在不做。
- `thinking` 只对 `reasoning=true`（DeepSeek 家族）发；`reasoning_effort` 任何家族配置了就发；`reasoning=true` 时 Tool Call 必须回 `reasoning_content`。
- 家族取值表不在这里，在 `@agent/contracts`；这里只消费 `ReasoningEffort` 类型。
- 网络错误不重试（2026-09-19 拍板）；错误文案不带厂商名，各家 OpenAI-compatible 端点共用同一套状态码含义。

## 验证

`pnpm --filter @agent/ai typecheck`、`lint`、`test`（node:test）。改公开导出面时先 `build`，api 与前端的 typecheck 依赖它。
