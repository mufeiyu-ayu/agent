# 路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前状态

```text
阶段 1-8：Completed
Active Agent Task：无
Next / Planned：#119 历史裁剪合一 → #120 packages/ai → #115 模型调用重试 → #116 同轮文本 + 多 Tool Call → #117 Responses adapter → web_fetch（#118 删死代码已于 2026-09-17 合并）
方向：runtime 深化（2026-09-05 定案）
当前阶段：源码阅读
候选子系统：session 事件流与 replay、审批门、compaction、定时任务
翻译质检站：已删除（#113）
Admin Observability：Task 0-3、Enhancement 1-3、Phase 8 Task 3C、#98 Completed
Admin Task 4：Planned
```

## 阶段路线

| 阶段 | 状态 | 核心能力 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答 |
| [阶段 2：Session Chat 持久化](./tasks/completed/phase-02-agent-chat-session.md) | Completed | Conversation / Message 持久化 |
| [阶段 3：Streaming Chat](./tasks/completed/phase-03-streaming-closeout.md) | Completed | NDJSON、Abort 与终态一致性 |
| [阶段 4：Agent Runtime 基础](./tasks/completed/phase-04-agent-runtime.md) | Completed | AgentRun / AgentStep 与 Runtime Event |
| [阶段 5：最小 Tool Calling](./tasks/completed/phase-05-tool-calling.md) | Completed | Tool Call、Observation、follow-up sampling |
| [阶段 6：有界单 Agent Loop](./tasks/completed/phase-06-bounded-agent-loop.md) | Completed | bounded loop、DeepSeek continuation、deadline、终态可靠性 |
| [阶段 7：Context Engineering](./tasks/completed/phase-07-context-engineering.md) | Completed | ModelContext、budget、history、Observation governance、Context Inspector |
| [阶段 8：Grounded Retrieval / RAG Baseline](./tasks/completed/phase-08-grounded-retrieval.md) | **Completed** | Evaluation、Chunk / Index、Hybrid Retrieval、Agent Tool、Grounded Answer、Web Sources、Admin Inspector |

## 关键工程认知

1. RAG 不是“把向量数据库接上模型”，而是索引、检索、低信任 Context、引用校验和可观察性的完整系统。
2. Embedding profile、Chunk identity 和 active index 必须版本化。
3. nearest candidate 不等于答案存在；no-answer false positive 不能靠拍脑袋阈值掩盖。
4. Tool Observation 是低信任输入，不能进入 system policy 层。
5. Citation identity validation 只证明来源身份，不证明每个断言真实。
6. UI、model-visible history、durable Grounding 与 Admin trace 必须分层。
7. fail-closed 的价值不仅是安全，也用于阻止损坏数据被展示成“完整成功”。

## 当前学习阶段

当前继续本项目源码阅读。2026-09-15 用户指定：完成当前学习后，由 AI 以 Pi 为主要参照实现云端 Agent，用户不读 Pi 代码；研究资料、架构图和实现顺序见 [`pi-reference/README.md`](./research/pi-reference/README.md) 与 [Pi 实现 roadmap](./research/pi-reference/roadmap.md)。研究准备不改变 #115 → #116 → #117 的正式顺序。参照方法见 [`learning-method.md`](research/pi-reference/learning-method.md)。Phase 8 链路仍可按以下顺序回读：

```text
索引入口
  -> Chunking / sourceHash / profile
  -> Gemini Embedding / pgvector
  -> lexical / vector / RRF
  -> retrieve_article_context@1
  -> Tool Observation / Context Planner
  -> Grounding Session / Evidence Registry
  -> finalization / Citation validation
  -> Stream / Messages API
  -> Web Source UI
  -> Admin Retrieval Inspector
```

该阶段属于阅读、讨论和本地实验模式，默认不创建 Issue、不修改正式状态。

学习出口（「代码完成」与「学习已验证」是两种状态，后者不由前者自动推出，也不用百分比表示）：

