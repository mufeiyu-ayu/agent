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

## 37. 路线三十四：终端里已经显示的字为什么不能随意改

先区分三种状态所有者：

- `tui/src/app_event.rs`与`app/event_dispatch.rs`：widget意图、App进程动作和退出顺序。
- `app/app_server_event_targets.rs`、`app_server_events.rs`、`thread_routing.rs`：server event的Thread/App/Global路由和active/inactive channel。
- `app/thread_events.rs`与`pending_interactive_replay.rs`：snapshot、bounded buffer、composer、active turn和interactive request重放。
- `chatwidget.rs`与`history_cell/mod.rs`：committed transcript、mutable active cell和overlay revision。
- `streaming/controller.rs`、`table_holdback.rs`、`chunking.rs`、`commit_tick.rs`：raw source、stable queue、mutable tail、resize和显示背压。
- `thread_transcript.rs`：持久化ThreadItem如何重建source-backed history cell。

做一次三Thread实验：A正在stream，B等待approval，C已完成。切到B、回答、再切回A；列出每个store的receiver、buffer、pending replay、active turn和composer。随后模拟session refresh，确认canonical turns替换哪些buffer事件，hook/approval为何需要单独保留或过滤。

对一个含Markdown table的回答按任意delta边界输入，记录`raw_source / rendered / enqueued / emitted / tail`五个长度。中途resize并触发CatchUp，最终结果必须与一次性full render等价且无重复。最后模拟AppServer `Lagged`：列出哪些UI状态能由Thread snapshot恢复，哪些旁路状态没有sequence补读，作为新增notification的可靠性检查清单。

## 38. 路线三十五：Plugin 已下载为何还不等于已启用

按三次决策阅读：

- `core-plugins/src/marketplace*.rs`与`marketplace_add/*`：source发现、requirements allow-list、staging clone和config登记。
- `manager.rs::resolve_installable_plugin/install_resolved_plugin`：product/install/auth policy、source materialize、Store与enabled config顺序。
- `store.rs`：plugin id/version布局、atomic copy/backup/rollback和active version选择。
- `manifest.rs`与`plugin/src/provider.rs`：资源路径限定、Host/Executor authority和inert descriptor。
- `remote_bundle.rs`与`plugin_bundle_archive.rs`：HTTPS、下载/解压cap、tar traversal/link防护和本地物化。
- App Server `request_processors/plugins.rs`：remote detail→local bundle→backend enable→cache refresh，以及install后的auth流程。

构造四个状态：catalog可见未安装、cache已存在未enabled、enabled但auth route不可用、当前Thread已捕获旧plugin snapshot。逐一列出UI、Config、磁盘、skills/MCP/apps/hooks看到什么。再让config写入、backend enable或cache clear分别失败，验证不会把其中一个层的成功误报成全部成功。

安全练习包含三个输入：允许host上的floating Git branch、HTTPS remote bundle、带`../`或symlink的tar。指出source policy、transport安全、archive结构验证各自防什么、不防什么；检查当前路径是否验证digest/signature。若答案只写“来自HTTPS所以可信”，说明还没有完成供应链审计。

## 39. 路线三十六：语音何时变成普通 Agent Turn

按control plane、media loop和handoff三条线阅读：

- App Server `turn_processor.rs::thread_realtime_*`与protocol `v2/realtime.rs`：feature/listener gate、RPC accepted与异步notification。
- `core/realtime_conversation.rs::RealtimeConversationManager`：单实例generation、bounded channels、start/stop和fanout ownership。
- 同文件input loop/event handler：audio drop、text backpressure、response.create queue、barge-in truncate和V1/V2 outbound映射。
- `handle_start_inner`与handoff helpers：realtime event如何路由成regular Turn，后台输出如何回流。
- `realtime_context.rs`：当前Thread、recent work、workspace tree的来源、预算与日志。
- App Server realtime集成测试：WebRTC sideband、active response、steer、tool call和关闭顺序。

画两个并行状态机：realtime transport generation与regular Agent Turn。让语音Session发handoff，Agent执行shell期间继续收audio；随后第二次handoff变成steer，旧Agent progress迟到。标明active handoff id、response create pending、fanout task和Thread Run分别由谁拥有。

再压满四个channel，解释audio为何drop而text/handoff/event为何backpressure。模拟用户barge-in，按sample rate/channels算truncate毫秒。最后审计startup context：列出包含和排除的数据、各section预算、日志级别与租户边界；“内容有token cap”不能替代隐私分析。

## 40. 路线三十七：配对成功到底授权了什么

从enable门到virtual connection逐层阅读：

- App Server startup与`remote_control_processor.rs`：managed policy、SQLite依赖、persisted/ephemeral desired state。
- transport `remote_control/mod.rs`、`desired_state.rs`、state runtime：URL/account/client-name三元持久化和并发锁。
- `auth.rs`、`server_api.rs`、`enroll.rs`：ChatGPT account header、server enrollment/token refresh和pairing identity复核。
- `protocol.rs`、`websocket.rs`、`client_tracker.rs`：client/stream→ConnectionId、seq/cursor/ack、reconnect、idle close与背压。
- `segment.rs`：大JSONRPC分段、重组cap、乱序/重复处理。
- clients/pairing/transport tests：账户切换、撤销、stale enrollment和重放。

先列四个身份：account、installation/server、paired client、stream/Connection。让用户在pair HTTP等待期间切换account，再让WebSocket 401、404和普通断线依次发生，说明哪些token刷新、哪些enrollment替换、哪些Connection重建。

然后发送一个超过150 KiB的响应并在第三段后断线，记录server seq、segment id、ack、outbound buffer和subscribe cursor。最后做权限审计：从remote initialize开始沿普通App Server dispatch列出该client能调用的方法；若没有method-level scope，就明确“配对=完整控制面”，并检查relay能否看到JSONRPC正文以及100 MiB重组cap的DoS成本。

## 41. 路线三十八：配置写成功为什么仍可能没有生效

按read model、mutation和runtime refresh三层阅读：

- `config/src/state.rs`、`fingerprint.rs`和loader README：layer precedence、active user layer、canonical TOML fingerprint与origin。
- `app-server/src/config_manager_service.rs::apply_edits`：writable path、expected version、merge、raw/effective/requirements验证和override metadata。
- `core/src/config/edit.rs`与`utils/path-utils`：`DocumentMut`保格式、batch edit、symlink target、no-op和tempfile persist。
- protocol `v2/config.rs`：Replace/Upsert、WriteStatus、错误码、`reloadUserConfig`契约。
- `request_processors/config_processor.rs`：plugin event、skills/plugins cache clear和loaded Thread refresh。
- `config_manager_service_tests.rs`：comment/order、version conflict、profile path、managed override、merge和validation失败。

先读取同时含system、user profile、project、session和managed层的配置，记录每个key的origin与user layer version。仅改注释/空白后验证version不变，再改语义值验证SHA-256 fingerprint变化。用旧version写入，确认冲突发生在任何落盘之前。

在同一batch中先Upsert table、再clear子path、最后写一个违反requirements的值，证明整批不落盘；移除坏edit后检查注释与顺序仍保留。然后让managed layer覆盖写入key，区分user文件中的stored value、effective value、`OkOverridden`和first-only metadata。

最后安排两个进程：A通过version check后暂停，B写入，再让A继续。沿源码确认持久化层没有第二次fingerprint CAS，解释为何atomic rename只防半文件，不能防lost update。再测试`reloadUserConfig=true`时一个Thread刷新失败：配置已提交、cache已失效和每个Thread已采用新配置必须作为三个状态记录。

## 42. 路线三十九：记忆何时生成、何时使用、何时必须遗忘

把写、读、反馈、删除拆开追踪：

- `memories/write/src/start.rs`与`guard.rs`：root/ephemeral/subagent/state DB门和额度fail-open。
- `phase1.rs`、`prompts.rs`与state memories startup claim：source/idle/history/mode筛选、lease、并行、rollout过滤、预算和secret redaction。
- `phase2.rs`、`storage.rs`、`workspace.rs`：全局lease、usage selection、git diff、受限Agent、heartbeat、artifact验证与baseline commit。
- `ext/memories`：Thread config snapshot、developer summary、dedicated tools、scoped path和ad-hoc note。
- `memories/read/citations.rs`、Core `stream_events_utils.rs`与`memory_usage.rs`：隐藏citation、usage回写和shell telemetry。
- Core tool/MCP路径与state `mark_thread_memory_mode_polluted`：external context如何触发forgetting consolidation。
- App Server memory reset：DB与两个目录的非原子清理。

建立五个Thread：当前root、旧interactive legacy、paginated、subagent和被external tool污染的Thread。推演谁触发pipeline、谁可被Phase 1 claim、谁会从Phase 2 selection被排除。让两个启动并发claim同一rollout，再让worker过lease后回写，检查ownership token是否阻止迟到结果冒充成功。

让Phase 2在同步文件后、Agent完成前丢global lease；再分别制造invalid `memory_summary.md`和baseline reset失败。记录DB selection marker、workspace diff和git baseline能否前移。特别比较parent permission profile为Managed、Disabled和External三种情况，不要笼统声称consolidator总是no-network sandbox。

读取侧先只启用summary injection，再打开dedicated tools。用`../`、hidden path、中间symlink、超长read和search cursor攻击scoped backend；随后让模型输出合法/部分畸形citation，验证visible answer、结构化citation、usage count和Turn metric。最后触发`memory/reset`目录删除失败，说明为何“DB已清、文件未清”需要可重试删除状态。

## 43. 路线四十：Patch 返回失败时磁盘是否真的没变

按intent、policy、mutation、projection四层阅读：

- `apply-patch/src/parser.rs`、`streaming_parser.rs`与`invocation.rs`：freeform语法、增量preview、shell heredoc识别、cwd/environment绑定。
- `invocation.rs::try_verify_apply_patch_args`：全量路径解析、旧内容读取和预计算action。
- Core `safety.rs`与handler permission helpers：source/destination、writable root、hardlink、profile、additional permission和foreign PathUri。
- `apply-patch/src/lib.rs::apply_hunks_to_files`：顺序Add/Delete/Update/Move、overwrite、父目录创建、partial failure和exactness。
- `tools/runtimes/apply_patch.rs`与orchestrator：approval cache、sandbox retry、committed delta跨attempt累积。
- `turn_diff_tracker.rs`与ToolEmitter：磁盘事实如何投影成事件和Turn净diff。

先让模型分三段stream一个patch，在500ms节流窗口中记录UI preview；随后PreToolUse hook改掉destination，证明preview不是审计事实。再在verification与runtime之间修改source文件，确认执行重新匹配当前内容而非盲写预计算new content。

构造四hunk：Add成功、Move destination写成功但source删除失败、Delete未执行、最后Update context错误。逐项记录磁盘、`AppliedPatchDelta.changes`、`exact`、tool exit和TurnDiffTracker。再让第一次sandbox attempt提交prefix后触发denied并重试，观察哪些操作不具备自然幂等性。

最后用project内hardlink指向root外文件、move到root外、foreign environment PathUri和granular禁止sandbox approval四组安全输入，画出auto approve、ask、reject与platform sandbox的决策。结论必须明确：一个patch call的approval覆盖意图，不提供跨文件事务保证。

## 44. 路线四十一：长目标为什么要拆成多个普通 Turn

按persistent state、accounting、continuation和product ordering阅读：

- state `model/thread_goal.rs`与`runtime/goals.rs`：goal generation、六种status、expected id CAS和usage update。
- `ext/goal/src/extension.rs`：Thread/Turn/tool/token lifecycle如何挂接runtime。
- `accounting.rs`：token baseline、non-cached算法、wall clock和progress semaphore。
- `runtime.rs`与`steering.rs`：budget steering、idle continuation、external mutation lock和error/usage-limit stop。
- `tool.rs`与`spec.rs`：Agent可创建/读取/终结的权限边界，以及三轮blocked规则的性质。
- App Server `thread_goal_processor.rs`与listener command：set/clear/resume的response、snapshot、notification与runtime effect顺序。

创建带budget的goal，让一个Turn并行执行三个tool并多次收到累计token snapshot。逐个计算cached input、output和wall time在每个tool finish/turn stop的delta，证明accounting semaphore不会重复收费；随后在最后flush前crash，标出DB必然缺失的usage窗口。

让token delta一次跨过budget，记录actual used、status、steering和当前Turn何时真正结束；再比较provider usage limit与普通turn error，确认分别进入usage_limited和blocked。检查“三次相同阻塞”是否由数据库字段验证，区分prompt contract与host invariant。

并发模拟idle callback读到active时，用户pause/replace/clear。验证goal-state lock和goal_id generation分别关闭哪类竞态；让旧Turn迟到上报usage和complete，确认不能修改replacement。最后重放resume：客户端必须先看到resume response与goal snapshot，再看到automatic continuation的新Turn。

## 45. 路线四十二：模型选择器里显示的名字是否就是实际执行模型

按catalog、snapshot、transport fact三层阅读：

- `models-manager/src/manager.rs`、`cache.rs`：bundled/remote/cache、auth merge、TTL/ETag和static/dynamic fallback。
- `model_info.rs`与protocol `openai_models.rs`：slug匹配、unknown fallback、capability字段和config override。
- App Server `models.rs`、catalog processor和refresh worker：picker投影、hidden/pagination与后台刷新。
- Core `TurnContext`构建：每Turn如何冻结ModelInfo、reasoning、service tier和tool capability。
- SSE/WS transport到`ResponseEvent::{ServerModel,ModelsEtag,ModelVerifications}`：后端事实来源。
- Core mismatch/verification处理与App Server notification映射：一次性去重和typed事件。

