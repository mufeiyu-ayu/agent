# Codex Reference Knowledge Base

本目录是 GPT 受托整理的 Codex 源码参考库，基于用户上传的 `codex-main-ab6a7eb87.zip`。它不是 Codex 源码百科，也不是当前项目任务看板，而是后续设计 `mufeiyu-ayu/agent` 时可查的架构案例库。

## 使用定位

这套文档解决一个问题：以后我们讨论 Agent 项目时，如何快速借鉴 Codex 的成熟设计，而不是每次重新阅读 6000+ 个源码文件。

它遵守三条边界：

1. **Codex 源码事实**：只写 zip 快照中能定位到的路径、符号和调用链。
2. **架构解释**：提炼控制权、状态所有权、失败收口和工程取舍。
3. **迁移建议**：翻译成当前 NestJS + Vue 云端 Agent 项目的最小可落地方案。

不要把“Codex 这样做”直接等同于“当前项目现在就要做”。Codex 是本地/客户端优先的成熟 Agent 产品，当前项目是云端 AI SEO Agent，需要选择性迁移。

## 阅读顺序

### 第一遍，只看四个文件

1. [how-to-use.md](./how-to-use.md)：以后如何让 GPT 查这套资料。
2. [current-agent-baseline.md](./current-agent-baseline.md)：当前项目已经有什么、下一步缺什么。
3. [core-runtime.md](./core-runtime.md)：Codex 的 Thread / Turn / Task / sampling loop。
4. [tool-loop.md](./tool-loop.md)：当前最需要迁移的 Tool loop 不变量。

### 实现前按问题查

| 你要讨论的问题 | 先看 |
| --- | --- |
| 单 Agent Tool Loop | [tool-loop.md](./tool-loop.md) |
| 工具结果是否应该进入 Message 表 | [tool-loop.md](./tool-loop.md)、[context-history.md](./context-history.md) |
| 工具失败是否终止 Run | [tool-loop.md](./tool-loop.md) |
| Context 爆掉怎么办 | [context-history.md](./context-history.md) |
| 如何做可恢复执行 | [durability-recovery.md](./durability-recovery.md) |
| 写操作工具如何保护 | [safety-permission.md](./safety-permission.md) |
| 什么时候做 MCP / Multi-agent | [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) |
| 如何把讨论变成正式任务 | [discussion-playbook.md](./discussion-playbook.md) |

## 文档索引

| 文件 | 核心用途 |
| --- | --- |
| [how-to-use.md](./how-to-use.md) | 后续 GPT / 用户如何使用本知识库 |
| [source-snapshot.md](./source-snapshot.md) | 源码快照、取证方法和路径地图 |
| [current-agent-baseline.md](./current-agent-baseline.md) | 当前项目真实能力、缺口和近期路线 |
| [core-runtime.md](./core-runtime.md) | 产品入口、协议、Thread、Turn、Task、runtime loop |
| [tool-loop.md](./tool-loop.md) | ToolRouter、ToolRegistry、ToolCallRuntime、Observation、follow-up sampling |
| [context-history.md](./context-history.md) | model-visible history、UI transcript、normalization、compaction |
| [durability-recovery.md](./durability-recovery.md) | rollout、ThreadStore、flush、resume、fork、crash window |
| [safety-permission.md](./safety-permission.md) | permission、approval、sandbox、恶意 observation |
| [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | MCP、Plugin、Skill、Hook、Goal、Memory、Multi-agent 的迁移边界 |
| [discussion-playbook.md](./discussion-playbook.md) | 以后做方案讨论时的查阅和决策模板 |

## 对当前阶段的结论

当前最重要的任务不是 MCP、RAG 或 Multi-agent，而是把已有的模型事件边界和工具契约连接成真正的 Agent loop：

```text
第一轮 sampling 产生 tool call
  -> server 验证 tool name / schema / policy
  -> executor 执行只读工具
  -> tool result 作为 observation 回填 model-visible history
  -> 第二轮 sampling 生成最终回答
  -> UI Message 只保存最终用户可见内容
```

这条链路跑通后，才值得进入 Tool 可靠性、Context、Recovery、HITL 和多租户。
