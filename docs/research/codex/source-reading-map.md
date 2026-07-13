# Codex 源码阅读地图

## 1. 使用原则

不要从 `codex-rs/core/src` 第一行顺序读到最后。每次选择一个问题，沿真实入口追到结果，再补测试。

推荐固定阅读模板：

1. 这个入口接收什么？
2. 在哪里转换成内部协议？
3. 谁拥有状态？
4. 谁执行副作用？
5. 过程如何发事件？
6. 哪些事实被持久化？
7. 取消或失败如何收口？
8. 哪个测试证明上述结论？

本文件基于本地 fork `ab6a7eb87cc8a816c88b86c44cf291e251ed2136`。路径用于定位，符号用于复查；行号会随源码变化，不作为证据主键。

阅读时固定区分：Item 是 message/tool call/tool output 等语义对象，Event 是 started/delta/completed 等生命周期或传输通知。一个 `OutputItemDone(item)` event 可以携带一个 item，但二者仍不是同一抽象。

## 2. 总体阅读顺序

| 顺序 | 主题 | 先读 | 暂时跳过 |
| --- | --- | --- | --- |
| 1 | 产品入口与公开协议 | CLI/TUI app-server client、protocol v2 | 命令参数与所有实验 API 细节 |
| 2 | Thread 创建 | ThreadRequestProcessor、ThreadManager | remote thread store |
| 3 | Turn 启动 | TurnRequestProcessor、Op::UserInput | realtime audio |
| 4 | Runtime loop | submission_loop、RegularTask、run_turn | plan mode UI 特例 |
| 5 | Tool loop | stream_events_utils、router、registry | shell sandbox 平台细节 |
| 6 | Context | ContextManager、compaction | world state 所有扩展 |
| 7 | Persistence | rollout policy、ThreadStore | SQLite 索引优化 |
| 8 | Safety | orchestrator、approval、sandbox | guardian 高级策略 |
| 9 | Extensibility | MCP、skills、plugins、hooks | marketplace 分发实现 |
| 10 | Multi-agent | AgentControl、spawn tool | v1/v2 兼容迁移细节 |

## 3. 路线一：一条用户消息如何进入 Runtime

### 问题

用户在客户端发一条消息后，为什么不是 Controller 直接调用模型？

### 调用链

```text
app-server turn/start
  -> TurnRequestProcessor::turn_start / turn_start_inner
  -> validate/map V2UserInput
  -> Op::UserInput
  -> CodexThread.submit...
  -> Session submission channel
  -> submission_loop
  -> user_input_or_turn
  -> RegularTask
  -> run_turn
```

### 源码入口

| 文件 | 位置 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/app-server-protocol/src/protocol/common.rs` | `turn/start` method declaration | 协议方法如何绑定 params/response |
| `codex-rs/app-server/src/request_processors/turn_processor.rs` | `TurnRequestProcessor::turn_start` / `turn_start_inner` | V2 input 校验、model/thread settings override、core input、`Op::UserInput` |
| `codex-rs/protocol/src/protocol.rs` | `enum Op` | runtime 接受哪些操作 |
| `codex-rs/core/src/session/handlers.rs` | `submission_loop` | submission queue 的单一 dispatch 点 |
| `codex-rs/core/src/tasks/regular.rs` | `RegularTask::run` | 普通 Task 如何启动并运行 Turn |
| `codex-rs/core/src/session/turn.rs` | `run_turn` | Agent loop 主函数 |

### 配套测试

- `codex-rs/app-server/tests/suite/v2/turn_start.rs`
- `codex-rs/app-server/tests/suite/v2/request_validation.rs`
- `codex-rs/core/src/session/turn_tests.rs`

### 映射到当前项目

```text
SeoController.chatStream
  -> SeoService.chatStream
  -> AgentRuntimeService.runTurnStream
```

当前缺少独立 queue，但已有 protocol -> business mapper -> runtime 的雏形。

## 4. 路线二：Thread 如何创建、恢复和 Fork

### 调用链

```text
thread/start / resume / fork
  -> ThreadRequestProcessor
  -> ThreadManager
  -> ThreadStore load/create
  -> Codex::spawn
  -> Session
```

### 源码入口

| 文件 | 符号 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/app-server/src/request_processors/thread_processor.rs` | `ThreadRequestProcessor::{thread_start,thread_resume,thread_fork}` | 协议门面和错误映射 |
| `codex-rs/core/src/thread_manager.rs` | `ThreadManager` | loaded threads 与 durable threads 的关系 |
| `codex-rs/core/src/thread_manager.rs` | `start_thread_with_options` / `resume_thread_with_history` / `fork_thread_from_history` | 新建、恢复和历史分支 |
| `codex-rs/core/src/session/mod.rs` | `Codex::spawn` | Session 初始化依赖与 channel |
| `codex-rs/thread-store/src/store.rs` | `ThreadStore` trait | 存储中立边界 |
| `codex-rs/app-server/tests/suite/v2/thread_resume.rs` | tests | 恢复语义 |
| `codex-rs/app-server/tests/suite/v2/thread_fork.rs` | tests | fork 语义 |

### 阅读问题

- persisted Thread 与 loaded Session 为什么分开？
- resume 与 fork 对历史的处理有何不同？
- 客户端断开后 Thread 是否必须销毁？
- 当前项目 Conversation 是否有 owner、archive、active run 投影？

### Goal：Thread 级长期状态

```text
thread/goal/set|get|clear
  -> ThreadGoalRequestProcessor
  -> GoalService
  -> state ThreadGoal
  -> GoalExtension lifecycle/token/tool contributors
  -> ThreadGoalUpdated durable event + client notification
```

- `codex-rs/app-server/src/request_processors/thread_goal_processor.rs`
- `codex-rs/ext/goal/src/api.rs`
- `codex-rs/ext/goal/src/extension.rs`
- `codex-rs/ext/goal/src/runtime.rs`
- `codex-rs/ext/goal/tests/goal_extension_backend.rs`
- `codex-rs/app-server/tests/suite/v2/thread_resume.rs`

阅读问题：Goal 为什么不等于 Turn？objective 更新是否重置 usage？Paused/Blocked/BudgetLimited 如何跨 resume 保持？模型可调用 Goal tool，但谁拥有最终状态转换权？