让bundled、cache和remote各声明同slug但不同context/tool能力，分别用ChatGPT、API key和custom static provider启动，写出最终picker和Turn metadata。再切换provider但复用同`CODEX_HOME`，验证当前cache eligibility没有provider identity，评估错误能力继承窗口。

在一个Turn streaming期间收到新ETag并让models endpoint延迟，测量后续delta消费是否暂停；refresh完成后确认本Turn tool spec不变、下一Turn才用新catalog。随后请求unknown namespaced/longest-prefix slug，列出实际发给API的slug与继承metadata来源。

最后让backend分别因cyber、capacity和model retirement返回不同actual model。沿当前源码确认三者是否都被标成HighRiskCyberActivity，并把它列为协议扩展风险；再单独发送verification metadata，证明它既不等于reroute，也不应进入模型history。

## 46. 路线四十三：一个 StateRuntime 为什么不能提供跨功能事务

按物理文件、migration、恢复和重建阅读：

- `state/src/runtime.rs`与`paths.rs`：五个DB owner、pool/WAL/synchronous/busy timeout、init顺序和maintenance。
- 各`*_migrations`与`migrations.rs`：独立history、ignore future version、known checksum和recency定点repair。
- goals/memories/thread metadata调用链：找出一次用户动作跨两个DB或DB+rollout的提交顺序。
- `runtime/recovery.rs`：error provenance、code/message分类、main/wal/shm定点备份。
- App Server/TUI/CLI startup recovery：哪些入口自动fresh start、哪些只报错，notice如何送达。
- `audit.rs`、`sqlite_integrity_check`与doctor：只读取证为何不能复用正常init。

让五库处于不同migration版本，并模拟旧/新两个binary同时启动。验证future migration只忽略未知version，known checksum变更仍失败；再让memories migration失败，记录此前三个库已经发生的schema变化和所有pool关闭顺序。

构造一个跨state+memories或goal DB+rollout的操作，在每个提交点kill进程，列出权威事实和reconcile来源。目标不是强行加分布式事务，而是证明每种partial state都能被识别，或明确当前缺口。

最后分别注入locked、NOTADB、malformed schema和路径名含`corrupt`四种错误。确认只有真实corruption进入定点backup；再让第二个sidecar rename失败，检查partial backup。用doctor的read-only路径取证，确保检查本身不创建或迁移数据库。

## 47. 路线四十四：App 卡片显示出来为何仍不一定能调用

按directory、access、policy和auth recovery四层阅读：

- `connectors/src/lib.rs`、`directory_cache.rs`：public/workspace分页、merge、identity cache key、内存TTL与stale disk snapshot。
- `accessible.rs`和Core connector discovery：host-owned MCP tool metadata如何投影已连接App与ready状态。
- `snapshot.rs`、`merge.rs`和plugin declarations：package connector dependency为何不是安装或授权事实。
- `app_tool_policy.rs`与`mcp_tool_exposure.rs`：managed/user enablement、approval、风险hint和direct/deferred exposure。
- App Server `apps_processor.rs`：cache interim、双异步load、force refetch和最终response。
- `codex-mcp/auth_elicitation.rs`与Core MCP call：可信metadata、URL elicitation、refresh和manual retry。

建立四个同id状态：directory only、plugin-declared only、accessible但disabled、accessible/enabled。分别记录App list、tool suggest、ToolRouter和model search结果；再撤销账户链接但保留stale disk/memory cache，确认真正call failure覆盖展示快照。

让workspace directory失败、workspace plugin setting失败、codex_apps startup超时和force refresh失败依次发生，明确哪些路径fail-open、哪些退cache、哪些最终error。检查企业策略是否能接受workspace setting读取失败仍允许Apps。

最后伪造tool result中的connector name、id和install URL。验证Core只接受与可信ToolInfo id一致的auth failure，并自己构造URL/name；用户Accept后观察原call仍是error、tools cache刷新和下一次显式retry。对副作用工具说明为何自动重放会产生重复写。

## 48. 路线四十五：为什么文件变化事件只能触发重新读取

按OS watch、订阅owner和domain invalidation阅读：

- `file-watcher/src/lib.rs`：requested/matched/actual path、ref count、missing fallback、RAII和event routing。
- `ThrottledWatchReceiver`与`DebouncedWatchReceiver`：窗口、积累和shutdown flush差异。
- App Server `fs_watch.rs`：connection-scoped id、unwatch barrier、changed path与outgoing等待。
- `skills_watcher.rs`和Thread listener：root计算、local/remote、plugin排除、10秒cache clear和registration寿命。
- plugin/config/models/MCP各自refresh路径：哪些变化根本不是filesystem event。

同时注册`/var/...`和canonical `/private/var/...`、recursive/non-recursive重复watch，再逐个drop guard，记录OS watch mode和subscriber-visible path。对一个尚不存在的深层SKILL.md逐层创建/删除，验证actual watch迁移且不会递归监听整个祖先树。

让200ms内连续写10次，再持续每100ms写5秒，比较debounce与throttle的输出批次；随后在有pending path时drop sender，确认flush。模拟OS watcher构造失败/noop，说明watch RPC成功不能证明后续通知可靠。

最后从第二个connection尝试unwatch第一个订阅，并让原connection慢消费/断开；验证owner清理和显式unwatch barrier。做权限审计：尝试watch workspace外敏感文件，若协议路径没有scope gate，就把变更时序侧信道列入App Server/Remote Control能力模型。

## 49. 路线四十六：配置锁为何不能替代权限和运行时状态快照

按输入层、解析值、校验时点和后续漂移阅读：

- `core/src/config_lock.rs`：lock metadata、load layer、debug controls 清理、strict comparison 与 compact diff。
- `core/src/config/mod.rs::ConfigBuilder::build`：load path 如何替换普通层栈、保留 requirements，并递归构建 replay config。
- `core/src/session/config_lock.rs`：effective layer 起点、Session/Config resolved fields、feature materialization、输入字段剔除和 TOML round-trip。
- `core/src/session/session.rs`：Agents/skills warmup、title lookup、root validation/export 与 Session 发布顺序。
- `config/src/config_toml.rs`和两组 tests：schema version、debug options、compatibility 与失败消息。

先用 profile、prompt include、model catalog 和 feature alias 生成 Session，导出 lock 后删除原文件并重放；确认 lock 依靠已解析值而不再读取生成输入。随后改变 managed requirements，观察它仍参与 replay normalization，并由最终 diff 暴露行为变化。

分别切换 `save_fields_resolved_from_model_catalog` 与 `allow_codex_version_mismatch`：前者改变 lock 覆盖面，后者只能忽略 Codex 版本，不能吞掉 config drift。再加入旧 compatibility feature，验证只有明确登记的 removed entry 被清理，未知字段/schema version 仍拒绝。

最后在导出写入中途终止进程，并在 Session 建立后动态修改 model、permission profile、MCP catalog 与 child role。证明当前普通写文件可能留下不可解析 lock，且启动时 root lock validation 不覆盖后续 Turn/child 漂移。设计 Run 级复现时，把行为快照与当前安全策略交集、tool/prompt hash和原子持久化分开建模。

## 50. 路线四十七：AGENTS.md 改了为何当前 Thread 仍按旧规则运行

按发现边界、内容组装、缓存和恢复阅读：

- `core/src/agents_md.rs`：root marker、Project layer排除、候选优先级、并发probe、byte budget、provenance和多Environment渲染。
- `codex-home/src/instructions/mod.rs`与extension API：root Thread的host provider、warning和source path限制。
- `core/src/agents_md_manager.rs`与`capture_step_context`：selection-keyed cache以及Deferred Executor refresh的真实边界。
- `context/world_state/agents_md.rs`：snapshot、Known/Unknown/Absent与replacement/removal notice。
- `thread_manager.rs::user_instructions_for_spawn`：root fresh load、running/cold resume、fork和child继承。
- Core/App Server agents_md suites：source列表、普通Turn冻结、cold resume/fork exactly-once与multi-Environment。

在root、nested cwd和两个Environment分别放override/primary/fallback，并让Project config试图更改root marker；记录每目录winner、读取顺序、PathUri和最终正文标签。把总byte budget卡在多字节字符中间，确认具体文件被截断的位置与lossy replacement。

Thread建立后原地改全局与项目文件，再跑普通Turn、Deferred Executor Step、running resume、cold resume和root fork。证明selection不变时cache冻结；cold边界重新发现并通过world-state diff只注入一次replacement/removal。

最后在parent运行时新增全局override并spawn child，再让parent被卸载后尝试按id派生。区分live继承与provider reload；审计rollout只保存text/directory而没有source hash的证据缺口。把仓库prompt当供应链输入，设计可信发现根、Run级hash和显式refresh。

## 51. 路线四十八：flush 完成为什么不代表日志已可靠落盘

按同步producer、异步queue、SQLite retention和feedback读取：

- `state/src/log_db.rs`：default filter、span/event field formatting、try_send、batch/timer、flush command和错误处理。
- `state/src/runtime/logs.rs`：batch transaction、estimated bytes、thread/process partitions、time maintenance与feedback query。
- `state/src/runtime.rs`：logs pool、incremental auto-vacuum、startup maintenance和五库ownership。
- App Server `feedback_processor.rs`与`thread_delete.rs`：何时flush、subtree选择、include logs和删除顺序。
- log DB/runtime suites：queue full、flush barrier、oversized row、process correlation和retention边界。

把queue设为1并暂停receiver，连续发事件后插入flush；分别统计generated、accepted、processed、committed和query-visible数量。再注入SQLite write error，确认flush仍ack，证明现有API不能给durability证据。

在root span写secret-like field、event只写普通message，检查feedback body是否包含完整span field；依次通过default filter和feedback include logs，画出本地保留与上传路径。验证当前没有通用redaction/长度限制，要求生产日志调用点自行遵守敏感度契约。

最后制造1001行、单条11 MiB、多个thread、多个process UUID和运行超过10天不重启的库。区分partition content cap、startup-only age cleanup和全库增长。删除agent subtree时在logs/memories/goals/state每个边界注入失败，记录可重试身份与已永久消失的诊断证据。

## 52. 路线四十九：数据库里有 running job 为何重启后不会自动继续

按tool入口、item CAS、child lifecycle与artifact提交阅读：

- `tools/handlers/agent_jobs/spawn_agents_on_csv.rs`：local CSV读取、job创建、runner调用和最终返回。
- `tools/handlers/agent_jobs.rs`：并发归一、spawn/assign顺序、watch/poll、timeout、recover helper、finalize和CSV export。
- `report_agent_job_result.rs`与tool spec plan：worker exposure、owner CAS、stop语义和schema软约束。
- `state/model/agent_job.rs`与`runtime/agent_jobs.rs`：job/item状态枚举、transaction创建、attempt/owner/timestamp与条件UPDATE。
- `runtime/threads.rs`：worker/runner Thread删除时requeue/cancel。

在spawn child成功后、item assign前kill runner，再在assign后、report前、report后和CSV write各kill一次。重启整个App Server，确认没有startup scan自动调用run loop；区分数据库可读状态与真正有owner的任务。

让两个worker同时报告同item、错误worker猜中id、同worker重复报告以及accepted后stop。验证assigned thread CAS只接受一次；记录pending item在job cancelled后为何仍pending。再让worker结束事件与result UPDATE竞速，检查finalize不会覆盖completed。

最后让CSV字段包含指令文本、result违反展示的output schema、系统时间跳变、output文件partial exists。验证prompt/data混合、schema未强制、无heartbeat timeout和exists-based导出恢复缺口。设计lease、reconciler、server-side schema和artifact commit状态机。

## 53. 路线五十：收到退出信号后为何还可以创建新 Turn

按signal state、Turn计数、connection gate和teardown阶段阅读：

- `app-server/src/lib.rs::ShutdownState`与主select loop：forceable/graceful-only信号、acceptor时点、DisconnectAll和forced分支。
- `thread_status.rs`：running assistant Turn watch与approval/user-input counter差异。
- `connection_rpc_gate.rs`及`MessageProcessor::connection_closed`：close/token/wait、late future和日常有界drain。
- `ThreadProcessor::drain_background_tasks`、`shutdown_threads`：两个10秒边界及warning-only结果。
- WebSocket Unix signal与logging suites：真实进程退出、二次signal和forced telemetry。

启动一个3秒Turn后发首次SIGTERM，同时从原连接和新连接继续发RPC/Turn。记录acceptor、running count和退出时点；持续制造Turn证明graceful restart可被延后，再用第二次SIGTERM验证force跳过Thread shutdown。

让running count归零但一个非Turn RPC永不返回。比较顶层`join_all(rpc_gate.shutdown)`与日常connection close timeout，确认第二信号此时是否仍被主loop接收。把它列为全局shutdown缺少总deadline的风险。

最后在terminal notification已生成但outbound writer很慢时触发DisconnectAll，检查client是否收到最后事件；forced路径kill在rollout不同flush点，再cold resume核对durable prefix。设计readiness→stop admission→bounded drain→force→reconcile的云端状态机。

## 54. 路线五十一：自动时间提示与 sleep 为什么是两种状态

按clock authority、delivery gate、history和input interruption阅读：

