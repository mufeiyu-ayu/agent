# 阶段 5：最小 Tool Calling

状态：进行中。Task 0-4 已完成并通过验收；Task 5 已实现、待验收，阶段 5 尚未完成或归档。

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
| Task 4 | Completed | 实现单 Agent Tool Loop：模型请求工具、后端执行、Observation 回填、模型继续生成最终回答 |
| Task 5 | 已实现 / 待验收 | 将模型调用、工具执行和工具结果记录到 `AgentStep`，保持当前前端 stream 协议稳定 |

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

## Task 4 完成结果

- 新增内部 `ModelInputItem`，分离普通消息、`assistant_tool_call` 与 `tool_result`；Provider adapter 将其映射为 OpenAI-compatible messages。
- Runtime 只向模型暴露现有 `search_articles`，并通过 `ToolInvocationService.invoke()` 执行模型提出的唯一工具调用。
- 单轮 sampling 判断显式拒绝缺失完成事件、结束原因冲突、同轮多个 Tool Call 和非完整回答；Tool Loop 最多执行一次工具、最多进行两轮 sampling。
- `ToolResult.modelContent` 与同一 `callId` 的 Tool Call 配对后作为 Observation 回填；`ToolResult.data`、工具 JSON 和第一轮中间文本不会写入用户可见 `Message`。
- unknown tool、invalid arguments 和低风险工具安全失败会作为脱敏 Observation 进入第二轮；Abort 在 sampling、工具执行和第二轮前后保持 `ABORTED` 终态。
- OpenAI-compatible 请求携带模型工具定义；最终合并版本不发送 DeepSeek 文档未声明的 `parallel_tool_calls` 字段，Runtime 继续兜底拒绝多个 Tool Call。
- 前端 `ChatStreamEvent` 仍为 `start / delta / done / error / aborted`；普通回答和工具后的第二轮最终回答都会在模型 `text_delta` 到达时实时产出 `assistant_delta`，不再等待 `response_completed` 后回放。
- SEO Agent system prompt 明确：用户查询站内已有文章时调用 `search_articles`；单纯询问数据库或工具能力时只解释、不调用，也不为举例自动查询；该工具只做关键词查询而不是 RAG；有结果时基于 Observation 回答，无结果时明确说明且不得编造文章。工具调用前不得先输出说明文字；若模型先输出最终文本又请求工具，Runtime 会拒绝该不安全混合响应。
- `test:tool-loop` 补充普通回答、第二轮最终回答在 `response_completed` 前产出 delta 的时序测试，以及 SEO Agent 工具说明边界测试。
- `test:tool-loop` 14 个用例、`test:model-stream` 22 个用例、`test:tools` 17 个用例，以及 API typecheck/lint、workspace typecheck、`git diff --check` 通过。
- 使用当前 DeepSeek 配置进行本地真实流验证：“你能查数据库吗？请简短回答。”只产生实时文本并以 `done` 结束；SP Himeko 查询实际返回 1 篇中文文章，工具后的最终回答实时输出。临时会话已删除。
- GPT 结合 Issue #11、PR #12 diff、Codex Review、测试结果和前端手工反馈完成验收；用户授权后 PR #12 已合并到 `master`，merge commit `390d8497`。
- 实施状态：已实现；验收状态：已通过；任务状态：Completed。Task 5 保持 Planned。

## Task 5 实现结果

