# Codex Reference Knowledge Base

本目录是基于用户提供的 Codex 源码快照整理的架构案例库。它不是 Codex 百科，也不是 `mufeiyu-ayu/agent` 的正式任务看板。

## 使用边界

这套资料承担三种职责：

1. **源码事实**：记录快照中可定位的路径、符号和调用链；
2. **架构解释**：提炼控制权、状态所有权、失败收口和工程取舍；
3. **迁移参考**：将成熟设计翻译成当前 NestJS + Vue Agent 项目可理解的候选方案。

必须遵守：

> Codex 具备某项能力，不等于当前项目现在就应该实现它。

当前项目的正式状态与执行顺序以 `docs/tasks/**` 和 `docs/roadmap.md` 为准。

## 当前项目映射

当前项目已经完成：

```text
基础 Chat
  -> Session / Streaming
  -> Agent Run / Step
  -> Tool Contract / Registry / Invocation
  -> search_articles
  -> 一次 Tool Call + Observation + 第二轮 sampling
  -> timeout / abort / recording / 统一 Runtime
```

当前唯一确定的下一阶段是：

```text
阶段 6：有界单 Agent Loop
```

它要学习多次顺序 Sampling / Tool Execution、服务端执行上限、终止条件、错误语义和 Agent 行为测试。

完整 Context Engineering、Recovery、HITL、MCP 和 Multi-agent 继续保留为研究专题，但当前未排期，也不作为阶段 6。

## 阅读顺序

### 当前阶段优先

1. [how-to-use.md](./how-to-use.md)：如何选择性使用这套资料；
2. [current-agent-baseline.md](./current-agent-baseline.md)：当前项目真实能力和阶段 6 缺口；
3. [core-runtime.md](./core-runtime.md)：Thread / Turn / Task / Runtime loop；
4. [tool-loop.md](./tool-loop.md)：Tool Call、Observation 与 follow-up sampling。

### 按问题查阅

| 问题 | 先看 | 当前定位 |
| --- | --- | --- |
| 如何从固定两轮升级为有界 Loop | [core-runtime.md](./core-runtime.md)、[tool-loop.md](./tool-loop.md) | 阶段 6 核心 |
| 工具结果是否进入 UI Message | [tool-loop.md](./tool-loop.md)、[context-history.md](./context-history.md) | 阶段 6 输入正确性 |
| 工具失败是否终止 Run | [tool-loop.md](./tool-loop.md) | 阶段 6 错误语义 |
| Context 长度失控怎么办 | [context-history.md](./context-history.md) | 研究资料，按真实压力启动 |
| 如何做跨进程恢复 | [durability-recovery.md](./durability-recovery.md) | 研究资料，未排期 |
| 写操作工具如何保护 | [safety-permission.md](./safety-permission.md) | 研究资料，未排期 |
| 什么时候做 MCP / Multi-agent | [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | 明确后置 |
| 如何把讨论变成正式 Task | [discussion-playbook.md](./discussion-playbook.md) | 规格与决策辅助 |

## 文档索引

| 文件 | 核心用途 |
| --- | --- |
| [how-to-use.md](./how-to-use.md) | 后续 GPT / 用户如何使用本知识库 |
| [source-snapshot.md](./source-snapshot.md) | 源码快照、取证方法和路径地图 |
| [current-agent-baseline.md](./current-agent-baseline.md) | 当前项目真实能力与近期缺口 |
| [core-runtime.md](./core-runtime.md) | 产品入口、协议、Thread、Turn、Task、Runtime loop |
| [tool-loop.md](./tool-loop.md) | ToolRouter、ToolRegistry、Tool Call、Observation、follow-up sampling |
| [context-history.md](./context-history.md) | model-visible history、UI transcript、normalization、compaction |
| [durability-recovery.md](./durability-recovery.md) | rollout、store、flush、resume、fork、crash window |
| [safety-permission.md](./safety-permission.md) | permission、approval、sandbox、恶意 Observation |
| [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | MCP、Plugin、Skill、Hook、Goal、Memory、Multi-agent |
| [discussion-playbook.md](./discussion-playbook.md) | 方案讨论、边界判断和 Task 决策模板 |

## 当前迁移原则

阶段 6 只迁移与有界单 Agent Loop 直接相关的不变量：

- 模型输出是请求，不是执行授权；
- Tool Call / Tool Result 必须完整配对；
- 下一轮 sampling 消费前一轮 Observation；
- Runtime 拥有最大 Sampling / Tool Call 次数；
- timeout、abort 和 limit exceeded 必须有明确终态；
- UI Message、model input、runtime event、durable Step 分层；
- 测试验证调用顺序、次数和状态。

当前不迁移 Codex 的完整 ContextManager、Rollout Recovery、Sandbox、MCP、Skills 或 Multi-agent 实现。