- `core/src/current_time.rs`：System/External provider选择、ThreadId与drop-cancel sleep契约。
- `session/time_reminder.rs`：window、interval、user/tool boundary flag与Fatal路径。
- `context/current_time_reminder.rs`和`turn.rs`：developer role、持久化位置及sampling前顺序。
- `tools/handlers/current_time.rs`、`sleep.rs`和spec plan：主动查询、code mode、12小时上限、Sleep item和activity watch。
- `session/input_queue.rs`：subscribe后pending检查、Steer/Mailbox来源和lost-wakeup防护。
- Current time/pending input suites：倒退时钟、compaction、provider失败与中断竞态。

用可控external clock在interval到期前后、向后跳和interval=0时连续采样；在AfterUserOrToolOutput模式让boundary出现但尚未到期，再发纯assistant continuation。确认boundary被消费而不会在稍后自动补发。

执行compaction/cold resume并检查history中的旧提醒与新window强制提醒；紧接自动提醒调用clock.curr_time，验证它不会更新auto delivery state。注入provider read failure，确认模型HTTP请求为0。

最后让用户steer/mailbox分别发生在sleep订阅前、订阅后和watch关闭时，核对started/completed、wall time与pending input。kill进程后证明Sleep item不能恢复剩余等待，设计durable wakeAt任务替代长sleep。

## 55. 路线五十二：本地图片何时才变成模型真正收到的bytes

按协议输入、权限读取、统一prepare、缓存和恢复阅读：

- `protocol/src/user_input.rs`与`models.rs`：Image/LocalImage、Process/Defer、path标签、读取失败placeholder。
- `core/image_preparation.rs`与Session history boundary：scheme/detail policy、逐项降级和persist前顺序。
- `utils/image/src/lib.rs`：magic decode、format preservation、ICC/EXIF、dimension/patch math、1 GiB guard和64 MiB LRU。
- `tools/handlers/view_image.rs`与image detail helpers：Step Environment、sandbox read、model modality/original capability和Item事件。
- Session/image/view/TUI suites：live write、legacy resume、失败替换和UI reattach。

从App Server提交workspace内/外LocalImage、http URL、非http scheme、伪MIME、animated GIF、CMYK JPEG与超大dimension图。记录host read权限、真正MIME、输出format/尺寸、model-visible placeholder和rollout内容。

用同bytes不同path、同path改bytes、不同detail重复处理，观察cache key和64 MiB eviction；构造SHA-1 collision仅作威胁建模，明确它不是内容完整性hash。比较High与Original的dimension/patch实际ceil值。

最后用旧binary写未prepared rollout，再在修改limits后的binary cold resume两次，确认旧rollout不回写且in-memory derivative可漂移。为云端设计immutable asset、derivative algorithm version与tenant scope，禁止服务器local path输入。

## 56. 路线五十三：Code Mode 脚本为什么不能直接绕过工具审批

按V8能力、delegate、cell lifecycle和process host阅读：

- `code-mode/runtime/{globals,module_loader,callbacks}.rs`：删减全局、import拒绝、tools promise、timers、store/load和输出事件。
- `cell_actor`与`session_runtime`：observer frontier、yield/terminate、callback drain、completion+stored writes原子commit和registry ownership。
- Core `tools/code_mode/{mod,delegate,execute_handler,wait_handler}.rs`：nested specs、ready gate、当前Turn ToolRuntime、trace、elicitation和结果截断。
- `remote_session.rs`及connection driver：共享process、V1 handshake、session generation、fallback、reconnect和shutdown。
- feature/config/tool-mode tests：CodeModeHost默认、CodeMode under-development、excluded/direct-only namespace和model capability warning。

让脚本尝试import fs、访问process/console/WebAssembly、自调用exec和传错function/freeform参数；确认只有enabled tools可以产生外部能力，且nested call仍触发hook/approval/sandbox。yield后改变permission profile/tool catalog，再wait，核对实际dispatch使用哪个Turn snapshot。

并发启动cells写同一store key，分别正常完成、throw error和terminate，记录completion顺序与KV可见性。让cell在没有Turn worker时notify/tool call，并大量text输出，测量unbounded broker/event/content buffer在model-side truncate前的峰值。

最后kill共享host，观察多个Thread cell、logical session generation和stored values；分别模拟host binary NotFound与handshake mismatch，验证只有前者fallback in-process。设计真正隔离时补OS sandbox、heap/CPU/queue硬限和durable Run recovery。

## 57. 路线五十四：外部Agent历史导入后为何不能证明原执行过程

按detect/validation、lossy projection、Thread提交和ledger阅读：

- `external-agent-sessions/{detect,records,export,ledger}.rs`：30天/50个、JSONL容错、内容选择、synthetic rollout、hash与mtime shortcut。
- `config/external_agent_config.rs::external_agent_session_source_path`：canonical containment与请求path边界。
- `external_agent_config_processor.rs`：import id、同步/后台拆分、progress/completed和history。
- `external_agent_session_import.rs`：batch semaphore、5并发、current config/model、ThreadStore提交与补偿。
- 外部迁移/ThreadStore integration tests：duplicate、restart、partial failure和可见投影。

创建超过50个session、保留mtime改内容、invalid lines、sidechain/thinking/tool blocks和首个user前assistant，记录detect与最终Codex Turn差异。证明Imported历史只保存可见文本，不能恢复原tool权限/usage/reasoning/model。

在validation canonicalize后替换projects内symlink，再进入blocking prepare，检查第二次canonical是否仍强制root containment。若未强制，把canonical file handle贯穿任务作为修复方向，不依赖两次字符串path校验。

最后在create/append/metadata/persist/shutdown/ledger save每一步注入失败，再断线/重启读取import history。区分partial Thread、重复导入和notification丢失；设计ImportJob、target transaction、idempotency hash与outbox terminal。

## 58. 路线五十五：设置代理环境变量为什么还不能证明网络被约束

按配置上界、Session投影、execution归因与请求决策阅读：

- `network-proxy/src/{config,state,runtime}.rs`：mode/method、requirements constraints、reload、deny/SSRF/allowlist顺序与blocked ring。
- `network-proxy/src/{proxy,attribution,network_policy}.rs`：listener reservation、Environment代理、env+sandbox共同投影、execution token和decider/audit。
- `network-proxy/src/{http_proxy,socks5,mitm,connect_policy}.rs`：HTTP/CONNECT/SOCKS/UDP/MITM各层二次检查。
- Core `config/network_proxy_spec*`与`session/{mod,session,turn_context}.rs`：普通config、managed requirements、exec-policy合并、permission profile切换和Turn可见性。
- Session、runtime、policy、proxy、attribution与MITM测试：full access、热换、local/private、scope mismatch、shutdown。

分别以danger-full-access与workspace-write创建Turn，观察SessionConfigured地址、Turn env和sandbox loopback端口。切换profile后确认代理策略重算但decider仍存活；再运行user shell，证明它不会误用Agent Turn代理。

对同一host组合deny、allow、wildcard与decider override，并让allowlisted hostname解析到loopback/private地址。验证显式deny和local SSRF都不能被动态decider覆盖，只有普通allowlist miss进入Ask/Allow流程；记录DNS timeout与审计关联id。

为两个Environment并发准备执行，核对各自listener与environment id；交换attribution token、提供未知token和超长/超时preface，确认没有跨execution借用策略。随后在请求中途reload失败、切credential broker和改listener地址，区分保留旧state与禁止热换的字段。

最后分别Drop、shutdown与强杀进程，检查主listener、Environment listener、blocked ring和审计的寿命。迁移到业务系统时把egress gateway、短寿命execution capability、DNS后SSRF检查和durable approval/outbox分开设计，不能把代理env视作安全证据。

## 59. 路线五十六：如何让CLI使用API Key却永远拿不到真实值

按provider binding、dummy capability、协议检测、hook与CA信任阅读：

- `network-proxy/src/credential_broker.rs`与`providers/{github,openai}.rs`：env识别、随机shape dummy、host binding、唯一dummy选择与marker防伪。
- `network-proxy/src/{http_proxy,socks5,mitm}.rs`：DetectTls、plaintext危险开关、inner request注入顺序与DNS/Host复查。
- `network-proxy/src/mitm_hook.rs`：exact host、method/path/query/header matcher、no-match拒绝、secret解析和actions。
- `network-proxy/src/certs.rs`：进程内私钥、动态leaf、平台/startup roots、bundle hash、原子写与artifact lease。
- broker/hook/MITM/cert tests：歧义、override、非TLS、body matcher未支持、symlink和stale bundle。

在两个broker实例和同一实例的两个child中虚拟化同一key，比较dummy复用边界。让请求缺dummy、带两个候选、改显式Authorization、换host或用未绑定GH enterprise token，确认真实secret不会因“目标看起来像GitHub”而自动注入。

把brokered CONNECT发往443、22和自定义端口，分别传TLS与SSH前缀；证明DetectTls只解密TLS。再用HTTP绝对URI发送dummy，比较危险plaintext开关前后header，确认默认失败方式不会泄露真实值。

为一个host配置两条hook，只允许特定POST/path/query/header；测试首条匹配、同host无匹配硬拒绝、literal星号与`pattern:`差异。让hook和broker同时写Authorization，核对strip/inject最终覆盖顺序，并验证body配置目前是启动错误而非运行时检查。

最后读取CA artifact的mode、hash与lock行为，确认私钥未落盘；覆盖child CA env、使用不识别managed bundle的TLS client并重启代理，区分“安全拒绝”“兼容失败”和“旧bundle失效”。业务迁移优先结构化egress intent+vault late injection，不因CLI兼容方案引入不必要MITM。

## 60. 路线五十七：远程环境没启动完时为什么模型仍能先工作

按selection future、Step快照、显式等待和连接恢复阅读：

- Core `environment_selection.rs`：ArcSwap selections、shared resolution、ready/starting双投影、shell snapshot异步构建。
- Core `session::{turn,mod}.rs`与`tools/handlers/wait_for_environment.rs`：每sampling recapture、world-state diff、wait语义和下一Step工具变化。
- `exec-server/src/{environment,client,resolved_capability}.rs`：pending/upsert、OnceCell startup、reconnect、fail-fast inspection与exact handle。
- `context/world_state/environment.rs`、MCP/skills/plugin路径：starting渲染与ready-only能力投影。
- remote_env、environment selection/manager/client/capability tests：成功、失败、replacement与并发连接。

让pending Environment在首轮sampling前不complete，确认模型仍能拿到starting world state与wait工具，但拿不到其shell/MCP/capability。模型调用wait后完成URL，验证工具返回本身不改变旧Step，下一次sampling才出现ready能力。

用同id不同cwd、同selection重复提交和重复id列表测试future复用规则；在Step捕获后upsert同id新Arc，分别让旧Step与新Thread执行，证明稳定id不能替代generation/handle。

分别制造首次connect失败、成功后断线、并发reconnect失败再成功与stdio环境。记录哪些错误永久封存在OnceCell、哪些下一次操作可重试，以及passive catalog inspection为何不能意外触发昂贵启动。

最后让wait无限pending并中断Turn，检查future/task资源是否释放；让环境ready但shell snapshot/info失败，确认工具可用性与shell metadata降级。业务实现应把WorkerSelection、ProvisionJob、Step Lease和Reconnect状态分层，而不是在Run启动入口同步等待全部远程依赖。

## 61. 路线五十八：不可信Relay为何无法读取或伪造远程执行RPC

按Registry bundle、hybrid IK、multiplex、record ordering与reconnect阅读：

- `exec-server/src/{remote,environment_registry}.rs`：executor注册、harness connect/validation、auth脱敏与fresh reconnect bundle。
- `exec-server/src/noise_channel.rs`：X25519+ML-KEM-768 hybrid IK、pinned responder、encrypted authorization、prologue与AES-GCM transport。
- `exec-server/src/relay.rs`：protobuf control frame、128 active/32 validation/8 failure、validation id与stream instance id。
- `exec-server/src/noise_relay/{harness,executor_stream,ordered_ciphertext,message_framing}.rs`：60KiB record、64MiB message、seq/reorder、队列隔离和Pong deadline。
- Noise/relay/remote recovery tests：tamper、splice、reuse、overload、registration rejection和reconnect。

让relay替换executor key、environment/registration/stream prologue或握手response，证明Harness不会fallback plaintext。把已捕获IK首包路由到另一个stream/registration，确认transcript binding失败。

让Registry validation慢于10秒、返回false、回显authorization错误，并并发33个pending/129个active/8个密码学失败。检查何时只Reset单流、何时关闭物理relay，以及日志是否泄露auth body。

乱序发送0/2/1、duplicate、gap 65、累计超过1MiB、seq耗尽和超过64MiB长度前缀；确认先重排再decrypt，且坏流不会阻塞同WebSocket其他流。填满一个virtual inbound queue，验证`try_send`隔离。

最后断开rendezvous并分别返回server error与client error，观察executor复用registration或重新注册；Harness每次获取fresh bundle。业务实现若无需128路复用，应删减复杂度，但不能删掉generation绑定、短寿命授权、端到端加密和per-stream backpressure边界。

## 62. 路线五十九：WebSocket握手通过后客户端到底获得了多大权限

按listener准入、Upgrade认证、browser防线、连接寿命与客户端自保阅读：

