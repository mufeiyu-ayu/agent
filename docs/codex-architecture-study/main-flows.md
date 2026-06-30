# Codex 核心主链路追踪

本文档沿着真实源码链路追踪 Codex 的 Agent runtime。它不是目录介绍，而是按“用户输入如何变成 runtime 行为”的方向阅读。

路径约定：`<codex>` 表示 Codex 仓库根目录，`<agent>` 表示当前 AI SEO Agent 项目根目录。

## 链路 1：TUI / CLI 输入如何进入 core runtime

### 路径概览

```txt
codex tui / codex exec
  -> CLI 参数解析
  -> InProcessAppServerClient
  -> app-server request
  -> thread/start 或 thread/resume
  -> turn/start
  -> TurnRequestProcessor::turn_start_inner
  -> Op::UserInput
  -> CodexThread::submit_user_input_with_client_user_message_id
  -> Codex::submit
  -> Session submission queue
```

### 源码节点

1. `<codex>/codex-rs/cli/src/main.rs`

`MultitoolCli` 分发子命令。`exec`、`app-server`、`mcp`、`plugin`、`sandbox` 都是入口，说明 Codex 顶层不是一个简单 chat 命令。

2. `<codex>/codex-rs/tui/src/cli.rs`

`Cli` 参数包含：

- `prompt`
- `resume_*`
- `fork_*`
- `approval_policy`
- `web_search`
- `no_alt_screen`

这些是入口配置，不是 runtime loop。

3. `<codex>/codex-rs/exec/src/lib.rs`

`codex exec` 使用 `codex_app_server_client::InProcessAppServerClient`，非交互执行也没有自己写 agent loop。

4. `<codex>/codex-rs/app-server-client/README.md`

in-process client 使用 typed channels：

```txt
client -> server: ClientRequest / ClientNotification
server -> client: InProcessServerEvent
```

它保留 app-server response contract，只是去掉外部进程和 JSON 序列化成本。

5. `<codex>/codex-rs/app-server/src/request_processors/turn_processor.rs`

`TurnRequestProcessor::turn_start_inner`：

- 加载 thread。
- 校验 input。
- 解析 turn-level settings。
- 把 v2 input 转成 core input items。
- 构造 `Op::UserInput`。
- 调用 `thread.submit_user_input_with_client_user_message_id(...)`。

6. `<codex>/codex-rs/core/src/codex_thread.rs`

`CodexThread::submit_user_input_with_client_user_message_id` 把 op 提交给 `Codex`，并关联 `client_user_message_id`。

### 架构结论

Codex 的入口层只负责把用户行为标准化为协议请求。真正运行 Agent 的地方在 core `Session`。这让 TUI、exec、SDK、app-server 多个 surface 可以共享同一套权限、工具、上下文和持久化行为。

迁移到 AI SEO Agent：你的 `SeoController.chatStream()` 应继续保持协议门面职责，不应该直接写复杂 agent loop。

## 链路 2：Thread 如何创建、恢复、保存和 fork

### Start

```txt
thread/start
  -> MessageProcessor
  -> ThreadRequestProcessor::thread_start
  -> thread_start_task
  -> load config / trust project / dynamic tools
  -> ThreadManager::start_thread_with_options
  -> Codex::spawn
  -> attach listener
  -> ThreadStartResponse
```

源码依据：

- `<codex>/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`：`ThreadStartParams`
- `<codex>/codex-rs/app-server/src/request_processors/thread_processor.rs`：`thread_start`、`thread_start_task`
- `<codex>/codex-rs/core/src/thread_manager.rs`：`start_thread_with_options`
- `<codex>/codex-rs/core/src/session/mod.rs`：`Codex::spawn_internal`

`thread_start_task` 会把协议参数转换成 config/runtime context，包括：

- model / model provider / service tier
- cwd / runtime workspace roots
- approval policy
- sandbox 或 permissions
- developer instructions
- dynamic tools
- selected capability roots
- history mode
- environments

这说明 Thread 不是一行聊天记录，而是一次 Agent 工作空间的配置载体。

### Resume

```txt
thread/resume
  -> thread_resume_inner
  -> 如果 running：resume_running_thread
  -> 否则从 history/path/thread_id 读取 stored thread / rollout
  -> load_and_apply_persisted_resume_metadata
  -> ThreadManager::resume_thread_with_history
  -> attach listener
  -> ThreadResumeResponse
```

源码依据：

- `<codex>/codex-rs/app-server/src/request_processors/thread_processor.rs`：`thread_resume_inner`、`resume_running_thread`
- `<codex>/codex-rs/core/src/thread_manager.rs`：`resume_thread_with_history`
- `<codex>/codex-rs/core/src/session/mod.rs`：`record_initial_history`
- `<codex>/codex-rs/core/src/session/rollout_reconstruction.rs`：`reconstruct_history_from_rollout`

