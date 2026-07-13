# Codex 源码快照与取证地图

## 1. 快照

本轮资料基于用户上传的源码压缩包：

```text
codex-main-ab6a7eb87.zip
```

解压后源码根目录包含 `codex-rs/`、`codex-cli/`、`.codex/skills/`、`.github/` 等目录；其中 `codex-rs/` 是本轮主要研究对象。压缩包没有 `.git` 元数据，因此本文不声称读取了远端 Git 状态，只按文件名和源码路径记录该快照。

## 2. 取证原则

本轮只沉淀对当前 Agent 项目长期有价值的架构材料，不做逐 crate 摘要。

采用的阅读顺序：

```text
产品入口 / 协议入口
  -> Thread / Turn 生命周期
  -> Session submission queue
  -> RegularTask / run_turn
  -> ModelClientSession sampling
  -> ResponseEvent 处理
  -> ToolRouter / ToolCallRuntime / ToolRegistry
  -> ContextManager / rollout / ThreadStore
  -> Permission / approval / sandbox / hook
  -> Extension / MCP / Skill / Plugin / Multi-agent
```

## 3. 核心源码路径

| 主题 | 关键路径 |
| --- | --- |
| CLI / App Server 入口 | `codex-rs/cli/src/main.rs`、`codex-rs/app-server/src/message_processor.rs` |
| App Server 协议 | `codex-rs/app-server-protocol/src/protocol/common.rs`、`codex-rs/app-server-protocol/src/protocol/v2/**` |
| Thread 生命周期 | `codex-rs/core/src/thread_manager.rs`、`codex-rs/core/src/codex_thread.rs` |
| Session / submission queue | `codex-rs/core/src/session/mod.rs`、`codex-rs/core/src/session/handlers.rs` |
| Task / Turn 主循环 | `codex-rs/core/src/tasks/regular.rs`、`codex-rs/core/src/session/turn.rs` |
| StepContext | `codex-rs/core/src/session/step_context.rs` |
| Model client | `codex-rs/core/src/client.rs`、`codex-rs/codex-api/src/common.rs` |
| Tool router | `codex-rs/core/src/tools/router.rs` |
| Tool registry | `codex-rs/core/src/tools/registry.rs` |
| Tool runtime / 并发 / 取消 | `codex-rs/core/src/tools/parallel.rs` |
| Tool call item 处理 | `codex-rs/core/src/stream_events_utils.rs` |
| Context manager | `codex-rs/core/src/context_manager/history.rs`、`normalize.rs`、`updates.rs` |
| Persistence | `codex-rs/thread-store/src/store.rs`、`types.rs`、`live_thread.rs` |
| Permission / policy | `codex-rs/core/src/config/permissions.rs`、`exec_policy.rs`、`tools/approvals.rs` |
| Hook | `codex-rs/core/src/hook_runtime.rs`、`codex-rs/hooks/**` |
| Extension | `codex-rs/ext/**`、`codex-rs/core/src/extension*`、`codex-rs/core/src/tools/spec_plan.rs` |
| Multi-agent | `codex-rs/core/src/agent/**`、`agent_communication.rs` |
| Goal / Memory | `codex-rs/ext/goal/**`、`codex-rs/core/src/memory*`、`codex-rs/ext/**` |

## 4. 高价值测试入口

| 主题 | 测试路径 |
| --- | --- |
| App Server protocol | `codex-rs/app-server-protocol/src/protocol/v2/tests.rs` |
| Thread start/resume/fork | `codex-rs/app-server/tests/suite/v2/thread_start.rs`、`thread_resume.rs`、`thread_fork.rs` |
| Turn start / request validation | `codex-rs/app-server/tests/suite/v2/turn_start.rs`、`request_validation.rs` |
| Runtime / abort | `codex-rs/core/tests/suite/abort_tasks.rs`、`codex-rs/core/src/session/tests.rs` |
| Tool router / registry | `codex-rs/core/src/tools/router_tests.rs`、`registry_tests.rs` |
| Tool parallelism | `codex-rs/core/tests/suite/tool_parallelism.rs` |
| Context normalization | `codex-rs/core/src/context_manager/history_tests.rs` |
| Token budget / compaction | `codex-rs/core/tests/suite/token_budget.rs` |
| Goal extension | `codex-rs/ext/goal/tests/goal_extension_backend.rs` |
| Multi-agent | `codex-rs/core/src/agent/control_tests.rs`、`registry_tests.rs`、`role_tests.rs` |

## 5. 本轮没有做的事

- 没有运行 Codex 全仓测试。
- 没有逐平台验证 sandbox 系统调用。
- 没有研究不可见的云端内部实现。
- 没有把 Codex 的所有专题都转成当前项目任务。
- 没有修改 `docs/tasks/**`、`docs/roadmap.md` 或 `docs/work-log.md`。

这套文档是“后续讨论可查的参考底座”，不是完整源码审计报告。