- `app-server-transport/src/transport/{auth,websocket}.rs`：non-loopback硬门、capability digest、HS256 claims、Origin拒绝、health与队列。
- CLI/App Server main：auth flag组合、旧insecure flag删除和policy启动时物化。
- `app-server-client/src/{lib,remote}.rs`：Bearer header与non-loopback明文ws拒绝。
- App Server connection/RPC dispatch：认证后是否存在token scope或method ACL。
- WebSocket auth/connection integration tests：token、JWT、Origin、disconnect、large frame和slow client。

分别绑定127.0.0.1与0.0.0.0，在无auth/capability/JWT下启动；验证旧unsafe flag无法解析。修改token/secret文件但不重启，比较新连接与已连接socket，证明policy是startup snapshot且无即时撤权。

构造过期、未来nbf、错iss、aud array、错签名和clock skew边界JWT；随后用同一有效token调用多个高权限RPC，确认claims不含scope enforcement。业务迁移必须把入口认证与RPC授权拆开。

对health、未知path和upgrade分别加Origin/Bearer，记录middleware顺序；从第三方client向non-loopback ws明文发送token，对比官方client提前拒绝，证明server端仍需要TLS终止策略。

最后填满业务outbound与control queue、发送binary/invalid text、半关闭reader/writer并轮换token。区分frame write ack、远端处理ack与连接撤权；补per-connection rate/size/expiry设计，不能把32768缓冲当流量治理。

## 63. 路线六十：为什么加速Shell启动会把API Key写进可执行快照

按capture、validation、wrapper precedence与cleanup阅读：

- Core `shell_snapshot.rs`：login rc执行、函数/options/alias/export展开、10秒timeout、temp/rename、Drop与3天cleanup。
- `session/turn_context.rs`与`environment_selection.rs`：local-only shared future、exact cwd和peek不等待。
- `tools/runtimes/mod.rs`：`-lc`改写、best-effort source、runtime/proxy/profile/PATH恢复顺序。
- user shell、shell/unified exec runtime：普通Agent命令与full-access `/shell`如何消费snapshot。
- shell snapshot/wrapper/cleanup tests：quoting、secret-like env、文件消失、stale rollout与remote环境。

在`.zshrc/.bashrc`中加入可观察副作用、slow command、stdout噪音和失败分支，确认创建阶段真实执行且marker前内容被丢弃。比较每条原始login shell与snapshot wrapper的TTY/conditional语义差异。

设置API key、PWD/OLDPWD和多种proxy/CA/PATH/profile变量后检查磁盘文件，区分被排除、被snapshot冻结与每次执行恢复的字段。检查目录/file mode，并在validate后替换/修改snapshot，确认使用时没有hash/owner复验。

让首条tool早于shared future完成、切换cwd、删除snapshot和source时出错，观察何时静默no-op；验证后续命令可能开始使用，不能把同一Turn所有命令假设为相同shell environment。

最后模拟正常Arc Drop、进程crash、无rollout、旧rollout、active thread与state DB不可用。把性能缓存和secret lifecycle分开审计；业务系统优先结构化allowlist env，避免持久化任意shell代码与完整export。

## 64. 路线六十一：删掉TOKEN变量为何仍不能证明工具没有凭据

按六步env投影、runtime mutation、attempt重算与持久化边界阅读：

- `protocol/src/{config_types,shell_environment}.rs`：All/Core/None、WildMatch、默认exclude、set/include/thread id顺序。
- Config `types.rs`与Core `exec_env.rs`：TOML conversion、permission profile标签和默认值。
- Core `tools/runtimes/{mod,shell,unified_exec}.rs`：PATH、snapshot、proxy strip/reapply与sandbox attempt。
- `exec.rs`、user shell/review路径：env_clear launch、full-access escape和派生Turn policy。
- exec_env/runtime/shell/config tests：Windows case/PATHEXT、glob误读、retry和managed proxy。

用包含KEY/SECRET/TOKEN/PASSWORD/AUTH和无关MONKEY的env比较默认policy与显式default excludes，证明变量名黑名单既漏报又误报。把exclude写成regex语法与glob语法，记录实际匹配。

组合exclude同名、set重新加入、include_only再删除和thread/profile标签，验证精确顺序；在Windows混用Path/PATH和缺PATHEXT，确认跨平台差异。

让workspace attempt带managed proxy后升级到full access，再重试；检查proxy、managed CA、用户CA、GIT_SSH和credential dummy的最终map。证明env展示标签与真正sandbox/network policy不能互相替代。

最后开启`experimental_use_profile`并搜索/执行runtime，确认当前字段无消费方；比较warm Thread、cold resume和subagent的父process env漂移。业务实现应保存policy revision/env key provenance，而不是持久化secret value或假设同Thread环境恒定。

## 65. 路线六十二：有PID文件为何仍不能说App Server一定可用

按operation lock、PID identity、socket ready、desired state和Updater阅读：

- `app-server-daemon/src/lib.rs`与README：start/restart/stop/bootstrap、unmanaged socket保护、10秒probe和JSON契约。
- `backend/pid.rs`：reservation flock、empty Starting、PID+start time、setsid、60秒grace/70秒stop和stderr tail。
- `settings.rs`：remote-control desired state普通JSON写入与restart顺序。
- `update_loop.rs`、`managed_install.rs`：5分钟/1小时、install.sh执行、binary digest、server-first restart和updater reexec。
- daemon/PID/update/remote-control tests：crash、Busy、stale、legacy fallback与partial success。

并发发起start/restart/stop，验证daemon.lock与pid.lock分别保护什么；在空pid reservation的lock持有者crash前后读取状态。复用同PID但改变start time，确认不会误杀。

让socket由手工进程占用、managed PID活着但未ready、socket文件陈旧和Initialize失败；区分AlreadyRunning、等待、拒绝与timeout诊断。检查stderr tail是否可能携带secret。

在settings write、old stop、new spawn、Updater start和ready probe各点注入失败，列出desired/actual/PID/socket/updater五层partial state。证明bootstrap输出只在全成功时成立，不是事务commit。

最后让install.sh下载错误、脚本执行失败、binary内容变但版本不变、version变但内容身份关系异常，并让operation lock长期Busy。生产迁移优先成熟supervisor与签名更新；若保留应用daemon，必须持久化generation journal和恢复器。

## 66. 路线六十三：0600 Socket为何仍可能被旧进程误删

按path准备、startup lock、bind权限、connection admission与cleanup阅读：

- `app-server-transport/src/transport/{mod,unix_socket,websocket}.rs`：URL解析、默认path、flock范围、stale检测、guard和共享连接队列。
- `uds/src/lib.rs`：Unix 0700/0600语义、symlink_metadata与Windows shim差异。
- App Server `lib.rs`：startup lock从prepare跨SQLite/config直到listener bind的寿命。
- `stdio-to-uds`：透明byte relay、half-close与协议不转换边界。
- UDS/transport/integration tests：mode、stale、overload、shutdown与并发startup。

用两个同CODEX_HOME不同socket、两个不同home同socket并发启动，确认startup lock与bind分别覆盖哪个竞态。让state DB初始化卡住，观察第二个startup lock无timeout等待。

对custom父目录设置0770、替换为regular/symlink/socket和在prepare/bind间rename，记录chmod副作用与拒绝/删除行为。Windows只验证功能，不沿用Unix权限结论。

在旧listener运行时unlink并绑定replacement，再让旧acceptor Drop；检查pathname guard会否删除新socket。修复方向是private generation directory或inode/ownership比对。

最后打开大量不完成WebSocket握手的UDS连接，填满transport/outbound queue并混发Request/Notification/invalid JSON/binary。区分admission、backpressure和parse error语义；本地可信不应等于无需资源上限。

## 67. 路线六十四：谁真正为上游请求生成Attestation

按provider能力快照、Thread订阅选择、server request callback和header注入阅读：

- `core/src/attestation.rs`、`core/src/client.rs`：host回调边界、Thread-only context、Responses/compaction/realtime/WS注入点与ModelClient寿命。
- `model-provider/src/{provider,auth}.rs`：ChatGPT auth判定、provider-scoped AuthManager和custom base URL信任边界。
- `app-server/src/attestation.rs`：100ms请求、opaque token、`{v,s,t}`失败envelope和HeaderValue转换。
- `app-server/src/thread_state.rs`、`outgoing_message.rs`：capable subscriber最小ConnectionId、callback ownership、发送失败、timeout cancel与迟到response。
- protocol Initialize capability与attestation integration/client tests：默认关闭、桌面opt-in、WS handshake和非ChatGPT省略。

用两个支持attestation的client和一个不支持client订阅同一Thread，改变连接顺序、断开最小ConnectionId并让首选client超时。确认选择稳定但没有同请求fallback；再让client只连接不订阅Thread，区分“无header”和失败状态header。

分别对Responses HTTP、remote compaction、realtime create、WS prewarm/重连计数，确认哪些操作触发新token、哪些复用连接。登录/登出或auth revision变化后复用同ModelClient，检查`include_attestation`构造期快照漂移。

让client返回超长token、控制字符、错误、malformed JSON和100ms后迟到response；记录HeaderValue、callback map、日志与上游`s=0..4`结果。证明App Server只验证response形状，不验证token真实性、freshness或request binding。

最后配置复用ChatGPT auth的custom `requires_openai_auth=true` provider和非官方base URL，核验Bearer与attestation的实际目的地。生产设计必须把host allowlist/audience、request digest、nonce、expiry、签发者校验与tenant identity同时绑定，不能把布尔capability升级为授权。

## 68. 路线六十五：模型列表为什么可能回退却不报错

按worker寿命、cache资格、ETag触发、发布顺序和分页读取：

- `app-server/src/models_refresh_worker.rs`：立即Online、完成后3分钟sleep、Weak manager和cancel不打断in-flight fetch。
- `models-manager/src/manager.rs`：三种RefreshStrategy、auth准入、remote-only/merge、双RwLock与memory→etag→disk顺序。
- `models-manager/src/cache.rs`：5分钟TTL、whole client version、直接JSON写入和future timestamp语义。
- `core/src/session/turn.rs`、API SSE/WS endpoint：`X-Models-Etag`进入sampling事件循环并同步refresh。
- App Server `models.rs`/catalog processor：OnlineIfUncached、hidden filter与offset cursor。
- worker/manager/models-cache-TTL/models-etag tests：失败继续、cache命中、ETag续期和串行去重。

让worker fetch、两个Thread收到相同mismatch ETag和两个model/list同时发生，并控制旧请求晚于新请求返回；记录最终models、etag、disk是否来自同一generation。当前没有singleflight或CAS，测试应把last-completion-wins暴露出来。

在memory publish、etag publish和disk write分别注入失败/crash，并用两个进程共享CODEX_HOME并发写cache。验证API仍返回last-known内存但不带stale标记，partial JSON在下次读取只退化为miss。

切换provider/base URL、ChatGPT/API-key auth、account和系统时钟；复用fresh cache，检查client version是当前唯一资格key、future timestamp可延长freshness、auth变化会改变filter与下一次apply projection。

让Responses ETag refresh延迟数秒，同时服务器继续发送tool call/completed，测量事件循环阻塞。生产设计应将header作为异步invalidate信号，用singleflight刷新并保留Turn自己的ModelInfo快照。

最后在分页第1页与第2页之间刷新catalog/切auth，验证offset cursor重复或漏项。修复应让cursor绑定catalog generation/etag，或一次响应返回稳定快照。

## 69. 路线六十六：Initialize成功后哪些状态才真正可见

按session commit、outbound发布、连接级过滤和process identity阅读：

- `app-server/src/request_processors/initialize_processor.rs`：name校验、OnceLock提交、global originator/UA、response与warning顺序。
- `message_processor.rs`：Request初始化门、experimental gate、connection metadata向Thread/hook/remote-control传播。
- `lib.rs`、`in_process.rs`：WebSocket两阶段ready和in-process提前发布的差异。
- `transport.rs`：broadcast ready gate、experimental notification/approval投影与opt-out exact match。
- `login/src/auth/default_client.rs`：first-write originator、last-write USER_AGENT_SUFFIX和UA sanitize。
- initialize/experimental/transport/multi-connection tests：重复、非法name、跨client capability与通知顺序。

并发连接两个不同name/version客户端，控制Initialize完成顺序，读取每个InitializeResponse和后续HTTP User-Agent；验证originator first-write、suffix last-write会形成混合identity。再用daemon/backend保留名与超长字段，区分路由身份、可信principal和纯telemetry label。

在session OnceLock提交、response enqueue、warning发送、capability登记与ready store逐点断开连接/填满outbound queue；观察客户端没收到成功response但server拒绝重试的partial initialize，以及broadcast是否越过发布屏障。

让experimental和stable client共同订阅同一Thread，由前者修改memory/settings/realtime/dynamic tools；列出后者虽不收experimental notification仍能观察的共享副作用。定义共享资源到底用owner、交集还是instance-global capability。

给opt-out传unknown、重复和关键terminal method，验证它只exact-match notification、不影响server request/response。新增experimental字段时检查生成schema标记、入站gate和出站strip/drop三处是否同时登记。

最后让未Initialize连接发送Notification、Response/Error与普通Request，核验只有Request有统一gate、server request callback又是否绑定目标connection。生产协议应在transport dispatcher最外层拒绝所有未协商message，并把callback key改为`(connectionId, requestId)`。

## 70. 路线六十七：Remote Compaction V2究竟提交了什么

按prompt构建、Responses stream、fallback、retention与checkpoint安装阅读：

