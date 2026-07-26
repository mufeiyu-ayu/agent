# Agent 架构研究资料

本目录是 AI SEO Agent 的长期架构研究区，不直接充当当前任务看板或阶段路线。

正式状态必须按以下顺序判断：

```text
当前 master 代码与测试
  -> docs/tasks/**
  -> docs/roadmap.md
  -> docs/work-log.md
  -> docs/research/**
```

研究资料可以讨论 Context、Recovery、HITL、MCP、Multi-agent 等远期能力，但不能据此宣称当前项目已经实现、必须立即实现或已经确定执行顺序。

## 当前项目结论

项目已经完成：

- Session Chat、消息持久化、NDJSON Streaming 与停止生成；
- `Conversation` / `Message` / `AgentRun` / `AgentStep` 的最小持久化边界；
- 内部 `AgentRuntimeEvent` 与外部 `ChatStreamEvent` 分层；
- provider-neutral `ModelStreamEvent`；
- Tool Definition / Registry / Invocation / Result；
- `search_articles` 只读工具；
- 最多一次工具调用、最多两轮 sampling 的最小 Tool Calling；
- timeout、abort、Observation 上限与动态 Run / Step 记录；
- 同步与流式入口共享 `AgentRuntimeService.runTurnStream()`。

当前唯一确定的下一正式阶段是：

```text
阶段 6：有界单 Agent Loop
```

目标是把固定的一次工具调用 / 两轮 sampling 特例，升级为服务端限制下的顺序多步骤循环。当前不把完整 Context Engineering、RAG、HITL、Recovery、MCP 或 Multi-agent 作为阶段 6，也不提前编号阶段 6 之后的路线。

## 研究资料如何使用

研究资料只在以下情况下迁移为正式 Task：

1. 当前业务出现真实问题或产品需求；
2. 当前代码具备必要前置能力；
3. 能定义一个最小、可测试、可验收的边界；
4. GPT 与用户确认其学习收益高于当前其他候选方向；
5. 正式规格写入 `docs/tasks/**` 并创建独立 Issue。

禁止按“成熟项目有这个能力，所以当前项目也应立即实现”的方式推进。

## 优先阅读入口

### 当前阶段相关

| 入口 | 用途 |
| --- | --- |
| [codex-reference/core-runtime.md](./codex-reference/core-runtime.md) | Runtime loop、Turn、Task、follow-up sampling |
| [codex-reference/tool-loop.md](./codex-reference/tool-loop.md) | Tool Call、Observation、继续 sampling 与终止条件 |
| [codex-reference/current-agent-baseline.md](./codex-reference/current-agent-baseline.md) | 当前项目真实能力与阶段 6 缺口 |
| [codex-reference/how-to-use.md](./codex-reference/how-to-use.md) | 如何选择性迁移 Codex 设计 |

### 按真实问题查阅

| 问题 | 参考资料 | 当前状态 |
| --- | --- | --- |
| Tool Call / Result 如何配对 | [codex-reference/tool-loop.md](./codex-reference/tool-loop.md) | 阶段 6 横向不变量 |
| Context 爆掉或历史失控 | [codex-reference/context-history.md](./codex-reference/context-history.md) | 研究资料，当前非正式阶段 |
| 崩溃后如何恢复 | [codex-reference/durability-recovery.md](./codex-reference/durability-recovery.md) | 研究资料，未排期 |
| 写操作如何审批 | [codex-reference/safety-permission.md](./codex-reference/safety-permission.md) | 研究资料，未排期 |
| MCP / Multi-agent 何时引入 | [codex-reference/extensibility-and-multi-agent.md](./codex-reference/extensibility-and-multi-agent.md) | 研究资料，明确后置 |

## 旧研究资料

旧的 [codex/](./codex/README.md) 与 [learning-roadmap/](./learning-roadmap/README.md) 保留历史研究价值，但它们包含曾经设想的完整阶段顺序和旧项目基线，不能直接作为当前执行计划。

若旧研究资料与当前代码或正式任务冲突，优先级为：

```text
当前代码事实
  > docs/tasks/**
  > docs/roadmap.md
  > codex-reference/**
  > 旧 research 文档
  > PR 描述或 Codex 自述
```

## Research 与 Tasks 的边界

| 目录 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `docs/research/` | 源码研究、架构解释、长期候选能力 | 宣称当前实现、当前状态或固定执行顺序 |
| `docs/tasks/` | 当前可执行任务、TDD 步骤和验收状态 | 存放脱离当前阶段的长期研究路线 |
| `docs/roadmap.md` | 已完成阶段与当前唯一确定阶段 | 提前编排阶段 6 之后的任务 |
| `docs/work-log.md` | 已真实发生的路线决策、实现、验收和合并 | 记录尚未发生的未来事实 |
