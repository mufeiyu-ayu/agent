# 路线

## 当前状态

当前状态（Active / Next / Gated）只在 [`tasks/README.md`](./tasks/README.md) 维护；顺序与触发只在 [内部数据工作台方向](./research/workbench-direction.md) 第 7 节维护。本文只写阶段、方向定案与后置清单。

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

## 学习路径

当前阶段只看 [`tasks/README.md`](./tasks/README.md)。2026-09-15 用户指定：完成当前学习后，由 AI 以 Pi 为主要参照实现云端 Agent，用户不读 Pi 代码；研究资料与架构图见 [`pi-reference/README.md`](./research/pi-reference/README.md)，每步的 Pi 素材与证明完成见 [Pi 实现 roadmap](./research/pi-reference/roadmap.md)，先后看工作台方向第 7 节。参照方法见 [`learning-method.md`](research/pi-reference/learning-method.md)。Phase 8 链路仍可按以下顺序回读：

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

## 方向定案（2026-09-05）

当时定案：不再为 runtime 寻找产品域，作品就是 runtime 本身，第一个用户是用户自己；目标是运行层技术深度、真实使用留下的问题记录、公开的设计笔记三样。当时参照 Codex 与 DeepSeek Harness。2026-09-15 后续方向更新为当前源码学习完成后由 AI 实现云端 Agent，主要参照 [Pi](./research/pi-reference/README.md)；旧Codex研究资料已按用户要求删除。参照用于对比取舍，不整包照搬。

当前能力缺口四块：Human-in-the-loop / 审批、Durable Execution / resume 与 replay、长期 Memory、成本与延迟。对应的候选子系统：

- session 事件流与 replay（append-only 日志、resume、fork、Trajectory 视图）；
- 审批门（工具执行前的 approval 与 permission preset）；
- compaction；
- 定时任务 / jobs。

它们在 [工作台方向](./research/workbench-direction.md) 第 7 节的位置：session 事件流与 replay 拆在第 2 档 R2（关页续跑）与「后」行 R1（可重建）；审批门是第 2 档 R3；compaction 与定时任务在「后」行。立项条件：真实使用卡住、源码阅读发现缺陷，或缺口被明确命中；三者都不满足时不立 Issue。候选不等于 Next，不因为“成熟项目有”就做。

2026-09-05 首批按「源码阅读发现缺陷」立项，主题是运行时健壮性：#115 模型调用零重试与 Loop 默认上限；#116 同轮「文本 + Tool Call」与多个 Tool Call 直接 FAILED；#117 DeepSeek Responses API adapter 与 Chat 并存。三件合起来是 Durable Execution 缺口的前半段（失败分类与重试单元），session 事件流与 replay 在其后。

2026-09-20 产品方向定案：合并公司 gsc 数据观测项目为内部数据工作台，固定页面是基础、agent 对话是补充，runtime 以它为唯一真实负载；OS sandbox 进第 1 档，各步触发条件具体化；定案、边界、否决项与未决见 [内部数据工作台方向](./research/workbench-direction.md)。2026-09-23 路线正文按其第 7、8 节对齐：顺序与触发只在第 7 节，本文不再维护顺序。

2026-09-20 方向变化：第二 provider 由 #142（2026-09-20 合并，模型配置入库、接入公司中转站）与 #146（2026-09-22 合并，各家族协议差异收口为 compat 表）落地，前台可选 DeepSeek 与经中转站的 GPT / Grok / Gemini，推翻工作台方向第 9 节「现在接第二模型」的否决。

2026-09-26 方向变化：用户定案删除阶段 8 的 RAG 与 Grounding 全链路（工作台短期不用，将来的知识库也不是文章检索），只留 `search_articles` 作工具模板与 `Article` 表；阶段 8 的 Completed 记录保留为历史。三步顺序与理由见 [工作台方向](./research/workbench-direction.md) 第 9 节删除记录。

2026-09-16 对照 Pi 做过度设计审查后再立三件，排在 #115 前：#118 删死代码与单实现抽象（零行为变化）、#119 历史裁剪合一、#120 抽出 `packages/ai`。`packages/ai` 提前的理由是 #115 / #117 全落在模型层；`packages/agent` 仍在 R2。2026-09-17 再立 #124 把 `packages/ai` 目录按 Pi 分层整理（单一 `types.ts`、按协议命名的 `api/`），同日合并。2026-09-18 立 #126 把 Admin Run 读模型去过度设计（删常量 / 重复 / 可信度字段与读时校验，projector 改逐字段读取，净减 5,611 行），同日合并；同日再立 #127 收敛 `packages/ai` 运行时配置（`LLMRuntimeConfig` 只剩三个必填 env 与 debug 开关，timeout 与 `max_tokens` 默认值改代码常量，删应用硬上限层与 4 个 `LLM_*` env），同日合并。其余结构性问题不单独立项，分别归 #116（重复校验、消息类型合并）、R1（debug 捕获）、R2（ModelContext 协议）。

## 当前明确后置

- 生产数据库拓扑设计；
- claim-level inline offsets；
- 在线第二模型 judge；
- PDF / Office、通用知识库；
- Agentic Retrieval、复杂 rerank / query rewrite；
- LangChain / LangGraph / 独立 Vector DB；
- DeepSeek Responses adapter（#117 Gated）；
- 登录权限 / Admin Auth / RBAC（Task 4）：2026-09-23 用户决定暂缓，API 与模型配置都是公司内部资产，现在做完整鉴权会拖慢学习节奏。触发为「第一个同事要用」（工作台第 3 档），局域网可达本身不算；此前只做低成本加固（#156）。R2/R1 的持久契约先带 owner 字段，只补字段不建 Guard；
- `web_fetch`（Gated）：2026-09-23 用户确认以后仍要做，放在工作台第 7 节「后」行；触发为用户或工作台需要读外部网页；
- 长会话首轮同步分词：会阻塞事件循环，实测 1000 条 × 约 2.4k 字符的历史要 4.6s；当前 dev 库最长的会话只有 18 条，2026-09-23 决定暂不处理。触发为真实会话超过约 200 条，或首轮 plan 超过 500ms；
- `packages/ai` / `packages/contracts` 的 src / dist 构建方式：typecheck 读 src，运行时与 api 测试读 dist，dev 期间不重建。2026-09-23 用户决定保留，只修导图描述；触发为 dist 过期造成一次真实误判；
- 并行 Tool Call；
- Memory、MCP、Multi-agent。

已移出后置：OS sandbox 于 2026-09-20 进工作台第 1 档；OpenAI / Gemini 等第二 provider 已由 #142 / #146 落地。多租户已否决（工作台方向第 9 节），不在后置清单。

## Admin Console 支线

目标与已完成基线见 [`tasks/admin-console.md`](./tasks/admin-console.md)，各任务状态只看看板。Task 4（登录 / 权限 / 脱敏）不因 Inspector 完成而自动启动，触发见上面的后置清单。

## 当前正式动作

状态看 [`tasks/README.md`](./tasks/README.md)，顺序与触发看工作台方向第 7 节；候选子系统在立项条件满足时建 Issue，走 `docs/workflow.md` 的流程。