1. 不看代码，用自己的话讲清一次运行的控制权、持久状态与失败路径；
2. AI 给方案前，先预测一个边界场景的结果；
3. 独立完成一个小而关键的状态或测试改动，再交 AI review；
4. 处理一个原任务里没见过的故障，说明为什么选当前修法而不是更重的方案。

## 方向定案（2026-09-05）

当时定案：不再为 runtime 寻找产品域，作品就是 runtime 本身，第一个用户是用户自己；目标是运行层技术深度、真实使用留下的问题记录、公开的设计笔记三样。当时参照 Codex 与 DeepSeek Harness。2026-09-15 后续方向更新为当前源码学习完成后由 AI 实现云端 Agent，主要参照 [Pi](./research/pi-reference/README.md)；旧Codex研究资料已按用户要求删除。参照用于对比取舍，不整包照搬。

当前能力缺口四块：Human-in-the-loop / 审批、Durable Execution / resume 与 replay、长期 Memory、成本与延迟。对应的候选子系统：

- session 事件流与 replay（append-only 日志、resume、fork、Trajectory 视图）；
- 审批门（工具执行前的 approval 与 permission preset）；
- compaction；
- 定时任务 / jobs。

立项条件：真实使用卡住、源码阅读发现缺陷，或缺口被明确命中；三者都不满足时不立 Issue。候选不等于 Next，不因为“成熟项目有”就做。

2026-09-05 首批按「源码阅读发现缺陷」立项，主题是运行时健壮性：#115 模型调用零重试与 Loop 默认上限；#116 同轮「文本 + Tool Call」与多个 Tool Call 直接 FAILED；#117 DeepSeek Responses API adapter 与 Chat 并存。三件合起来是 Durable Execution 缺口的前半段（失败分类与重试单元），session 事件流与 replay 在其后。

2026-09-16 对照 Pi 做过度设计审查后再立三件，排在 #115 前：#118 删死代码与单实现抽象（零行为变化）、#119 历史裁剪合一、#120 抽出 `packages/ai`。`packages/ai` 提前的理由是 #115 / #117 全落在模型层；`packages/agent` 仍在 R2。其余结构性问题不单独立项，分别归 #116（重复校验、消息类型合并）、R1（debug 捕获）、R2（ModelContext 协议）。

## 当前明确后置

- 生产数据库拓扑设计；
- claim-level inline offsets；
- 在线第二模型 judge；
- PDF / Office、通用知识库、多租户 ACL；
- Agentic Retrieval、复杂 rerank / query rewrite；
- LangChain / LangGraph / 独立 Vector DB；
- OpenAI / Gemini 双 active provider；
- Admin Auth / RBAC Task 4；
- 并行 Tool Call；
- OS sandbox；
- Memory、MCP、Multi-agent。

多租户 ACL 与 Admin Auth 的触发条件：第一个外部写，或第一次把真实数据开放给第二个用户，先到者。在此之前 R2/R1 的持久契约先带 owner 字段，只补字段不建 Guard。

## Admin Console 支线

```text
Task 0：Admin 基础壳                    Completed
Task 1：静态 Run List / Detail          Completed
Task 2：真实 Run / Step Query API       Completed
Task 3：真实 Run Trace UI               Completed
Enhancement 1：Run Trace Workspace      Completed
Phase 8 Task 3C：Retrieval Inspector    Completed
Task 4：登录 / 权限 / 脱敏              Planned
```

Phase 8 Task 3C 已完成安全 Retrieval Inspector，但不自动启动 Task 4。

## 当前正式动作

```text
Phase 8：Completed / 已归档（docs/tasks/completed/phase-08-grounded-retrieval.md）
Active Agent Task：无
当前阶段：本项目源码阅读；后续按 pi-reference roadmap 由 AI 参照 Pi 实现云端方向
下一步：#119 → #120 → #115 → #116 → #117 依次开工（#118 已合并），之后 web_fetch；其余候选子系统在立项条件满足时建 Issue，走 docs/workflow.md 的流程
```
