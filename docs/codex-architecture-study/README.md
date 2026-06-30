# Codex 开源项目架构精读与 AI SEO Agent 学习路线

本文档是对 `<codex>` 的只读源码研究产物。目标不是复刻 Codex，也不是学习 Rust 语法细节，而是把 Codex 作为一个生产级 Agent 应用样本，提炼出可以迁移到当前 `<agent>` AI SEO Agent 项目的工程思想。

路径约定：`<codex>` 表示 Codex 仓库根目录，`<agent>` 表示当前 AI SEO Agent 项目根目录，避免绑定某台电脑的用户名。

配套文档：

- [source-map.md](./source-map.md)：源码阅读范围与模块索引。
- [main-flows.md](./main-flows.md)：7 条核心链路的详细源码追踪。
- [agent-migration-roadmap.md](./agent-migration-roadmap.md)：映射到当前 AI SEO Agent 项目的落地路线。
- [mindmap-codex-runtime.md](./mindmap-codex-runtime.md)：Codex runtime 架构思维导图。
- [mindmap-ai-seo-migration.md](./mindmap-ai-seo-migration.md)：迁移到 AI SEO Agent 的路线图。

## 1. 阅读范围与源码依据

本次不是只读 `README` 或已有 `learning-roadmap` 后总结，而是覆盖了 Codex 的核心运行链路、协议层、持久化、安全边界和 SDK 复用方式。

重点阅读目录：

| 方向 | 主要源码依据 | 关键类型 / 函数 / 模块 |
| --- | --- | --- |
| 顶层入口 | `<codex>/codex-rs/cli/src/main.rs`、`<codex>/codex-rs/tui/src/main.rs`、`<codex>/codex-rs/tui/src/cli.rs`、`<codex>/codex-rs/exec/src/lib.rs` | `MultitoolCli`、`TopCli`、`ExecCli`、`InProcessAppServerClient` |
| app-server 协议层 | `<codex>/codex-rs/app-server/README.md`、`<codex>/codex-rs/app-server/src/message_processor.rs`、`<codex>/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`、`<codex>/codex-rs/app-server-protocol/src/protocol/v2/turn.rs` | `ClientRequest`、`ThreadStartParams`、`ThreadResumeParams`、`ThreadForkParams`、`TurnStartParams` |
| core runtime | `<codex>/codex-rs/core/src/session/mod.rs`、`<codex>/codex-rs/core/src/session/handlers.rs`、`<codex>/codex-rs/core/src/tasks/mod.rs`、`<codex>/codex-rs/core/src/tasks/regular.rs`、`<codex>/codex-rs/core/src/session/turn.rs` | `Codex`、`Session`、`submission_loop`、`SessionTask`、`RegularTask`、`run_turn` |
| thread / turn / session | `<codex>/codex-rs/core/src/codex_thread.rs`、`<codex>/codex-rs/core/src/thread_manager.rs`、`<codex>/codex-rs/app-server/src/request_processors/thread_processor.rs`、`<codex>/codex-rs/app-server/src/request_processors/turn_processor.rs` | `CodexThread`、`ThreadManager`、`start_thread_with_options`、`resume_thread_with_history`、`fork_thread_from_history`、`turn_start_inner` |
| model client / streaming | `<codex>/codex-rs/core/src/client.rs`、`<codex>/codex-rs/core/src/client_common.rs`、`<codex>/codex-rs/codex-api/src/sse/responses.rs`、`<codex>/codex-rs/codex-api/src/common.rs` | `ModelClient`、`ModelClientSession::stream`、`Prompt`、`ResponseEvent` |
| tool spec / router / registry / runtime | `<codex>/codex-rs/core/src/tools/spec_plan.rs`、`<codex>/codex-rs/core/src/tools/router.rs`、`<codex>/codex-rs/core/src/tools/registry.rs`、`<codex>/codex-rs/core/src/tools/parallel.rs` | `build_tool_router`、`ToolRouter`、`ToolRegistry`、`CoreToolRuntime`、`ToolCallRuntime` |
| approval / permission / sandbox / execpolicy | `<codex>/codex-rs/core/src/tools/orchestrator.rs`、`<codex>/codex-rs/core/src/tools/sandboxing.rs`、`<codex>/codex-rs/core/src/exec_policy.rs`、`<codex>/codex-rs/sandboxing/src/manager.rs`、`<codex>/codex-rs/execpolicy/src/policy.rs` | `ToolOrchestrator`、`ExecApprovalRequirement`、`PermissionProfile`、`SandboxManager`、`Policy::check_multiple_with_options` |
| context / history / compaction | `<codex>/codex-rs/core/src/context_manager/history.rs`、`<codex>/codex-rs/core/src/context_manager/normalize.rs`、`<codex>/codex-rs/core/src/session/context_window.rs`、`<codex>/codex-rs/core/src/compact.rs`、`<codex>/codex-rs/core/src/session/rollout_reconstruction.rs` | `ContextManager`、`for_prompt`、`normalize_history`、`context_window_token_status`、`run_auto_compact`、`reconstruct_history_from_rollout` |
| rollout / thread-store / state | `<codex>/codex-rs/rollout/src/recorder.rs`、`<codex>/codex-rs/rollout/src/policy.rs`、`<codex>/codex-rs/thread-store/src/store.rs`、`<codex>/codex-rs/thread-store/src/live_thread.rs`、`<codex>/codex-rs/state/src/extract.rs` | `RolloutRecorder`、`RolloutItem`、`is_persisted_rollout_item`、`ThreadStore`、`LiveThread`、`apply_rollout_item` |
| skills / plugins / MCP | `<codex>/codex-rs/core-skills/src/model.rs`、`<codex>/codex-rs/core-skills/src/service.rs`、`<codex>/codex-rs/core-skills/src/render.rs`、`<codex>/codex-rs/plugin/src/manifest.rs`、`<codex>/codex-rs/codex-mcp/src/catalog.rs`、`<codex>/codex-rs/codex-mcp/src/connection_manager.rs` | `SkillMetadata`、`SkillsService`、`build_available_skills`、`PluginManifestPaths`、`ResolvedMcpCatalog`、`McpConnectionManager` |
| SDK | `<codex>/sdk/python/src/openai_codex/client.py`、`<codex>/sdk/python/src/openai_codex/_message_router.py`、`<codex>/sdk/typescript/src/exec.ts`、`<codex>/sdk/typescript/src/thread.ts`、`<codex>/codex-rs/app-server-client/README.md` | `CodexClient`、`MessageRouter`、`CodexExec.run`、`Thread.runStreamedInternal`、`InProcessAppServerClient` |

