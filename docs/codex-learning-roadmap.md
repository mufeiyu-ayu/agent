# Codex 架构学习手册与当前项目路线

本文把 `<codex>` 里的 OpenAI Codex CLI 开源项目，当作一个生产级 coding agent 的参考样本，翻译成当前 AI SEO Agent 项目可实践的学习路线。

重点不是学习 Rust、TUI 或 Codex 的全部内部细节，而是理解一个 agent 系统如何把用户输入、会话状态、模型请求、流式输出、工具调用、权限控制、上下文和持久化串成闭环。

官方参考：[Codex Prompting](https://developers.openai.com/codex/prompting) 和 [Codex CLI Slash Commands](https://developers.openai.com/codex/cli/slash-commands)。

路径约定：

- `codex/` 表示 `<codex>`
- `agent/` 表示 `<agent>`

## 0. Goal mode 使用结论

官方 Codex 文档里，Goal mode 适合多步骤长期任务。Goal 文本既是启动 prompt，也是完成标准，所以目标必须能判断是否完成；如果目标太长，应把细节放到文件里，再让 goal 引用这个文件。

本次适合使用的 goal 思路是：

```text
基于 codex/ 这个 OpenAI Codex CLI 开源项目，为 agent/ 当前 Vue + Nest + TypeScript AI SEO Agent 学习项目产出一份中文学习手册和后续路线，写入 agent/docs/codex-learning-roadmap.md。只读分析 codex/，不修改该仓库；可读取 agent/docs；不修改业务代码；重点解释多入口复用 runtime、thread/turn/session、agent loop、streaming、tool spec/runtime、权限审批与 sandbox、上下文/持久化、SDK/协议边界，并映射到当前项目阶段 2/3 收口和后续 Tool Calling / Agent Runtime 学习。
```

这个目标比“总结 Codex 全部架构”更好，因为它有清晰产物、路径边界和验收标准。

## 1. Codex 的核心心智模型

Codex 不是一个简单 CLI，也不是一个“输入 prompt -> 返回文本”的聊天壳。更准确的理解是：

```text
多种产品入口
  -> app-server 协议门面
  -> thread/session/turn runtime
  -> prompt/context 组装
  -> 模型流式响应
  -> tool call 识别与执行
  -> observation 写回模型上下文
  -> 继续采样或结束 turn
  -> UI / CLI / SDK 展示过程和结果
```

第一轮只需要记住这句话：

```text
Codex = LLM + 工具 + 循环 + 状态 + 权限约束 + 多入口产品体验
```

源码入口：

- 产品定位：`codex/README.md`
- 项目功能地图：`codex/learning-roadmap/00-project-function-map.md`
- 核心 loop 导读：`codex/learning-roadmap/01-core-agent-loop.md`
- 产品入口导读：`codex/learning-roadmap/02-entrypoints-and-product-shells.md`
- 工具与权限导读：`codex/learning-roadmap/03-tools-permissions-sandbox.md`
- 上下文与持久化导读：`codex/learning-roadmap/04-context-state-persistence.md`

## 2. 源码主链路导读

### 2.1 多入口复用同一个 runtime

Codex 有 CLI、TUI、非交互 `exec`、App Server、Python SDK、TypeScript SDK 等入口，但它们不应该各自实现一套 agent loop。入口层只负责收集输入、发协议请求、消费通知并展示结果。

关键路径：

- 顶层 CLI 分发：`codex/codex-rs/cli/src/main.rs`
- TUI 入口：`codex/codex-rs/tui/src/app_server_session.rs`
- 非交互执行：`codex/codex-rs/exec/src/lib.rs`
- app-server 请求分发：`codex/codex-rs/app-server/src/message_processor.rs`
- in-process / remote client：`codex/codex-rs/app-server-client/src/lib.rs`
- TypeScript SDK：`codex/sdk/typescript/src/codex.ts`
- Python SDK：`codex/sdk/python/src/openai_codex/client.py`

对当前项目的启发：

当前 `agent` 项目只有 Web + API 两个入口，短期不用做 SDK。但从现在开始，前后端 contract 要稳定，不要让 UI 组件直接绑定后端临时字段。已有的 `agent/packages/contracts/src/seo.ts` 和 `agent/packages/contracts/src/conversation.ts` 就是正确方向。

### 2.2 app-server 协议门面

Codex 在外部入口和 core runtime 之间放了 app-server。外部看到的是 `thread/start`、`turn/start` 等 JSON-RPC 风格请求；core 内部则使用更贴近 runtime 的 `Submission` / `Event`。

关键路径：

- 对外请求分发：`codex/codex-rs/app-server/src/message_processor.rs`
- turn 请求处理：`codex/codex-rs/app-server/src/request_processors/turn_processor.rs`
- thread 生命周期：`codex/codex-rs/app-server/src/request_processors/thread_lifecycle.rs`
- app-server protocol：`codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- core protocol：`codex/codex-rs/protocol/src/protocol.rs`

对当前项目的启发：

现在 `agent` 里的 HTTP API 同时承担“产品接口”和“runtime 入口”。阶段 4 以后可以收敛一个更明确的 runtime service：Controller 只负责协议边界，Service 负责 turn 流程，LLMService / ToolService 负责能力实现。

### 2.3 Thread / Turn / Session 边界

Codex 里可以这样理解：

- `Thread`：长生命周期会话，负责恢复、fork、命名、归档等。
- `Turn`：一次用户输入触发的运行过程，里面可能多次请求模型和执行工具。
- `Session`：运行中的 agent 状态中心，持有配置、history、工具、事件通道等。
- `Task`：一次 turn 或 compact / review 等后台工作单元。

关键路径：

- thread 生命周期管理：`codex/codex-rs/core/src/thread_manager.rs`
- thread 门面：`codex/codex-rs/core/src/codex_thread.rs`
- session 创建与事件通道：`codex/codex-rs/core/src/session/mod.rs`
- 输入分发：`codex/codex-rs/core/src/session/handlers.rs`
- 普通任务：`codex/codex-rs/core/src/tasks/regular.rs`
- turn 主循环：`codex/codex-rs/core/src/session/turn.rs`

对当前项目的映射：

- 当前 `Conversation` 约等于 Codex 的 `Thread`，是长期会话。
- 当前一次 `POST /api/seo/chat/stream` 约等于一个 `Turn`。
- 当前 `useSeoWorkspace` + `SeoService` 共同承担了一部分 `Session` 职责，但还没有清晰 runtime 对象。
- 后续进入 Tool Calling 时，不要把工具调用、模型循环、消息落库全塞进 `SeoService`，应逐步抽出 `AgentRuntimeService` 或类似模块。

### 2.4 Agent loop：为什么不是同步函数

Codex core 使用 `Submission` / `Event` 模型，而不是同步函数调用。用户输入、interrupt、审批结果、权限响应都进入 submission；agent 文本、工具开始/结束、审批请求、turn 完成等都作为 event 发回 UI。

关键路径：

- `Submission` / `Op`：`codex/codex-rs/protocol/src/protocol.rs`
- `Event` / `EventMsg`：`codex/codex-rs/protocol/src/protocol.rs`
- `submission_loop`：`codex/codex-rs/core/src/session/handlers.rs`
- `run_turn`：`codex/codex-rs/core/src/session/turn.rs`
- 模型流消费：`codex/codex-rs/core/src/session/turn.rs`
- 输出 item 处理：`codex/codex-rs/core/src/stream_events_utils.rs`

最小链路：

```text
Op::UserInput
  -> submission_loop
  -> RegularTask::run
  -> run_turn
  -> build_prompt
  -> try_run_sampling_request
  -> handle_output_item_done
  -> tool output 写回 history 或 assistant message 完成
  -> EventMsg::TurnComplete
```

对当前项目的启发：

你现在已经从一次性响应升级到 NDJSON streaming，这是从同步思维走向 runtime 思维的第一步。下一步不是马上做复杂工作流，而是把一次用户消息建模成一个 turn：开始、生成中、工具调用中、等待确认、完成、失败、中断。

### 2.5 Streaming 事件

Codex 会把模型输出和工具过程转成事件发给 UI，例如 assistant 文本 delta、工具调用开始/结束、审批请求、turn 完成等。

关键路径：

- streaming delta 事件：`codex/codex-rs/protocol/src/protocol.rs`
- delta 转 UI event：`codex/codex-rs/core/src/session/turn.rs`
- stream item 处理：`codex/codex-rs/core/src/stream_events_utils.rs`
- TUI 协议展示：`codex/codex-rs/tui/src/chatwidget/protocol.rs`

当前项目已经有自己的简化版：

- 共享事件类型：`agent/packages/contracts/src/seo.ts`
- 后端 stream API：`agent/apps/api/src/seo/seo.controller.ts`
- 后端生成逻辑：`agent/apps/api/src/seo/seo.service.ts`
- 前端 stream client：`agent/apps/web/src/api/seo.ts`
- 前端消费状态：`agent/apps/web/src/hooks/useSeoWorkspace.ts`

当前事件已经够用：

```text
start -> delta -> done
              -> error
              -> aborted
```

短期不要扩成 SSE/WebSocket/多协议。等 Tool Calling 加入后，再增加 `tool_call_start`、`tool_call_delta`、`tool_call_done`、`tool_call_error` 这类业务事件。

### 2.6 Tool spec 与 Tool runtime 分离

Codex 的工具系统有两层：

- model-visible spec：告诉模型能用什么工具、参数是什么。
- runtime handler：后端真实执行工具、处理权限、返回 observation。

关键路径：

- 工具规格组装：`codex/codex-rs/core/src/tools/spec_plan.rs`
- 工具路由：`codex/codex-rs/core/src/tools/router.rs`
- 工具注册与执行：`codex/codex-rs/core/src/tools/registry.rs`
- 并发工具运行：`codex/codex-rs/core/src/tools/parallel.rs`
- tool output 回到模型输入：`codex/codex-rs/core/src/stream_events_utils.rs`

对当前项目的启发：

后续实现 Tool Calling 时，不要让模型“直接操作系统或数据库”。模型只应该返回结构化 tool call；后端根据工具名和参数执行本地函数，再把结果作为 observation 交回模型。

当前项目最小可做：

```text
ToolDefinition
  -> name / description / inputSchema

ToolExecutor
  -> validate(input)
  -> execute(input)
  -> return observation

AgentRuntime
  -> 把 tool definitions 放进模型请求
  -> 识别模型 tool call
  -> 调用 ToolExecutor
  -> 把 observation 追加到下一次模型请求
```

### 2.7 权限、审批与 sandbox

Codex 作为 coding agent，可以读写文件、运行命令、应用 patch，所以权限不是 UI 提醒，而是执行约束。approval policy、sandbox policy、execpolicy、平台 sandbox 分别在不同层面拦截风险。

关键路径：

- 审批事件：`codex/codex-rs/protocol/src/protocol.rs`
- turn 中携带 approval / sandbox：`codex/codex-rs/core/src/session/turn.rs`
- 工具执行携带 sandbox tags：`codex/codex-rs/core/src/tools/registry.rs`
- sandbox 转换：`codex/codex-rs/sandboxing/src/manager.rs`
- 命令策略：`codex/codex-rs/execpolicy/README.md`

对当前项目的启发：

你的 SEO Agent 后续如果只是调用“关键词分析”“标题生成”这类纯函数，风险不高；但一旦工具会写数据库、调用外部 API、批量改页面 SEO 字段，就需要 human-in-the-loop。

第一版权限模型可以很小：

```text
low risk: 直接执行，例如本地 SEO 文本分析
medium risk: 执行前展示工具名、参数、预期影响，让用户确认
high risk: 暂不支持，例如真实发布、删除、批量覆盖数据
```

不要一开始实现复杂权限系统。先做一个明确的 `requiresConfirmation` 字段和确认流程。

### 2.8 上下文、状态与持久化

Codex 不把 UI transcript 等同于模型 history。它会维护运行时 history、rollout 事件日志、thread store、状态索引和 compaction。

关键路径：

- ContextManager：`codex/codex-rs/core/src/context_manager`
- SessionState：`codex/codex-rs/core/src/session/mod.rs`
- TurnContext：`codex/codex-rs/core/src/session/turn_context.rs`
- rollout：`codex/codex-rs/rollout/src/lib.rs`
- state_db：`codex/codex-rs/rollout/src/state_db.rs`
- thread store：`codex/codex-rs/thread-store/README.md`

对当前项目的启发：

当前 `ConversationMessage` 同时服务 UI 展示和模型 history。短期可以接受，但要建立边界意识：

- UI message：展示给用户看，包含状态、时间、错误提示。
- Model message：传给模型，应该是经过裁剪和结构化的上下文。
- Runtime event：生成过程中的事件，例如 delta、tool call、approval request。
- Persisted record：刷新后能恢复的最终结果或关键过程。

当前阶段 2 已经做了最近 12 条 history 控制，这是 Memory Layer 的第一步。后续不要急着做 RAG，先把 turn 内 tool observation 如何进入下一次模型请求跑通。

### 2.9 SDK 与协议边界

Codex SDK 不重写 agent loop，而是通过本地 Codex runtime / app-server 协议来启动 thread 和 turn。

关键路径：

- TypeScript 主入口：`codex/sdk/typescript/src/codex.ts`
- TypeScript exec 封装：`codex/sdk/typescript/src/exec.ts`
- Python client：`codex/sdk/python/src/openai_codex/client.py`
- app-server client：`codex/codex-rs/app-server-client/src/lib.rs`

对当前项目的启发：

当前阶段不用做 SDK。但如果后续想把 AI SEO Agent 嵌入其他后台系统，先保证 HTTP contract 清晰，再考虑 SDK。SDK 应该是协议客户端，不应该重新实现一套 Agent 流程。

## 3. 可迁移设计思想

| Codex 设计 | 解决的问题 | 当前项目对应实践 |
| --- | --- | --- |
| 多入口复用 core runtime | CLI / TUI / SDK 行为一致 | Web 和后端通过 `packages/contracts` 对齐协议 |
| Thread / Turn 分层 | 长会话和一次执行过程分离 | `Conversation` 是长会话，stream 请求是一次 turn |
| Submission / Event | 支持 interrupt、审批、工具过程和流式反馈 | 继续扩展 `ChatStreamEvent`，不要回到一次性 response |
| Tool spec / runtime 分离 | 模型只决定调用，后端负责执行 | 后续新增 `ToolDefinition` 和 `ToolExecutor` |
| 权限与 sandbox | 防止模型直接执行高风险操作 | 先做 `requiresConfirmation`，高风险工具暂不支持 |
| ContextManager / rollout | 区分模型上下文、UI transcript、持久化日志 | 区分 UI message、model message、runtime event |
| SDK 走协议 | 外部集成不复制 agent loop | 未来 SDK 只封装 HTTP contract |

## 4. 当前项目学习路线

### 阶段 A：收口 Session Chat 和 Streaming

目标：把阶段 2 / 3 从“基础链路完成”推进到“可稳定回归”。

当前事实：

- 阶段 2 已完成 Conversation / Message 持久化、session chat、最近 12 条 history。
- 阶段 3 已完成 NDJSON stream、前端逐 chunk 渲染、前端停止生成基础链路。
- 下一步明确是补齐后端真实中断和 `ABORTED` 持久化一致性。

建议任务：

1. 验证多会话不串线：A/B 两个 conversation 同时切换时，delta 只进入对应 conversation。
2. 补齐后端 aborted 语义：客户端断开或 abort 后，assistant message 最终状态应能稳定落到 `ABORTED`。
3. 固化错误恢复：模型失败时落库 `FAILED`，刷新页面能看到失败态。
4. 补一条最小回归测试或脚本，验证 `start / delta / done / error / aborted` 至少一条主路径。

验收标准：

- 刷新后能恢复已完成、失败、中断的 assistant message。
- 停止生成后 UI 不再追加内容，后端状态不残留 `STREAMING`。
- 阶段 2 的多 conversation 能力不被阶段 3 破坏。

### 阶段 B：Tool Calling 最小闭环

目标：从普通聊天进入真正 agent 能力，但只做一个低风险工具。

推荐工具：

```text
analyze_seo_text
输入：页面标题、描述、关键词或一段正文
输出：结构化 SEO 诊断建议
风险：low，不需要确认
```

建议流程：

```text
用户输入
  -> 保存 user message
  -> 构造带 tool definitions 的模型请求
  -> 模型选择是否调用 analyze_seo_text
  -> 后端执行工具
  -> 工具结果作为 observation 进入下一次模型请求
  -> 模型生成最终回答
  -> assistant message 落库
```

要学到的点：

- 模型决定调用哪个工具，不代表模型执行工具。
- 工具参数必须后端校验。
- 工具结果要回到模型上下文，最终回答仍由模型生成。

暂不做：

- 多工具并发。
- 外部搜索。
- 真实写数据库。
- 工具市场和插件系统。

### 阶段 C：工具注册与执行边界

目标：把 Tool Calling 从单个 if/else 收敛成最小注册表。

推荐结构：

```text
ToolDefinition
  -> name
  -> description
  -> inputSchema
  -> riskLevel
  -> requiresConfirmation

ToolExecutor
  -> execute(input)
```

学习 Codex 的点：

- `spec_plan.rs` 负责组装给模型看的工具。
- `router.rs` 负责识别模型返回的工具调用。
- `registry.rs` 负责找到真实 executor。
- `parallel.rs` 负责并发和取消；当前项目第一版不用学。

当前项目第一版只需要：

- 一个 `ToolService`。
- 一个工具 map。
- 一个输入校验函数。
- 一个 observation 格式。

### 阶段 D：Human-in-the-loop

目标：让中风险工具执行前需要用户确认。

推荐练习工具：

```text
update_seo_draft
输入：conversationId、草稿标题、草稿描述
行为：只保存草稿，不发布
风险：medium，需要确认
```

建议事件：

```text
tool_call_pending_confirmation
tool_call_confirmed
tool_call_rejected
tool_call_done
tool_call_error
```

验收标准：

- 用户可以看到工具名、参数摘要和影响范围。
- 用户拒绝后，工具不执行，并把拒绝结果作为 observation 返回给模型。
- 用户确认后，后端执行工具并记录结果。

### 阶段 E：上下文与状态管理

目标：拆清 UI message、model history、runtime event。

建议最小改造：

- 保留 `ConversationMessage` 做 UI 与持久化主记录。
- 在 service 内部构造 `ModelMessage[]`，只放模型需要看的内容。
- Tool observation 不一定直接展示成普通 assistant 文本，可以先作为内部上下文记录。

验收标准：

- 长历史不会全部传给模型。
- 工具结果能参与后续回答。
- UI 展示不会被内部 observation 污染。

### 阶段 F：错误恢复与观测

目标：Agent 流程出错时能定位是哪一层失败。

建议错误分类：

```text
llm_error: 模型 API、限流、超时、模型名错误
tool_validation_error: 工具参数不合法
tool_execution_error: 工具执行失败
user_abort: 用户停止生成
runtime_error: Agent 流程自身错误
```

最小观测内容：

- conversationId
- turnId 或 requestId
- model
- stream event type
- tool name
- message status
- error type

暂不做复杂面板。先让日志和数据库状态能解释问题。

## 5. 阶段目标与验收标准

| 阶段 | 目标 | 验收标准 |
| --- | --- | --- |
| A. 收口 Streaming | 稳定完成 / 失败 / 中断状态 | 无残留 `STREAMING`，刷新可恢复最终状态 |
| B. 最小 Tool Calling | 跑通一个低风险工具闭环 | 模型发起 tool call，后端执行，observation 回到模型 |
| C. 工具注册表 | 工具定义和执行分离 | 新增第二个工具时不复制主流程 |
| D. 人工确认 | 中风险工具执行前确认 | 拒绝不执行，确认才执行 |
| E. 上下文管理 | UI / model / runtime 状态分层 | history 可控，工具结果不污染 UI |
| F. 错误恢复 | 失败可定位、可恢复 | 每类失败有状态、日志和用户可见反馈 |

## 6. 暂时不学的内容

这些不是不重要，而是现在学会分散主线：

- Rust 语法细节。
- TUI cell 渲染和终端 UI 布局。
- 多 agent 协作。
- RAG 和向量数据库。
- 复杂 workflow engine。
- 本地模型部署。
- 插件市场和 MCP 完整生态。
- WebSocket 多路复用。
- 生产级权限矩阵。

当前最重要的是：

```text
把一个用户请求建模成可观察、可中断、可恢复、可调用工具的一次 turn。
```

## 7. 后续提问模板

如果继续用 Codex 仓库辅助学习，建议不要问“帮我讲整个 Codex 架构”。可以这样问：

```text
请沿着 codex 的“用户输入一条消息 -> run_turn -> 模型返回 tool call -> 工具执行 -> observation 回到模型”这条链路解释，不要展开无关 Rust 细节。请最后映射到 agent 当前项目应该怎么实现最小 Tool Calling。
```

```text
请只比较 codex 的 ToolRouter / ToolRegistry 和 agent 项目未来 ToolService 的职责边界，给出 TypeScript/NestJS 版本的最小设计，不要引入插件系统。
```

```text
请用前端状态流和 API contract 的类比解释 codex 的 Submission / Event 模型，并告诉我 agent 当前 NDJSON ChatStreamEvent 下一步应该增加哪些事件。
```

```text
请根据 agent/docs/tasks/phase-03-streaming-chat-experience.md，帮我设计“停止生成后后端 aborted 持久化一致性”的最小实现计划。
```

这些问题都比“总结源码”更有效，因为它们会逼着学习回到当前项目的下一步实现。
