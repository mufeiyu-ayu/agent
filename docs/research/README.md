# Agent 架构研究与学习路线

本目录是 AI SEO Agent 的长期架构研究区。它不直接充当当前任务看板，而是服务于三个目标：

1. 把 Codex 源码中值得长期借鉴的 Agent Runtime 设计沉淀为可复用知识库。
2. 把这些设计翻译成当前 NestJS + Vue 云端 Agent 项目的工程边界。
3. 在后续讨论 `agent` 项目的具体任务时，让 GPT 能按问题快速定位对应的 Codex 参考，而不是每次重新从源码开始。

## 当前结论

当前项目已经不是模型 API Demo。`master@5f2ad11f2c65425e84392e81048364d55ec626ef` 已经具备：

- Session Chat、消息持久化、NDJSON Streaming 与停止生成。
- `Conversation` / `Message` / `AgentRun` / `AgentStep` 的最小持久化边界。
- 内部 `AgentRuntimeEvent` 与外部 `ChatStreamEvent` 的分层。
- provider-neutral `ModelStreamEvent`，可以表达文本、tool call、usage 与 response terminal。
- 最小 `ToolDefinition` / `ToolRegistry` / `ToolInvocation` / `ToolResult` 边界。
- `test:model-stream` 与 `test:tools` 两组 Node 原生测试。

因此当前最近主线不是“从零建立 Tool Contract”，而是：

```text
复盘已完成的模型事件与工具契约
  -> 单 Agent Tool Loop：tool call -> execute -> observation -> second sampling -> final answer
  -> Tool 可靠性：timeout / cancel / error / recording / terminal exactly-once
  -> Context：model-visible history、observation 截断、token budget
  -> Durable recovery：crash reconciliation、idempotency、operation receipt
  -> Human-in-the-loop / 权限 / 多租户
  -> 扩展协议和 Multi-agent 只在单 Agent 稳定后评估
```

## 证据基线

| 对象 | 本次基线 | 用途 |
| --- | --- | --- |
| 当前项目 | `mufeiyu-ayu/agent`，`master@5f2ad11f2c65425e84392e81048364d55ec626ef` | 判断已经完成什么、真实缺口是什么 |
| Codex 源码 | 用户上传 `codex-main-ab6a7eb87.zip` | 提取成熟 Agent 系统的可迁移设计 |
| 本轮整理 | GPT 受托整理到 `docs/research/codex-reference/**` | 后续技术讨论的优先参考入口 |

源码会继续演进。本文档中的 Codex 路径对上述 zip 快照负责；后续升级 Codex 快照时，应优先校验稳定符号和调用链，而不是盲目复用旧行号。

## 优先阅读入口

### 后续讨论 Agent 项目时优先使用

| 入口 | 用途 |
| --- | --- |
| [codex-reference/README.md](./codex-reference/README.md) | 新 Codex 参考知识库总入口 |
| [codex-reference/how-to-use.md](./codex-reference/how-to-use.md) | GPT / 用户后续如何按问题查资料 |
| [codex-reference/current-agent-baseline.md](./codex-reference/current-agent-baseline.md) | 当前项目真实能力、缺口和近期路线 |
| [codex-reference/discussion-playbook.md](./codex-reference/discussion-playbook.md) | 以后做方案讨论时的检索表和决策模板 |

### Codex 架构核心专题

| 专题 | 适合什么时候看 |
| --- | --- |
| [core-runtime.md](./codex-reference/core-runtime.md) | 讨论 Thread / Turn / Task / StepContext / Runtime loop |
| [tool-loop.md](./codex-reference/tool-loop.md) | 讨论 Tool Calling、Observation 回填、第二轮 sampling |
| [context-history.md](./codex-reference/context-history.md) | 讨论 model history、UI transcript、token budget、compaction |
| [durability-recovery.md](./codex-reference/durability-recovery.md) | 讨论持久化、恢复、幂等、crash reconciliation |
| [safety-permission.md](./codex-reference/safety-permission.md) | 讨论权限、审批、sandbox、恶意 observation |
| [extensibility-and-multi-agent.md](./codex-reference/extensibility-and-multi-agent.md) | 讨论 MCP、Plugin、Skill、Hook、Multi-agent；当前只作为未来参考 |

### 旧研究资料

旧的 [codex/](./codex/README.md) 与 [learning-roadmap/](./learning-roadmap/README.md) 仍保留历史价值，但如果它们与 `codex-reference/**` 或当前代码事实冲突，优先使用：

```text
当前代码事实
  > codex-reference/**
  > 旧 research 文档
  > PR 或 Codex 自述
```

## Research 与 Tasks 的边界

| 目录 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `docs/research/` | 研究结论、源码地图、学习路线、设计参考 | 宣称当前代码已经实现 |
| `docs/tasks/` | 当前可执行任务、TDD 步骤和验收状态 | 存放长篇外部项目研究 |
| `docs/roadmap.md` | 项目阶段状态总览 | 展开每个架构主题的细节 |

研究路线可以比当前任务走得更远，但任何“已完成”都必须由当前代码、测试或运行结果证明。
