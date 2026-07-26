# AI SEO Agent 学习路线

本文只维护已经完成的阶段与当前阶段。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从基础 LLM Chat 到 Session、Streaming、Agent Runtime 和最小 Tool Calling 的连续学习闭环。阶段 5 已证明：模型可以提出一次只读 Tool Call，服务端完成验证与执行，将 Observation 回填第二轮 sampling，并以 `AgentRun` / `AgentStep` 记录执行过程；同步与流式入口也已共享同一个 Runtime。

当前 Runtime 仍是一个受限特例：只向模型提供 `search_articles`，最多执行一次工具、最多进行两轮 sampling。它能完成“模型 -> 工具 -> 模型”的最小闭环，但还不能让模型根据第一步结果继续选择第二个工具，并在明确上限内自主结束一次多步骤任务。

因此，当前正在推进的阶段是：

```text
阶段 5：最小 Tool Calling（Completed）
  -> 阶段 6：有界单 Agent Loop（Active）
```

阶段 6 完成前，不预设或编号阶段 7 及之后的任务。后续方向必须根据阶段 6 的真实代码、测试、运行数据和学习结果重新决定。

## 阶段路线

| 阶段 | 状态 | 核心学习问题 | 主要产物 | 验收重点 |
| --- | --- | --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 如何完成一次基础模型问答 | 基础 Chat 链路 | 能完成一次稳定问答 |
| 阶段 2：Session Chat 持久化 | Completed | 如何保存多会话与用户可见消息 | `Conversation`、`Message` | 刷新不丢、多会话不串 |
| 阶段 3：Streaming Chat | Completed | 如何流式输出、停止生成并保证终态一致 | NDJSON stream、Abort | `done / error / aborted` 不残留错误状态 |
| 阶段 4：Agent Runtime 基础 | Completed | 如何记录一次 Agent 运行及其内部步骤 | `AgentRun`、`AgentStep`、Runtime Event | Run / Step 与外部流式协议分层 |
| 阶段 5：最小 Tool Calling | Completed | 模型如何提出一次工具调用并消费 Observation | Tool contract、Registry、`search_articles`、两轮 sampling | Tool Call、执行、Observation、第二轮回答和可靠终态 |
| [阶段 6：有界单 Agent Loop](./tasks/phase-06-bounded-agent-loop/README.md) | **Active：Task 0 已实现、待验收** | 模型如何根据 Observation 连续决定下一步，Runtime 如何限制、记录并终止循环 | 第二个只读工具、有界顺序 Loop、执行状态与回归测试 | 直接回答、一次工具、多次工具、失败、超时、Abort 和超限均有确定语义 |

## 阶段 6 学什么

阶段 6 不以“增加工具数量”为目标，也不建设通用 Agent 框架。学习重点是：

1. Tool Calling 与 Agent Loop 的区别。
2. 固定 Workflow 与模型动态决策的区别。
3. 一个 `AgentRun` 为什么可以包含多次 model sampling 与多次 Tool Execution。
4. 模型负责提出下一步动作，服务端负责验证、执行、限制和终止的职责边界。
5. 如何通过 `maxSamplingRounds`、`maxToolCalls`、timeout 和 Abort 防止无限循环。
6. 如何区分零结果、参数错误、业务失败、系统异常、超时、取消和超限。
7. 如何通过 `AgentStep` 与自动化测试还原一次多步骤执行链。
8. 如何保证最小 Context 正确性，而不提前建设复杂 Token Budget 或截断系统。

## 阶段 6 实践载体

当前阶段只增加一个与现有搜索工具形成依赖关系的只读工具：

```text
search_articles
  -> get_article_detail
```

代表性任务：

```text
查找与某个关键词相关的文章
  -> 模型根据搜索结果选择候选文章
  -> 读取该文章详情
  -> 基于真实内容输出 SEO 优化建议
```

后端不得把流程硬编码为固定的 `search -> detail -> answer`。模型根据当前目标和 Observation 选择继续或结束，服务端只提供受控能力。

## 当前任务顺序

```text
Task 0：新增 get_article_detail 只读工具（Active，Issue #25 / Draft PR #26，已实现、待验收）
  -> Task 1：有界顺序 Agent Loop（Planned）
  -> Task 2：可靠性、回归与学习验收（Planned）
```

详细入口：[`tasks/phase-06-bounded-agent-loop/README.md`](./tasks/phase-06-bounded-agent-loop/README.md)。

当前只详细编写 Task 0。Task 1、Task 2 必须等待前置 Task 验收后，再基于最新代码形成正式规格和独立 Issue。

## 当前优先级

| 优先级 | 任务 | 说明 |
| --- | --- | --- |
| P0 | 阶段 6 Task 0：新增 `get_article_detail` 只读工具 | Issue #25 / Draft PR #26；已实现、待验收 |
| P1 | 阶段 5 源码复盘 | 自由学习模式；继续巩固 Tool Calling 完整调用链，不创建 Issue、不改状态 |
| P1 | Admin Console Task 2 规划 | 可并行产品支线；若启动，需单独创建 Issue |
| P2 | 阶段 6 Task 1-2 | 等前置 Task 真实验收后再展开，不能预先标记 Active |

## 阶段 6 明确边界

| 本阶段包含 | 本阶段不包含 |
| --- | --- |
| 第二个只读详情工具 | RAG、Embedding、向量数据库 |
| 多次顺序 Sampling / Tool Execution | 写工具、Permission、Approval、HITL |
| 最大 Sampling / Tool Call 次数 | Durable Recovery、跨进程 Resume |
| Timeout、Abort、超限终止 | 并行 Tool Call、Planner、Workflow DSL |
| Tool Call / Result 配对与顺序 | 完整 ContextPlan、Token Budget、自动摘要、Compaction |
| Run / Step Trace 与行为测试 | MCP、Plugin、Skill、Multi-agent |

Context 在本阶段只保留必要正确性：合法历史、当前输入唯一、Tool pair 完整、Tool Result 作为低信任数据、实际 Token Usage 可观测。不会以“未来可能超长”为理由预建完整裁剪系统。

## Admin Console 支线

Admin Console Task 0 与 Task 1 已完成。Task 2-4 仍是可并行产品支线，不替代阶段 6 主线，也不映射为任何提前编号的后续阶段。具体状态以 [`tasks/admin-console.md`](./tasks/admin-console.md) 为准。

## 阶段 6 之后

阶段 6 完成并由用户确认收口后，再根据真实项目证据讨论下一阶段。候选能力可以来自 RAG、写工具与审批、Context、Recovery、Evaluation、MCP 等方向，但当前文档不编号、不承诺顺序，也不提前创建正式 Task。