关键点：如果 thread 仍在内存中，resume 更像 rejoin；如果是冷恢复，就从 rollout 重建 runtime history。

### Fork

```txt
thread/fork
  -> 读 source stored thread + history
  -> 可按 last_turn_id 截断
  -> ThreadManager::fork_thread_from_history
  -> fork_thread_with_initial_history
  -> 新 thread id
```

源码依据：

- `<codex>/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`：`ThreadForkParams`
- `<codex>/codex-rs/app-server/src/request_processors/thread_processor.rs`：`thread_fork_inner`
- `<codex>/codex-rs/core/src/thread_manager.rs`：`fork_thread_from_history`

Fork 的价值是允许从一个历史点分支探索，这在 coding agent 中很有用。当前 AI SEO Agent 还不需要。

### Save

```txt
core event / response item
  -> Session::record_conversation_items / send_event
  -> rollout policy 判断是否持久化
  -> LiveThread.append_items
  -> ThreadStore.append_items
  -> JSONL rollout + SQLite metadata
```

源码依据：

- `<codex>/codex-rs/core/src/session/mod.rs`：`record_conversation_items`、`send_event`
- `<codex>/codex-rs/rollout/src/policy.rs`：`should_persist_response_item`、`should_persist_event_msg`
- `<codex>/codex-rs/thread-store/src/live_thread.rs`：`LiveThread::append_items`
- `<codex>/codex-rs/thread-store/src/store.rs`：`ThreadStore`

Codex 不持久化所有 delta。它持久化的是可重放事实。

迁移到 AI SEO Agent：`Conversation` / `Message` 已经是最小 ThreadStore。现阶段不要保存每个 delta，只保存最终 message、aborted、failed 状态。

## 链路 3：一个 turn 从用户输入到模型 streaming 完成

### 路径概览

```txt
Op::UserInput
  -> submission_loop
  -> user_input_or_turn
  -> user_input_or_turn_inner
  -> new_turn_with_sub_id
  -> steer_input 或 spawn_task(RegularTask)
  -> RegularTask::run
  -> run_turn
  -> build Prompt
  -> ModelClientSession::stream
  -> ResponseEvent stream
  -> EventMsg deltas/items
  -> TurnComplete
```

### 源码节点

1. `<codex>/codex-rs/protocol/src/protocol.rs`

`Op::UserInput` 包含：

- `items`
- `final_output_json_schema`
- `responsesapi_client_metadata`
- `additional_context`
- `thread_settings`

这比普通 chat request 更接近“运行一次 turn 的操作”。

2. `<codex>/codex-rs/core/src/session/handlers.rs`

`submission_loop` 从 queue 读取 `Submission`，按 `Op` 分发。`Op::UserInput` 进入 `user_input_or_turn`。

`user_input_or_turn_inner` 会：

- 应用 thread settings。
- 创建 `TurnContext`。
- 如果当前 active turn 可 steer，则注入输入。
- 否则把输入转成 `TurnInput`，启动 `RegularTask`。

3. `<codex>/codex-rs/core/src/tasks/mod.rs`

`Session::spawn_task` 会取消旧 task、设置 active turn、emit lifecycle、spawn tokio task。

这说明 turn 是可取消的后台任务，不是同步函数调用。

4. `<codex>/codex-rs/core/src/tasks/regular.rs`

`RegularTask::run` 先发送 `EventMsg::TurnStarted`，然后循环调用 `run_turn`。如果期间有 pending input，就继续下一轮。

5. `<codex>/codex-rs/core/src/session/turn.rs`

`run_turn` 做几类事情：

- 建立 turn-scoped `ModelClientSession`。
- pre-sampling compaction 检查。
- 捕获 `StepContext`。
- 构建 skills/plugins。
- 记录 pending input。
- 从 history 构造 prompt input。
- 构造 tool router。
- 调用 `run_sampling_request`。
- 处理 tool follow-up。
- 检查 context window。

6. `<codex>/codex-rs/core/src/client.rs`

`ModelClientSession::stream` 发起模型流式请求。它可以走 Responses WebSocket 或 HTTP Responses API，最终统一成 `ResponseEvent`。

### 架构结论

Codex 的 turn 是一个可被事件观察、可中断、可包含多轮模型采样和工具调用的异步任务。这个模型比“controller 调 service 返回字符串”更接近真实 Agent。

迁移到 AI SEO Agent：`SeoService.chatStream()` 已经是简化版 `runTurn`。下一步应把 turn lifecycle 显式化，而不是继续把所有逻辑塞在一个方法里。

## 链路 4：模型返回 tool call 后如何执行并回传 observation

### 路径概览

