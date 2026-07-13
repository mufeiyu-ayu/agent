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