## 5. 路线三：模型采样如何形成循环

### 调用链

```text
run_turn
  -> build prompt from ContextManager
  -> run_sampling_request
  -> try_run_sampling_request
  -> ModelClientSession::stream
  -> ResponseEvent
  -> needs_follow_up?
  -> next sampling / complete
```

### 源码入口

| 文件 | 位置 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/core/src/session/turn.rs` | `run_turn` outer loop | prompt、follow-up、pending input 与 auto-compaction |
| `codex-rs/core/src/session/turn.rs` | `run_sampling_request` / `try_run_sampling_request` | 一轮 provider stream、tool futures 与 completion |
| `codex-rs/core/src/session/turn_context.rs` | `TurnContext` | 一次 Turn 固定的 model/provider/policy/config |
| `codex-rs/core/src/session/step_context.rs` | `StepContext` | 每次 sampling 固定的 environment/capability/MCP/tool snapshot |
| `codex-rs/core/src/client.rs` | `ModelClient` / `ModelClientSession` | provider-independent client 与 turn-scoped transport session |
| `codex-rs/codex-api/src/common.rs` | `ResponseEvent` | SSE/WebSocket 被归一化后的事件集合 |

配套测试优先读 `core/src/client_tests.rs` 的 transport/auth/retry 边界、`core/tests/suite/pending_input.rs` 的 follow-up、`app-server/tests/suite/v2/selected_capability_stack.rs` 的 step snapshot，以及 `core/tests/suite/abort_tasks.rs` 的取消终态。

### 映射到当前项目

当前 `OpenAICompatibleClient.chatStream()` 只读取 `delta.content`，因此第一步要定义 provider-neutral `ModelStreamEvent`，不能直接在 `AgentRuntimeService` 解析 OpenAI SDK chunk。

## 6. 路线四：Tool Call 如何执行并回填

### 调用链

```text
ResponseEvent::OutputItemDone
  -> handle_output_item_done
  -> ToolRouter::build_tool_call
  -> ToolCallRuntime.handle_tool_call
  -> ToolRouter.dispatch
  -> ToolRegistry.dispatch
  -> handler/runtime
  -> ResponseInputItem tool output
  -> record history
  -> needs_follow_up
```

### 源码入口

| 文件 | 位置 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/core/src/session/turn.rs` | `try_run_sampling_request` | 完成 item、in-flight futures 与 follow-up |
| `codex-rs/core/src/stream_events_utils.rs` | `handle_output_item_done` | tool / non-tool 分叉与完成 item 记录 |
| `codex-rs/core/src/tools/router.rs` | `ToolCall` / `build_tool_call` | tool_name/call_id/raw payload 路由信封，不等于业务 schema 已验证 |
| `codex-rs/core/src/tools/parallel.rs` | `ToolCallRuntime::handle_tool_call` | 并发许可、取消和 terminal lifecycle |
| `codex-rs/core/src/tools/registry.rs` | `dispatch_any_with_terminal_outcome` | 名称/kind、hook、handler 与 telemetry |
| `codex-rs/tools/src/tool_spec.rs` | `ToolSpec` | 模型可见 contract 与运行实现分离 |

### 配套测试

- `codex-rs/core/src/tools/router_tests.rs`
- `codex-rs/core/src/tools/registry_tests.rs`
- `codex-rs/core/src/tools/spec_plan_tests.rs`
- `codex-rs/core/src/stream_events_utils_tests.rs`
- `codex-rs/app-server/tests/suite/v2/dynamic_tools.rs`
- `codex-rs/core/tests/suite/tool_parallelism.rs`
- `codex-rs/core/tests/suite/hooks.rs`

`core/tests/suite/tool_harness.rs` 当前第一个黄金测试使用 mock Responses SSE 驱动已注册的真实 `shell_command` handler，再捕获第二轮 request 的 `function_call_output`；它不是 fake executor 单元测试。当前项目应迁移“按次 mock provider + 捕获第二轮输入”的验证结构，用无副作用 SEO executor 替代 shell。

### Tool search 与 argument streaming

- `codex-rs/core/src/tools/handlers/tool_search.rs`：client `ToolSearchCall` 如何检索当前 catalog 并返回 loadable specs。
- `codex-rs/core/src/session/turn.rs`：`active_tool_argument_diff_consumer` 的创建、consume、finish。
- `codex-rs/core/src/tools/registry.rs`：`ToolArgumentDiffConsumer` contract。
- `codex-rs/core/src/tools/handlers/apply_patch.rs`：partial patch 只投影 `PatchApplyUpdated`。
- `codex-rs/core/tests/suite/plugins.rs`、`codex-rs/core/src/tools/handlers/mcp_search_tests.rs`：deferred tools 与 provenance。

阅读不变量：tool search 只扩大后续 sampling 的可见 catalog；argument delta 只用于预览。两者都不能绕过完整 payload、registry、handler 和 policy 直接执行。

### 当前项目练习重点

先用 fake model stream：第一轮返回 unvalidated call envelope，router 产 validated invocation，无副作用 executor 返回 observation，第二轮断言输入包含 mixed assistant call（如有文本）与同 callId observation 并返回 final text。

## 7. 路线五：工具安全如何分层

### 调用链

```text
ToolRuntime request
  -> exec approval requirement
  -> permission/approval decision
  -> sandbox selection
  -> first attempt
  -> classified denial/failure
  -> optional approval and retry
```

### 源码入口