同时读取了当前项目资料：

- `<agent>/docs/development-task-plan.md`
- `<agent>/docs/tasks/phase-02-agent-chat-session.md`
- `<agent>/docs/tasks/phase-03-streaming-chat-experience.md`
- `<agent>/docs/work-log.md`
- `<agent>/packages/contracts/src/seo.ts`
- `<agent>/packages/contracts/src/conversation.ts`
- `<agent>/apps/api/src/seo/seo.service.ts`
- `<agent>/apps/api/src/seo/seo.controller.ts`
- `<agent>/apps/api/src/llm/llm.service.ts`
- `<agent>/apps/api/src/llm/clients/openai-compatible.client.ts`
- `<agent>/apps/web/src/api/seo.ts`
- `<agent>/apps/web/src/hooks/useSeoWorkspace.ts`
- `<agent>/prisma/schema.prisma`

未充分展开的模块：

- TUI 具体组件渲染、快捷键、终端绘制细节没有深入，因为它们主要是产品交互层，不是 Agent runtime 精髓。
- cloud / chatgpt / remote 相关功能没有深入，因为当前项目还不需要云端任务编排。
- realtime audio / WebRTC 没有深入，因为当前 AI SEO Agent 仍处在文本 chat streaming 阶段。
- 所有平台 sandbox 的底层系统调用没有逐行深挖，只阅读了 `SandboxManager`、macOS/Linux/Windows 边界和执行链路；当前项目暂不需要实现 OS 级 sandbox。
- MCP server 的完整协议实现没有逐行阅读，但已读清楚 `codex-mcp` 作为 MCP client、`mcp-server` 作为 MCP server 的职责边界。

## 2. Codex 一句话架构

Codex 不是“一个命令行聊天工具”，而是一个本地运行的、事件驱动的 Agent runtime：多种入口（TUI、CLI exec、app-server、SDK）都通过协议或 in-process client 把用户输入转换成 `Op::UserInput`，交给 core `Session` 的 submission queue；core 负责模型 streaming、工具调度、权限审批、sandbox 执行、上下文压缩和持久化；UI/SDK 只消费事件流，不复制 Agent loop。

用前端工程师熟悉的方式类比：

```txt
Vue 页面 / CLI / SDK
  不是业务状态源
  只是 dispatch action + subscribe event

app-server
  像 BFF + 协议网关
  把 thread/start、turn/start、approval 等能力变成稳定 API

core runtime
  像真正的 store + effect runtime
  管 task、turn、model stream、tool effect、权限、history、persistence

thread-store / rollout
  像可恢复的事件日志 + 查询索引
  不保存每个 UI delta，只保存可重放的关键事实
```

它的核心价值不是 Rust 写得复杂，而是把 Agent 运行中容易混在一起的东西拆开了：

- 用户看到的消息。
- 模型需要的上下文。
- 运行时事件。
- 工具调用和 observation。
- 权限审批。
- 可重放持久化日志。
- SDK 和 UI 的协议边界。

## 3. Codex 核心主链路

更详细的源码追踪见 [main-flows.md](./main-flows.md)。这里先按主线建立整体心智模型。

### 3.1 用户输入如何进入 core runtime

TUI 和 exec 都不是直接调用模型。顶层 `codex-rs/cli/src/main.rs` 的 `MultitoolCli` 只是分发子命令，TUI 入口在 `codex-rs/tui/src/main.rs` 和 `codex-rs/tui/src/cli.rs`，非交互执行入口在 `codex-rs/exec/src/lib.rs`。

`codex-rs/app-server-client/README.md` 明确说明 TUI 和 exec 共享 `InProcessAppServerClient`，这个 client 保留 app-server 语义，只是移除外部进程边界。也就是说：

```txt
TUI / exec
  -> InProcessAppServerClient
  -> app-server typed protocol
  -> turn/start
  -> Op::UserInput
  -> core Session submission queue
```

源码依据：

- `<codex>/codex-rs/exec/src/lib.rs` 使用 `codex_app_server_client::InProcessAppServerClient`。
- `<codex>/codex-rs/app-server-client/README.md` 说明 in-process path 使用 `ClientRequest` / `ClientNotification` / `InProcessServerEvent` typed channels。
- `<codex>/codex-rs/app-server/src/request_processors/turn_processor.rs` 的 `turn_start_inner` 把 `TurnStartParams` 转成 core `Op::UserInput`。
- `<codex>/codex-rs/core/src/codex_thread.rs` 的 `CodexThread::submit_user_input_with_client_user_message_id` 把 op 提交给 core session。

这解决的 Agent 工程问题：UI 输入不能直接等一个同步函数返回，因为中间可能发生模型流式输出、tool call、审批、用户 interrupt、上下文压缩和持久化。入口层只负责把输入变成标准操作。

### 3.2 Thread 如何创建、恢复、保存和 fork

Codex 的 `Thread` 对应一条可恢复、可持久化、可 fork 的 Agent 工作线，不是一次 HTTP 请求。

创建链路：

```txt
thread/start
  -> ThreadRequestProcessor::thread_start
  -> thread_start_task
  -> ThreadManager::start_thread_with_options
  -> Codex::spawn
  -> Session + submission_loop
  -> attach listener
  -> ThreadStartResponse + thread/started notification
```

恢复链路：

```txt
thread/resume
  -> resume_running_thread 如果内存中已加载则 rejoin
  -> 否则从 history/path/thread_id 读取 rollout
  -> ThreadManager::resume_thread_with_history
  -> Session::record_initial_history
  -> reconstruct_history_from_rollout
```

Fork 链路：

```txt
thread/fork
  -> 读取源 thread history
  -> 可按 last_turn_id 截断
  -> ThreadManager::fork_thread_from_history
  -> 新 thread id + copied history
```

保存链路：

```txt
Session 运行中产生 ResponseItem / EventMsg
  -> record_conversation_items / send_event
  -> rollout policy 选择可持久化项
  -> LiveThread.append_items
  -> ThreadStore.append_items
  -> local JSONL rollout + SQLite metadata
```

源码依据：

