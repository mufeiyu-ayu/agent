# Codex 思想迁移到 AI SEO Agent

本文只记录 Codex 架构思想如何落到当前项目，不作为具体任务清单。具体任务看 `docs/tasks/`。

## 当前阶段判断

当前项目已经具备：

- `Conversation` / `Message` 持久化。
- Session Chat。
- 受控 history。
- NDJSON streaming。
- 前端停止生成基础链路。

当前缺口：

- 没有显式记录一次 Agent 运行。
- 没有 step 级执行过程记录。
- `SeoService.chatStream()` 仍承担过多 runtime 职责。
- 没有 Tool Calling / Tool Registry。
- 没有 human-in-the-loop。

## 推荐迁移顺序

| 顺序 | 迁移点 | 当前项目落地 |
| --- | --- | --- |
| 1 | Turn / Run | 新增 `AgentRun`，记录一次用户输入触发的运行 |
| 2 | Step / Item | 新增 `AgentStep`，记录运行中的系统步骤 |
| 3 | Runtime boundary | 抽 `AgentRuntimeService.runTurnStream()` |
| 4 | Context boundary | 抽 `SeoContextBuilder` |
| 5 | RuntimeEvent | 内部事件和外部 `ChatStreamEvent` 分离 |
| 6 | Tool spec/runtime | 做最小 `ToolDefinition` / `ToolExecutor` / `ToolRegistry` |
| 7 | Approval | 中风险工具加入用户确认 |
| 8 | Context upgrade | 区分 UI message、model message、tool observation |

## 不照搬 Codex 的部分

| Codex 能力 | 当前处理 |
| --- | --- |
| Rust core runtime | 不学实现语言，只学边界 |
| app-server JSON-RPC | 当前继续用 Nest HTTP + NDJSON |
| OS sandbox | 当前不做 |
| execpolicy DSL | 当前用简单 riskLevel |
| MCP / plugin marketplace | 当前不做，先做内置工具 |
| rollout JSONL | 当前用 PostgreSQL 保存关键事实 |
| TUI | 当前是 Web UI，不学终端渲染 |

## 当前项目的目标形态

```txt
SeoController
  -> SeoService
  -> AgentRuntimeService
  -> SeoContextBuilder
  -> LLMService
  -> ToolRegistry later
  -> AgentRun / AgentStep persistence
```

核心原则：先让一次 Agent 运行可记录、可测试、可恢复，再做工具调用。