| 文件 | 位置 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/core/src/config/permissions.rs` | permission profile compiler | 文件、网络和继承边界 |
| `codex-rs/core/src/exec_policy.rs` | approval requirement | 命令规则与 permission profile 如何合并 |
| `codex-rs/core/src/tools/approvals.rs` | approval reviewer | 用户、Guardian 与 failure-closed |
| `codex-rs/core/src/tools/orchestrator.rs` | `ToolOrchestrator::run` | approval、sandbox、network approval、attempt/retry；非全局必经层 |
| `codex-rs/core/src/tools/sandboxing.rs` | approval/sandbox traits | policy 与 runtime 契约 |
| `codex-rs/core/src/guardian` | Guardian review | 风险 reviewer，不替代 sandbox |

### 迁移提醒

SEO Agent 当前不执行 shell。阅读目标是学会把 `risk metadata -> permission -> approval -> execution` 分开，而不是移植平台 sandbox。先用 `rg "ToolOrchestrator::new"` 核对真实调用点；MCP/dynamic 等 handler 有各自执行路径，不能写成“所有 Codex 工具统一经过 orchestrator”。

## 8. 路线六：Context 如何保持合法

### 源码入口

| 文件 | 位置 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/core/src/context_manager/history.rs` | `ContextManager` / `record_items` / `for_prompt` / `normalize_history` | model history、预算、rollback、call/output 和模态不变量 |
| `codex-rs/core/src/context_manager/normalize.rs` | normalization helpers | 补缺失 output、删除 orphan output |
| `codex-rs/core/src/context/world_state` | `WorldState` fragments | 环境/插件/App 等动态上下文如何去重更新 |
| `codex-rs/core/src/compact.rs` / `compact_*` | compaction | local/remote/token-budget 压缩生命周期 |

### 配套测试

- `codex-rs/core/src/context_manager/history_tests.rs`
- `codex-rs/core/tests/suite/token_budget.rs`
- `codex-rs/core/tests/suite/compact_resume_fork.rs`
- `codex-rs/core/tests/suite/truncation.rs`
- `codex-rs/app-server/tests/suite/v2/thread_rollback.rs`

### 当前项目对照

`SeoContextBuilder` 目前只是在 history 前加 prompt；固定 12 条消息不是完整 Context policy。

## 9. 路线七：哪些事实被持久化

### 源码入口

| 文件 | 位置 | 阅读重点 |
| --- | --- | --- |
| `codex-rs/rollout/src/policy.rs` | `is_persisted_rollout_item` / `should_persist_*` | ResponseItem、Turn 终态与 transient event 的筛选 |
| `codex-rs/rollout/src/recorder.rs` | `RolloutRecorder` | live append、flush 和错误传播 |
| `codex-rs/thread-store/src/store.rs` | `ThreadStore` | create/resume/append/persist/flush/load 的存储中立边界 |
| `codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs` | history projection | paginated `TurnItem` 与 legacy EventMsg 的兼容投影 |
| `codex-rs/core/src/session/rollout_reconstruction_tests.rs` | reconstruction tests | 恢复时如何重建合法 working history |

### 阅读问题

- 为什么 `ItemStarted` 不一定持久化，而 `TurnComplete` 要持久化？
- 工具调用事实为什么必须保留？
- 当前 PostgreSQL schema 如何表达 tool call 与 observation？
- Run 标为 COMPLETED 前需要哪些事务保证？

## 10. 路线八：Interrupt、Steer、Resume、Fork

| 能力 | 协议入口 | 测试 |
| --- | --- | --- |
| Interrupt | `turn/interrupt` | `app-server/tests/suite/v2/turn_interrupt.rs` |
| Steer | `turn/steer` | `app-server/tests/suite/v2/turn_steer.rs` |
| Resume | `thread/resume` | `app-server/tests/suite/v2/thread_resume.rs` |
| Fork | `thread/fork` | `app-server/tests/suite/v2/thread_fork.rs` |

阅读时重点比较状态变化、历史变化和新旧 ID，不要只看 API 名字。

## 11. 路线九：扩展能力

先读 `codex-rs/ext/extension-api/src/registry.rs` 与 `codex-rs/ext/extension-api/src/contributors.rs`，理解 host 允许扩展贡献哪些 typed surface，以及为什么贡献者只拿稳定 ID、私有 `ExtensionData` 和窄输入，而不是整个 Session。

### Built-in / Dynamic / MCP

- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/src/tools/handlers/dynamic.rs`
- `codex-rs/core/src/tools/handlers/mcp.rs`
- `codex-rs/core/src/mcp_tool_call/`
- `codex-rs/ext/extension-api/tests/registry.rs`
- `codex-rs/app-server/tests/suite/v2/mcp_tool.rs`
- `codex-rs/app-server/tests/suite/v2/dynamic_tools.rs`

### Skills / Plugins / Hooks

- `codex-rs/core/src/skills.rs`
- `codex-rs/ext/skills/src/`
- `codex-rs/core/src/plugins/`
- `codex-rs/core/src/hook_runtime.rs`
- `codex-rs/core/src/context/world_state/`
- `codex-rs/app-server/tests/suite/v2/skills_list.rs`
- `codex-rs/app-server/tests/suite/v2/plugin_list.rs`
- `codex-rs/app-server/tests/suite/v2/hooks_list.rs`

阅读问题：它们分别提供“指令”“工具”“生命周期扩展”还是“分发安装”？不要把这些术语互换。

## 12. 路线十：Multi-agent

### 源码入口

- `codex-rs/core/src/agent/control/spawn.rs`
- `codex-rs/core/src/agent/control/execution.rs`
- `codex-rs/core/src/agent/control/residency.rs`
- `codex-rs/core/src/agent_communication.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/core/src/agent/control_tests.rs`

阅读重点：

- 子 Agent 为什么是独立 Thread？
- 父子关系如何持久化？
- fork history 与只传 prompt 的成本区别？
- 并发容量如何限制？
- 消息和结果如何回到父 Agent？
- execution capacity 与 v2 residency capacity 为什么分开？

失败/边界测试继续读 `codex-rs/core/src/agent/control/execution_tests.rs`、`codex-rs/core/src/agent/control/residency_tests.rs` 与 `codex-rs/core/tests/suite/pending_input.rs`，分别验证并发限额、idle eviction 和 mailbox follow-up。

## 13. 路线十一：SDK 不复制 Runtime

### TypeScript SDK

- `sdk/typescript/src/codex.ts`
- `sdk/typescript/src/thread.ts`
- `sdk/typescript/src/events.ts`
- `sdk/typescript/tests/runStreamed.test.ts`
- `sdk/typescript/tests/abort.test.ts`

### Python SDK

- `sdk/python/src/openai_codex/client.py`
- `sdk/python/src/openai_codex/_run.py`
- `sdk/python/src/openai_codex/_message_router.py`
- `sdk/python/examples/02_turn_run/`
- `sdk/python/examples/06_thread_lifecycle_and_controls/`

阅读重点：SDK 封装协议和易用 API，不拥有另一套模型工具循环。

## 14. 路线十二：Event 如何成为产品状态

```text
ResponseEvent
  -> core EventMsg / TurnItem
  -> bespoke_event_handling
  -> ServerNotification
  -> client live projection