- `<codex>/codex-rs/app-server/src/request_processors/thread_processor.rs`：`thread_start_task`、`thread_resume_inner`、`thread_fork_inner`。
- `<codex>/codex-rs/core/src/thread_manager.rs`：`start_thread_with_options`、`resume_thread_with_history`、`fork_thread_from_history`。
- `<codex>/codex-rs/thread-store/src/store.rs`：`ThreadStore`。
- `<codex>/codex-rs/thread-store/src/live_thread.rs`：`LiveThread`。
- `<codex>/codex-rs/rollout/src/policy.rs`：`is_persisted_rollout_item`、`should_persist_response_item`、`should_persist_event_msg`。

这解决的 Agent 工程问题：用户不是只问一次。生产 Agent 需要刷新后恢复、断线后 rejoin、从历史某一点分支、只持久化可重放事实，而不是把 UI 状态当数据源。

### 3.3 一个 turn 如何从用户输入到 streaming 完成

核心链路：

```txt
Op::UserInput
  -> Codex submission queue
  -> submission_loop
  -> user_input_or_turn_inner
  -> TurnContext
  -> Session::spawn_task(RegularTask)
  -> RegularTask::run
  -> run_turn
  -> build Prompt + ToolRouter
  -> ModelClientSession::stream
  -> ResponseEvent stream
  -> AgentMessageContentDelta / ItemStarted / ItemCompleted
  -> TurnComplete
```

源码依据：

- `<codex>/codex-rs/protocol/src/protocol.rs`：`Submission`、`Op::UserInput`、`Event`、`EventMsg`。
- `<codex>/codex-rs/core/src/session/handlers.rs`：`submission_loop`、`user_input_or_turn_inner`。
- `<codex>/codex-rs/core/src/tasks/mod.rs`：`SessionTask`、`spawn_task`、`start_task`。
- `<codex>/codex-rs/core/src/tasks/regular.rs`：`RegularTask::run`。
- `<codex>/codex-rs/core/src/session/turn.rs`：`run_turn`、`run_sampling_request`、`try_run_sampling_request`。
- `<codex>/codex-rs/core/src/client.rs`：`ModelClientSession::stream`。

这解决的 Agent 工程问题：一个 turn 不只是“调用模型并返回文本”，它是一次可被观测、可中断、可能包含多次模型采样和工具执行的异步任务。

### 3.4 Tool call 如何执行并回传 observation

模型不会直接执行工具。模型只输出结构化 tool call，core 负责识别、校验、执行，并把 observation 写回模型历史。

核心链路：

```txt
ResponseEvent::OutputItemDone
  -> handle_output_item_done
  -> ToolRouter::build_tool_call
  -> ToolCallRuntime::handle_tool_call
  -> ToolRouter::dispatch_tool_call_with_terminal_outcome
  -> ToolRegistry::dispatch_any_with_terminal_outcome
  -> handler / runtime 执行工具
  -> ResponseInputItem::*Output
  -> record_conversation_items
  -> 下一轮 sampling 的 prompt input
```

源码依据：

- `<codex>/codex-rs/core/src/stream_events_utils.rs`：`handle_output_item_done`。
- `<codex>/codex-rs/core/src/tools/router.rs`：`ToolRouter::build_tool_call`、`dispatch_tool_call_with_terminal_outcome`。
- `<codex>/codex-rs/core/src/tools/parallel.rs`：`ToolCallRuntime::handle_tool_call`。
- `<codex>/codex-rs/core/src/tools/registry.rs`：`ToolRegistry::dispatch_any_with_terminal_outcome`。
- `<codex>/codex-rs/protocol/src/models.rs`：`ResponseItem::FunctionCall`、`ResponseItem::CustomToolCall`、`ResponseInputItem::FunctionCallOutput` 等。

这解决的 Agent 工程问题：模型负责“决定要不要调用工具”和“生成参数”，后端负责“是否允许、如何执行、结果如何编码”。这条边界是 Tool Calling 安全性的根。

### 3.5 权限、审批和 sandbox 如何保护命令执行

Codex 的安全不是一个 `confirm()`，而是多层防线：

```txt
tool handler 解析命令
  -> ExecPolicyManager 判断 Allow / Prompt / Forbidden
  -> ExecApprovalRequirement
  -> ToolOrchestrator 编排审批和 sandbox
  -> EventMsg::ExecApprovalRequest / ApplyPatchApprovalRequest
  -> Op::ExecApproval / PatchApproval 回传决策
  -> PermissionProfile + sandbox policy 描述可读写/网络能力
  -> SandboxManager 转换为平台 sandbox
  -> execute_env / exec-server 执行
  -> sandbox denial / timeout / output limit 归一化
```

源码依据：

- `<codex>/codex-rs/core/src/exec_policy.rs`：`ExecPolicyManager::create_exec_approval_requirement_for_command`。
- `<codex>/codex-rs/execpolicy/src/policy.rs`：`Policy::check_multiple_with_options`。
- `<codex>/codex-rs/core/src/tools/sandboxing.rs`：`ExecApprovalRequirement`、`default_exec_approval_requirement`。
- `<codex>/codex-rs/core/src/tools/orchestrator.rs`：`ToolOrchestrator::run`。
- `<codex>/codex-rs/protocol/src/protocol.rs`：`EventMsg::ExecApprovalRequest`、`Op::ExecApproval`、`ReviewDecision`。
- `<codex>/codex-rs/protocol/src/permissions.rs`：`FileSystemSandboxPolicy`、`NetworkSandboxPolicy`。
- `<codex>/codex-rs/sandboxing/src/manager.rs`：`SandboxManager::select_initial`、`transform`。

这解决的 Agent 工程问题：高风险工具不能只靠模型自觉，也不能只靠 UI 提示。审批解决“是否允许”，sandbox 解决“即使运行了也不能越界”。

### 3.6 上下文过长、历史恢复和 compaction

Codex 把“展示历史”和“模型上下文”分开。模型上下文由 `ContextManager` 管理，恢复由 rollout 重建，压缩由 compaction 替换 history checkpoint。

核心链路：

```txt
record_conversation_items
  -> ContextManager.record_items
  -> ContextManager.for_prompt
  -> normalize_history
  -> context_window_token_status
  -> run_auto_compact
  -> run_compact_task_inner_impl
  -> build_compacted_history
  -> Session::replace_compacted_history
  -> RolloutItem::Compacted
```

恢复链路：

