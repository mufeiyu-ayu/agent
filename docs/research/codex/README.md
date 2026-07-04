# Codex 架构研究

本文档是对 OpenAI Codex 开源项目的研究入口。这里保留架构结论和当前项目可迁移的设计思想，具体执行任务放在 `docs/tasks/`。

## 一句话结论

Codex 不是一个简单 CLI，而是一个事件驱动的 Agent Runtime：多个入口把用户输入转换成标准协议请求，core runtime 负责 thread、turn、model streaming、tool calling、approval、context 和 persistence。

```txt
Entrypoint
  -> protocol facade
  -> thread / turn runtime
  -> model stream
  -> tool execution
  -> observation
  -> final response / persistence
```

## 配套资料

| 文档 | 用途 |
| --- | --- |
| [source-map.md](./source-map.md) | 记录本次研究覆盖的 Codex 核心模块 |
| [main-flows.md](./main-flows.md) | 按运行链路理解 Codex 的主流程 |
| [agent-migration-roadmap.md](./agent-migration-roadmap.md) | 映射到当前 AI SEO Agent 的落地路线 |
| [mindmap-codex-runtime.md](./mindmap-codex-runtime.md) | Codex Runtime 架构图 |
| [mindmap-ai-seo-migration.md](./mindmap-ai-seo-migration.md) | AI SEO Agent 迁移路线图 |

## 当前项目最该吸收的思想

| Codex 思想 | 当前项目落点 |
| --- | --- |
| Thread / Turn 分层 | `Conversation` 是长期会话，`AgentRun` 是一次运行 |
| Event-driven runtime | 当前 NDJSON stream 是最小事件流 |
| Tool spec / runtime 分离 | 后续做 `ToolDefinition`、`ToolExecutor`、`ToolRegistry` |
| UI message != model history | 后续抽 `SeoContextBuilder` |
| Delta != persistence | 不保存所有 delta，只保存最终事实和关键过程 |
| Approval != sandbox | 当前先做人类确认，不做 OS sandbox |

## 当前不深入的内容

- Rust 语法细节。
- TUI 终端渲染。
- MCP 完整协议。
- Plugin marketplace。
- OS sandbox 底层实现。
- Multi-agent。
- Remote compaction。

这些不是不重要，而是当前 AI SEO Agent 还没到那个复杂度。
