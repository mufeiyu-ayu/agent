# AI SEO Agent 学习路线

本文是当前项目的路线总览。正式任务状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前判断

项目已经完成从固定字段 SEO 生成器到 Session Chat、Streaming Chat、Agent Runtime 和最小 Tool Calling 的连续迁移。阶段 5 已完成并归档：模型能够提出只读 Tool Call，后端统一验证和执行工具，将 Observation 回填第二轮 sampling，并以 `AgentRun` / `AgentStep` 记录执行过程；同步与流式 SEO Chat 也已共享唯一 Runtime。

当前新的瓶颈不是工具数量，而是模型输入仍主要依赖固定最近 12 条消息：history 状态没有统一策略，当前用户输入尚未作为独立高优先级来源建模，整体输入没有近似 token budget，第二轮 Tool Observation 只有单条字符上限。

结合当前代码和 [`docs/research/**`](./research/README.md)，下一条 Agent 主线已经重新确认为：

```text
阶段 5：最小 Tool Calling（已完成）
  -> 阶段 6：Context Engineering 基础（下一阶段）
  -> 阶段 7：Durable Facts 与 Recovery 基础
  -> 阶段 8：真实写工具 + Permission + Human-in-the-loop
  -> 阶段 9：Observability / Evaluation / Portfolio
```

阶段 6 已完成 Task 0-5 规划，但尚未创建 Issue、分支或 PR，也尚未进入代码实现。Task 0 是下一项要执行的正式任务；当前状态是 `Next`，不是 `Active`。

Admin Console Task 0 与 Task 1 已完成并通过验收。Admin 后台仍是一条可并行推进的产品支线；它不代表阶段 6 已实现，也不代表阶段 9 已经启动或完成。

## 路线调整依据

- [`research/README.md`](./research/README.md)：推荐顺序为 Tool Loop → Tool 可靠性 → Context → Durable recovery → HITL / 权限。
- [`research/codex-reference/current-agent-baseline.md`](./research/codex-reference/current-agent-baseline.md)：Tool Calling 后优先补 model-visible history、Observation budget、source / priority，不做完整 RAG 平台。
- [`research/codex-reference/context-history.md`](./research/codex-reference/context-history.md)：UI transcript、model history、runtime events、durable facts 与 telemetry 需要分层；Context budget 先从 Observation 和来源预算开始。
- [`research/codex-reference/how-to-use.md`](./research/codex-reference/how-to-use.md)：先做 Observation 截断、来源标记和 token budget，再讨论复杂 Memory、RAG 或完整 ContextManager。

旧 `research/learning-roadmap/**` 继续作为深挖材料，但不直接复制为当前任务规格；当前代码事实、最新 `codex-reference/**` 与最小可验证边界优先。

## 阶段路线

| 阶段 | 状态 | 目标 | 主要产物 | 验收重点 |
| --- | --- | --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | 已完成 | 跑通基础 LLM 调用和 Chat UI | 基础聊天链路 | 能完成一次问答 |
| 阶段 2：Session Chat 持久化 | 已完成 | 多会话、消息落库、受控 history | `Conversation`、`Message` | 刷新不丢、多会话不串 |
| 阶段 3：Streaming Chat | 已完成 | 流式输出、停止生成、最终态一致 | NDJSON stream、`ABORTED` 状态 | `done/error/aborted` 不残留 `STREAMING` |
| 阶段 4：Agent Runtime 基础 | 已完成 | 记录一次 Agent 运行过程并抽 runtime 边界 | `AgentRun`、`AgentStep`、`AgentRuntimeService`、`AgentRuntimeEvent`、`SeoContextBuilder` | 每次发送都有 run/step，runtime event 与前端协议解耦 |
| 阶段 5：最小 Tool Calling | 已完成 | 让模型请求只读工具，服务端执行并继续生成最终回答 | Tool contract / registry、`search_articles`、Tool Loop、可靠运行记录、统一 Runtime | Tool Call、Observation、第二轮 sampling、timeout / abort 与前端协议稳定 |
| [阶段 6：Context Engineering 基础](./tasks/phase-06-context-engineering/README.md) | **Next：已规划，待启动** | 把消息与 Tool facts 投影为合法、可解释、受预算约束的 model-visible Context | `ContextPlan`、history normalization、source priority、budget decisions、Observation policy、共享 Runtime 接入 | 当前输入唯一；非法状态排除；Tool pair 不拆；预算和裁剪原因可解释；同步与流式一致 |
| 阶段 7：Durable Facts 与 Recovery 基础 | 后续 | 让关键执行事实可在进程重启后重建，并处理卡死运行与副作用不确定性 | canonical execution facts、operation identity、receipt、stale run reconciliation | 崩溃后不重复副作用；未知结果可核对；终态可恢复 |
| 阶段 8：真实写工具 + Permission + Human-in-the-loop | 后续 | 在第一个真实写操作中建立权限、风险策略、审批、拒绝和继续执行语义 | write tool、policy gate、approval resource、confirm / reject / resume | 未授权不执行；拒绝可审计；确认后只执行一次；审批状态可恢复 |
| 阶段 9：Observability / Evaluation / Portfolio | 后续 | 把运行、成本、质量与错误沉淀为可调试、可评估、可展示的产品能力 | Run / Step API、Admin 真实数据、评估集、指标、错误分类、作品集文档 | 能解释一次 Agent 为什么这样运行，并用固定用例证明质量与回归 |