durable RolloutLine
  -> thread_history_projection::project_rollout_line
  -> ThreadHistoryChangeSet
  -> reconnect/read/list projection
```

源码与测试：

- `codex-rs/core/src/event_mapping.rs`
- `codex-rs/app-server/src/bespoke_event_handling.rs`
- `codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs`
- `codex-rs/app-server-protocol/src/protocol/thread_history_projection_tests.rs`
- `codex-rs/app-server/tests/suite/v2/thread_read.rs`
- `codex-rs/app-server/tests/suite/v2/thread_status.rs`
- `codex-rs/app-server/tests/suite/v2/thread_unsubscribe.rs`

阅读问题：实时 delta、完成 Item、Turn status、durable history 和 analytics fact 分别由谁拥有？客户端断开后哪些仍会继续？

## 15. 路线十三：可观测性与质量

- `codex-rs/core/src/client.rs`：transport retry、usage、WebSocket/SSE metadata。
- `codex-rs/core/src/session/turn.rs`：sampling/response spans 与 TTFT。
- `codex-rs/core/src/tools/registry.rs`、`orchestrator.rs`、`tool_dispatch_trace.rs`：tool decision/result/latency。
- `codex-rs/core/src/turn_timing.rs`：Turn profile。
- `codex-rs/otel/src/provider.rs`：trace-safe 与 log-only 导出边界。
- `codex-rs/analytics/src/reducer.rs`：notification 到 analytics fact，不拥有 runtime 状态。
- `codex-rs/core/tests/common/responses.rs`、`streaming_sse.rs`：fake provider harness。
- `codex-rs/core/tests/suite/otel.rs`、`codex-rs/analytics/src/analytics_client_tests.rs`：metadata 与投影断言。

## 16. 当前项目反向阅读地图

完成 Codex 一条路线后，立即回到当前项目找对应边界：

| 主题 | 当前项目文件 |
| --- | --- |
| HTTP/stream 入口 | `apps/api/src/seo/seo.controller.ts` |
| 业务 facade | `apps/api/src/seo/seo.service.ts` |
| Runtime | `apps/api/src/agent-runtime/agent-runtime.service.ts` |
| Runtime event | `apps/api/src/agent-runtime/agent-runtime.types.ts` |
| 外部 event mapper | `apps/api/src/seo/seo-chat-stream-event.mapper.ts` |
| Model boundary | `apps/api/src/llm/llm.service.ts` |
| Provider adapter | `apps/api/src/llm/clients/openai-compatible.client.ts` |
| Context | `apps/api/src/seo/seo-context-builder.service.ts` |
| Persistence | `prisma/schema.prisma`、`agent-run-recorder.service.ts` |
| Frontend stream | `apps/web/src/api/seo.ts`、`useSeoWorkspace.ts` |

每次只回答一个具体差距：“Codex 在这里保护了哪个不变量？当前项目最小应增加什么？”

## 17. 路线十四：App Server 如何避免重连与 RPC 竞态

先读协议中的资源作用域，再读队列实现，最后读 Thread listener；不要一开始钻进单个 request processor：

```text
protocol/common.rs::ClientRequest::serialization_scope
  -> request_serialization.rs::RequestSerializationQueues
  -> message_processor.rs::dispatch_initialized_client_request
  -> thread_state.rs::ThreadListenerCommand
  -> request_processors/thread_lifecycle.rs
```

源码入口：

- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server-protocol/src/protocol/v1.rs::InitializeCapabilities`
- `codex-rs/app-server/src/request_serialization.rs`
- `codex-rs/app-server/src/message_processor.rs`
- `codex-rs/app-server/src/thread_state.rs`
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs`

配套测试优先找这些断言：同资源 exclusive 顺序、配置 shared read、无 scope 并发、未 initialize/未启用 experimental 的拒绝、运行中 resume 的 active turn、pending approval 重放、unsubscribe 后 Turn 继续，以及 idle 且无订阅者才 unload。

阅读完成后应能解释：为什么请求序列化键有些包含 `connection_id`、有些跨连接共享；为什么 resume response 与 subscription 必须在 listener 顺序中成为一个操作；为什么 notification opt-out 不能改变 canonical history。

## 18. 路线十五：模型传输何时可以安全复用

```text
session::turn::run_sampling_request
  -> ModelClientSession::stream
      -> Responses WebSocket / HTTP SSE
      -> map_response_events
  -> retryable error decision
      -> WS retry
      -> session-scoped HTTP fallback
      -> terminal error
```

按顺序阅读：

- `codex-rs/core/src/client.rs` 顶部寿命说明、`ModelClientSession`、`responses_request_properties_match`、`prepare_websocket_request`、`map_response_events`。
- `codex-rs/core/src/responses_retry.rs`：统一 retry/fallback 决策。
- `codex-rs/core/src/session/turn.rs::run_sampling_request` 与 `try_run_sampling_request`：业务错误短路、attempt 重建和 `ResponseEvent` 消费。
- `codex-rs/codex-api/src/endpoint/responses.rs`、`responses_websocket.rs`：HTTP SSE / WS 传输层。
- `codex-rs/core/tests/suite/client_websockets.rs` 与 `client.rs`：prefix、字段变化、失败清理、401、断流、rate limit 和历史去重。

必须做三个反例推演：上次请求只收到 delta 未收到 Completed；instructions 在第二次 sampling 改变；WS 失败后下一请求改走 HTTP。分别回答哪些缓存必须失效、哪些逻辑历史仍保留、错误由哪一层决定重试。

## 19. 路线十六：一次 append 何时才算持久化成功

从 live append 顺着 barrier 读，不要先看数据库 schema：

```text
thread-store/local/live_writer.rs::append_items
  -> RolloutRecorder::record_canonical_items
  -> RolloutWriterState::pending_items
  -> flush / reopen retry
  -> LiveThread metadata update
  -> state DB backfill/list projection
