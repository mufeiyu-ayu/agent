# 阶段 6：有界单 Agent Loop

- 阶段状态：**Active**
- 决策日期：2026-07-26
- 当前执行入口：Task 1（Next，待编写正式规格）
- 实施状态：进行中
- 验收状态：未验收
- GitHub 状态：Task 0 已通过 Issue #25 / PR #26 完成；横向配置治理已通过 Issue #27 / PR #28 完成；Task 1 尚未创建 Issue

## 阶段定位

阶段 5 已完成最小 Tool Calling：模型提出一次 Tool Call，服务端验证并执行，将 Observation 回填第二轮 sampling，随后模型必须给出最终答案。

当前实现本质上仍是固定上限的特殊流程：

```text
sampling #1
  -> final answer
  或
  -> 一次 tool call
       -> observation
       -> sampling #2
       -> final answer
```

阶段 6 要把它升级为一个生命周期完整、能力边界受控的单 Agent Loop：

```text
用户目标
  -> model sampling
  -> final answer ? --------> 完成 Run
  -> tool call
       -> 服务端校验并执行
       -> append observation
       -> 再次 model sampling
       -> 继续或结束
```

“完整”指成功、失败、取消和超限路径都有确定语义；“有界”指模型不能无限调用模型或工具。本阶段不建设通用 Agent Framework。

## 已完成前置

### Task 0：第二个只读工具

Issue #25 / PR #26 已完成：

- Tool 目录整理为 `tools/core/ + tools/articles/`；
- 新增 `get_article_detail`；
- 全局 Registry 与当前 Run allowlist 分层；
- 当前 Runtime 仍只向模型暴露并允许执行 `search_articles`。

### 横向运行参数治理

Issue #27 / PR #28 已完成：

```text
用户消息上限：64K 字符
合格历史：最近 40 条 COMPLETED
DeepSeek Profile：1M context / 384K provider max output
应用输出：65,536 默认 / 131,072 硬上限
请求超时：metadata 10s / chat 60s / stream 10min
Search excerpt：500 字符
Observation：Search 16K / Detail 64K / 全局硬上限 128K
```

这项横向任务不占用 Phase 6 Task 编号，也没有实现 Agent Loop、TokenEstimator、自动裁剪或 Compaction。

## 核心学习目标

完成阶段 6 后，需要能够解释并用代码证明：

1. Tool Calling 是一次模型动作协议，Agent Loop 是反复决策、行动和观察的运行机制。
2. 固定 Workflow 由代码预先决定步骤；Agent 的下一步由模型根据 Observation 动态选择。
3. 一个 `AgentRun` 可以包含多次 `model_sampling` 和多次 `tool_execution`。
4. 模型只负责提出下一步动作；服务端拥有工具查找、参数校验、风险判断、执行和终止权。
5. `maxSamplingRounds`、`maxToolCalls`、tool timeout、Run deadline 和 Abort 分别解决什么问题。
6. 零结果、资源不存在、参数错误、工具业务失败、系统异常、超时、取消和超限如何区分。
7. 为什么 Tool Call 与 Tool Result 必须按 `callId` 配对并保持实际发生顺序。
8. 如何测试 Agent 的工具顺序、调用次数、终止状态和最终答案来源，而不只检查 HTTP 200。

## 实践场景

本阶段使用两个有依赖关系的只读工具：

```text
search_articles
get_article_detail
```

代表性任务：

```text
查找与某关键词相关的文章，
选择最相关的一篇，
读取完整详情，
然后给出 SEO 优化建议。
```

允许的执行路径包括：

```text
sampling #1 -> final answer
sampling #1 -> search_articles -> sampling #2 -> final answer
sampling #1 -> search_articles -> sampling #2 -> get_article_detail -> sampling #3 -> final answer
```

Runtime 不得硬编码模型必须按照固定顺序使用两个工具。模型可以根据目标和 Observation 选择继续或结束，服务端只提供受控能力。

## 任务看板