- `compact_remote_v2_attempt.rs`：history clone、尾部tool output rewrite、Step tool schema与CompactionTrigger。
- `compact_remote_v2.rs`：exactly-one output、每transport retry、64k retained messages、window推进与replacement install。
- `compact_remote.rs`共享函数：user/hook retention、developer/system过滤、initial context/world state reinjection。
- `responses_retry.rs`：WS retry预算、HTTPS fallback重置与UI warning。
- `session/turn.rs`：pre-turn comp-hash/downshift、previous→current model fallback条件和inline client session复用。
- compact remote/parity/rollout-budget/reconstruction tests：trigger、图片、错误、hook和cold resume。

构造history尾部为user message、前面含巨大tool output，和尾部连续多个tool output两组输入；验证reverse loop的break只重写连续suffix。不要把它误写成任意超限tool history清理器。

让Responses依次返回compaction后断流、0个、2个、1个+tool call、Completed无usage；计数实际请求数和最终安装。再让WS耗尽2个retry后切HTTPS，确认总attempt budget跨transport被重置。

previous model先InvalidRequest，current model再失败，比较用户收到的原error与telemetry里的fallback error。对非InvalidRequest错误确认不会换模型，以免把server不兼容与网络故障混为一谈。

用64k文本、多图片、image-only message和单条混合content测试retention实际token/byte大小；图片0 token但message最低1的heuristic可被附件规模绕过。生产budget必须按prepared image patch/token和serialized byte双限制。

最后在ContextCompaction started、budget record、window advance、replacement persist、completed和post hook各点终止。冷恢复核对哪个window生效；post hook stop之后history已提交，不应在产品层显示“compaction canceled”。

## 71. 路线六十八：Responses Metadata为何会在同一Turn中变化

按canonical payload、兼容投影、动态状态与数据外发阅读：

- `responses_metadata.rs`：request kind identity、reserved keys、ASCII JSON、flat client metadata和headers。
- `turn_metadata.rs`：frozen IDs、三组mutable state、Git enrichment与Memory同步metadata。
- `session/turn.rs`、sampling retry：每Step构造、同request retry复用和tool follow-up更新。
- `client.rs`：HTTP body、WS response.create、handshake compatibility headers与连接复用。
- `git-utils/src/info.rs`：5秒command timeout、raw `git remote -v`解析和另有但未使用的canonicalizer。
- turn/client/MCP metadata tests：reserved覆盖、Unicode、workspace与compaction overlay。

让Git enrichment分别在首个请求前/后完成，比较同Turn两次Responses metadata；再制造retry，确认同一次request对象不因后台完成而改变。区分progressive enrichment和request snapshot。

用复用WebSocket跨两个window/parent thread发送请求，抓握手header和每个response.create client_metadata；证明握手兼容值可陈旧，canonical per-request blob才有当前generation。

在remote URL放HTTPS userinfo/token、SSH username和internal hostname，检查raw metadata；本机repo root也会作为map key。生产前必须做credential stripping、path pseudonymization和policy consent。

给client extra传reserved keys、大小写变体、model/reasoning/workspace_kind、超长Unicode value和大量keys；比较canonical JSON、MCP meta与实际request body model。手工reserved list和header复制需要schema自动生成与总大小上限。

最后在一个in-flight request期间连续steer两条带不同metadata的input，验证last-write map与pending input合并不具消息绑定。若业务要归因，metadata必须和每条Input/Step ID一起入队。

## 72. 路线六十九：Rollout Budget为什么耗尽后仍会继续花费

按shared state、reminder、Completed记账、fork/resume和错误副作用阅读：

- `rollout_budget.rs`：OnceLock config、f64加权总数、per-thread/window delivery。
- `session/rollout_budget.rs`、`session/turn.rs`：sampling前注入与Completed后record。
- `agent/control.rs`、ThreadManager spawn/fork/resume：live child共享和新AgentControl重置边界。
- compaction local/V2：usage先记、budget error早于checkpoint安装。
- config resolver：threshold/weight校验与允许zero weights。
- rollout_budget tests：当前/后续超限、child共享、rollback不退款与window重述。

先耗尽预算后继续发多个Turn并抓网络，证明没有preflight admission；给response加入assistant/tool output，检查budget error前哪些history/UI副作用已提交。产品文案不能叫“请求被预算拒绝”。

模拟断流后retry、Completed无usage、重复Completed/response id和provider错误cached count，比较真实请求数与本地weighted usage。财务账本必须按attempt/reservation记，不信任只有terminal usage的best effort计数。

并发root和多个child在接近limit时同时请求，观察所有请求先通过再串行record而集体overshoot。硬limit设计需reserve最大输出/预估prefill并在完成后settle。

在live spawn、history fork、cold resume三种路径读取reminder；验证只有live child共享旧usage，fork/resume从0重新配置。若要session quota，usage event必须持久化并在重建AgentControl时replay。

最后测试fraction weights、zero weights、重复/乱序threshold、多window/多child提醒自耗。软提醒单独计策略成本，避免每个分支都用同一开发者消息消耗有限预算。

## 73. 路线七十：Hook被信任后实际执行的还是同一段代码吗

按discovery hash、command launch、stdin/timeout、输出解析和spill阅读：

- `hooks/src/engine/discovery.rs`：normalized config hash、hash后env替换、Managed/bypass与positional key。
- `command_runner.rs`：login shell、继承env、timeout范围、kill_on_drop和wait_with_output。
- `dispatcher.rs`：并发执行、completion order与config-order聚合。
- `events/*`、`output_parser.rs`：每类event的stdout/stderr/exit code和“universal”字段差异。
- `output_spill.rs`：2500-token preview、temp path、普通write与无cleanup。
- discovery/parser/spill/Core/TUI tests：trust、阻断、长输出和事件投影。

先信任含`${SCRIPT}`的command，再只改变source.env替换值；比较current hash和最终执行command。继续替换PATH、SHELL、rc与被command引用脚本内容，证明config hash不覆盖transitive executable closure。

让hook完全不读stdin，传超过pipe容量的tool payload；验证timeout尚未开始。再持续输出stdout/stderr和spawn后台descendant，观察内存、timeout后direct child与descendant状态。生产runner要从spawn前开始deadline并使用process group/job object。

对每种event组合exit 0/2、plain stdout、JSON-looking invalid、合法JSON加日志前缀、stderr reason；列出哪些成为prompt、block、warning或被丢弃。不要把schema字段名“universal”理解为全事件统一语义。

输出超大additionalContext，比较model outcome preview、HookCompleted entries、rollout和temp file；spiller发生在capture后且event可能保留全量。测试thread dir symlink、umask、file替换和cold resume旧path。

最后把hook command视为Tool执行面做同样的权限审计：env secret、cwd文件、网络、shell rc和子进程。只有source trust，没有runtime capability，不足以满足多租户Agent边界。

## 74. 路线七十一：MCP refresh token为什么必须固定存储authority

按policy resolution、aggregate lock、refresh transaction和删除恢复阅读：

- `rmcp-client/src/oauth.rs`：Stored tokens、File/Keyring save/delete、identity key、expiry与persistor。
- `oauth/resolved_store.rs`：Auto keyring-first、backend error/lock failure分流和client-lifecycle pin。
- `oauth/store_lock.rs`：File/Secrets aggregate flock、同步60秒轮询。
- `oauth/refresh_lock.rs`、`refresh_transaction.rs`：per-credential序列化、45秒provider request、owned task与persist-before-install。
- config store mode resolver：local dev强制File、managed override和Auto默认。
- unit/multiprocess/streamable HTTP tests：authority、rotation、timeout和startup。

让keyring初次不可用后恢复，和另一个不同CODEX_HOME process同时启动；比较各自pin到File/Keyring及refresh最终写向。证明pin解决单client热切换，不解决跨process多authority。

对URL做case、尾斜线、default port、query变化，再改变resource/scopes/client_id/headers；记录store key。credential audience identity必须覆盖OAuth语义，而不是只hash原始URL字符串。

在File直接write、chmod、Secrets更新、keyring save、fallback cleanup逐点crash/失败；检查旧File是否能在后续Auto fallback复活。用symlink和宽umask验证0600发生在publish之后。

并发两个refresh，控制第一个rotation后caller cancel、provider timeout和persist失败；第二个lock后必须rereadwinner。Direct keyring跨CODEX_HOME缺同一lock，应单独验证。

最后让AuthorizationManager credential变None且durable delete失败，重复persist_if_needed并重启；当前last_credentials已take导致不再重试。生产删除必须tombstone+retry，logout成功要以所有authority不可再恢复为准。

## 75. 路线七十二：PKCE为何仍挡不住本地OAuth callback被抢先终止

按listener、redirect identity、callback parser、授权交换和HTTP transport阅读：

- `rmcp-client/src/perform_oauth_login.rs`：三种登录入口、listener guard、callback id/path、parser、timeout和token save顺序。
- `rmcp-client/src/oauth_http_client.rs`：default/request header覆盖、redirect policy、timeout与1 MiB response上限。
- `app-server/src/request_processors/mcp_processor.rs`：return-url handle、后台completion与protocol notification。
- `cli/src/mcp_cmd.rs`、`core/src/mcp_skill_dependencies.rs`、plugin login：browser/silent调用和scope retry。
- config callback URL/port定义与tests：自定义redirect的预期部署模型。
- callback/parser/App Server executor tests：state、token exchange、notification与固定client id。

先对默认、localhost、IPv6、外部HTTPS、非HTTP scheme与host不含端口的callback URL记录advertised redirect URI、实际listen address和path；验证非loopback host自动扩大为0.0.0.0，却不证明流量真的被转发到该port。

计算已知server URL的callback id，从同机/LAN在浏览器redirect前发送`?error=access_denied`和错误state的code；观察oneshot一次性终结、listener退出以及合法callback无法恢复。再用随机path对比，明确PKCE只保护token exchange，不保护flow availability。

构造duplicate code/state、code+error、percent-encoded key、无`=`参数、POST/HEAD和任意Host；记录手写parser的last-write与success优先语义。生产callback parser应使用标准form-url-encoded decoder并把method/host/body/query限制写入协议。

让state validation、token endpoint和credential store分别失败，比较浏览器已返回的“complete”与App Server最终失败notification。成功页必须位于durable commit之后，或改成“callback received，等待客户端确认”。

分别延迟metadata discovery、dynamic registration、callback、token exchange与keyring/file save；证明timeout只包callback receiver。用0、负数、极大i64检查静默clamp和无上限后台驻留，handle drop也要测试是否真正取消。

最后让OAuth endpoint跨origin redirect并配置Authorization/custom header，抓底层HTTP client行为；adapter只映射Follow/Stop，没有自己剥离敏感header。生产安全测试要固定跨origin重定向策略，而不是依赖通用transport默认值。

## 76. 路线七十三：Skill snapshot冻结的是目录还是正文

按root ownership、bounded walk、canonical identity、late read和cache generation阅读：

- `core-skills/src/loader.rs`：root来源/去重、scope symlink policy、canonicalization、frontmatter/metadata与asset路径。
- `core-skills/src/loader/discovery.rs`、`file-system/src/lib.rs`：BFS、排序、cycle identity、depth/directory/entry/response bounds和partial inventory。
- `core-skills/src/root_loader.rs`、`model.rs`：first-wins merge、path→filesystem映射与所谓immutable HostSkillsSnapshot。
- `core-skills/src/injection.rs`、`ext/skills/src/provider/host.rs`、`extension.rs`/`render.rs`：Turn late read、完整分配后8000-byte截断。
- `config_rules.rs`、`invocation_utils.rs`：disabled selector与implicit command usage的best-effort canonicalization。
- loader/service/executor authority tests：目录/file symlink、hidden alias、cycle、namespace和remote filesystem身份。

在Repo/User/Admin/System四种scope分别放指向root外的directory symlink和file symlink；记录walk、canonical path、scope、namespace与最终filesystem。特别验证Repo标签不等于target仍属于repo。

让两个不同root alias指向同一target并交换root顺序，比较first-wins的scope/plugin id；root只在canonicalize前按文本dedupe，所以同target仍重复scan。给scan前部制造2000目录/20000 entries，检查后部skill缺失是否只出tracing日志。

在catalog生成后、Turn选择前把`SKILL.md`原子替换、改symlink target或只改正文；比较snapshot name/description/policy与实际注入body。加入digest后应拒绝generation不一致，而不是静默组合A metadata+B body。

制造几十MiB正文，测量host read峰值；当前8 KiB限制发生在完整String之后。统一Host/Executor/Orchestrator的流式上限，并把truncation语义放在provider contract而非consumer末端。

让`openai.yaml`声明禁止implicit后变invalid/不可读，验证policy回到默认允许；再让disabled path在config load时不存在、之后创建symlink。安全开关应与展示metadata区分fail-closed/fail-open。

最后在`assets/`内放外链symlink，把icon absolute path通过App Server交给client；loader的lexical prefix不证明real target containment，consumer必须按package capability重新读取和限流。

## 77. 路线七十四：为什么known-safe命令仍不能当安全边界

按shell lowering、显式rule、heuristic三态、approval矩阵与sandbox bypass阅读：

- `shell-command/src/bash.rs`：tree-sitter word-only sequence、quote/concatenation和heredoc prefix。
- `command_safety/is_safe_command.rs`：basename safelist与find/rg/base64/git参数过滤。
- `command_safety/is_dangerous_command.rs`及Windows variants：窄dangerous枚举与wrapper解析。
- `core/src/exec_policy.rs`：commands lowering、unmatched decision matrix、rule aggregate和bypass条件。
- `execpolicy/src/policy.rs`/`rule.rs`：exact prefix、absolute host executable映射与最严格Decision。
- `command_canonicalization.rs`、`execpolicy/src/amend.rs`：approval key和持久化规则更新。

