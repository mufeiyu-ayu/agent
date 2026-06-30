# Codex 源码阅读范围与依据索引

本文档记录本次只读研究实际覆盖的源码范围，方便后续按模块回看。路径使用仓库根目录占位符，避免绑定某台电脑的用户名。

路径约定：

- `<codex>`：Codex 仓库根目录。
- `<agent>`：当前 AI SEO Agent 项目根目录。

## 1. 仓库结构判断

Codex 仓库主体在：

```txt
<codex>/codex-rs
```

顶层还包含：

```txt
<codex>/sdk/python
<codex>/sdk/typescript
<codex>/codex-cli
<codex>/docs
<codex>/learning-roadmap
```

本次重点没有放在 `learning-roadmap`，而是从 Rust workspace 和 SDK 源码追主链路。

## 2. 入口层

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/cli/src/main.rs` | `MultitoolCli` 分发 `exec`、`tui`、`app-server`、`mcp`、`plugin`、`sandbox`、`execpolicy` 等子命令 | 顶层 CLI 是多工具入口，不是 Agent loop |
| `<codex>/codex-rs/tui/src/main.rs` | `codex_tui::run_main` | TUI 是交互 surface |
| `<codex>/codex-rs/tui/src/cli.rs` | prompt、resume、fork、approval、web_search 等参数 | TUI 负责收集入口参数 |
| `<codex>/codex-rs/exec/src/lib.rs` | `InProcessAppServerClient`、JSON event 输出 | `codex exec` 复用 app-server/core runtime |
| `<codex>/codex-rs/app-server-client/README.md` | in-process typed channels、initialize、backpressure、shutdown | TUI/exec 通过 app-server facade 复用 runtime |

## 3. app-server 协议层

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/app-server/README.md` | JSON-RPC、transport、Thread/Turn/Item、API overview | app-server 是对外协议门面 |
| `<codex>/codex-rs/app-server/src/message_processor.rs` | `MessageProcessor::handle_initialized_client_request` | 所有 client request 统一路由到 processor |
| `<codex>/codex-rs/app-server-protocol/src/rpc.rs` | `JSONRPCRequest`、`JSONRPCResponse`、`JSONRPCNotification` | wire contract |
| `<codex>/codex-rs/app-server-protocol/src/protocol/v2/thread.rs` | `ThreadStartParams`、`ThreadResumeParams`、`ThreadForkParams` | thread 协议参数 |
| `<codex>/codex-rs/app-server-protocol/src/protocol/v2/turn.rs` | `TurnStartParams` | turn 协议参数 |
| `<codex>/codex-rs/app-server/src/thread_state.rs` | `ThreadStateManager`、`track_current_turn_event` | app-server 维护客户端可见 thread 状态 |
| `<codex>/codex-rs/app-server/src/request_processors/thread_lifecycle.rs` | `ensure_conversation_listener` | 把 core event 投影为 server notification |

## 4. core runtime

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/protocol/src/protocol.rs` | `Submission`、`Op`、`Event`、`EventMsg`、`TurnStartedEvent`、`TurnCompleteEvent` | core 与 UI/协议层之间的事件模型 |
| `<codex>/codex-rs/protocol/src/models.rs` | `ResponseInputItem`、`ResponseItem` | 模型输入/输出结构 |
| `<codex>/codex-rs/core/src/session/mod.rs` | `Codex`、`Codex::spawn_internal`、`record_conversation_items`、`send_event`、`replace_compacted_history` | runtime 初始化、事件输出、history 记录 |
| `<codex>/codex-rs/core/src/session/session.rs` | `Session`、`SessionConfiguration` | session 是运行态状态容器 |
| `<codex>/codex-rs/core/src/session/handlers.rs` | `submission_loop`、`user_input_or_turn_inner`、approval handlers | op 分发和 turn 启动 |
| `<codex>/codex-rs/core/src/codex_thread.rs` | `CodexThread`、`submit_user_input_with_client_user_message_id`、`flush_rollout` | thread 对 runtime 的外部门面 |
| `<codex>/codex-rs/core/src/thread_manager.rs` | `start_thread_with_options`、`resume_thread_with_history`、`fork_thread_from_history` | thread 生命周期 |
| `<codex>/codex-rs/core/src/tasks/mod.rs` | `SessionTask`、`spawn_task`、`start_task`、`abort_all_tasks` | task 生命周期 |
| `<codex>/codex-rs/core/src/tasks/regular.rs` | `RegularTask::run` | 普通对话任务 |
| `<codex>/codex-rs/core/src/tasks/compact.rs` | `CompactTask` | compaction task |

## 5. model client 与 streaming

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/core/src/session/turn.rs` | `run_turn`、`run_sampling_request`、`try_run_sampling_request`、`build_prompt` | Agent loop 主体 |
| `<codex>/codex-rs/core/src/client.rs` | `ModelClient`、`ModelClientSession::stream`、`stream_responses_api`、`stream_responses_websocket` | turn-scoped model stream |
| `<codex>/codex-rs/core/src/client_common.rs` | `Prompt` | 模型请求抽象 |
| `<codex>/codex-rs/codex-api/src/common.rs` | `ResponseEvent` | SSE/WebSocket 统一事件 |
| `<codex>/codex-rs/codex-api/src/sse/responses.rs` | Responses API SSE mapping | `response.output_item.done` 等事件映射 |