```txt
ResponseEvent::OutputItemDone
  -> handle_output_item_done
  -> ToolRouter::build_tool_call
  -> ToolCallRuntime::handle_tool_call
  -> ToolRouter::dispatch_tool_call_with_terminal_outcome
  -> ToolRegistry::dispatch_any_with_terminal_outcome
  -> CoreToolRuntime::handle
  -> AnyToolResult
  -> ResponseInputItem::*Output
  -> record_conversation_items
  -> next sampling input
```

### 源码节点

1. `<codex>/codex-rs/core/src/session/turn.rs`

`try_run_sampling_request` 消费 `ResponseEvent`。当收到 `OutputItemDone` 时，调用 `stream_events_utils::handle_output_item_done`。

2. `<codex>/codex-rs/core/src/stream_events_utils.rs`

`handle_output_item_done` 判断该 item 是普通 assistant 输出还是 tool call。

如果是 tool call：

- 记录模型原始 call item。
- 创建 tool future。
- `needs_follow_up = true`。

如果不是 tool call：

- finalize 普通响应。
- 记录 assistant message。
- 更新 `last_agent_message`。

3. `<codex>/codex-rs/core/src/tools/router.rs`

`ToolRouter::build_tool_call` 识别：

- `ResponseItem::FunctionCall`
- client execution 的 `ToolSearchCall`
- `ResponseItem::CustomToolCall`

它只做解析，不执行工具。

4. `<codex>/codex-rs/core/src/tools/parallel.rs`

`ToolCallRuntime::handle_tool_call` 控制并发、取消和结果转换。支持 parallel 的工具拿 read lock，不支持 parallel 的工具拿 write lock。

5. `<codex>/codex-rs/core/src/tools/registry.rs`

`ToolRegistry::dispatch_any_with_terminal_outcome`：

- 查找 tool runtime。
- 校验 payload kind。
- 发送 tool start。
- 执行 pre tool hooks。
- 调用 runtime。
- 执行 post tool hooks。
- 发送 tool finish。
- 返回 model-visible output。

6. `<codex>/codex-rs/core/src/session/turn.rs`

`drain_in_flight` 等待工具 future，把 tool output 写回 history。下一轮 sampling 时 `clone_history().for_prompt(...)` 会把 observation 发回模型。

### 架构结论

模型不能直接执行工具。模型只能提出结构化调用请求。runtime 才能执行、拦截、审批、记录和回传 observation。

迁移到 AI SEO Agent：Tool Calling 第一版要坚持这个边界。模型输出 `tool_call`，后端查 `ToolRegistry` 执行，执行结果以 `tool observation` 进入下一次模型请求。

## 链路 5：需要权限或 sandbox 的命令如何经过审批和受限执行

### 路径概览

```txt
model tool call
  -> ToolRegistry
  -> shell / exec handler
  -> normalize permissions
  -> ExecPolicyManager
  -> ExecApprovalRequirement
  -> ToolOrchestrator
  -> request approval if needed
  -> SandboxManager select / transform
  -> ShellRuntime / UnifiedExecRuntime
  -> execute_env / exec-server
  -> result / sandbox denied / timeout
```

### 源码节点

1. `<codex>/codex-rs/core/src/tools/handlers/shell.rs`

`run_exec_like` 解析 shell tool 参数、合并权限、校验 additional permissions，并构造 `ShellRequest`。

2. `<codex>/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs`

`ExecCommandHandler::handle_call` 处理统一 exec tool，解析 command、cwd、env、sandbox 选择。

3. `<codex>/codex-rs/core/src/exec_policy.rs`

`ExecPolicyManager::create_exec_approval_requirement_for_command` 判断命令：

- `Allow`
- `Prompt`
- `Forbidden`

并可生成 proposed execpolicy amendment。

4. `<codex>/codex-rs/core/src/tools/sandboxing.rs`

`ExecApprovalRequirement` 表达：

- `Skip`
- `NeedsApproval`
- `Forbidden`

它不是执行本身，只是审批要求。

5. `<codex>/codex-rs/core/src/tools/orchestrator.rs`

`ToolOrchestrator::run` 是关键编排点：

- 根据 approval requirement 决定是否请求审批。
- 等待 user/guardian/hook decision。
- 决定 first attempt 是否 sandbox。
- 运行工具。
- 如果 sandbox denied，根据策略决定是否请求升级和重试。

6. `<codex>/codex-rs/protocol/src/protocol.rs`

审批请求通过 `EventMsg::ExecApprovalRequest` 或 `EventMsg::ApplyPatchApprovalRequest` 发出，客户端用 `Op::ExecApproval` 或 `Op::PatchApproval` 回传。

7. `<codex>/codex-rs/sandboxing/src/manager.rs`