| Task | 状态 | 目标 | 详细文档 | 前置 | Issue | PR |
| --- | --- | --- | --- | --- | --- | --- |
| Task 0：新增 `get_article_detail` 只读工具 | **Completed** | 建立第二个与搜索结果有依赖关系的只读动作 | [task-00-get-article-detail-tool.md](./task-00-get-article-detail-tool.md) | 阶段 5 Completed | [#25（Closed）](https://github.com/mufeiyu-ayu/agent/issues/25) | [#26（Merged）](https://github.com/mufeiyu-ayu/agent/pull/26) |
| 横向前置：运行参数与模型配置治理 | **Completed** | 统一模型能力、应用策略、历史和 Observation 预算 | [../runtime-configuration-governance.md](../runtime-configuration-governance.md) | Task 0 Completed | [#27（Closed）](https://github.com/mufeiyu-ayu/agent/issues/27) | [#28（Merged）](https://github.com/mufeiyu-ayu/agent/pull/28) |
| Task 1：有界顺序 Agent Loop | **Next** | 将固定两轮逻辑升级为服务端受控的多轮循环 | 待基于最新 `master` 编写 | 前置均 Completed | 未创建 | 未创建 |
| Task 2：可靠性、回归与阶段验收 | Planned | 覆盖失败、超时、Abort、超限、Trace 和学习复盘 | 前置完成后再编写 | Task 1 Completed | 未创建 | 未创建 |

## 为什么 Task 1 现在才展开

Task 1 依赖两个 Article Tool、Registry 注册方式、模型 Tool Spec、Runtime allowlist、有效历史策略、Model Profile 和分级 Observation 预算。Task 2 又依赖 Task 1 暴露出的真实失败路径。

这些前置已经完成，因此下一步应读取最新 `master`，编写 Task 1 的正式规格并创建独立 Issue。当前只把 Task 1 标记为 `Next`，在独立 Issue 和 Clarification Gate 完成前不得进入实现。

## 阶段级强制不变量

阶段 6 最终必须由自动化测试证明：

- 模型可以直接回答，不会被强迫调用工具；
- 模型可以执行一次或多次顺序 Tool Call；
- 每轮最多处理一个 Tool Call，不支持并行执行；
- Sampling 和 Tool Call 数量均由服务端硬上限控制；
- 达到上限时明确终止，不能伪装成正常完成；
- Tool Call 在对应 Tool Result 之前，且 `callId` 完整配对；
- 当前用户输入恰好出现一次；
- `PENDING / STREAMING / FAILED / ABORTED` 不会被当作可靠历史；
- Tool Result 始终是低信任 tool data，不能覆盖 system policy；
- 工具零结果和资源不存在可以成为模型可见 Observation；
- 工具系统异常、timeout、Abort 和 loop limit 有不同终态语义；
- `AgentRun` 与所有已开始 `AgentStep` 最终状态一致；
- 同步与流式接口继续共享唯一 `AgentRuntimeService.runTurnStream()`；
- UI `Message` 只保存用户可见输入和最终 Assistant 内容，不保存内部 Tool Exchange；
- 测试验证调用链、次数和状态，不对随机模型文案做脆弱逐字断言。

## 最小执行策略方向

Task 1 的最终数值由对应 Issue 和 Clarification Gate 确认，但第一版应保持以下边界：

```ts
interface AgentLoopPolicy {
  maxSamplingRounds: number
  maxToolCalls: number
  toolTimeoutMs: number
  runDeadlineMs?: number
}
```

原则：

- 单 Agent；
- 顺序执行；
- 每轮最多一个 Tool Call；
- 不自动并行；
- 不允许模型绕过服务端上限；
- 不因为达到上限就生成伪造的成功答案。

## DeepSeek continuation 前置约束

Task 1 必须处理 DeepSeek thinking mode 下的多轮 Tool Calling continuation：

- 采集 Provider 返回的 `reasoning_content`；
- Tool Call 后的下一次 sampling 按 Provider 要求完整续传；
- 不把 `reasoning_content` 暴露给 UI；
- 不将其保存为普通用户可见 Message；
- 不通过关闭 thinking mode 回避协议要求。

具体数据结构、生命周期和持久化边界由 Task 1 Issue 与 Clarification Gate 确认。

## Context 在本阶段的位置

本阶段只处理 Agent Loop 必需的输入正确性：

- 有效历史消息；
- 当前用户输入恰好一次；
- 多个 Tool Call / Tool Result 按实际顺序追加；
- Tool pair 完整；
- Tool Result 保持低信任数据身份；
- 继续记录 Provider 返回的实际 Token Usage。

本阶段不实现：

- 通用 `ContextPlan`；
- TokenEstimator；
- completion reserve / safety margin；
- Source Priority Engine；
- 自动按 Token 删除历史；
- 自动摘要或 Compaction；
- 长期 Memory。

## 明确不在本阶段

- RAG、Embedding、向量数据库和文档知识库；
- 写操作工具、Permission、Approval 和 Human-in-the-loop；
- Durable Recovery、跨进程 Resume、队列和后台长任务；
- 并行 Tool Call、显式 Planner、Workflow DSL；
- MCP、Plugin、Skill、Hook 和 Multi-agent；
- 通用 Agent Framework 或 LangGraph 类抽象层；
- 阶段 7 及之后的任务规划。

## 阶段完成条件

只有 Task 0-2 依次实现、通过 GPT 技术验收并由用户确认后，阶段 6 才能标记 Completed。

阶段级验收至少包括：

- [x] `get_article_detail` 可通过统一 Tool Contract、Registry 和 Invocation 安全执行；
- [x] 运行参数、模型 Profile、合格历史和分级 Observation 预算已完成治理；
- [ ] Runtime 不再依赖固定 `[1, 2]` sampling 特例；
- [ ] 直接回答、一次工具和 `search -> detail -> final` 均可完成；
- [ ] 零结果、资源不存在、参数无效、工具失败、timeout、Abort 和超限均有测试；
- [ ] Run / Step 顺序和终态可从数据库记录还原；
- [ ] 同步与流式入口行为一致；
- [ ] 用户可以不看文档解释 Agent Loop、执行预算、状态机和错误语义；
- [ ] 用户确认阶段收口后，再重新讨论下一学习方向。

## 建议源码阅读顺序

```text
1. apps/api/src/agent-runtime/agent-runtime.service.ts
2. apps/api/src/agent-runtime/agent-runtime.types.ts
3. apps/api/src/agent-runtime/agent-runtime.policy.ts
4. apps/api/src/agent-runtime/model-sampling-decision.ts
5. apps/api/src/llm/model-profiles.ts
6. apps/api/src/llm/llm-runtime-config.ts
7. apps/api/src/tools/articles/search-articles.tool.ts
8. apps/api/src/tools/articles/get-article-detail.tool.ts
9. apps/api/src/tools/core/tool.types.ts
10. apps/api/src/tools/core/tool-registry.service.ts
11. apps/api/src/tools/core/tool-invocation.service.ts
12. apps/api/src/tools/core/tool-observation.ts
13. apps/api/src/agent-runtime/agent-run-recorder.service.ts
14. prisma/schema.prisma 与相关测试
```

## 研究依据

- [`../../research/codex-reference/core-runtime.md`](../../research/codex-reference/core-runtime.md)：`run_turn`、`needs_follow_up`、有界 sampling loop；
- [`../../research/codex-reference/tool-loop.md`](../../research/codex-reference/tool-loop.md)：Tool Call、Observation 与 follow-up sampling；
- [`../../research/codex-reference/context-history.md`](../../research/codex-reference/context-history.md)：Tool pair、低信任数据和输入分层不变量；
- [`../../research/codex-reference/how-to-use.md`](../../research/codex-reference/how-to-use.md)：只迁移当前业务需要且可验证的最小能力。

## 下一步

读取最新 `master`，为 Task 1 编写正式规格并创建独立 Issue。当前不创建 Task 2 的 Issue，也不开始修改 Runtime Loop。