创建PATH前置fake `cat`与直接`/tmp/cat`，在UnlessTrusted+Managed和Disabled profile分别观察approval与sandbox；basename判safe不等于binary可信。下一步把binary在审批后替换，验证canonical cache没有inode/digest。

用`rm -rf`、`rm -fr`、`rm -r -f`、long options、绝对path、sudo额外flag、env wrapper和find-delete跑完整approval矩阵。dangerous提示必须被描述为best-effort UX，不是破坏性操作denylist。

在repo config/env注册Git fsmonitor/pager/textconv/external helper，再执行被判safe的status/log/diff/show；确认过滤command-line flags没有覆盖transitive executable closure。生产可选择clean env+safe config或不把Git特判为纯读。

给`cat`读取workspace、home secret与系统路径，区分command side effect和data confidentiality；只有PermissionProfile/sandbox能决定真实读边界，safe classification本身没有path policy。

组合pipeline与多条conflicting rules，确认每segment分别匹配、最终取最严格Decision，且只有每段显式Allow才bypass sandbox。对复杂shell和heredoc检查原wrapper/argv prefix如何进入rule与approval cache。

最后破坏任一低优先级`.rules`，验证所有普通rules被丢弃、只保留requirements；再模拟append成功但memory update失败。policy loader要有last-known-good generation和逐文件可见错误，不能静默回到更宽heuristics。

## 78. 路线七十五：MCP等待人类时谁暂停timeout、谁负责最终收口

按RMCP active time、Core lifecycle、router、App Server request和TUI action阅读：

- `rmcp-client/src/elicitation_client_service.rs`、`rmcp_client.rs`：server request、双form协议、per-client pause与active-time timeout。
- `codex-mcp/src/elicitation.rs`：policy、Guardian前置、public id router、manual event和无timeout oneshot。
- `core/src/elicitation.rs`、`session/mcp.rs`：session计数、active Turn holder、refresh router继承与内部请求路径。
- `mcp_tool_call.rs`、`request_plugin_install.rs`：Core-generated tool approval/install/auth elicitations。
- App Server `bespoke_event_handling.rs`与v2 MCP protocol：typed schema、outbound request、error→Decline/Cancel。
- TUI `mcp_server_elicitation.rs`、`app_link_view.rs`：form response、URL校验和external completion。

让MCP tool timeout设为100ms，elicitation停留数秒后回答，确认active-time剩余而非wall clock；再永久不回答，列出仍存活的Turn、router、client、process与pause guard。生产必须有独立human TTL。

关闭event channel、取消tool future、refresh manager和late-response交叉测试；当前send failure被忽略且map没有Drop cleanup。router entry应绑定lease并在任一owner结束时发明确Cancel。

用相同`(server,id)`并发走Core内部holder，验证旧waiter被覆盖；再在无active Turn发请求。public manager path用Codex生成id规避MCP原id碰撞，但internal path仍依赖call id唯一性。

模拟client name/version为Xcode 26.4，分别触发真实server form与Core tool approval/plugin install/auth URL；验证同一`auto_deny`flag前者Decline、后者Accept空对象。兼容性不能用含义相反的boolean跨两条决策路径。

发送future typed schema字段、巨大OpenAI image picker、非object meta与malformed response；比较标准Form自动Cancel、OpenAI raw透传、context meta merge和response缺schema validation。

最后让generic server提供HTTPS phishing URL、userinfo URL、HTTP和ChatGPT lookalike，检查TUI只在用户动作后打开且显示server。点击“I finished”后让远端状态保持未完成，证明Accept是用户声明，不是业务事务commit。

## 79. 路线七十六：文件模糊搜索为什么不能直接等同workspace索引

按walker、matcher、session lifecycle、RPC ownership与UI generation阅读：

- `file-search/src/lib.rs`：multi-root WalkBuilder、Nucleo injector、unbounded query channel、snapshot与cancel。
- `file-search/src/cli.rs`/`main.rs`：standalone limits和无pattern fallback command。
- `app-server/src/fuzzy_file_search.rs`：50 top-N、最多12 threads、runtime-spawned notifications。
- `request_processors/search.rs`：任意roots、legacy token cancel、session map与same-id replace。
- `tui/src/file_search.rs`：单session复用、cwd切换、session token过滤。
- App Server/TUI tests：scores/indices、stream updates、stop、case、clear与独立sessions。

用App Server请求home、`/etc`和workspace内指向外部的symlink root；确认搜索不经过Thread permissions且hidden被包含。把这个RPC归类为host inspection，而不是普通workspace UI helper。

生成百万path并并发启动大量session，记录Nucleo full-path+UTF32内存、native thread数和Drop后退出延迟。rapid发送大query，验证unbounded channel即使stale snapshots被过滤仍处理全部消息。

让matcher在complete前panic/返回Err，检查one-shot Condvar是否永久等；取消中途读取结果，当前协议把partial success与complete empty混为一谈。生产返回必须有terminal reason和inventory completeness。

在walk完成后增删/替换文件与symlink，再更新query；catalog不会重walk，match type却live stat，形成旧membership+新type组合。选择path时重新验证root containment和generation。

对nested、duplicate和alias roots检查同一inode多次注入及最深lexical root attribution；再给只相对primary root有意义的exclude pattern，明确multi-root pattern namespace。

最后高频A→B→C并抓sessionUpdated/sessionCompleted；completed只带sessionId且由独立task发送，无法归属query。协议应给每次update递增generation并在所有notification回显。

## 80. 路线七十七：Standalone Web Search如何把远端策略伪装成本地工具

按tool selection、request envelope、远端state、输出投影和失败终态阅读：

- `core/src/tools/spec_plan.rs`与config resolver：hosted/standalone互斥、Responses Lite、mode和PermissionProfile默认值。
- `ext/web-search/src/extension.rs`/`tool.rs`：provider gate、tool exposure、recent conversation、settings和事件顺序。
- `ext/web-search/src/history.rs`/`schema.rs`：两条user+assistant tail、non-strict commands与无本地数量限制。
- `codex-api/src/search.rs`及endpoint：`level_id`、`alpha/search`、max tokens、plaintext/encrypted output和HTTP client lifecycle。
- `ext/web-search/src/output.rs`、`tools/src/tool_output.rs`：无通用截断的FunctionCallOutput、external-context与日志占位。
- App Server/code-mode/spec-plan tests：持久化WebSearchItem、allowed callers、模式settings和冷恢复。

构造完整gate matrix：hosted可用但extension缺失、Responses Lite、Standalone feature、Disabled/Cached/Indexed/Live，以及OpenAI和actor-auth custom provider。记录模型实际看见`web_search`还是`web.run`，不要把UI里同名“网页搜索”当同一个protocol。

向两条user消息塞大文本，并在中间加入system/developer/tool/contextual user、图片、assistant和internal metadata；抓`alpha/search` body。验证assistant约1000-token截断，但user无本地上限；再把provider base URL指向测试server，确认对话片段和location会发往custom origin。

一次提交所有command arrays、unknown fields、巨大列表、per-query domains与non-HTTP URL。对照backend实际收到的commands和本地WebSearchItem action；后者只按固定优先级保留一个search/image/literal-open/find，其他操作和ref-id open都退化为Other。

并发发两个search及依赖reference id的open/click，确认所有request复用同一个`level_id`且没有call generation。再从Code Mode调用，抓settings仍是`allowed_callers=["direct"]`；远端session identity和caller provenance必须分开设计。

让backend忽略`max_output_tokens`并返回巨大plaintext，再只返回`encrypted_output`或malformed body。追踪完整body decode、SearchOutput clone、rollout和下一轮context；当前没有本地输出截断，encrypted字段也不参与恢复。

分别在auth、connect、HTTP status和JSON decode阶段失败，观察started item与terminal event。生产协议必须让每个started都落到succeeded/failed/cancelled，且失败审计保存阶段，不只依赖通用tool error。

最后让backend违反allowed domains、external mode和location预期，验证客户端没有二次强制。把这些字段定义为remote policy request；真正安全边界仍需本地egress proxy、URL normalization、tenant allowlist和response budget。

## 81. 路线七十八：图像生成结果为什么不应在每层重复内嵌base64

按能力gate、输入authority、API body、artifact提交和恢复投影阅读：

- `ext/image-generation/src/extension.rs`与`core/src/tools/spec_plan.rs`：provider粗gate、model/auth/capability细gate及config refresh。
- `tool.rs`：严格args、recent image selection、started时机、fixed model、response clone与artifact write。
- `backend.rs`、`codex-api/src/images.rs`和endpoint：fresh client、JSON edit data URLs、完整response decode及first data selection。
- `stream_events_utils.rs`、`context/image_generation_instructions.rs`：sanitized host path、绝对路径hint和1024-byte omission。
- `ext/items/src/image_generation.rs`、rollout policy、context normalization：base64 item、模型投影和持久化。
- App Server `thread_resume_redaction.rs`及extension tests：特定remote client的response-only删除与saved path透传。

逐项切换provider/auth/capability/model modality/feature/namespace，比较extension executor存在与模型实际看见tool。能力必须在Step快照里解释，不能只检查registry里是否注册。

用两个不同Environment和同一absolute path验证只取first authority；再测workspace外path、symlink和五张超大图片。读取由Executor sandbox约束是关键优点，但authority选择、总bytes和decode预算仍要显式。

构造重复call id、远距pair、orphan output、不同role Message和新但无关图片，调用`num_last_images_to_include`。recent不是稳定reference；生产UI应先解析成artifact ids并让用户可确认。

让API返回空b64、非法base64、非PNG、巨大body和多个data，记录Item、FunctionOutput、hook、rollout和内存中的复制份数。当前只取第一项，直到save才验证base64，而且即使save失败也返回completed。

为thread/call id使用`a/b`与`a_b`、超长字符串，并预置generated_images目录或目标文件symlink；观察sanitize碰撞、nofollow缺失和非原子overwrite。opaque id必须通过hash映射，host path不能由不可信id直接塑形。

在parse/read/preprocess、HTTP、JSON decode、started后cancel、base64 decode和write分别失败。确认哪些根本无ImageGenerationItem、哪些failed、哪些仍completed；建立覆盖整个tool transaction的terminal状态机。

最后比较paginated/legacy rollout、下一轮model、Code Mode、live App Server与mobile thread/resume。response-only redaction不会减少持久化或live payload，真正的容量边界应是一次存储、多处引用。

## 82. 路线七十九：Safety Buffering为什么不是本地安全buffer

按transport metadata、Core透传、TUI状态和retry transaction阅读：

- `codex-api/src/safety_buffering.rs`、`common.rs`：header treatment、false不gate和payload字段。
- SSE `responses.rs`与WS endpoint：event提取顺序、header snapshot/update、重复通知和正常ResponseEvent并行。
- `core/src/session/turn.rs`、rollout policy：requested model投影、实时EventMsg与不持久化。
- App Server bespoke mapping/protocol：thread/turn关联和`showBufferingUi`通知。
- TUI `chatwidget/safety_buffering.rs`、`streaming.rs`：current Turn guard、visible text activity和popup状态。
- `app/event_dispatch.rs`、`thread_routing.rs`：interrupt→rollback→resubmit及失败补偿。

组合header enabled absent/true/false、fallback model和wire retry_model omitted/null/string；对SSE和WS分别抓事件。当前enabled值不参与判断，object payload总被强制show=true，名称不能当语义。

把safety payload附在created、每个delta和completed，并放超大数组/字符串；观察每次都先发SafetyBuffering再发原事件，Core没有dedupe。生产状态应按run+revision upsert，而不是把每帧metadata当新通知。

让server实际reroute为C、Turn请求A、retry建议B；检查Core通知model仍是A。所有模型字段要分成requested/actual/retryTarget，避免审计混淆。

buffer期间断线、切Thread和resume；EventMsg不持久化且TUI忽略initial replay。若产品承诺“仍在审核”，状态必须由server snapshot恢复，而不是等一次性stream metadata。

在没有assistant text前依次产生reasoning、shell/patch/MCP side effect，再点Retry；当前guard仍允许。rollback history不等于回滚外部世界，重试必须依赖tool idempotency或在首次tool dispatch后禁用快捷重试。

在interrupt后、rollback前由另一connection启动Turn；再分别令三个RPC失败。通用`rollback(1)`缺expected turn id，三个步骤无法提供原子性，服务端应提供CAS retry endpoint。

最后让popup显示后马上到达text delta再点击；当前分支不重试，却更新未来默认model+Low effort。stale action应返回“响应已开始，重试不可用”，不得改变其他设置。

## 83. 路线八十：Legacy notify为何既不是可靠hook也不是安全outbox

按config source、payload范围、process authority和delivery结果阅读：

- `hooks/src/legacy_notify.rs`：历史wire shape、argv append、null stdio和spawn-only成功。
- `hooks/src/registry.rs`：不依赖CodexHooks feature的注册与plain Command构造。
- `core/src/hook_runtime.rs`：从完整sampling input收集UserMessage和AfterAgent失败处理。
- `core/src/session/turn.rs`：Stop hook之后、final Turn之前的触发顺序。
- config loader project-key过滤与session refresh tests：repo notify拒绝、notify session-static。
- Guardian review config和user notification integration tests：internal session清理与目前只验证spawn副作用。