```

源码入口：

- `codex-rs/thread-store/src/local/live_writer.rs`
- `codex-rs/rollout/src/recorder.rs`
- `codex-rs/rollout/src/ordinal.rs`
- `codex-rs/rollout/src/reverse_jsonl_scanner.rs`
- `codex-rs/rollout/src/state_db.rs`
- `codex-rs/rollout/src/metadata.rs`
- `codex-rs/state/src/runtime/backfill.rs`
- `codex-rs/state/src/runtime/recovery.rs`
- `codex-rs/app-server/src/lib.rs` 的 state DB recovery 入口

用四个故障验证理解：目录暂时不可写；写到一半后 handle 失效；paginated 文件末尾是不完整 JSON；SQLite metadata DB 损坏但 goals DB 正常。对每个故障写出保留的 canonical facts、允许重试的 barrier、需要重建的 projection 和不能删除的数据。

## 20. 路线十七：一个工具动作如何获得最终执行权

按决策顺序读，而不是按目录读：

1. `core/src/tools/registry.rs` 与 `core/src/hook_runtime.rs`：pre/post hook 在 handler 两侧的位置。
2. `hooks/src/events/pre_tool_use.rs`、`post_tool_use.rs`、`engine/output_parser.rs`：block、rewrite、invalid output 语义。
3. `core/src/tools/handlers/request_permissions.rs` 与 `session/mod.rs`：请求、pending response、交集和 Turn/Session scope。
4. `core/src/tools/orchestrator.rs`、`sandboxing.rs`、`approvals.rs`：approval → sandbox → denial escalation。
5. `core/src/tools/network_approval.rs` 与 `network_policy_decision.rs`：执行级网络归因。
6. `core/src/guardian/mod.rs`、`review.rs`、`review_session.rs`：隔离 reviewer、fail-closed 与 rejection circuit breaker。

阅读时做一张“谁能扩大权限”的表。正确答案应非常少：模型和 hook 只能提出候选，客户端/Guardian 的授权仍受原请求交集限制，Orchestrator 只按已解析 policy 选择 attempt，真正的 I/O 上限由 PermissionProfile、sandbox 和 managed proxy 执行。

## 21. 路线十八：扩展为何不能拿到整个 Runtime

先读 API 契约，再看 Core 如何调用：

- `codex-rs/ext/extension-api/src/registry.rs`
- `codex-rs/ext/extension-api/src/state.rs`
- `codex-rs/ext/extension-api/src/contributors.rs`
- `codex-rs/ext/extension-api/src/contributors/context.rs`
- `codex-rs/ext/extension-api/src/contributors/mcp.rs`
- `codex-rs/ext/extension-api/src/contributors/tool_lifecycle.rs`
- `codex-rs/ext/extension-api/src/contributors/turn_lifecycle.rs`
- `codex-rs/core/src/session/session.rs` 的 Thread store 创建与 lifecycle gate
- `codex-rs/core/src/session/turn_context.rs`、`turn.rs` 的 Turn store
- `codex-rs/core/src/stream_events_utils.rs` 的 TurnItem post-processing

逐类标注合并规则：all-in-order、first-claim、last-write-by-name、observer-only 或 mutate-in-order。然后标注失败策略：忽略并 warning、短路、阻止启动或返回 host。若无法回答这两项，就还没有理解该扩展点的真实权力。

最后用一个反例检验：某扩展需要把外部 CRM 摘要加到 prompt、记录 token usage，并在 Thread resume 后恢复缓存。正确实现应是三个 typed contributor 共享 Thread attachment/外部持久化，而不是获得一个 `Session` 指针后在任意事件里改历史。

## 22. 路线十九：Multi-agent 的三个“并发上限”

```text
root-scoped AgentControl
  -> AgentRegistry        identity/tree
  -> V2Residency          loaded threads
  -> AgentExecutionLimiter active child turns
  -> RolloutBudget        shared cost
```

阅读顺序：

- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/agent/registry.rs`
- `codex-rs/core/src/agent/control/spawn.rs`
- `codex-rs/core/src/agent/control/residency.rs`
- `codex-rs/core/src/agent/control/execution.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/core/src/session/input_queue.rs`

先画一名 child 的状态迁移：reserved → loaded/running → completed resident → evicted → reloaded → follow-up running。每条边分别标出 registry、residency、execution guard 和 rollout 的变化。再对 queue-only message、trigger-turn followup、interrupt、final answer 后迟到 mail 做时序推演。

最后对照 V1 tests，明确列出不能沿用到 V2 的假设：depth limit、完成 watcher、显式 close/resume 与 target id 形状。V2 仍在快速演进，应把这些差异记录为快照事实而非通用 Agent 定律。

## 23. 路线二十：Context rewrite 后哪些缓存必须失效

```text
record_items
  -> raw ResponseItem history
  -> for_prompt normalization
  -> provider request

history rewrite
  -> history_version++
  -> world_state_baseline = None
  -> conditionally clear reference_context_item
  -> next turn full reinjection
```

阅读入口：

- `codex-rs/core/src/context_manager/history.rs`
- `codex-rs/core/src/context_manager/normalize.rs`
- `codex-rs/core/src/context_manager/updates.rs`
- `codex-rs/core/src/context/world_state/mod.rs`
- `codex-rs/core/src/session/world_state.rs`
- `codex-rs/core/src/session/context_window.rs`
- `codex-rs/core/src/compact.rs`
- `codex-rs/core/src/compact_token_budget.rs`
- `codex-rs/core/src/session/turn.rs` 的 pre-sampling / inline compact 分支

练习一：构造 call 无 output、orphan output、旧模型支持 image 而新模型不支持 image 三种 history，写出 `for_prompt` 结果。练习二：分别模拟 pre-turn、mid-turn 和 rollback，标出 summary、initial context、last user 与 reference baseline 的位置/状态。练习三：解释 `BodyAfterPrefix` 为什么仍必须检查 full context window。

## 24. 路线二十一：并行 Tool 为何不会打乱模型历史

```text
ResponseEvent::OutputItemDone(tool call)
  -> persist call immediately
  -> ToolCallRuntime + RwLock admission
  -> FuturesOrdered
  -> persist output in call order
  -> next sampling
```

源码入口：

