# packages/ai 导图

`@agent/ai`：模型客户端。零 Nest、零 Prisma、零业务概念；只认「一个 OpenAI-compatible 端点 + 一份模型行能力事实」。新增 / 移动 / 删除这里提到的文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 文件

```txt
src/index.ts                          # 公开导出面，业务层只从这里 import
src/types.ts                          # 模型输入项 / 流事件 / usage / 工具定义等内部类型
src/config.ts                         # LLMClientConfig（key / baseUrl / 原样透传给 SDK 的 fetchOptions）、LLMModelProfile（模型行能力）、resolveChatRequestConfig
src/errors.ts                         # LLMError 族：网络 / 401·403 / 402 / 429 / 4xx / 5xx / 协议异常
src/provider-metadata.ts              # /models 与 /user/balance 的响应形状
src/api/openai-completions.ts         # 客户端主体：请求拼装（thinking / reasoning_effort / tools）、重试、错误转换、SDK 边界
src/api/openai-completions-stream.ts  # 把 SDK chunk 归一成项目事件：text_delta / tool_call_* / usage / response_completed
src/api/openai-completions-tool-calls.ts   # Tool Call 碎片拼接；id / name 去重规则 debug tee 共用
src/api/openai-completions-raw-capture.ts  # debug：捕获原始请求 / 响应
src/api/__fixtures__/                 # 各家族真实 Tool Call 流原文（*.tool-call.sse）、真实聚合响应（*.response.json）与手工 chunk 序列（*.chunks.json）
scripts/export-raw-response-fixtures.ts    # 一次性只读导出脚本：从本机 AgentStep.debugRawResponse 生成 *.response.json
scripts/record-tool-call-stream-fixtures.ts  # 一次性手动录制脚本：用 dev 库服务商真实调用一次，生成 *.tool-call.sse（有费用）
```

## 不变量

