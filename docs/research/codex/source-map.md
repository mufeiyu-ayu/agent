# Codex 源码阅读范围

路径约定：`<codex>` 表示 Codex 仓库根目录，`<agent>` 表示当前项目根目录。

## 核心阅读范围

| 方向 | Codex 主要路径 | 结论 |
| --- | --- | --- |
| 顶层入口 | `<codex>/codex-rs/cli/src/main.rs`、`<codex>/codex-rs/exec/src/lib.rs` | CLI / exec / app-server 是入口，不是 Agent loop |
| app-server | `<codex>/codex-rs/app-server`、`app-server-protocol` | 对外提供 thread / turn 协议门面 |
| core runtime | `<codex>/codex-rs/core/src/session`、`tasks`、`thread_manager.rs` | Session 和 Task 承担真正运行态 |
| protocol | `<codex>/codex-rs/protocol/src/protocol.rs` | Submission / Op / Event / EventMsg 是核心事件模型 |
| model stream | `<codex>/codex-rs/core/src/client.rs`、`session/turn.rs` | turn 内发起模型流式请求 |
| tools | `<codex>/codex-rs/core/src/tools` | spec、router、registry、runtime 分层 |
| approval / sandbox | `<codex>/codex-rs/core/src/tools/orchestrator.rs`、`sandboxing`、`execpolicy` | 审批和执行约束是两层 |
| context | `<codex>/codex-rs/core/src/context_manager` | model history 不等于 UI transcript |
| persistence | `<codex>/codex-rs/rollout`、`thread-store` | 不保存所有 delta，只保存可恢复事实 |
| SDK | `<codex>/sdk/python`、`<codex>/sdk/typescript` | SDK 复用 runtime，不复制 Agent loop |

## 当前项目对照

| 当前项目 | Codex 对照 | 说明 |
| --- | --- | --- |
| `Conversation` | Thread | 长期会话 |
| `Message` | Thread item / UI transcript item | 用户可见消息 |
| `POST /api/seo/chat/stream` | turn/start 极简版 | 一次用户输入触发一次运行 |
| `ChatStreamEvent` | EventMsg 极简版 | `start/delta/done/error/aborted` |
| `SeoService.chatStream()` | run_turn 极简版 | 当前承担了运行编排 |
| `LLMService.chatStream()` | ModelClientSession::stream | 模型流式门面 |
| `useSeoWorkspace` | UI event consumer | 消费事件并更新 UI |

## 只做边界级了解的部分

- TUI 具体布局和快捷键。
- realtime audio / WebRTC。
- cloud remote 任务。
- OS sandbox 底层系统调用。
- plugin marketplace 分发细节。