## 6. Tool 系统

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/core/src/tools/spec_plan.rs` | `build_tool_router`、`build_tool_specs_and_registry`、`add_tool_sources` | 构建 tool specs + registry |
| `<codex>/codex-rs/core/src/tools/router.rs` | `ToolRouter`、`build_tool_call`、`dispatch_tool_call_with_terminal_outcome` | 识别模型 tool call |
| `<codex>/codex-rs/core/src/tools/registry.rs` | `ToolRegistry`、`CoreToolRuntime`、`dispatch_any_with_terminal_outcome` | 统一执行工具、hooks、telemetry |
| `<codex>/codex-rs/core/src/tools/parallel.rs` | `ToolCallRuntime`、parallel lock | 并发/串行和取消控制 |
| `<codex>/codex-rs/core/src/stream_events_utils.rs` | `handle_output_item_done` | tool call 分叉点 |
| `<codex>/codex-rs/core/src/tools/handlers/shell.rs` | `run_exec_like` | shell tool handler |
| `<codex>/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs` | `ExecCommandHandler::handle_call` | unified exec handler |

## 7. 权限、审批、sandbox、execpolicy

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/core/src/exec_policy.rs` | `ExecPolicyManager::create_exec_approval_requirement_for_command` | 命令策略判断 |
| `<codex>/codex-rs/execpolicy/src/policy.rs` | `Policy::check_multiple_with_options` | policy language 执行 |
| `<codex>/codex-rs/core/src/tools/sandboxing.rs` | `ExecApprovalRequirement`、`SandboxAttempt`、`sandbox_override_for_first_attempt` | 审批要求和 sandbox attempt |
| `<codex>/codex-rs/core/src/tools/orchestrator.rs` | `ToolOrchestrator::run` | 审批、sandbox、失败重试统一编排 |
| `<codex>/codex-rs/protocol/src/permissions.rs` | `FileSystemSandboxPolicy`、`NetworkSandboxPolicy` | 权限表达 |
| `<codex>/codex-rs/sandboxing/src/manager.rs` | `SandboxManager::select_initial`、`transform` | 平台 sandbox 转换 |
| `<codex>/codex-rs/core/src/exec.rs` | `build_exec_request`、`execute_exec_request` | 进程执行边界 |
| `<codex>/codex-rs/core/src/spawn.rs` | `spawn_child_async` | 子进程启动 |
| `<codex>/codex-rs/exec-server/src/process_sandbox.rs` | `prepare_exec_request` | 远端执行 sandbox materialize |

## 8. context、history、compaction、rollout

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/core/src/context_manager/history.rs` | `ContextManager`、`record_items`、`for_prompt`、`remove_first_item`、`drop_last_n_user_turns` | model history 容器 |
| `<codex>/codex-rs/core/src/context_manager/normalize.rs` | `ensure_call_outputs_present`、`remove_orphan_outputs` | tool call/output 配对修正 |
| `<codex>/codex-rs/core/src/session/context_window.rs` | `context_window_token_status` | token window 判断 |
| `<codex>/codex-rs/core/src/compact.rs` | `run_compact_task_inner_impl`、`build_compacted_history` | 本地 compaction |
| `<codex>/codex-rs/core/src/compact_remote.rs` | `process_compacted_history` | remote compaction |
| `<codex>/codex-rs/core/src/session/rollout_reconstruction.rs` | `reconstruct_history_from_rollout` | 从 rollout 重建 history |
| `<codex>/codex-rs/rollout/src/recorder.rs` | `RolloutRecorder`、`get_rollout_history` | JSONL rollout 读写 |
| `<codex>/codex-rs/rollout/src/policy.rs` | `should_persist_response_item`、`should_persist_event_msg` | 持久化过滤 |
| `<codex>/codex-rs/thread-store/src/store.rs` | `ThreadStore` | thread storage 抽象 |
| `<codex>/codex-rs/thread-store/src/live_thread.rs` | `LiveThread` | active session 持久化句柄 |
| `<codex>/codex-rs/state/src/extract.rs` | `apply_rollout_item` | 从 rollout 提取 SQLite metadata |

## 9. skills、plugins、MCP

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/codex-rs/core-skills/src/model.rs` | `SkillMetadata` | skill 元数据 |
| `<codex>/codex-rs/core-skills/src/service.rs` | `SkillsService` | skill 发现/加载 |
| `<codex>/codex-rs/core-skills/src/render.rs` | `build_available_skills` | skill list 注入上下文 |
| `<codex>/codex-rs/core-skills/src/skill_instructions.rs` | `SkillInstructions` | 完整 skill 指令注入 |
| `<codex>/codex-rs/plugin/src/manifest.rs` | `PluginManifestPaths` | plugin manifest 能声明 skills/mcp/apps/hooks |
| `<codex>/codex-rs/plugin/src/load_outcome.rs` | `LoadedPlugin`、`PluginLoadOutcome` | plugin load 结果 |
| `<codex>/codex-rs/core/src/plugins/injection.rs` | `build_plugin_injections` | 显式 plugin mention 的 developer hint |
| `<codex>/codex-rs/codex-mcp/src/catalog.rs` | `ResolvedMcpCatalog` | MCP server 声明合并 |
| `<codex>/codex-rs/codex-mcp/src/connection_manager.rs` | `McpConnectionManager` | MCP client 连接、列工具、call_tool |
| `<codex>/codex-rs/mcp-server/src/message_processor.rs` | `handle_list_tools` | Codex 作为 MCP server 暴露工具 |