`SandboxManager::select_initial` 和 `transform` 把 `PermissionProfile`、filesystem/network policy 转成平台执行方式：

- no sandbox
- macOS Seatbelt
- Linux sandbox
- Windows restricted token

### 架构结论

Codex 把“是否允许”和“运行后能做什么”拆开：

- approval / execpolicy：产品和策略层。
- sandbox / permission profile：执行约束层。
- exec/spawn：进程生命周期层。

迁移到 AI SEO Agent：当前不用实现 sandbox，但必须从第一版 Tool Calling 就设计 risk level 和 confirmation，否则后面补很痛。

## 链路 6：上下文过长或历史恢复时如何处理 history、rollout、compaction

### 上下文构造

```txt
record_conversation_items
  -> ContextManager.record_items
  -> ContextManager.items
  -> ContextManager.for_prompt
  -> normalize_history
  -> prompt input
```

源码依据：

- `<codex>/codex-rs/core/src/session/mod.rs`：`record_conversation_items`
- `<codex>/codex-rs/core/src/context_manager/history.rs`：`ContextManager`
- `<codex>/codex-rs/core/src/context_manager/normalize.rs`：`normalize_history`

`ContextManager` 记录的是 model-visible `ResponseItem`，不是 UI transcript。

### 自动压缩

```txt
run_turn
  -> run_pre_sampling_compact
  -> context_window_token_status
  -> run_auto_compact
  -> run_compact_task_inner_impl
  -> build_compacted_history
  -> Session::replace_compacted_history
  -> RolloutItem::Compacted
```

源码依据：

- `<codex>/codex-rs/core/src/session/context_window.rs`
- `<codex>/codex-rs/core/src/session/turn.rs`
- `<codex>/codex-rs/core/src/compact.rs`
- `<codex>/codex-rs/core/src/session/mod.rs`

如果用于 summary 的请求本身也超窗口，`ContextManager::remove_first_item` 会删最旧 item 并保持 tool call/output 配对。

### 历史恢复

```txt
RolloutRecorder::get_rollout_history
  -> InitialHistory::Resumed
  -> Session::record_initial_history
  -> apply_rollout_reconstruction
  -> reconstruct_history_from_rollout
  -> latest Compacted checkpoint + replay following items
```

源码依据：

- `<codex>/codex-rs/rollout/src/recorder.rs`
- `<codex>/codex-rs/core/src/session/mod.rs`
- `<codex>/codex-rs/core/src/session/rollout_reconstruction.rs`

恢复不是把 JSONL 每行全部拼进 prompt，而是重建当前有效 model history。

### 四类历史/日志

| 类别 | 源码 | 用途 |
| --- | --- | --- |
| UI transcript | `ThreadHistoryBuilder`、`ThreadState::track_current_turn_event` | 给 UI 展示 |
| model history | `ContextManager.items` | 给模型作为 prompt input |
| runtime event | `EventMsg` | 实时通知 UI/SDK |
| persistent log | `RolloutRecorder` + `rollout/policy.rs` | 恢复和重放 |

迁移到 AI SEO Agent：当前 `Message` 既是 UI transcript 又是 model history 来源，短期可接受。Tool Calling 后必须区分 tool observation 和普通 assistant message。

## 链路 7：SDK 如何通过协议复用 Codex，而不是重写 Agent loop

### Python SDK

```txt
CodexClient.start
  -> spawn codex app-server --listen stdio://
  -> initialize
  -> initialized notification
  -> thread_start / thread_resume / thread_fork / turn_start
  -> MessageRouter
  -> turn notifications
```

源码依据：

- `<codex>/sdk/python/src/openai_codex/client.py`
- `<codex>/sdk/python/src/openai_codex/_message_router.py`
- `<codex>/sdk/python/src/openai_codex/api.py`

Python SDK 是协议客户端和类型封装。

### TypeScript SDK

```txt
Codex.startThread
  -> Thread.runStreamed
  -> CodexExec.run
  -> spawn codex exec --experimental-json
  -> parse stdout JSONL
  -> yield ThreadEvent
```

源码依据：

- `<codex>/sdk/typescript/src/codex.ts`
- `<codex>/sdk/typescript/src/thread.ts`
- `<codex>/sdk/typescript/src/exec.ts`
- `<codex>/codex-rs/exec/src/lib.rs`

重要差异：TypeScript SDK 当前不是直接连 app-server JSON-RPC，而是通过 `codex exec --experimental-json` 间接复用 runtime。

### 架构结论

SDK 不复制 agent loop。它只负责：

- 启动或连接 runtime。
- 发送 thread/turn 请求。
- 路由事件。
- 提供语言友好的 API。

迁移到 AI SEO Agent：未来如果做 SDK，SDK 不应该自己调用模型。它应该调用你的 Nest runtime API。