- `codex-rs/core/src/stream_events_utils.rs::handle_output_item_done`
- `codex-rs/core/src/tools/parallel.rs`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/session/turn.rs::drain_in_flight`
- `codex-rs/core/src/tools/lifecycle.rs`

构造三个工具：两个 read-only 快工具和一个 exclusive 慢工具，分别改变 emission/completion 顺序，验证 gate 与 history 顺序。再在“等待 gate”“handler 中”“handler 已返回但 finish observer 未完成”三个时间点取消，检查 response pair、terminal lifecycle 和 timing attribution。

特别区分三种顺序：provider 发出 call 的顺序、真实副作用完成的顺序、observation 回填 model history 的顺序。只有第三种必须严格确定；若业务要求副作用也有序，就不应给 handler parallel opt-in。

## 25. 路线二十二：谁拥有 Active Turn 的终止权

```text
submission_loop (serialized control)
  -> start/steer/interrupt/approval
  -> RunningTask (background work)
  -> TurnState (pending holders/input/grants)
  -> on_task_finished OR handle_task_abort
  -> terminal event + flush
```

源码入口：

- `codex-rs/core/src/session/handlers.rs::submission_loop`
- `codex-rs/core/src/tasks/mod.rs`
- `codex-rs/core/src/tasks/regular.rs`
- `codex-rs/core/src/state/turn.rs`
- `codex-rs/core/src/session/input_queue.rs`
- `codex-rs/core/src/session/inject.rs`
- `codex-rs/core/src/session/mod.rs::steer_input`

画出 ActiveTurn 的 `None → reserved(task=None) → running → finishing(task=None) → None`，以及 running → abort-owned → None。每次跨 `await` 后找 identity recheck。特别观察：pending approvals何时清、terminal event前后各为何需要 flush、cancel token与handle abort谁先发生。

用三个竞态测试理解：旧 task finish与新 task start并发；extension idle reservation期间trigger mail到达；用户在process cleanup和tool lifecycle finish之间interrupt。能说明最终哪个 Turn收到input、谁发terminal、是否会双发，才算读懂。

## 26. 路线二十三：Legacy replay 与 Paginated projection 的分界

先并排阅读：

- `codex-rs/app-server-protocol/src/protocol/thread_history.rs`
- `codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs`
- `codex-rs/app-server-protocol/src/protocol/thread_history_projection_tests.rs`
- `codex-rs/app-server/src/thread_state.rs` 的 live `ThreadHistoryBuilder`
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs` 的 active snapshot resume

建立一张输入分类表：Turn lifecycle、ItemStarted/Completed、legacy begin/end、raw ResponseItem、Compacted、TurnContext/WorldState。分别标出 legacy builder与paginated projector是否消费，以及产出 Turn metadata、item snapshot还是忽略。

用乱序序列验证：Turn A start → exec begin A → Turn B start → exec end A → Turn A complete → Turn B complete。检查A的item更新、B的active状态和change set。再把A id删掉，对比stateful legacy fallback与stateless paginated ignore，理解“兼容猜测”为什么不能进入新格式。

## 27. 路线二十四：连接断开后哪些工作还能继续

先把一条 App Server connection画成两个并行状态机：processor侧的 initialize/session/RPC gate，与 outbound侧的 writer/capability filter/disconnect token。然后按以下顺序阅读：