- `AgentStep` 新增同一 Run 内从 1 开始的 `sequence`，migration 先按 `runId` 分组、按 `createdAt` 和 `id` 稳定回填旧数据，再设置 `NOT NULL` 与唯一约束。
- `AgentRunRecorderService` 改为在真实执行时动态创建 `RUNNING` Step，并通过真实 `stepId` 和带非终态条件的更新完成 terminal transition；重复收口或迟到更新会抛出 invariant error。
- `completeRun()` 会拒绝仍有非终态 Step 的 Run；`failRun()` 与 `abortRun()` 在事务中收口全部 `PENDING` / `RUNNING` Step，再以 compare-and-set 方式收口 Run。
- 每轮 `model_sampling` 分别记录 sampling 序号、稳定 attempt id、请求模型、消息数、工具数、provider-neutral usage、finish reason、文本长度、Tool Call 数和耗时；usage 缺失时保存 `null`，不伪造 token 数。
- `tool_execution` 只保存工具名、版本、调用 id、执行次数和参数字符数等 allowlist 输入，以及状态、错误分类、Observation 长度、截断标记和耗时等 allowlist 输出；不保存完整 raw arguments、`ToolResult.data`、`modelContent`、原始异常或 stack。
- `ToolDefinition.timeoutMs` 已成为真实 deadline：外层主动竞争 Executor 与 timeout / user abort，timeout 安全归类为 `timeout`，用户先取消时整次 Run 收口为 `ABORTED`；迟到 resolve / reject 不再改变终态，也不会产生 unhandled rejection。
- 单条 Tool Observation 的后端固定上限为 8,000 个 Unicode code point。该额度能容纳当前最多 10 条精简文章结果及回答上下文，同时限制异常 Executor 产生的无界输入；超限内容转换为确定性的纯文本预览 envelope，不再宣称是完整 JSON。
- Runtime 已按真实顺序形成普通回答的 `receive -> history -> sampling#1 -> assistant`，以及 Tool Loop 的 `receive -> history -> sampling#1 -> tool -> sampling#2 -> assistant`；工具安全失败 Step 可为 `FAILED`，Run 仍可经第二轮解释后 `COMPLETED`。
- `ChatStreamEvent` 继续只有 `start / delta / done / error / aborted`；未新增前端时间线，未暴露 Tool Call、Tool Result、raw arguments 或 `AgentStep`，用户可见 Message 仍只保存最终回答。
- Red 阶段分别复现 Recorder、sampling、timeout / abort、Runtime 记录与迟到 terminal CAS 缺口；Green / Refactor 后 Recorder 9 个、Tool Loop 19 个、Model Stream 34 个、Tools 24 个自动化用例均通过。真实普通回答、正常 Tool Loop、零结果和停止生成场景已验证，临时会话数据已清理；工具 timeout 使用测试专用永不结束 Executor 验证。
- 实施状态：已实现；验收状态：待验收。Task 5 未标记为 Completed，阶段 5 保持进行中，未处理 Issue #14。

### Task 4 手工验收问题

以下问题基于 `prisma/fixtures/articles.json` 当前 68 条真实 seed，并按 `search_articles` 的不区分大小写关键词包含查询验证：

| 问题 | `zh-cn` 预期匹配数 | 验收重点 |
| --- | ---: | --- |
| 查一下 zh-cn 里关于 SP Himeko 的文章，最多 3 条 | 1 | 调用工具并基于 sourceId 24 的 Observation 回答 |
| 查一下 zh-cn 里关于 Honkai: Star Rail 的文章 | 2 | 标题、slug、SEO 字段或正文任一字段包含关键词都可命中 |
| 查一下 zh-cn 里关于 Silver Wolf 的文章 | 1 | 命中 sourceId 24 的正文关键词 |
| 查一下 zh-cn 里关于 4.4 更新的文章 | 1 | 命中 sourceId 24 的 SEO 描述或正文关键词 |
| 查一下 zh-cn 里关于 completely-not-exist-xyz 的文章 | 0 | 明确说明没有找到，不编造文章 |

普通流式回归可使用“请用三点说明网站内容审计的基本思路”；验收时应看到回答逐步到达，而不是整段一次出现。默认手工验收不再使用当前 seed 无匹配的“图片优化”“sitemap”“SEO title”等问题。

能力边界回归可询问“你能查数据库吗”：预期只说明可以按关键词查询站内文章，不实际调用工具，也不出现晚到 Tool Call 的协议错误。

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