- 出口不在本包决定：`fetchOptions`（如 undici `dispatcher`，由 api 按服务商的代理勾选构造）原样交给 SDK，本包不依赖 undici、不读代理环境变量。
- 只有一套 wire 协议（Chat Completions）；直连 Anthropic / Gemini 原生接口时才加第二套，现在不做。
- 家族差异只读 `@agent/contracts` 的 compat 表（`LlmFamilyCompat`）：`thinkingFormat='deepseek'` 才发 `thinking`；`requiresReasoningContent` 为真时 assistant 消息都带 `reasoning_content`：续轮的 Tool Call 消息回填本轮推理，模型没思考时回空串（缺字段官方端点 400），历史回放的 assistant 回复给空串（官方文档要求带 tools 时历史轮也带），其他家族空就不写；`toolCallIndexOptional` / `toolCallsMayFinishWithStop` 为真时（目前只有 gemini）分片缺 index 取还没被占用的最小槽位、显式 index 固定映射到同一槽位（`ToolCallSlots`，谁先到都不撞号，debug tee 共用）、带 Tool Call 的 stop 归一成 tool_calls，其余家族缺 index 或 stop 带调用都报错；`reasoning_effort` 任何家族配置了就发。
- usage 的缓存字段按 `prompt_tokens_details.cached_tokens` → `prompt_cache_hit_tokens` → `cached_tokens` 兜底，只认有限数，字符串 / null 按缺失继续往下取；`inputTokens` 保持原始 `prompt_tokens`；reasoning 是 output 的子集，`total_tokens` 证明 `completion_tokens` 不含推理（grok）时 `outputTokens` 归一为 completion + reasoning；缺失字段保持 unknown，不补零。
- `src/api/__fixtures__/`：`*.tool-call.sse` 是真实流式 Tool Call 响应体原文（不含请求头与 key），测试经 fake fetch 交给真实 client 走 SDK 解析；`*.response.json` 是各家族经中转站 / 直连的真实聚合响应（由 `scripts/export-raw-response-fixtures.ts` 从本机 `AgentStep.debugRawResponse` 只读导出，不含 `reasoning_content`，也不带服务商地址）；`*.chunks.json` 是按真实 usage 形状手工整理的最小流序列，不是抓包原样。改 usage 归一化或不变量时先跑这组回归。
- 重试交给 SDK：`REQUEST_MAX_RETRIES = 2`（#115），只在收到响应头之前重试 408 / 409 / 429 / 5xx 与连接错误；流正文中断、abort 之后不重试，abort 不等退避 sleep（`rejectOnAbort`，`chatStream` 与 `listModels` / `getUserBalance` 都接受调用方 signal）。回归在 `openai-completions.test.ts` 的「瞬态失败重试」组。
- reasoning 正文不进事件流：adapter 只在首段 reasoning 到达时发一次不带正文的 `reasoning_started`（runtime 据此算首 token 时间），正文只随 `tool_call_completed.reasoningContent` 回填。
- `finish_reason` 不是 stop / tool_calls / length / content_filter 时归 `unknown`：这是异常结束，已收到的 Tool Call 分片不组装也不报协议错；原值只有由字母与下划线组成、不超过 64 个字符时才随 `response_completed.rawFinishReason` 带出。调用方会把它放进用户可见文案，所以白名单比下面错误 body 的摘要规则更严。
- SDK 读响应体时遇到 abort 会静默结束迭代：`chatStream` 先看 signal，已 aborted 就按 abort 抛（不报成缺 finish reason）；raw capture 在 signal 已 aborted 或没见到 finish_reason 时标 partial。
- 错误文案不带厂商名，各家 OpenAI-compatible 端点共用同一套状态码含义。上游 body 原文不进文案：400 / 422 / 5xx 与未单独映射的状态码（后者只报 `HTTP ${status}`）仅当 JSON body 的 `error` 是对象时在文案末尾附摘要——字符串 code / type 与去掉控制 / 格式字符、截断到 200 字符的 message，其中出现的本次请求 key 先换成 `***` 再截断；401 / 402 / 403 / 429 只有固定文案；中转站把上游故障包成的 400 + `type: upstream_error` 归 `LLMServerError`（#175）。完整 APIError 留在异常的 `detail` 上，目前没有代码记录它。流内夹带的 error 对象带 HTTP 状态码（数值或三位数字字符串）时与响应状态码同表归类；上游 JSON 解析失败（SSE 行或元数据响应体）与既没有 `choices` 也没有 `usage` 的数据块归协议错误（`LLMApiError`），不当网络错误。SDK 客户端 `logLevel: 'off'`，解析失败时不再把上游原文打到 stderr（SDK 只在 Assistants 的 `thread.*` 事件分支直接调 `console.error`，Chat Completions 流走不到）。

## 已知限制（只在直连官方时暴露，2026-09-26 文档对照与实测）

- 直连 OpenAI：GPT ≥ 5.4 在 Chat Completions 上带 tools 时 `reasoning_effort` 只能是 `none`，gpt-6-astra 调工具必须走 Responses；`max_tokens` 已废弃，改用 `max_completion_tokens`。公司中转站上游就是 Responses（响应 id 为 `resp_`），现在的组合才可用；要直连须先做 Responses 适配。
- 直连 Google Gemini 3：续轮必须原样回传 `tool_calls[].extra_content.google.thought_signature`（缺了 400，本包目前不保存），tool 消息应带 `name`（官方示例都带）。经公司中转站实测两者都不需要。

## 验证

`pnpm --filter @agent/ai typecheck`、`lint`、`test`（Vitest）。`scripts/` 不在 tsconfig include 里，只过 lint。

`package.json` 的 `exports` 里 `types` 指向 `src`、`import` 指向 `dist`：typecheck 读 src，node 运行时读 dist；测试经 Vitest 别名直接读 src，不需要先 build。`pnpm dev` 会 watch 本包并重建 dist。
