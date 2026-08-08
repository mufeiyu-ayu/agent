# AI SEO Agent 学习路线

本文只维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从基础 LLM Chat 到 Session、Streaming、Agent Runtime、最小 Tool Calling 的连续学习闭环。当前处于阶段 6 `有界单 Agent Loop`。

Task 1 已建立核心 Agent Loop：Runtime 由服务端 policy 控制 sampling、Tool Call 与终止；当前 Run 可动态使用 `search_articles` 和 `get_article_detail`，并支持 DeepSeek thinking Tool Call continuation。

当前状态：

```text
阶段 1-5：Completed
阶段 6：有界单 Agent Loop（Active）
  Task 0：Completed
  横向配置治理：Completed
  Task 1：Completed（Issue #29 / PR #30，等待合并）
  Task 2：Next（PR #30 合并后再创建正式 Issue）
```

## 阶段路线

| 阶段 | 状态 | 核心能力 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答 |
| 阶段 2：Session Chat 持久化 | Completed | Conversation / Message 持久化 |
| 阶段 3：Streaming Chat | Completed | NDJSON 流式输出、Abort 与终态一致性 |
| 阶段 4：Agent Runtime 基础 | Completed | `AgentRun` / `AgentStep` 与 Runtime Event |
| 阶段 5：最小 Tool Calling | Completed | 单次 Tool Call、Observation 与第二轮 sampling |
| [阶段 6：有界单 Agent Loop](./tasks/phase-06-bounded-agent-loop/README.md) | **Active** | 多轮顺序决策、执行预算、终止语义与 Agent 行为测试 |

## 阶段 6 已建立

- 第二个只读 Article Tool：`get_article_detail`；
- Tool 基础设施与 Article 业务工具分层；
- 用户输入、历史、模型 Profile、输出、timeout 与 Observation 预算治理；
- policy 驱动的 bounded sequential Agent Loop；
- 默认 `3` 次 sampling / `2` 次 Tool Call / `600s` Run deadline；
- `search_articles` 与 `get_article_detail` Run allowlist；
- DeepSeek `reasoning_content` continuation 与非 null assistant Tool Call content；
- direct final、一次 Tool、两次顺序 Tool、超限、deadline、Abort 与终态测试。

## 当前执行顺序

```text
Task 0：get_article_detail（Completed）
  -> 横向配置治理 Issue #27（Completed）
  -> Task 1：有界顺序 Agent Loop（Completed；PR #30 等待合并）
  -> Task 2：可靠性、回归与阶段学习验收（Next）
```

Task 2 尚未启动。PR #30 合并到 `master` 后，再基于最新代码编写正式规格、创建独立 Issue 并执行 Clarification Gate。

## Task 2 已知输入

Task 1 最新 Review 确认了一个后续可靠性问题：Run deadline 当前能主动取消 model sampling / Tool Execution，但 Prisma query、transaction 与 Recorder 数据库等待还没有统一的 query/statement timeout 和剩余预算传播。该问题不阻塞 Task 1，但必须作为 Task 2 的正式输入。

## 阶段 6 边界

| 本阶段包含 | 本阶段不包含 |
| --- | --- |
| 顺序 Agent Loop 与 Tool Execution | 并行 Tool Call、Planner、Workflow DSL |
| Sampling / Tool Call / Run 执行预算 | Durable Recovery、跨进程 Resume |
| Tool Call / Result 配对与顺序 | 完整 ContextPlan、自动摘要、Compaction |
| Timeout、Abort、超限终止 | 写工具、Permission、Approval、HITL |
| Run / Step Trace 与行为测试 | RAG、Embedding、Memory |
| DeepSeek thinking continuation | MCP、Plugin、Skill、Multi-agent |

## Admin Console 支线

Admin Console Task 0-1 已完成，Task 2-4 仍为 Planned。它是可并行产品支线，不替代阶段 6 主线。具体状态见 [`tasks/admin-console.md`](./tasks/admin-console.md)。

## 阶段 6 之后

阶段 6 完成并由用户确认收口后，再根据真实项目证据选择下一学习方向。当前不预设阶段 7 及之后的编号或正式任务。