运行三轮用户输入后抓最后argv，确认它包含完整normalized history而非current prompt；再做compaction、rollback、steer和tool follow-up，记录历史集合如何变化。契约应直接命名`all_visible_input_messages`，或更合理地只发run id。

把密钥和超长文本放入旧消息，使用同账户process读取child argv并逐步逼近ARG_MAX。argv不适合承载敏感/无界JSON，应该用有权限和长度限制的stdin或opaque lookup id。

分别配置direct script、`sh -c`、PATH basename和relative program；检查JSON在shell里成为`$0/$1`的差异、实际process cwd和继承env。payload声明cwd并不会改变命令执行目录。

让脚本exit 1、sleep forever、spawn descendant和连续大量Turn；当前spawn Ok立即等于Hook成功，stdio被null且Child未wait。需要测试process reaping、shutdown和并发上限，而不只等一个touch file。

从project/user/managed层分别配置notify，并在runtime reload后修改；project会被剔除，现有Thread又保留旧notify。source trust与runtime generation都应在诊断里可见。

最后启动Guardian、thread-spawn child和其他internal sessions，确认哪些clone清notify。生产默认只允许root user Turn投递，内部代理如需通知必须显式声明而非继承。

## 84. 路线八十一：桌面通知的grapheme截断为何挡不住terminal injection

按producer、coalescing、focus gate、terminal encoder和failure fallback阅读：

- `tui/src/chatwidget/notifications.rs`：五类正文、优先级单slot、200/30 grapheme截断。
- `turn_runtime.rs`、`tool_requests.rs`：模型回复、命令、path、MCP server和plan title来源。
- `tui/src/notifications/osc9.rs`/`bel.rs`：raw OSC9、tmux DCS wrapping和BEL discard。
- `tui/src/tui.rs`/`event_stream.rs`：focus condition、同步stdout写、首次错误永久disable。
- `config/src/types.rs`：默认enabled/unfocused/auto与custom type allowlist。
- notification/TUI tests：当前只覆盖普通文本、ESC double和优先级行为。

对每类Notification注入BEL、ST、OSC52、CSI title、newline、C1和bidi controls；抓最终bytes而不只看Rust String。plain路径完全raw，tmux路径只double ESC而未处理BEL。

把同一payload送过nested tmux和SSH，记录tmux de-escape后outer terminal真正看见的sequence。安全测试必须验证终端parser边界，而不是“字符串里ESC数量增加”。

连续产生两个approval、elicitation、plan prompt和TurnComplete，在redraw前后观察pending slot。高优先级压低优先级、同级last-write，桌面提醒和实际UI request queue并不一一对应。

使用不发送FocusLost的terminal、启动时窗口已失焦和rapid focus切换；默认Atomic=true会导致漏通知。focus是体验hint，不能控制安全或durable delivery。

关闭stdout或制造write error，确认backend被永久None且不降级；再发送语法有效但有害的escape，它返回Ok所以不会自愈。生产应统一sanitize，并把I/O降级显式展示。

最后比较queued follow-up/active goal时完成通知被抑制的正确语义，与side Thread/多审批的缺口。attention routing要绑定request id和owner Thread。

## 85. 路线八十二：sandbox继承的escalation socket为何必须按敌对RPC设计

按capability传播、framing、policy identity、FD transfer和process cleanup阅读：

- `shell-escalation/README.md`与`unix/mod.rs`：patched zsh、Run/Escalate/Deny和共享fd拓扑。
- `escalate_client.rs`/protocol：完整env、per-request stream、stdio SCM_RIGHTS和Run execv。
- `socket.rs`：8192 datagram、16 FD、u32 stream frame、无receiver上限和ancillary parser。
- `escalate_server.rs`：unbounded handshake spawn、detached handler、response-before-SuperExec及host child。
- `stopwatch.rs`：shared active-time pause和非RAII `pause_for`。
- Core `unix_escalation.rs`：execpolicy/approval只看program+argv+cwd、env落入Unsandboxed/新sandbox和direct-child cancel。

从sandbox内绕过官方wrapper，直接在继承datagram fd发送带stream fd的handshake；stream只写`0xffffffff`长度或partial JSON。记录host allocation、task/FD数量和session cancel能否全部join。

并发制造大量request，其中一个进入人工approval永久不答，另一个正常执行；共享Stopwatch直到所有pause清空才恢复。取消pending future，检查`pause_for`没有Drop guard导致的active count。

给一个allowlisted absolute command注入LD_PRELOAD、Git/Python helper、PATH/config env；比较policy、Guardian、人工UI都看不到env，而prepare执行保留。command identity必须包含transitive environment。

批准后不发SuperExec，或发送destination fds为重复、负数、巨大值及非stdio；当前只校验数量相等且忽略dup2失败。host必须只接受固定0/1/2映射。

构造超过16 FD、MSG_CTRUNC、多个SCM_RIGHTS和异常control长度，做parser fuzz与FD leak检查。局部Unix socket也要按敌对输入验证unsafe边界。

让host child fork后台descendant再取消parent；direct kill不收process tree。然后走Run路径，让ordinary child读取仍继承的socket/env，证明capability传播超过wrapper瞬间。

最后比较EscalationSession只abort主loop、per-request task detached的shutdown行为；用JoinSet/TaskTracker拥有全部handler并在drop时有界join。

## 86. 路线八十三：transport retry为什么不能替代业务幂等协议

按request construction、auth、retry、body read和logging阅读：

- `codex-api/src/endpoint/session.rs`：unary/stream make-request差异、per-attempt auth和telemetry。
- `codex-api/src/provider.rs`、model-provider-info：URL/query拼接、默认4 retries与100 cap。
- `codex-client/src/retry.rs`：inclusive loop、retry条件、指数jitter和无总deadline。
- `http-client/src/transport.rs`：full success/error body、status映射和TRACE完整JSON。
- `http-client/src/default_client.rs`：URL/response headers DEBUG logging和auth专用关闭路径。
- Images/Search/Memories/Responses clients及tests：POST endpoints、prepared stream body与flaky auth/transport。

设置request_max_retries为0/1/4并让transport恒失败，确认total attempts为值+1、attempt从0记录。API字段和实现命名应统一，避免SLO/成本配置误读。

让测试server收到POST并commit后，在response body中途断开；对image generation、edit、search和写endpoint数实际副作用。没有idempotency key时，ambiguous failure不应由generic transport自动重放。

返回429带Retry-After和连续5xx，对比generic 200ms指数退避与Responses上层parser；再配置100观察无max delay/total deadline。每个operation要有可取消总预算。

在unary configure closure递增header，在stream configure同样操作；抓retry wire requests。前者每attempt重建，后者只prepare一次，稳定operation id不能靠调用方偶然closure语义。

让auth第一次Transient、第二次成功，记录telemetry attempt虽没有首个wire send；再模拟send后network error。`sent`状态必须单独存在，不能都叫network retry。

给base URL现有query/fragment，query_params放`&`, `=`, `#`, Unicode并多次运行；当前raw HashMap join不canonical。标准URL builder和稳定排序是签名/缓存前置条件。

最后打开TRACE，发送conversation和image data URL；让server返回巨大error body/敏感headers。验证完整正文和headers进入日志/error，建立统一byte cap与field allowlist。

## 87. 路线八十四：Apps fileParams为何是隐藏在arguments rewrite里的数据egress

按descriptor schema、approval顺序、filesystem authority、三阶段upload和partial cleanup阅读：

- `codex-mcp/src/codex_apps/file_params.rs`：meta声明、optional fields推导和destructive schema rewrite。
- `core/src/mcp_tool_call.rs`：仅codex_apps准入、approval后rewrite再真实call。
- `core/src/mcp_openai_file.rs`：primary cwd join、sandbox=None metadata/stream、串行多文件和argument fallback。
- `codex-api/src/files.rs`：512 MiB单项、create→PUT→finalize、raw URL/id与软30秒轮询。
- fileParams/OpenAI file integration tests：目前主要覆盖happy path、单项size和custom MCP拒绝。

在read-only/denied-read profile下传absolute secret、`../../`和workspace symlink；抓create/PUT bytes。当前两个filesystem调用都明确sandbox=None，这是权限绕过而非UI提示问题。

给原provided-file schema设置maxItems、pattern、oneOf/ref和item limits，比较model-facing schema；`object.clear()`只留下string/array。再传成百文件，记录总bytes/clients/time，建立批量budget。

数组前两项合法、第三项missing或non-string；前者留下orphan cloud objects，后者可能让原local paths直接进入远端MCP args。rewrite必须all-or-nothing validate before any upload，类型错要fail-closed。

metadata读取后替换file/symlink target或改变大小，验证旧Content-Length与新stream。用open-once handle及fstat/hash消除check/use漂移。

让create返回localhost、HTTP、userinfo、private IP、DNS rebinding和非Azure host upload URL；当前只提host用于日志，仍直接PUT本地bytes。signed URL必须有scheme/host/IP policy。

让file_id含slash/`..`/query/fragment，抓带auth finalize目标；让download_url用任意scheme。opaque server id不能字符串拼path。

令第N项、PUT response、finalize retry/cancel各阶段失败并检查云端对象；当前无delete/ledger。生产上传是durable transaction，有orphan sweeper与idempotency key。

最后用async request-signing AuthProvider，确认files路径只调用add_auth_headers；所有HTTP路径应遵守同一authoritative apply_auth契约。

## 88. 路线八十五：Request User Input为什么不能用Turn id代替call id

按tool schema、Core rendezvous、App Server RPC、TUI队列和rollout lifecycle阅读：

- `core/src/tools/handlers/request_user_input_spec.rs`：描述性约束、non-strict schema、options normalization和60–240秒clamp。
- `protocol/src/request_user_input.rs`：call/turn双id、secret/other、answer map与autoResolutionMs wire shape。
- `core/src/tools/handlers/request_user_input.rs`、`session/mod.rs`、`state/turn.rs`：root/mode gate、elicitation guard、Turn-keyed oneshot和response投影。
- App Server `bespoke_event_handling.rs`、outgoing request：每event独立client request、per-request task和error→empty answers降级。
- TUI `app_server_requests.rs`、`bottom_pane/request_user_input/**`与history cell：per-Turn FIFO、fixed timer、draft/answer flattening和secret masking。
- rollout policy与interrupt tests：RequestUserInput transient、不持久化、partial committed answer TODO和Turn cleanup。

在同一Turn并行触发A/B两个tool call，给不同question id和答案；分别按A→B、B→A回答。Core map以Turn id覆盖sender，TUI却排队两个call，记录第一receiver cancel、答案错投和late response丢失。rendezvous必须以call id唯一。

构造0题、4题、重复id、1/4/万级options、超长header/question/label和非法snake_case。对比description与真正JSON schema/runtime validation；所有资源和语义约束都必须在边界执行，不能依赖模型自觉。

让client回未知key、缺失key、任意label、多个answer、巨大note和`user_note:`前缀option；当前Core直接回模型，TUI重复id还会HashMap覆盖。改为question/option stable id与typed note字段。

分别制造用户空提交、TUI计时到期、client JSON-RPC error、channel close和malformed JSON；它们都可能成为空map。response需要`answered/expired/client_failed/cancelled`显式terminal status。

传60、90、240秒并抓实际TUI时间；任意Some都是60秒hidden+60秒visible。再按一个无关键、排队第二request、暂停/重启client，验证timer由UI临时状态控制而非server deadline。

从内部/MCP路径构造isSecret问题，检查overlay/history/raw lines遮罩，同时抓App Server response和模型tool output。UI星号不等于秘密不出client或不回模型，协议必须声明实际confidentiality范围。

无auto timer且没有client subscriber时永久等待，再cancel、cold resume和interrupt partial answers。RequestUserInput属于transient rollout event，当前无法重建pending input；生产HITL Step必须持久化request、deadline、draft和terminal reason。

最后把questions设空并在TUI操作；没有current question时无自然submit路径，只能auto-resolve/interrupt/dismiss。入口应拒绝空集合并给所有等待设置server-owned TTL和bounded pending count。

## 89. 路线八十六：Final Output Schema为什么不是完成态DTO

按App Server入口、Turn快照、request projection、stream item和恢复审计阅读：

- App Server Protocol v2 `turn.rs`/`thread_data.rs`：任意JsonValue outputSchema与不含schema信息的Turn snapshot。
- `request_processors/turn_processor.rs`：只限制input字符、直接把schema放进Op，以及active Turn下的统一turn/start路径。
- Core `session/handlers.rs`、`turn_context.rs`、`session/mod.rs::steer_input`：per-Turn schema snapshot、active input排队和schema静默丢失。
- `session/turn.rs::build_prompt`、`client.rs`、`codex-api/src/common.rs`：每Step复制、fixed name、strict选择和HTTP/WS `text.format`。
- SSE/WS response parser、AgentMessage lifecycle、rollout policy：structured text仍作普通delta/item且无通用post-validation。
- Guardian prompt/parser：strict=false但消费层另做typed deserialize，可作为对照。

传scalar、数组、非法schema、unsupported keyword、深层嵌套和巨大description；确认turn/start本地成功、input limit不计算schema，直到remote sampling才报错。入口应编译schema并限制nodes/depth/bytes。

用工具让同一Turn产生多个sampling Step，记录相同schema在每个request重复serialize的bytes和CPU；再加stream retry。大schema需要immutable intern/hash引用，而不是随Prompt复制。

让OpenAI测试server、custom provider分别严格执行、忽略或拒绝`text.format`；Core没有capability gate。provider声称compatible不等于structured-output contract相同。