```txt
RolloutRecorder::get_rollout_history
  -> InitialHistory::Resumed
  -> Session::record_initial_history
  -> apply_rollout_reconstruction
  -> reconstruct_history_from_rollout
  -> 从最近 Compacted checkpoint 正向 replay 后续 RolloutItem
```

源码依据：

- `<codex>/codex-rs/core/src/context_manager/history.rs`：`ContextManager`、`record_items`、`for_prompt`、`remove_first_item`。
- `<codex>/codex-rs/core/src/context_manager/normalize.rs`：`ensure_call_outputs_present`、`remove_orphan_outputs`。
- `<codex>/codex-rs/core/src/session/context_window.rs`：`context_window_token_status`。
- `<codex>/codex-rs/core/src/compact.rs`：`run_compact_task_inner_impl`。
- `<codex>/codex-rs/core/src/session/mod.rs`：`replace_compacted_history`。
- `<codex>/codex-rs/core/src/session/rollout_reconstruction.rs`：`reconstruct_history_from_rollout`。

这解决的 Agent 工程问题：长对话不能无限塞给模型；恢复也不能简单把 JSONL 全量拼回 prompt。需要有模型历史、可重放日志和压缩 checkpoint 的分层。

### 3.7 SDK 如何复用 runtime

Python SDK 是直接协议客户端：

```txt
CodexClient.start
  -> spawn codex app-server --listen stdio://
  -> initialize / initialized
  -> thread_start / turn_start JSON-RPC
  -> MessageRouter 分流 response / notification / turn stream
```

TypeScript SDK 当前不是直接连 app-server JSON-RPC，而是调用 `codex exec --experimental-json`：

```txt
CodexExec.run
  -> spawn codex exec --experimental-json
  -> stdin 输入
  -> stdout JSONL events
  -> Thread.runStreamedInternal 解析 thread.started / item.completed / turn.completed
  -> codex exec 内部仍使用 InProcessAppServerClient
```

源码依据：

- `<codex>/sdk/python/src/openai_codex/client.py`：`CodexClient.start`、`thread_start`、`turn_start`。
- `<codex>/sdk/python/src/openai_codex/_message_router.py`：`MessageRouter`。
- `<codex>/sdk/typescript/src/exec.ts`：`CodexExec.run`。
- `<codex>/sdk/typescript/src/thread.ts`：`Thread.runStreamedInternal`。
- `<codex>/codex-rs/exec/src/lib.rs`：`InProcessAppServerClient`。

这解决的 Agent 工程问题：SDK 不应该重写 Agent loop，否则权限、持久化、compaction、tool calling、streaming 行为会分叉。SDK 应该是协议客户端或 runtime facade。

## 4. 核心架构概念

### Thread

`Thread` 是一条可持续的 Agent 工作线，包含多个 turn、items、metadata、settings 和持久化历史。

它解决的问题：

- 多轮对话归属。
- 刷新、重启、断线后恢复。
- fork 到某个历史点继续探索。
- 按 thread 查询、归档、删除、命名。

源码依据：

