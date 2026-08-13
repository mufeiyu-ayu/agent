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
  -> search_articles + get_article_detail
  -> bounded sequential Agent Loop
  -> timeout / abort / database deadline / terminal reliability
  -> ModelContext Boundary
  -> model-aware Budget + Dynamic History
  -> per-sampling Context Plan + Observation Governance
  -> Admin Run Trace + Context Inspector
```

当前正式状态：

```text
阶段 1-7：Completed
Active Agent Task：无
Minimal Compaction：Gated
下一正式阶段：尚未定案
```

Context Engineering、Runtime reliability 与真实 Observability Baseline 已经建立。RAG、Permission / HITL、Durable Recovery、MCP / Skill、Planner / Workflow 和 Multi-agent 仍是候选方向，不因本知识库存在相关专题而自动排期。

## 阅读顺序

### 当前基线优先

1. [how-to-use.md](./how-to-use.md)：如何选择性使用这套资料；
2. [current-agent-baseline.md](./current-agent-baseline.md)：当前 Phase 1-7 真实能力、状态和归档指针；
3. [core-runtime.md](./core-runtime.md)：Thread / Turn / Task / Runtime loop；
4. [tool-loop.md](./tool-loop.md)：Tool Call、Observation 与 follow-up sampling；
5. [context-history.md](./context-history.md)：Context、History、normalization 与 Compaction 研究。

### 按问题查阅

| 问题 | 先看 | 当前定位 |
| --- | --- | --- |
| 有界单 Agent Loop 如何控制执行 | [core-runtime.md](./core-runtime.md)、[tool-loop.md](./tool-loop.md) | Phase 6 已实现，资料用于复盘与扩展 |
| 工具结果是否进入 UI Message | [tool-loop.md](./tool-loop.md)、[context-history.md](./context-history.md) | 当前已按 UI / model / runtime / durable facts 分层 |
| Tool 失败、Abort 与终态如何收口 | [tool-loop.md](./tool-loop.md)、[durability-recovery.md](./durability-recovery.md) | Phase 6 已建立同步执行可靠性；跨进程恢复未实现 |
| Context 长度、History 与 Observation 如何治理 | [context-history.md](./context-history.md) | Phase 7 已建立 Budget / Selection / Inspector；Compaction Gated |
| RAG / Retrieval 如何进入 Agent | [context-history.md](./context-history.md)、[how-to-use.md](./how-to-use.md) | 候选方向，尚未进入正式 Task |
| 如何做跨进程恢复 | [durability-recovery.md](./durability-recovery.md) | 研究资料，未排期 |
| 写操作工具如何保护 | [safety-permission.md](./safety-permission.md) | 研究资料，未排期 |
| 什么时候做 MCP / Multi-agent | [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | 明确后置，需证明真实必要性 |
| 如何把讨论变成正式 Task | [discussion-playbook.md](./discussion-playbook.md) | 规格与决策辅助 |

## 文档索引

| 文件 | 核心用途 |
| --- | --- |
| [how-to-use.md](./how-to-use.md) | 后续 GPT / 用户如何使用本知识库 |
| [source-snapshot.md](./source-snapshot.md) | 源码快照、取证方法和路径地图 |
| [current-agent-baseline.md](./current-agent-baseline.md) | 当前项目真实能力、状态与近期缺口 |
| [core-runtime.md](./core-runtime.md) | 产品入口、协议、Thread、Turn、Task、Runtime loop |
| [tool-loop.md](./tool-loop.md) | ToolRouter、ToolRegistry、Tool Call、Observation、follow-up sampling |
| [context-history.md](./context-history.md) | model-visible history、UI transcript、normalization、compaction |
| [durability-recovery.md](./durability-recovery.md) | rollout、store、flush、resume、fork、crash window |
| [safety-permission.md](./safety-permission.md) | permission、approval、sandbox、恶意 Observation |
| [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | MCP、Plugin、Skill、Hook、Goal、Memory、Multi-agent |
| [discussion-playbook.md](./discussion-playbook.md) | 方案讨论、边界判断和 Task 决策模板 |

## 当前迁移原则

当前项目已经迁移并验证的核心不变量：

- 模型输出是请求，不是执行授权；
- Tool Call / Tool Result 必须完整配对并保持顺序；
- 下一轮 sampling 消费前一轮 Observation；
- Runtime 拥有最大 Sampling / Tool Call 次数、deadline、Abort 与终态；
- UI Message、model input、runtime event、provider continuation 与 durable Step 分层；
- model-visible Context 受模型容量、应用输入上限、输出预留和安全余量共同约束；
- History、Tool / Retrieval 数据按来源与信任级别进入 Context，无法安全组装时 fail closed；
- Context 与执行决策通过安全元数据和 Inspector 观察，不暴露 Prompt、reasoning 或 raw Tool payload；
- 新能力必须由真实问题、前置条件和可验收边界驱动。

当前不自动迁移 Codex 的完整 Rollout Recovery、Sandbox、MCP、Skills、Planner、Multi-agent 或自动 Compaction 实现。