分别返回非JSON、schema不符JSON、额外字段和截断JSON；观察普通AgentMessage仍可完成。server必须在stream终结后本地parse+validate，不能让client各自猜测。

先启动schema A的Regular Turn，在它运行时调用`turn/start(outputSchema=B)`；handler构建B context后，`steer_input`只把input加入active A，B不进入queue。断言API应拒绝schema-changing steer或明确开启新Turn。

逐字符切分JSON并由TUI/App Server消费；完成前每个prefix都不是valid document。raw delta只能做preview，业务state必须等待validated terminal artifact。

thread/read/resume/fork后检查Turn只保留items/status/time，没有schema/version/hash/strict/validation evidence。生产审计要能证明“请求了哪个contract”和“谁验证通过”。

最后比较Guardian：它在provider约束之外还parse成Rust payload。把这条“双重验证”抽象成所有structured result共用的Run/Step后置条件。

## 90. 路线八十七：Clipboard为什么需要artifact lease而不只是PathBuf

按copy source、backend选择、external process、image decode、temp ownership和composer lifecycle阅读：

- `tui/src/clipboard_copy.rs`：SSH/tmux/WSL heuristic、native lease、OSC52 100 KiB、PATH helper和process-global stderr suppression。
- `chatwidget/interaction.rs`、`transcript.rs`：快捷键同步执行、last agent markdown ring与rollback一致性。
- `clipboard_paste.rs`：file/raw image读取、full PNG encode、temp keep和WSL PowerShell双临时文件。
- `bottom_pane/chat_composer/attachment_state.rs`：PathBuf-only attachment、placeholder prune/take/remove与无file cleanup。
- Core image prepare/cache路径：提交后才出现的decode/budget不能保护TUI paste阶段。

分别在local、SSH、tmux、WSL走copy，发送99/101 KiB文本；native/helper与OSC容量不同。让terminal静默丢OSC52、tmux接受load-buffer但不转发，观察UI仍提示Copied；区分attempt和delivery。

用stale `SSH_TTY`、伪造TMUX、nested ssh/mosh/container测试backend target。clipboard authority应显示给用户或由显式配置决定，不能只靠env存在。

在PATH放fake tmux/PowerShell，让它不读stdin、输出巨大stderr、fork descendant；当前同步wait无deadline，会冻结TUI。helper按host process执行，必须固定路径/clean env/限流。

并发其他线程写stderr时触发macOS native copy；全进程fd 2被dup2到devnull，非clipboard日志也丢失。用subprocess capture或库配置代替global fd mutation。

把巨大/压缩炸弹图片作为clipboard file或raw RGBA，记录decode+PNG Vec+write峰值和render停顿。读取在UI event thread且无pixels/bytes/time上限。

paste后删除placeholder、clear draft、提交失败、rollback和exit，扫描`codex-clipboard-*.png`；`keep()`后没有owner cleanup。Attachment应持RAII artifact lease而不是裸PathBuf。

在WSL检查`GetTempFileName`的原`.tmp`和改扩展`.png`都残留；保存后替换mapped file再提交，验证TOCTOU。应立即复制到Codex-owned immutable artifact并删除Windows临时对象。

最后连续paste成百图片，确认attachment无count/total budget且未提交文件永不进入Core image limit。预算必须在生成第一份temp之前执行。

## 91. 路线八十八：Terminal hyperlink为何不能按cell复制完整destination

按semantic range、markdown link、wrap remap、live buffer、scrollback writer和terminal activation阅读：

- `tui/src/terminal_hyperlinks.rs`：HTTP(S) gate、control过滤、bare URL扫描、column ranges、wrap remap和per-cell OSC8。
- `markdown_render.rs`：web label+destination、local target替换label、percent decode和table annotation。
- `history_cell`/`pager_overlay`：live buffer mark与scroll offset。
- `insert_history.rs`：scrollback contiguous-span decoration、wrap policy和u16 row bookkeeping。
- `custom_terminal.rs`：忽略BEL-terminated OSC的cell width与buffer diff。
- onboarding/MCP/app link producers：可信与远端URL共用同一encoder。

构造control、bidi、userinfo、punycode/lookalike、localhost/private host和超长URL；比较visible suffix、terminal hover与实际click target。control应reject而不是删除后改变URL，host应canonical显示。

用`[https://trusted](https://trusted@evil)`放在窄窗口和table最后一列，观察label可点而真实suffix换行/出viewport。只给canonical destination区域链接，或click前确认origin。

测量1/100/2000字节destination覆盖1/100/2000 cells时live frame bytes；当前每cell重复完整OSC，而scrollback只按range一对。以destination intern id和row range encoder消除乘法。

输入大量短bare URLs、重复substring、长括号尾并连续resize，profile `web_links_in_text`、`trailing_url_end`和`remap_wrapped_line`。渲染算法也需要per-frame work budget。

把单行放在width=1并制造65,535+ physical rows；live临时Buffer和scrollback `as u16`走不同overflow语义。所有height/bytes/cells转换要checked并有hard cap。

给wide CJK、combining mark、zero-width/bidi和wrap transformation failure，断言range不会串到相邻link。最佳方案是在layout pipeline保持run id，不做事后字符串匹配。

最后在支持/不支持OSC8及tmux/screen/zellij测试BEL/ST终止。width parser与encoder应共享typed grammar；terminal click在Codex外完成，必须把不可审计性列入安全模型。

## 92. 路线八十九：Terminal title的cache为何不等于terminal state

按sanitizer、item composition、animation、config preview、Thread切换和退出清理阅读：

- `tui/src/terminal_title.rs`：control/bidi/invisible过滤、240-char cap、OSC0与clear语义。
- `chatwidget/status_surfaces.rs`：默认activity+project、raw cache、per-item截断、100ms spinner和action-required。
- `bottom_pane/title_setup.rs`、`status_controls.rs`：typed ids、preview snapshot、confirm/cancel。
- App event config edit：persist成功才commit，失败回滚preview。
- `app/session_lifecycle.rs`与exit：widget cache转移、clear而非restore。
- branch/thread/rate-limit producers：title的多信任源与隐私内容。

让两个title只差BEL/bidi/多空格或第241字符，抓OSC次数；low-level输出相同但raw cache不同会重复写。sanitizer应返回canonical emitted string给cache。

输入combining-only、超长grapheme、emoji ZWJ/variation selector、default-ignorables、四字节字符与CJK；比较segment grapheme cap、final char cap、display width和bytes。四种单位不能混称“title length”。

在tmux多pane/screen/zellij/SSH里开默认10Hz spinner，观察共享window/outer title实际owner。stdout是TTY不代表当前pane独占title capability。

模拟write持续失败并保持Working；当前每100ms重试且只debug。terminal side effects要有统一backoff、failure status和可恢复probe。

启动前设shell title，运行Codex再正常/异常退出；当前只清空，不恢复。再由外部进程中途改title，raw cache仍认为旧值在屏幕上。把cache语义降级为last emitted，不声称current。

打开setup逐项preview、令config persist失败/取消/确认，验证rollback正确；再在preview期间切Thread/退出，检查original snapshot与managed title谁收口。

选择project/cwd/thread/branch/rate limits/session id并在OS task switcher、tmux status、录屏查看。每项配置说明应标出terminal外部可见性。

最后检查SessionId的full UUID说明与32-grapheme截断；display id不可用作审计或copy identity，稳定id另走结构化action。

## 93. 路线九十：Workspace headline为什么不该由短命widget拥有cache

按status配置、5分钟timer、App Event request id、App Server account RPC、backend transport和response selection阅读：

- `chatwidget/status_surfaces.rs`：pending id、last requested、negative cache、stale保留和render。
- `workspace_messages.rs`：首个非空Headline与5分钟interval。
- `app/background_requests.rs`：2秒outer timeout、detached task与全局AppEvent。
- App Server `account_processor.rs`：1秒inner timeout、auth gate、404 feature-disabled和全列表timestamp mapping。
- `backend-client/client.rs`/types：no-store GET、完整body、read error吞空、无messages/body cap。
- widget constructor/session lifecycle：request id从0重置、Thread切换owner替换与旧task继续。

返回高速巨大body、数万messages和超长body，记录1秒内仍可消耗的RSS/JSON-RPC bytes；viewport ellipsis不是input budget。backend应只返回bounded active headline DTO。

在合法headline后放一个timestamp非法的announcement；整个App Server mapping失败。辅助字段错误应局部降级，不能阻断主消息。

返回多个乱序/archived headline，观察只取backend第一个且丢message_id/time。客户端至少保留revision/id/expiresAt并明确server排序契约。

在message_body放control/bidi/newline/combining并抓最终Ratatui Cell和terminal bytes；workspace remote text要复用title级sanitizer，不依赖layout偶然过滤。

先404再恢复route；TUI将feature permanently disabled，不再5分钟poll。区分authoritative capability absence与transient 404，negative cache必须有TTL/generation。

先成功再持续失败/撤回announcement；旧String无限保留且无stale标记。状态模型需要fresh/stale/unavailable/disabled和last-updated。

旧widget发id=0后立即切Thread，新widget也发id=0，乱序返回；全局AppEvent只比较局部u64，可能ABA接受。把cache/request ownership上移到App/account store并绑定generation。

最后开多个TUI/connection同时选择headline，统计每5分钟请求数。App Server应singleflight+ETag/cache或订阅push，避免poll-per-view。

## 94. 路线九十一：Reset credit的idempotency key为何不能只存在popup closure

按availability读取、detail fallback、picker key生成、consume POST、两阶段refresh和account lifecycle阅读：

- App Server `account_processor/rate_limit_resets.rs`：非空验证、current auth、10秒timeout、details全-or-nothing mapping。
- `backend-client/client/rate_limit_resets.rs`：redeem_request_id body、specific/generic POST与完整body transport。
- Protocol account types：UUID仅推荐、credit optional、AlreadyRedeemed和被丢弃的windows_reset。
- TUI `reset_credits.rs`/`usage.rs`：expiry排序、Unknown type、per-option UUID、retry closure与phase复用id。
- App background/event dispatch：15秒outer timeout、consume→refresh链和global AppEvent。
- widget constructor/settings：局部id从0、account clear与Thread replacement。

让backend先commit再延迟超过10/15秒；error页Try again应复用key。然后关闭popup/切Thread/重启再操作，观察新key；generic fallback可能消费第二枚credit。operation key需durable。

在account A打开picker，切换B后点击specific与generic；App Server消费时读取current auth，generic可扣B。请求必须带expected account generation并在server CAS。

旧widget发id=0 consume后切Thread，新widget也发id=0；让旧response先到。finish只比较u64，不比较idempotency/account/phase，构造ABA错投。view id用全局generation，业务仍以operation key关联。

并发两个TUI用不同UUID消费same credit/pool，验证backend specific CAS和generic serialization；`allow_cancel=false`只约束一个popup，不是admission lock。

传空/非UUID/超长key、same key+different credit、巨大credit id；当前只拒绝empty。server应验证UUID/length并把key绑定body hash/account。

details中放一个坏timestamp和多个好credit；全部details被丢弃，UI转generic。逐项隔离，不能因坏metadata扩大副作用选择范围。

构造Unknown reset type、巨大available_count/list/title/description；旧client把Unknown显示成Full reset且忽略description。稀缺credit的未知语义应fail closed。

最后令consume Reset而post-refresh失败；UI正确不否认成功，但没有windows/account/credit receipt。持久化`committed|unknown`操作记录并支持按key查询。

## 95. 路线九十二：Owner nudge邮件为何需要operation identity而不只是429 cooldown

按rate-limit触发、TUI确认、App Event slot、App Server auth、backend POST和UI receipt阅读：

- `chatwidget/turn_runtime.rs`/`rate_limits.rs`：member-only prompt、默认No、单in-flight type与generic结果文案。
- App Event/background request：request UUID只属于JSON-RPC，Finished event不带id/type/account且无timeout。
- App Server `account_processor.rs`：current auth、直接POST、429→Cooldown和无deadline。
- `backend-client/client.rs`：credit_type-only body、完整response body和无idempotency/receipt。
- Protocol account types：两种type与Sent/CooldownActive，缺operation/recipient/time。
- widget replacement/account update：旧task继续、slot重置与全局event路由。

让backend实际发送后断开；TUI提示retry，再发一次。429只能限制频率，无法证明同一logical email只发一次；加入durable idempotency key/status query。

令HTTP永不返回或持续body，观察App Server/TUI都无timeout，slot永久Some且后续prompt被抑制。operation需要deadline、cancel和unknown reconciliation。

在account A触发prompt、切B后点击Yes；server处理时读current auth，目标workspace漂移。confirmation token必须绑定expected account/workspace。

发UsageLimit后切Thread，新widget无slot时收到old Finished；finish默认Credits并显示错误文案。再与新Credits request乱序，旧result会take新slot。event必须回显request id/type/account generation。

通过第二个App Server client直接调用RPC，绕过TUI默认No确认。external communication应需要server-verified confirmation/policy capability。

并发多个client/device发送，验证backend cooldown到底按什么key；协议应返回cooldownUntil/recipient，而不是把任何429都叫recently notified。

返回巨大/敏感error body和success body；当前完整读且error贯穿日志。加byte cap、redaction并丢弃不需要的success正文。

最后检查TUI info cell在Thread switch/resume后的归属；邮件receipt应进account audit store，不进入或依赖conversation history。