- `<codex>/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `<codex>/codex-rs/app-server/src/request_processors/thread_processor.rs`
- `<codex>/codex-rs/core/src/thread_manager.rs`
- `<codex>/codex-rs/thread-store/src/store.rs`

迁移到当前项目：你的 `Conversation` 已经承担了最小版 Thread 职责，见 `<agent>/prisma/schema.prisma` 的 `model Conversation` 和 `model Message`。

### Session

`Session` 是 thread 被加载后的运行态容器。它持有配置、队列、active turn、服务依赖、approval waiter、conversation history、runtime MCP 状态等。

它解决的问题：

- 同一个 thread 当前是否有 active task。
- 用户输入、approval、interrupt 等 op 如何排队。
- runtime 服务如何共享。
- 配置和权限如何在运行中变更。

源码依据：

- `<codex>/codex-rs/core/src/session/session.rs` 的 `Session`
- `<codex>/codex-rs/core/src/session/mod.rs` 的 `Codex::spawn_internal`
- `<codex>/codex-rs/core/src/session/handlers.rs` 的 `submission_loop`

迁移到当前项目：你现在没有显式 `Session` 对象，相关职责分散在 `SeoService.chatStream()`、Prisma、`useSeoWorkspace` 的 active stream 状态里。短期可以先不抽完整 `Session`，但下一步应引入轻量 `Turn` / `RuntimeEvent` 概念，避免 `SeoService` 越来越胖。

### Turn

`Turn` 是一次用户输入触发的 Agent 执行周期。它可能包含多次模型 sampling、多个 tool call、多个 observation，也可能被中断。

它解决的问题：

- 一次用户输入的生命周期状态。
- start / delta / tool / done / error / aborted 的归属。
- 运行中消息和最终消息的关联。
- 多会话同时存在时不串线。

源码依据：

- `<codex>/codex-rs/app-server-protocol/src/protocol/v2/turn.rs`
- `<codex>/codex-rs/core/src/session/turn.rs`
- `<codex>/codex-rs/protocol/src/protocol.rs` 的 `TurnStartedEvent`、`TurnCompleteEvent`、`TurnAborted`

迁移到当前项目：你现在有 `ChatStreamEvent` 和 `assistantMessageId`，但还没有显式 `turnId`。短期可把 `assistantMessageId` 当作 turn anchor，但更清晰的方案是后续新增 `turnId`，让 user message、assistant message、tool observation 都归属同一 turn。

### Task

`Task` 是 runtime 内部异步执行单元。`RegularTask` 负责普通对话，`CompactTask` 负责压缩。task 可被取消、替换、完成。

它解决的问题：

- 当前运行的是普通对话、压缩、review 还是别的任务。
- 新输入到来时是否中断旧任务。
- 后台 async 工作如何统一生命周期。

源码依据：

- `<codex>/codex-rs/core/src/tasks/mod.rs`：`SessionTask`、`spawn_task`、`abort_all_tasks`
- `<codex>/codex-rs/core/src/tasks/regular.rs`：`RegularTask`
- `<codex>/codex-rs/core/src/tasks/compact.rs`：`CompactTask`

迁移到当前项目：现在可以先不用显式 `Task` 抽象。等你有 manual compaction、tool calling、后台 SEO audit 时再抽。

### Event

`Event` 是 runtime 对外输出的事实流。Codex 的 `EventMsg` 很多，包括 delta、item started、tool begin/end、approval request、turn complete、turn aborted 等。

它解决的问题：

- UI 不需要阻塞等待最终回复。
- SDK 可以逐步消费进度。
- 审批、工具执行、错误、中断都能被统一表达。
- 持久化策略可以选择哪些事件需要落盘。

源码依据：

- `<codex>/codex-rs/protocol/src/protocol.rs`：`Event`、`EventMsg`
- `<codex>/codex-rs/core/src/session/mod.rs`：`Session::send_event`
- `<codex>/codex-rs/rollout/src/policy.rs`：事件持久化策略

迁移到当前项目：`ChatStreamEvent` 已经是最小版 runtime event，但它还偏 UI 消息协议。下一步建议扩展为更清晰的 `AgentRuntimeEvent`，内部可包含 `message.delta`、`turn.completed`、`turn.aborted`、`tool.approval_required` 等，再由 API 映射成 NDJSON。

### Tool

Codex 的 tool 被拆成三层：

- `ToolSpec`：给模型看的工具说明和参数 schema。
- `ToolRouter`：把模型输出解析成内部 `ToolCall`。
- `ToolRegistry` / runtime：真正执行工具、跑 hooks、做 telemetry、返回 observation。

它解决的问题：

- 模型可见契约和本地执行能力不混在一起。
- 可以隐藏某些 runtime 细节。
- 可以统一加审批、并发控制、hook、telemetry。
- 工具结果能规范回填给模型。

源码依据：

- `<codex>/codex-rs/core/src/tools/spec_plan.rs`
- `<codex>/codex-rs/core/src/tools/router.rs`
- `<codex>/codex-rs/core/src/tools/registry.rs`
- `<codex>/codex-rs/core/src/tools/parallel.rs`

迁移到当前项目：后续 Tool Calling 先做最小闭环即可：`ToolDefinition`、`ToolExecutor`、`ToolRegistry` 三件套，不要一开始做插件市场、MCP、动态工具搜索。

### Context

`Context` 不是 UI 消息数组，而是模型请求前经过筛选、规范化、压缩后的 `ResponseItem` 序列。

它解决的问题：

- 不把所有 UI 内容塞给模型。
- tool call 和 output 必须配对，避免模型看到无效历史。
- 模型不支持某种输入模态时可以降级。
- 长历史可以压缩或截断。

源码依据：

- `<codex>/codex-rs/core/src/context_manager/history.rs`
- `<codex>/codex-rs/core/src/context_manager/normalize.rs`
- `<codex>/codex-rs/core/src/session/context_window.rs`

迁移到当前项目：你现在在 `<agent>/apps/api/src/seo/seo.service.ts` 用 `CHAT_HISTORY_LIMIT = 12` 取最近消息，并用 `buildSeoAgentChatMessages()` 加 system prompt。这是很好的第一版 ContextManager，但后续加入 tool observation 后，不能再只靠 `role/content` 简化结构。

### Rollout

`Rollout` 是可重放的持久化事件日志。它不是完整 UI event dump，而是经过 policy 过滤后的 canonical facts。

它解决的问题：

- 重启后恢复 thread。
- compaction 后从 checkpoint 继续。
- 不保存每个 delta，避免日志膨胀。
- 与 SQLite metadata 分工。

源码依据：

- `<codex>/codex-rs/rollout/src/recorder.rs`
- `<codex>/codex-rs/rollout/src/policy.rs`
- `<codex>/codex-rs/thread-store/src/live_thread.rs`
- `<codex>/codex-rs/state/src/extract.rs`

迁移到当前项目：当前 PostgreSQL 的 `Message` 表已经是最小持久化层。短期不需要 JSONL rollout，但需要学习 Codex 的原则：delta 是实时事件，最终 assistant message、aborted 状态、error 状态才是该持久化的事实。

## 5. 生产级 Agent 设计思想

### 5.1 多入口共享一个 runtime

Codex 有 TUI、exec、app-server、SDK，但它们不各自实现模型循环。

源码证据：

- `codex-rs/cli/src/main.rs` 的 `MultitoolCli` 只是分发入口。
- `codex-rs/exec/src/lib.rs` 使用 `InProcessAppServerClient`。
- `codex-rs/app-server-client/README.md` 说明 TUI/exec 共享 in-process app-server runtime。
- `codex-rs/core/src/session/mod.rs` 的 `Codex::spawn_internal` 才是 core queue/runtime 初始化。

设计动机：如果每个入口都自己写 agent loop，tool calling、权限、安全策略、持久化、compaction 行为必然分叉。生产 Agent 应该只有一个 runtime，多个 surface 只是协议客户端。

迁移建议：当前 AI SEO Agent 只有 Web UI + Nest API，暂时不需要 app-server。但是你应避免未来出现“普通 chat 接口一套逻辑、stream 接口一套逻辑、tool calling 又一套逻辑”。可以逐步把 `SeoService.chat()` 和 `SeoService.chatStream()` 收敛到同一个 runtime flow。

### 5.2 app-server 是协议门面，不是第二套 Agent

源码证据：

- `codex-rs/app-server/src/message_processor.rs` 根据 `ClientRequest` 路由到 thread/turn/config/mcp/plugin 等 processor。
- `codex-rs/app-server/src/request_processors/turn_processor.rs` 的 `turn_start_inner` 构造 `Op::UserInput` 后提交给 `CodexThread`。
- `codex-rs/app-server/README.md` 把 API 抽象成 `thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`item/*` events。

设计动机：协议层要稳定、可跨语言、可重连、可做能力协商；runtime 层要处理复杂状态和副作用。两者不能混。

迁移建议：你的 Nest Controller 应保持“协议边界”职责，类似 `SeoController.chatStream()` 只处理 HTTP NDJSON、headers、close -> abort；业务 loop 留在 service/runtime 层。

### 5.3 Agent loop 必须事件化

源码证据：

- `codex-rs/protocol/src/protocol.rs` 的 `Submission` / `Op` / `Event` / `EventMsg`。
- `codex-rs/core/src/session/handlers.rs` 的 `submission_loop`。
- `codex-rs/core/src/session/turn.rs` 的 `try_run_sampling_request` 将 `ResponseEvent` 映射为 `AgentMessageContentDelta`、`ItemStarted`、`ItemCompleted` 等。

