# 阶段 5：最小 Tool Calling

状态：进行中。Task 0-3 已完成并通过验收，Task 4 保持 Planned。

## 阶段目标

在现有 `AgentRuntimeService` 基础上完成最小只读工具闭环：

```text
用户问题
  -> 模型提出 Tool Call
  -> Runtime 识别并执行工具
  -> Observation 回填模型
  -> 模型生成最终回答
```

阶段 5 重点学习 Tool Calling 主链路，不提前扩展复杂权限、RAG 或 Multi-agent。

## 当前前置条件

- 阶段 4 Agent Runtime 基础已完成。
- `AgentRuntimeService.runTurnStream()` 已成为 runtime 主编排入口。
- `AgentRuntimeEvent` 已与前端 `ChatStreamEvent` 解耦。
- `SeoContextBuilder` 已承接 SEO Agent 的 model messages 构造。
- 已准备 68 篇文章 Demo 数据，其中 15 篇 `zh-cn`、53 篇 `en`。

## 学习主线

```text
结构化模型事件
  -> Tool Contract 与 Registry
  -> 文章查询工具
  -> 单 Agent Tool Loop
  -> Tool Calling 运行记录
```

## 任务计划

| 任务 | 状态 | 核心目标 |
| --- | --- | --- |
| Task 0 | Completed | 新增 `Article` 表并导入文章 Demo 数据，为只读工具提供稳定数据源 |
| Task 1 | Completed | 将纯文本模型流升级为 provider-neutral `ModelStreamEvent`，让 Runtime 能识别文本、Tool Call 和本次 sampling 的结束原因 |
| Task 2 | Completed | 定义最小 `ToolDefinition`、`ToolRegistry`、参数验证、执行与结果边界 |
| Task 3 | Completed | 实现第一只只读工具 `search_articles`，查询并返回精简文章信息 |
| Task 4 | Planned | 实现单 Agent Tool Loop：模型请求工具、后端执行、Observation 回填、模型继续生成最终回答 |
| Task 5 | Planned | 将模型调用、工具执行和工具结果记录到 `AgentStep`，保持当前前端 stream 协议稳定 |

## Task 1 完成结果

- 新增 provider-neutral `ModelStreamEvent`，覆盖文本、未验证 Tool Call、usage 和 sampling 完成语义。
- OpenAI-compatible adapter 会按 index 拼装 Tool Call 分片，归一化 finish reason，并处理 `choices=[]` 的 usage-only chunk。
- `LLMService.chatStream()` 已从 `AsyncGenerator<string>` 升级为 `AsyncGenerator<ModelStreamEvent>`，Provider SDK 类型没有泄漏到 Runtime。
- Runtime 保持现有文本流行为；Tool Loop 接入前收到 Tool Call 会明确 fail-fast，不会静默保存空的成功回复。
- Provider error 和 Abort 继续只通过 async iterator throw 传播，前端 `ChatStreamEvent` 保持不变。
- 使用现有 `tsx` 和 Node 原生 `node:test` 增加 12 个最小回归用例，没有新增依赖。
- `pnpm --filter @agent/api test:model-stream`、`pnpm --filter @agent/api lint`、`pnpm typecheck`、`git diff --check` 通过；全仓 `pnpm lint` 仍被既有 research Markdown 的 97 个错误阻断。

## Task 2 完成结果

- 新增一级 `tools` 模块，明确 `ToolDefinition`、输入契约、Registry、已验证调用、Executor、执行上下文和 `ToolResult` 边界。
- `ToolRegistryService` 对非法名称、重复注册和未知工具 fail fast，并按名称稳定列出 definitions。
- `ToolInvocationService` 依次完成工具查找、JSON 解析、工具专属运行时验证和执行；参数失败不调用 Executor，普通异常转换为安全结果。
- Abort 在调用入口和 Executor 返回后检查，已取消调用不会被记录成工具失败；当前阶段对需审批、非低风险、有副作用或联网工具统一 fail closed。
- 新增 provider-neutral `ModelToolSpec` 与纯映射，只暴露名称、描述和输入 Schema。
- 使用无网络、无副作用的测试专用 `echo` 工具覆盖 13 个 Registry、Invocation、Mapper 和 NestJS 模块回归用例；未接入 Runtime Tool Loop，也未实现正式业务工具。
- `timeoutMs` 当前只保留为 server-owned metadata；工具超时执行逻辑按 Issue #1 明确留待后续任务，不阻塞 Task 2 验收。
- 实施状态：已实现；验收状态：已通过；任务状态：Completed。

## Task 3 完成结果

- 新增低风险、只读、无外部网络且无需审批的 `search_articles`，通过现有输入契约校验 `query`、`languageCode` 和 `limit`。
- 工具查询 `Article` 表并稳定返回匹配总数与最多 10 条精简结果；单条结果只包含 `sourceId`、`slug`、`languageCode`、`title`、`seoTitle`、`seoDescription` 和截断后的 `excerpt`，不返回完整 `content`。
- `ToolsModule` 显式注册工具并引入 `PrismaModule`；合法调用继续通过 `ToolRegistryService`、`ToolInvocationService` 和 `ToolExecutor` 边界执行。
- `modelContent` 提供有结果或无结果的受控查询说明，可供后续 Task 4 作为 Observation 使用；本任务未接入 Runtime Tool Loop、Observation 回填或第二轮 sampling。
- `test:tools` 覆盖 Registry、模型 spec、参数校验、查询参数、精简输出、无结果和风险边界；既有模型流回归、API typecheck/lint 与 workspace typecheck 通过。
- Codex Review 提出的 LIKE 通配符问题已修复并复审通过；PR #10 已合并，Issue #9 已关闭。
- 实施状态：已实现；验收状态：已通过；任务状态：Completed。Task 4 保持 Planned。

## 关键边界

- Provider 原始 SDK chunk 只在 LLM adapter 内处理，不能泄漏到 Runtime。
- 模型只能提出 Tool Call，工具是否存在、参数是否合法、是否允许执行由后端决定。
- `tool_call_completed` 只表示模型已经提出完整调用，不表示工具已验证或已执行。
- `finishReason = tool_calls` 只结束一次模型 sampling，不结束整个 `AgentRun`。
- 工具结果必须作为 Observation 回填模型，不能直接把数据库 JSON 当成最终回答返回前端。
- 第一版只支持低风险、只读、顺序执行的工具。
- 第一只工具只返回文章列表所需的精简字段，不返回全部正文。

## 本阶段不做

- 不建设完整自动化测试体系；Task 1 只保留关键模型流和 Runtime 回归测试，其余使用固定场景手工验证。
- 不做写操作工具。
- 不做用户审批和 Human-in-the-loop。
- 不做复杂权限策略。
- 不做 RAG / 向量数据库。
- 不做 MCP / 插件市场。
- 不做 Multi-agent。
- 不做并行工具执行。
- 不做工具执行过程的前端时间线 UI。

## 阶段验收标准

- Runtime 能区分普通文本输出和模型 Tool Call。
- 工具定义、注册、验证和执行职责清晰。
- `search_articles` 能查询文章并返回受控结果。
- Observation 能进入下一次模型调用。
- 最终回答由工具执行后的后续 sampling 生成。
- 工具调用过程能记录到 `AgentStep`。
- 当前 `ChatStreamEvent` 前端协议不被破坏。
- 普通聊天、停止生成、消息持久化和 Run 状态通过固定场景手工回归。
- `typecheck`、`lint`、`git diff --check` 通过。

## 后续阶段

阶段 5 稳定后，进入阶段 6：Human-in-the-loop。