阶段 6 的详细任务边界见 [`tasks/phase-06-context-engineering/README.md`](./tasks/phase-06-context-engineering/README.md)。

Admin Console 的任务边界与进度以 [`tasks/admin-console.md`](./tasks/admin-console.md) 为准；Task 0-1 已 Completed，Task 2-4 均为 Planned。

## 当前优先级

| 优先级 | 任务 | 说明 |
| --- | --- | --- |
| P0 | 阶段 6 Task 0：Context 基线、契约与测试夹具 | 下一项正式主线；先创建独立 Issue 并通过 Clarification Gate，再开始实现 |
| P1 | 阶段 5 源码复盘（学习模式） | 可与 Task 0 前后衔接；按 Vue → SEO adapter → Runtime → sampling → Tool → Observation → Recorder → tests 阅读，不创建 Issue、不改正式状态 |
| P1 | Admin Console Task 2 规划 | 作为旁路线，定义只读 Run / Step 查询 API、安全 DTO 和分页筛选边界；开始前另建独立 Issue |
| P2 | 阶段 6 Task 1-5 | 只能按前置顺序逐个确认、逐个创建 Issue，不因 Task 0 启动而自动推进 |

## 阶段 6 为什么先于 HITL 和 RAG

- 当前正式工具是低风险只读查询，没有需要用户批准的真实副作用；现在做审批会变成无产品价值的“查询前确认”。
- Context 是 Tool Calling 后立即出现的工程问题：history、当前输入与 Tool Observation 已经在竞争模型窗口。
- RAG 检索结果本质上也是不可信 Context；在来源、预算、截断与 tool role 边界稳定前加入向量检索，只会把问题扩大。
- Durable Recovery 与 HITL 还需要 operation identity、幂等与可恢复事实，放在 Context 基础之后更符合当前项目成熟度。

## 阶段 6 明确边界

| 本阶段包含 | 本阶段不包含 |
| --- | --- |
| model-visible history 与 UI transcript 的边界 | RAG、Embedding、向量数据库、rerank |
| 消息状态过滤、顺序与当前输入去重 | 自动长期记忆、用户画像、Memory pipeline |
| Tool Call / Observation 配对与不可信数据边界 | 写操作工具、Permission、Approval API |
| 近似 token 预算、completion reserve、source priority | 跨进程恢复、幂等收据、Durable execution |
| include / truncate / exclude 决策与原因 | 完整自动摘要、复杂 compaction、删除原始 history |
| 第一次与第二次 sampling 共用 ContextPlan | Multi-agent、MCP、插件系统、Workflow engine |

## 现在暂不做

| 暂不做 | 原因 |
| --- | --- |
| 直接把 Admin Mock UI 接入数据库 | 需要先通过独立 Task 2 定义安全的只读 API contract |
| 新增更多只读工具 | 当前重点是把已有 Tool Loop 的 Context 边界做正确，不用工具数量代替架构掌握 |
| RAG / 向量数据库 | 当前真实需求仍是结构化 Tool Calling；先稳定 Context 投影、预算和不可信 Observation 边界 |
| 完整 ContextManager、自动摘要与复杂 compaction | 阶段 6 MVP 先完成 deterministic normalization 和预算策略；摘要质量、版本与恢复语义后置 |
| 写操作工具与 HITL | 当前没有值得审批的真实副作用；先完成 Context，再补 durable facts，最后围绕真实写工具设计审批 |
| Multi-agent | 尚无单 Agent 无法解决且值得引入角色协作成本的真实问题 |
| MCP / 插件系统 | 先掌握内置工具、Context、权限与执行事实边界 |
| OS sandbox | 当前不执行 shell，不需要 Codex 级 sandbox |
| WebSocket 多路复用 | NDJSON 已满足当前交互式流式任务 |