设计动机：Agent 执行过程不是单值返回，而是一串事实：开始、模型 delta、工具参数 delta、工具执行、审批请求、错误、完成、中断。同步函数只能表达最终结果，表达不了过程。

迁移建议：你已经有 `ChatStreamEvent`。下一步要避免它继续膨胀成 UI 专用协议，建议引入内部 `RuntimeEvent`，再映射到外部 NDJSON。

### 5.4 Tool spec 和 Tool runtime 必须分离

源码证据：

- `spec_plan.rs` 的 `build_tool_specs_and_registry` 同时构造 model-visible specs 和 runtime registry。
- `router.rs` 的 `ToolRouter::build_tool_call` 只识别模型输出。
- `registry.rs` 的 `ToolRegistry::dispatch_any_with_terminal_outcome` 才执行本地 runtime、pre/post hooks、telemetry。

设计动机：模型看到的是“工具怎么调用”，后端拥有的是“工具能不能执行、怎么执行、风险多大、结果如何回传”。两者混在一起会导致无法审批、无法观测、无法替换实现。

迁移建议：AI SEO Agent 的第一批工具可以是低风险只读工具，例如 `analyze_page_title`、`extract_keywords_from_text`、`score_meta_description`。先做定义、执行、observation 闭环，再考虑外部搜索和写操作。

### 5.5 权限是产品语义，sandbox 是执行约束

源码证据：

- `exec_policy.rs` 判断命令是 `Allow`、`Prompt`、`Forbidden`。
- `tools/orchestrator.rs` 编排审批、sandbox 选择、失败重试。
- `protocol/src/protocol.rs` 定义 `EventMsg::ExecApprovalRequest` 和 `Op::ExecApproval`。
- `sandboxing/src/manager.rs` 将抽象权限转换成 macOS/Linux/Windows 执行包装。

设计动机：用户点击“允许”只表示产品层同意，不代表进程真的不会越界。反过来，sandbox 能限制进程，但不能表达“用户是否愿意让 Agent 做这件事”。两层都需要。

迁移建议：当前 AI SEO Agent 短期只需要 human-in-the-loop，不需要 OS sandbox。设计工具时先按风险分级：只读分析自动执行；需要联网或消耗额度的工具提示确认；写数据库、发站点请求、改配置的工具暂不做。

### 5.6 UI transcript、model history、runtime event、persistent log 不能混为一谈

源码证据：

- `ContextManager.items` 是 model history。
- `EventMsg` 是 runtime event。
- `ThreadHistoryBuilder` 把 rollout/event 投影成 UI transcript。
- `rollout/src/policy.rs` 选择哪些事实持久化。
- `state/src/log_db.rs` 是观测日志，不用于恢复模型上下文。

设计动机：这四类数据优化目标完全不同。UI transcript 要好看，model history 要节省 token 并保持 tool 配对，runtime event 要实时，persistent log 要可恢复且不膨胀。

迁移建议：你当前 `Message` 同时承担 UI message 和 model history 来源。阶段 2/3 可以接受；进入 Tool Calling 后，应至少在后端内部区分：

- `ConversationMessage`：UI 展示和数据库消息。
- `ModelMessage`：喂给模型的 `system/user/assistant/tool` 结构。
- `RuntimeEvent`：stream 给前端的过程事件。
- `ToolObservation`：工具结果，可能进入 model history，但不一定直接展示成普通 chat 气泡。

### 5.7 持久化不等于保存所有流式 delta

源码证据：

- `rollout/src/policy.rs` 不持久化大量 begin/delta/transient events。
- `thread-store/src/live_thread.rs` 通过 `LiveThread` 追加 canonical items 并同步 metadata。
- `core/src/session/rollout_reconstruction.rs` 从 checkpoint 和后续 facts 重建有效 history。

设计动机：delta 是传输过程，最终 message/status 才是业务事实。保存所有 delta 会让恢复复杂、数据膨胀，也容易出现重复追加。

迁移建议：你当前 `SeoService.chatStream()` 只在完成后把完整 assistant message 更新为 `COMPLETED`，aborted 时更新为 `ABORTED`，这个方向是对的。下一步要严谨处理“HTTP 断开但模型请求还在跑”的真实中断和落库一致性。

### 5.8 SDK 应该复用协议，而不是复制流程

源码证据：

- Python SDK 的 `CodexClient.start` 启动 `codex app-server --listen stdio://`，`thread_start` / `turn_start` 只是 JSON-RPC。
- Python SDK 的 `MessageRouter` 只分流 response/notification/turn stream。
- TypeScript SDK 当前通过 `codex exec --experimental-json` 复用 CLI/runtime，而不是重写 agent loop。

设计动机：SDK 是产品封装，不应该成为第二个 runtime。否则 SDK 行为和官方客户端会不一致。

迁移建议：如果未来你给 AI SEO Agent 做 CLI 或第三方 SDK，不要在 SDK 里写 LLM 调用和 tool loop。SDK 只调用 Nest API 的 `conversation` / `turn` / `stream` 协议。

## 6. 与我的 AI SEO Agent 项目的对照表