## 10. SDK

| 文件 | 阅读重点 | 结论 |
| --- | --- | --- |
| `<codex>/sdk/python/src/openai_codex/client.py` | `CodexClient.start`、`initialize`、`thread_start`、`turn_start` | Python SDK 直接启动 app-server stdio |
| `<codex>/sdk/python/src/openai_codex/_message_router.py` | `MessageRouter` | response/notification/turn stream 分流 |
| `<codex>/sdk/python/src/openai_codex/api.py` | `Codex`、`Thread`、`TurnHandle` | 高层 Python API |
| `<codex>/sdk/typescript/src/codex.ts` | `Codex.startThread`、`resumeThread` | TypeScript 高层 API |
| `<codex>/sdk/typescript/src/thread.ts` | `Thread.runStreamedInternal` | 消费 JSONL events |
| `<codex>/sdk/typescript/src/exec.ts` | `CodexExec.run` | spawn `codex exec --experimental-json` |

## 11. 当前项目阅读范围

| 文件 | 阅读重点 | 对映 Codex 概念 |
| --- | --- | --- |
| `<agent>/docs/tasks/phase-02-agent-chat-session.md` | 多会话、持久化、受控 history | Thread / model history |
| `<agent>/docs/tasks/phase-03-streaming-chat-experience.md` | NDJSON stream、start/delta/done/error/aborted、AbortController | Runtime event / turn lifecycle |
| `<agent>/packages/contracts/src/seo.ts` | `ChatStreamEvent` | EventMsg 简化版 |
| `<agent>/packages/contracts/src/conversation.ts` | `ConversationMessage`、`MessageStatus` | Thread item / message status |
| `<agent>/prisma/schema.prisma` | `Conversation`、`Message` | ThreadStore 简化版 |
| `<agent>/apps/api/src/seo/seo.service.ts` | `chatStream`、history、message create/update | Turn runtime 简化版 |
| `<agent>/apps/api/src/seo/seo.controller.ts` | NDJSON response、close -> abort | 协议门面 |
| `<agent>/apps/api/src/llm/llm.service.ts` | LLM 门面 | Model client facade |
| `<agent>/apps/api/src/llm/clients/openai-compatible.client.ts` | OpenAI-compatible SDK stream | Model provider adapter |
| `<agent>/apps/web/src/api/seo.ts` | NDJSON parser | SDK/client stream reader |
| `<agent>/apps/web/src/hooks/useSeoWorkspace.ts` | active conversation、active stream、local cache、abort | UI transcript + stream state |

## 12. 阅读深度声明

充分阅读并可用于架构结论的部分：

- app-server Thread/Turn 协议主路径。
- core `Op::UserInput` 到 `run_turn` 主路径。
- streaming 事件到 tool call / observation 回填主路径。
- shell/exec 权限审批和 sandbox 编排主路径。
- ContextManager、rollout reconstruction、thread-store 持久化边界。
- Python/TypeScript SDK 复用 runtime 的路径。
- 当前 AI SEO Agent 阶段 2/3 的文档和关键代码。

只做边界级阅读、不作为深结论的部分：

- TUI 具体渲染组件。
- realtime audio/WebRTC。
- cloud/chatgpt remote 业务。
- 所有 sandbox 平台底层实现细节。
- plugin marketplace 全量 UI/远程分发逻辑。