- `codex-rs/app-server/src/lib.rs` 的 `TransportEvent` loop、`OutboundControlEvent` 和 shutdown收口。
- `codex-rs/app-server/src/transport.rs` 的 `route_outgoing_envelope`、notification filter与慢连接策略。
- `codex-rs/app-server/src/message_processor.rs` 的 `ConnectionSessionState`、initialize/dispatch与 `connection_closed`。
- `codex-rs/app-server/src/request_processors/initialize_processor.rs`：OnceLock提交、process-global client identity和outbound-ready分工。
- `codex-rs/app-server/src/connection_rpc_gate.rs` 与 `request_serialization.rs`：连接 admission和资源 serialization的正交关系。
- `codex-rs/app-server/src/outgoing_message.rs`：`ConnectionRequestId`、pending callback、Thread重放/取消与write completion。
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs`：running Thread resume如何重放 pending approval。

做四个时序练习：initialize response排队但capability尚未镜像；已进入handler时断连；请求还在Thread serialization queue时断连；approval重放到新连接后旧连接迟到响应。分别写出 gate、queue、writer、callback和durable Thread的状态。

最后审计 request id所有权：入站 client request为何必须带ConnectionId，出站 server request为何当前只按全局id first-response-wins。把“不可信多租户共享同一进程”代入，判断现有 responder校验是否足够。这个结论是部署边界，不应被JSON-RPC类型安全掩盖。

## 28. 路线二十五：MCP refresh 为什么不能原地替换 client map

按“投影输入 → Runtime generation → Step snapshot → tool call”阅读：

- `codex-rs/core/src/mcp.rs`：config/plugin/extension/compatibility catalog合并。
- `codex-rs/core/src/session/mcp.rs`：projection lock、environment key比较、refresh/publication和elicitation holder。
- `codex-rs/core/src/session/mcp_runtime.rs`：一个Step实际冻结的边界。
- `codex-rs/codex-mcp/src/connection_manager.rs`：startup聚合、required validation、cache/reconnect、resource pagination、shutdown/Drop。
- `codex-rs/codex-mcp/src/rmcp_client.rs`：transport startup future、cached tools与Codex Apps reconnect。
- `codex-rs/core/src/mcp_tool_exposure.rs`：model visibility、connector policy和direct/deferred exposure。
- `codex-rs/core/src/tools/handlers/mcp.rs` 与 `mcp_tool_call.rs`：命名空间、并行声明、approval、argument/meta rewrite和结果清洗。

构造两代Runtime：Step A已经拿到server-v1，配置refresh发布server-v2，Step B随后开始。验证A的spec、manager、cwd和call都来自v1，B全部来自v2；最后一个A引用释放后v1 startup/process才可cancel。再只改变一个与任何MCP server无关的environment id，确认manager应复用而不是重启。

继续做三个失败练习：required server失败、optional Codex Apps失败但有cache、resources/list重复cursor。分别说明Session是否还能启动、模型能看到哪些工具、聚合结果保留哪些server。最后检查elicitation在refresh前发出、refresh后响应时，为什么必须复用router而不能只查新manager的本地map。

## 29. 路线二十六：为什么 managed config 仍可能被用户覆盖

先明确普通config与requirements是两条输入，不要从最终`Config`倒推：

- `codex-rs/config/src/config_layer_source.rs`：每类普通layer的明确precedence。
- `codex-rs/config/src/state.rs`：stack排序、project祖先链、profile user layer、effective config和origins。
- `codex-rs/config/src/merge.rs`：table递归、array/scalar替换、alias/domain normalization。
- `codex-rs/config/src/cloud_config_bundle.rs` 与 `cloud_config_layers.rs`：cloud fragment进入两条stack的方向。
- `codex-rs/config/src/requirements_layers/stack.rs`：regular requirements merge与source attribution。
- `requirements_layers/{rules,hooks,permissions}.rs`：append/union/fail-closed的领域规则。
- `codex-rs/config/src/constraint.rs` 与 `config_requirements.rs`：validator、normalizer、allow-only和source。
- `codex-rs/core/src/config/mod.rs::from_config_with_base`：最终fallback/fatal、permission重新物化和MCP disable。

练习一：依次给system、enterprise、user、project、session设置同一scalar和一个array，写出winner；再把同一限制写进requirements，解释为什么结果不同。练习二：两层requirements分别添加hook目录、hook event和deny-read，推演哪些append、哪些union、哪些冲突启动失败。

最后模拟一次配置编辑：只修改active profile的model字段。列出写回磁盘的内容、保留但不写回的非user layer，以及必须重新应用的requirements。若实现方案是把`effective_config()`整份写到`config.toml`，说明它会怎样破坏provenance和后续managed更新。

## 30. 路线二十七：Environment ID、连接与 Step handle 如何分工

阅读顺序：

- `codex-rs/exec-server/src/environment_provider.rs` 与 `environment_toml.rs`：可用列表、default、local injection和disabled。
- `codex-rs/exec-server/src/environment.rs`：registry、upsert/pending/Noise、Environment backend组合与startup task。
- `codex-rs/exec-server/src/client.rs::LazyRemoteExecServerClient`：初次OnceCell、current client、single reconnect与fail-fast。
- `codex-rs/core/src/environment_selection.rs`：Thread selection、shared resolution与blocking/non-blocking snapshot。
- `codex-rs/exec-server/src/resolved_capability.rs`：passive inspect和Step-bound resolve。
- `codex-rs/core/src/session/mod.rs::capture_step_context`：environment、AGENTS.md、capability root和MCP的一次性快照。
- `codex-rs/core/src/tools/handlers/wait_for_environment.rs`、`tools/spec_plan.rs` 与 `context/world_state/environment.rs`：模型如何看见starting并等待。

用同一个environment id做三代状态：首次连接pending、首次失败、首次成功后断线。分别说明`wait_until_ready`是否重试、普通filesystem call是否reconnect、fail-fast inspection会返回什么。再在Step A捕获handle后upsert同名environment，确认A不能转用新handle，后续Step何时才能看到新实例。

最后构造两个selected capability roots指向同一starting environment。检查本Step为何两个都omit但只启动一次；下一Stepready后为何两个都绑定同一Arc。把cwd改成非本机`PathUri`，列出哪些消费者仍可能错误fallback到host path，作为迁移审计点。

## 31. 路线二十八：一次 exec 返回后命令为什么还活着

按身份与事实流阅读：

- `codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs`、`write_stdin.rs`：call id、process id、chunk id与环境/权限解析。
- `codex-rs/core/src/unified_exec/process_manager.rs`：reservation、sandbox attempt、yield/poll、store、network approval和LRU。
- `codex-rs/core/src/unified_exec/process.rs`、`process_state.rs`：local/remote handle统一、output/state signal。
- `head_tail_buffer.rs` 与 `async_watcher.rs`：response chunk、delta、terminal aggregate三条输出投影。
- `codex-rs/exec-server/src/local_process.rs`：Starting/Running、seq、read/write/terminate、retention。
- `codex-rs/exec-server/src/client.rs` 与 `client_recovery.rs`：ordered events、resume补读与stdin idempotency。
- `codex-rs/app-server/src/thread_history.rs`：跨Turn迟到ExecCommandEnd如何归属原item。

构造一个命令：100ms内输出head，初次yield后继续大量输出，期间断开remote transport，重连后写一次stdin，最终在新Turn开始后退出。逐项写出三种id、每次`after_seq`、write id、HeadTailBuffer内容、delta/terminal item和process store变化。

再做两个失败练习：Exited比最后output早到；write已经进入child stdin但response在网络上丢失。前者靠seq gap/read与close barrier恢复，后者靠同write id server dedupe恢复。若方案只是“断线后重发RPC”，会分别造成丢输出和重复输入。

## 32. 路线二十九：同一个 Tool Result 会被送到哪些观测系统

先分三条管线，不要从某个`tracing!`调用推断全部遥测：

- `codex-rs/otel/src/events/shared.rs`、`targets.rs`、`provider.rs`：log-only/trace-safe routing和signal exporter。
- `otel/src/events/session_telemetry.rs`：同一事件的content版与shape版，以及metrics tag。
- `core/src/config/otel.rs`、`otel_init.rs`：默认开关、Statsig debug差异、span attributes/tracestate。
- `codex-rs/analytics/src/{facts,reducer,events,client}.rs`：协议fact、join条件、lossy queue与HTTP payload。
- `codex-rs/feedback/src/lib.rs`、`feedback_diagnostics.rs`：full-fidelity ring、tags、attachments和Sentry upload。
- `app-server/src/request_processors/feedback_processor.rs` 与TUI feedback流程：consent、Thread子树与路径附件。

选一个包含shell arguments、stdout和error的Tool call，逐字段列出：OTEL log、OTEL trace、metric、Analytics event、Feedback ring分别看到什么。再关闭`log_user_prompt`、analytics和include_logs，确认三个开关只影响各自管线，不能互相代替。

最后做威胁建模：远程App Server client传入`extra_log_files=/path/to/secret`，以及开发者把token写进普通span field。指出现有边界为何不会自动阻止，并给出server-side artifact id、trace field allow-list等修复方向。可观测性审计必须包含“没有发送什么”，不能只验证事件存在。

## 33. 路线三十：没有 `/v2` endpoint 的协议如何演进

从wire envelope到schema逐层读：

- `codex-rs/app-server-protocol/src/rpc.rs`：实际JSONRPC方言与四种message shape。
- `protocol/common.rs` 的request/notification宏和登记表：method、params、response、experimental、serialization scope一次声明。
- `protocol/v1.rs`、`protocol/v2/mod.rs`：类型分区与同一union中的新旧API。
- `experimental_api.rs` 与derive macro使用点：method、field、nested collection判定。
- `app-server/src/message_processor.rs::deserialize_client_request` 与dispatch gate：raw→typed→capability。
- `app-server/src/transport.rs`：outbound experimental notification drop与approval字段strip。
- `app-server-protocol/src/export.rs`、`schema_fixtures.rs`：stable schema post-process、孤儿type清理与fixture闭环。

练习一：给稳定`thread/start`新增optional experimental字段，分别构造None、Some(empty)、nested stable和nested experimental值，写出runtime与stable schema结果。练习二：给approval notification新增同类字段，决定旧client应drop whole message还是strip，并说明审批语义为何影响选择。

最后模拟删除deprecated method：除了Rust variant，还检查response payload特例、Analytics reducer、serialization scope、TS/JSON fixture与旧client wire test。若只从schema移除而binary仍接受，它是“停止广告”；若从binary删除，则是breaking change，二者不能混称。

## 34. 路线三十一：401 后为什么先重载再刷新

先从认证所有者而不是HTTP client开始：

- `codex-rs/login/src/auth/manager.rs`：`AuthManager`缓存、revision、refresh semaphore、永久失败snapshot与`UnauthorizedRecovery`状态机。
- `codex-rs/login/src/auth.rs`及storage实现：credential变体、effective/API mode、file/keyring/ephemeral和logout/revoke。
- `codex-rs/core/src/client.rs::stream_responses_api`：一个请求如何创建recovery、每轮重建`ClientSetup`并把phase写入下一attempt遥测。
- 同文件`stream_responses_websocket`：建连401、upgrade fallback与已建连stream error的不同边界。
- `login/tests/suite/auth_refresh.rs`：磁盘变化、account mismatch、permanent/transient failure。
- `login/src/auth/auth_tests.rs`和`core/tests/suite/client.rs::provider_auth_command_refreshes_after_401`：external provider、workspace restriction和真实header替换。

画managed状态机：旧token请求401，第一次只guarded reload并重试，第二次才authority refresh，第三次401终止。分别让磁盘token变更、账户id变更和另一个并发refresh先完成，记录每一步是否访问authority、是否更新cache、下一请求用哪个header。

再把两类重试叠在一张图上：401发生在建流前，SSE断流发生在已经得到response后。说明为什么前者可以重建完整request，而后者必须考虑response id/已消费output；检查WebSocket只在connect阶段恢复认证，不能把任意mid-stream错误自动重放。最后审计新credential类型：若只把它映射为“ChatGPT”产品模式，却没有明确storage、workspace identity和unauthorized recovery能力，会在哪一层产生错误授权。

## 35. 路线三十二：Agent Role 到底锁住了什么

先把metadata discovery与spawn-time config application分开阅读：

- `core/src/config/agent_roles.rs`：逐layer声明/目录发现、role file metadata、字段继承、warning降级与nickname校验。
- `core/src/agent/role.rs`：built-in/user resolve、tool spec、SessionFlags插层、完整Config reload与sticky runtime choice。
- `core/src/tools/handlers/multi_agents/{spawn.rs}`和`multi_agents_v2/spawn.rs`：caller override、role、service tier、runtime override的实际顺序。
- `core/src/agent/control/spawn.rs`与`control.rs::prepare_thread_spawn`：nickname reservation、Thread config、environment/exec-policy继承和resume metadata。
- config/role/multi-agent tests：跨层merge、skills/sandbox、full-history fork拒绝覆盖。

构造三层同名`researcher`：user层给description和config file，project层standalone file只给nickname与developer instructions，session请求另一个model。推演最终metadata、实际role file、model和requirements约束；再让file内部name改成`auditor`，检查duplicate判定发生在声明key还是resolved name。

然后比较三种spawn：无fork、last-N fork、full-history fork。前两者可在新child config上应用role；full-history必须继承父agent type/model/reasoning。把role file中的skills disable与sandbox写根加入练习，确认它们必须走完整Config loader且仍受managed requirements限制。最后把role文件当供应链输入做威胁建模：展示description之前可以只解析metadata，真正启用完整Config前必须建立信任和审计。

## 36. 路线三十三：为什么看见 Skill 不等于读过 Skill

按metadata→catalog→snapshot→body四层阅读：

- `core-skills/src/loader.rs`与`root_loader.rs`：来源root、symlink/hidden、canonical identity、frontmatter、namespace与optional metadata。
- `service.rs`与`config_rules.rs`：config-aware cache、product filter、enable/disable和immutable host snapshot。
- `ext/skills/src/catalog.rs`、`sources.rs`、`provider/*`：Host/Executor/Orchestrator authority、opaque package/resource和list/read路由。
- `ext/skills/src/state.rs`：executor root的Thread缓存、orchestrator MCP generation与bounded resource cache。
- `extension.rs`、`selection.rs`、`render.rs`：Thread/Turn/Step投影、explicit mention、8 KiB预算和双注入抑制。
- `core/session/turn_context.rs`、`turn.rs`与App Server `skills_watcher.rs`：每Turn host snapshot、legacy dependency/analytics路径和watch invalidation。

建立四个同名skill：repo、plugin、remote executor和orchestrator。分别用plain `$name`、filesystem link、`skill://` opaque id和structured UserInput选择，记录谁被选中、由哪个filesystem/provider读取，以及哪些正文被去重。结论必须把name、path、package id与authority分别列出，不能统称skill id。

再做更新实验：当前Turn捕获host snapshot后修改文件、executor断线重连、MCP generation刷新。说明当前Turn、下一Turn、当前Thread executor catalog和新orchestrator generation分别看到哪个版本。最后制造12 KiB main prompt，确认catalog metadata可见不代表正文完整；根据warning和locator继续读取尾部，而不是把8 KiB注入当完整执行说明。