| Codex 概念 | 当前项目已有实现 | 缺口 | 建议下一步 |
| --- | --- | --- | --- |
| `Thread` | `Conversation` 表和 API 已完成，多会话、message 归属、刷新恢复已有。源码：`<agent>/prisma/schema.prisma`、`docs/tasks/phase-02-agent-chat-session.md` | 没有 fork、archive、thread metadata、thread-level settings | 当前不做 fork/archive。先保证多会话不串线和 `updatedAt` 一致 |
| `Turn` | `ChatStreamEvent` 有 `start/delta/done/error/aborted`，`assistantMessageId` 是事实上的 turn anchor。源码：`packages/contracts/src/seo.ts` | 没有显式 `turnId`，user/assistant/tool observation 无统一 turn 归属 | 后续新增 `turnId`，每次发送创建 `AgentTurn` 或至少在 event 中携带 `turnId` |
| `Session` | `SeoService.chatStream()` 在一次请求内加载 history、创建消息、调用 stream、处理 abort/error。源码：`apps/api/src/seo/seo.service.ts` | 缺少运行态对象，active turn、abort、pending tool approval 没有后端集中管理 | 短期不抽复杂 Session；先抽 `AgentRuntimeService.runTurnStream()` |
| `Submission` / `Op` | HTTP request body `SeoChatRequest` 承担输入协议。源码：`packages/contracts/src/seo.ts` | 只有 user message，没有 interrupt/approval/tool response 等 op | 进入 Tool Calling 前设计 `TurnStartRequest`、`ToolApprovalResponse` 等最小 op |
| `EventMsg` | `ChatStreamEvent` 已经是最小 runtime event。前端 `streamChatWithSeoAgent()` 解析 NDJSON。 | event 类型偏少，缺少 `tool_call_started`、`tool_observation`、`approval_required`、`turn_started` 等 | 内部先定义 `AgentRuntimeEvent`，外部继续 NDJSON |
| Model client | `LLMService` 和 `OpenAICompatibleClient` 已经分层，业务层不直接碰 SDK chunk。源码：`apps/api/src/llm/llm.service.ts`、`apps/api/src/llm/clients/openai-compatible.client.ts` | 仍使用 Chat Completions `role/content` 简化结构，tool calling 后需要 tool message schema | Tool Calling 阶段再扩展 `ChatMessage` 类型，不要现在过早改 |
| ContextManager | `CHAT_HISTORY_LIMIT = 12` + `buildSeoAgentChatMessages()` 已有受控 history。 | 只有最近 N 条，无 token 估算、summary、tool observation 规范化 | 阶段 3 稳定后，可做一个 `SeoContextBuilder` 封装 history 选择 |
| Tool spec/runtime | 暂无 tool calling | 无 `ToolDefinition`、`ToolExecutor`、`ToolRegistry`、tool observation | 先做 1 个只读工具闭环，不做 MCP/plugin |
| Approval | 暂无 human-in-the-loop | 模型若要执行高风险工具，没有确认流程 | 先用 `approval_required` event + 前端确认按钮 + `POST /turns/:id/approval` |
| Sandbox | 暂无，也暂时不需要 | 如果未来执行 shell/写文件/联网，风险高 | 当前不要做 OS sandbox。SEO 工具优先后端受控函数 |
| Rollout / persistence | PostgreSQL `Message` 持久化，`MessageStatus` 包含 `STREAMING/COMPLETED/FAILED/ABORTED`。 | 没有 turn event log；aborted 持久化还在完善 | 不保存所有 delta；补齐 aborted/error 最终状态和 partial content |
| UI transcript | `useSeoWorkspace` 基于 messages/cache 组织页面状态。源码：`apps/web/src/hooks/useSeoWorkspace.ts` | UI state 和 runtime stream state 混在一个 hook 内，后续会膨胀 | 阶段 3 完成后考虑拆 `useChatStreamRuntime` |

## 7. 我的后续学习路线

### 阶段 A：收口阶段 3 streaming 稳定性

阶段目标：让现有 streaming 链路在多会话、刷新、停止、错误场景下稳定。

要学习的 Agent 概念：

- runtime event 与 persistent message 的区别。
- turn lifecycle。
- abort / interrupted / failed 的状态边界。

当前项目要实现：

- 后端真实中断：HTTP close -> `AbortController` -> OpenAI SDK signal -> 终止 stream。
- `ABORTED` 持久化一致性：停止后数据库 assistant message 状态和内容可恢复。
- 多会话不串线：每个 event 都用 `conversationId` + `assistantMessageId` 或后续 `turnId` 校验。

推荐文件：

- `<agent>/apps/api/src/seo/seo.controller.ts`
- `<agent>/apps/api/src/seo/seo.service.ts`
- `<agent>/apps/web/src/api/seo.ts`
- `<agent>/apps/web/src/hooks/useSeoWorkspace.ts`
- `<agent>/packages/contracts/src/seo.ts`

验收标准：

- 生成中停止后，后端不继续写 `COMPLETED`。
- 刷新页面后能看到 `ABORTED` 消息。
- A 会话生成中切到 B 会话，不会把 A 的 delta 写到 B。
- 模型错误时 message 状态为 `FAILED`，UI 不会卡在 `generating`。

暂不做：

- Tool Calling。
- 多 Agent。
- summary memory。
- WebSocket。

### 阶段 B：抽出轻量 Agent Runtime 边界

阶段目标：让 `SeoService` 不再直接承担所有 turn runtime 职责。

要学习的 Agent 概念：

- `Turn`。
- `RuntimeEvent`。
- `ModelMessage` 与 `ConversationMessage` 的区别。
- context builder。

当前项目要实现：

```txt
SeoController
  -> SeoService
  -> AgentRuntimeService.runTurnStream()
  -> LLMService.chatStream()
```

最小结构：

- `AgentRuntimeService`：组织一次 turn。
- `SeoContextBuilder`：从 DB message 构造 model messages。
- `AgentRuntimeEvent`：内部 runtime event union。
- `ChatStreamEventMapper`：把 runtime event 映射成 NDJSON event。

推荐文件：

- `apps/api/src/seo/seo.service.ts`
- `apps/api/src/seo/prompts/seo-agent.prompt.ts`
- `apps/api/src/llm/llm.types.ts`
- `packages/contracts/src/seo.ts`

验收标准：

- 旧 `POST /api/seo/chat/stream` 行为不变。
- `SeoService` 更像业务编排，不直接包含所有 stream 细节。
- 未来添加 tool event 不需要重写 Controller。

暂不做：

- 复杂队列。
- 多 turn 并发执行器。
- app-server 风格协议网关。

### 阶段 C：实现最小 Tool Calling 闭环

阶段目标：让模型能调用一个安全、只读、可观测的 SEO 工具。

要学习的 Agent 概念：

- Tool spec。
- Tool executor。
- Tool observation。
- follow-up sampling。

当前项目要实现：

```ts
interface ToolDefinition {
  name: string
  description: string
  inputSchema: unknown
  riskLevel: 'low' | 'medium' | 'high'
}

interface ToolExecutor<TInput = unknown, TOutput = unknown> {
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>
}

class ToolRegistry {
  listDefinitions(): ToolDefinition[]
  getExecutor(name: string): ToolExecutor | undefined
}
```

第一批工具建议：

- `score_meta_description`：输入 meta description，输出长度、关键词覆盖、改进建议。
- `extract_seo_keywords`：输入一段文本，输出候选关键词。
- `analyze_title_tag`：输入 title，输出长度、可读性、风险。

验收标准：

- 模型返回 tool call 后，后端识别工具名和参数。
- 后端执行工具并生成 `tool observation`。
- observation 回传模型后，模型能基于工具结果生成最终回答。
- 工具过程通过 stream event 展示给前端。

暂不做：

- shell 工具。
- 外部网页抓取。
- MCP。
- 并行工具调用。

### 阶段 D：加入 human-in-the-loop

阶段目标：让中风险工具执行前需要用户确认。

要学习的 Agent 概念：

- approval request event。
- pending turn。
- user decision op。
- tool risk policy。

当前项目要实现：

- `approval_required` event：包含 `turnId`、`toolCallId`、`toolName`、`summary`、`riskLevel`。
- 前端展示确认 UI。
- 用户确认后调用后端 approval endpoint。
- 后端继续执行工具，并把 observation 回传模型。

验收标准：

- 低风险工具自动执行。
- 中风险工具等待确认。
- 用户拒绝后，模型收到“用户拒绝执行该工具”的 observation。
- 等待期间 UI 不丢失当前 turn 状态。

暂不做：

- Codex 级 execpolicy DSL。
- sandbox。
- guardian reviewer。

### 阶段 E：上下文管理升级

阶段目标：从“最近 12 条”升级为“受控 context builder”。

要学习的 Agent 概念：

- model history。
- UI transcript。
- context truncation。
- summary memory。
- tool observation normalization。

当前项目要实现：

- `SeoContextBuilder` 支持按 token 或字符预算裁剪。
- tool observation 有独立结构，不直接混成普通 assistant 文本。
- 可选增加 summary message，但只在长会话触发。

验收标准：

- 当前用户输入一定进入上下文。
- system prompt 始终在首位。
- history 不超过预算。
- tool call 和 observation 不丢配对关系。

暂不做：

- 向量数据库。
- RAG。
- 长期记忆。
- remote compaction。

## 8. 未来 5 个最适合练习的小任务

### 任务 1：补齐 stream aborted 持久化回归测试

目标：停止生成后，数据库中 assistant message 是 `ABORTED`，刷新仍可恢复。

练习点：runtime event 和 persistent message 的区别。

建议范围：

- `SeoService.chatStream()`
- `SeoController.chatStream()`
- `MessageStatus.ABORTED`

验收：

- 手动停止生成。
- DB 中 assistant message status 为 `ABORTED`。
- 页面刷新后仍展示中断状态。

### 任务 2：给 stream event 增加 `turnId`

目标：让一次发送的 user message、assistant message、后续 tool event 有共同归属。

练习点：Codex `Turn` 心智模型。

建议范围：

- `packages/contracts/src/seo.ts`
- `SeoService.chatStream()`
- `useSeoWorkspace.sendMessage()`

验收：

- 每个 `start/delta/done/error/aborted` 都带 `turnId`。
- 前端用 `turnId` 防止 active turn 串线。

### 任务 3：抽一个 `SeoContextBuilder`

目标：把 `CHAT_HISTORY_LIMIT = 12` 和 `buildSeoAgentChatMessages()` 的上下文构造职责收拢。

练习点：Codex `ContextManager` 的简化版。

建议范围：

- `apps/api/src/seo/seo.service.ts`
- `apps/api/src/seo/prompts/seo-agent.prompt.ts`
- 新增 `apps/api/src/seo/seo-context.builder.ts`

验收：

- system prompt、history selection、当前输入规则集中管理。
- 行为与原先一致。
- 未来可扩展 token budget。

### 任务 4：实现第一个只读 SEO 工具

目标：模型可以调用 `score_meta_description` 并基于 observation 回复。

练习点：Tool spec / executor / registry / observation。

建议范围：

- 新增 `apps/api/src/agent-tools`
- 扩展 `LLMService` 的 tool calling 能力
- 扩展 stream event

验收：

- 用户问“帮我评估这个 meta 描述”时模型触发工具。
- 后端执行工具。
- 工具结果回传模型。
- 最终回答引用工具结果。

### 任务 5：给中风险工具加确认

目标：模拟一个“需要确认”的工具，例如“生成并保存 SEO 优化建议到会话记录”。

练习点：human-in-the-loop。

建议范围：

- `approval_required` event。
- 前端确认按钮。
- 后端 approval endpoint。

验收：

- 工具执行前暂停。
- 用户同意后继续。
- 用户拒绝后模型得到拒绝 observation，并给出替代建议。

## 9. 暂时不要学的内容

这些 Codex 模块很有价值，但不适合你当前 AI SEO Agent 阶段投入：

| 暂不学习 | 原因 | 以后什么时候再看 |
| --- | --- | --- |
| 完整 TUI 渲染系统 | 它主要解决终端 UI 体验，不是 Agent runtime 主干 | 需要做 CLI/TUI 产品时 |
| OS 级 sandbox 细节 | 当前 SEO Agent 不执行 shell/写文件/任意命令，实现成本和风险都高 | 有真实高风险工具时 |
| execpolicy DSL | 当前只需要简单 riskLevel 和确认，不需要命令策略语言 | 有多种命令工具和企业策略时 |
| shell-escalation | 解决 shell 内部二次 exec 绕过审批的问题，当前项目不跑 shell | 做代码 Agent 或命令 Agent 时 |
| MCP 完整协议实现 | 当前先做内置工具闭环，MCP 会增加协议和生命周期复杂度 | 内置工具稳定后，需要接第三方工具生态时 |
| plugin marketplace | 这是能力分发和治理系统，远超当前学习阶段 | 你的工具生态有多个外部贡献者时 |
| multi-agent / subagent | 当前主线是单 Agent runtime，过早引入会稀释学习重点 | 单 Agent tool loop、context、approval 稳定后 |
| remote compaction / token-budget compaction | 当前 history 规模小，最近 N 条足够 | 长会话明显超上下文时 |
| realtime audio / WebRTC | 当前产品是文本 SEO assistant | 要做语音 Agent 时 |
| Guardian reviewer / automated review | 属于高风险操作自动审查体系 | 有写操作、命令执行、企业合规要求时 |

当前最该学的不是“Codex 有多复杂”，而是它的分层习惯：

```txt
入口只是入口
协议只是协议
runtime 才跑 Agent
tool spec 不等于 tool execution
UI message 不等于 model history
delta 不等于持久化事实
审批不等于 sandbox
SDK 不应该复制 agent loop
```

把这几条迁移到 AI SEO Agent，你就能从“能聊天的应用”逐步走向“可维护、可观测、可扩展的 Agent runtime”。
