# 阶段 6：Context Engineering 基础

- 阶段状态：**Next（已规划，待正式启动）**
- 决策日期：2026-07-26
- 当前执行入口：Task 0
- 实施状态：未开始
- 验收状态：未验收
- GitHub 状态：Issue / 分支 / PR 均未创建

## 阶段定位

阶段 5 已完成最小 Tool Calling 闭环：模型提出 Tool Call，服务端验证并执行工具，Observation 回填第二轮 sampling，最终回答通过同步或流式接口返回，并由 `AgentRun` / `AgentStep` 记录运行事实。

阶段 6 不继续堆叠工具数量，也不提前进入 RAG 或 Human-in-the-loop，而是解决模型输入开始失控的问题：

```text
UI transcript / current input / Tool facts / business prompt
  -> eligibility + normalization
  -> source priority + budget
  -> include / truncate / exclude decisions
  -> ContextPlan
  -> shared Agent Runtime sampling
```

本阶段要把“固定读取最近若干条消息并直接交给 prompt builder”的隐式行为，升级成一套合法、可解释、可测试、受预算约束的 model-visible Context 投影机制。

## 为什么现在做

当前代码已经具备：

- `Message` 持久化和会话 history；
- `ModelInputItem` 对 message、assistant Tool Call、Tool Result 的基础表达；
- `SeoContextBuilder` 独立边界；
- Tool Observation 的受控输出和 8,000 Unicode code point 上限；
- 同步与流式 SEO Chat 共用唯一 `AgentRuntimeService.runTurnStream()`。

但仍存在以下缺口：

- `SeoService` 仍使用固定 `CHAT_HISTORY_LIMIT = 12`；
- history 查询没有统一的 `MessageStatus` eligibility 策略；
- 当前用户输入、旧 history 和当前 Tool Observation 尚未作为不同优先级来源建模；
- Context 构造结果只有输入数组，没有预算报告、来源决策和裁剪原因；
- Tool Observation 虽有单条字符上限，但第二轮 sampling 没有整体 token budget；
- UI transcript、model-visible history、runtime events、durable facts 和 telemetry 仍需明确分层。

这正是 Tool Calling 完成后、RAG / Memory / Recovery / HITL 之前需要补齐的基础。

## 学习目标

完成本阶段后，需要能够解释：

1. 为什么 UI 上显示的聊天记录不等于模型每轮实际收到的 Context。
2. Context Builder 为什么是“受约束的事实投影器”，而不是简单拼接数组。
3. system / developer instructions、当前用户输入、当前 Tool Exchange、最近完整 Turn 和旧 history 应如何分配优先级。
4. 为什么 Tool Call 与 Observation 必须保持顺序和完整配对。
5. 为什么 Tool / RAG 内容属于不可信数据，不能升级为 system prompt 或权限规则。
6. context window、completion reserve、safety margin、input limit 和 token estimate 的关系。
7. 为什么同步与流式入口必须复用同一 ContextPlan。
8. 哪些 Context 决策可以记录为安全摘要，哪些完整 prompt、工具参数和敏感内容不能持久化。

前端类比：

```text
UI transcript       ≈ 页面展示状态
Model-visible input ≈ 真正提交给模型的请求 payload
Runtime events      ≈ 流式事件与执行状态机
Durable facts       ≈ 数据库里的业务事实
ContextPlan         ≈ selector + serializer + budget report
```

## 任务看板

| Task | 状态 | 目标 | 前置 | Issue | PR | 实施状态 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Task 0：Context 基线、契约与测试夹具](./task-00-context-baseline-and-contract.md) | **Next** | 固化当前链路，建立 provider-neutral `ContextPlan` 契约与 deterministic fixtures | 阶段 5 Completed | 未创建 | 未创建 | 未开始 | 未验收 |
| [Task 1：History 资格、规范化与配对不变量](./task-01-history-normalization.md) | Planned | 明确消息状态、当前输入唯一性、顺序和 Tool pair 规则 | Task 0 Completed | 未创建 | 未创建 | 未开始 | 未验收 |
| [Task 2：Token 预算、来源优先级与安全裁剪](./task-02-budget-and-source-priority.md) | Planned | 建立 completion reserve、source priority 和整单元裁剪 | Task 1 Completed | 未创建 | 未创建 | 未开始 | 未验收 |
| [Task 3：Tool Observation 的 Context 策略](./task-03-tool-observation-context-policy.md) | Planned | 补齐来源、投影、敏感字段、token 贡献和截断原因 | Task 2 Completed | 未创建 | 未创建 | 未开始 | 未验收 |
| [Task 4：ContextPlan 接入共享 Agent Runtime](./task-04-runtime-context-plan-integration.md) | Planned | 让两轮 sampling 共用同一 Context 规则并记录安全摘要 | Task 3 Completed | 未创建 | 未创建 | 未开始 | 未验收 |
| [Task 5：Context 回归、评估与阶段收口](./task-05-regression-evaluation-and-closeout.md) | Planned | 完成长会话、异常状态、Tool Loop、同步 / 流式回归与学习验收 | Task 4 Completed | 未创建 | 未创建 | 未开始 | 未验收 |

### 状态解释

- `Next`：已经确认是下一项要创建 Issue 的正式 Task，但尚未进入实现。
- `Planned`：边界已规划，必须等待前置 Task 验收后再讨论和创建独立 Issue。
- 当前没有 `Active` Task；没有 Issue、分支或 PR 时不得写成“进行中”。
- 本次只建立规划，不创建 Issue，不修改 Agent Runtime 代码，不推进 Task 1-5。

## 最小 ContextPlan 方向

Task 0 会结合真实代码确定最终字段；阶段目标至少需要表达：

```ts
interface ContextPlan {
  items: ModelInputItem[]
  budget: {
    contextWindow: number
    completionReserve: number
    safetyMargin: number
    inputLimit: number
    estimatedInputTokens: number
  }
  sourceDecisions: Array<{
    source: string
    action: 'include' | 'truncate' | 'exclude'
    reason: string
    estimatedTokens: number
  }>
  promptVersion: string
}
```

该契约必须是项目自有、provider-neutral 的类型，不把 OpenAI、DeepSeek 或其他供应商 SDK 类型泄漏进 Runtime。

## 强制不变量

阶段 6 最终必须通过自动化测试证明：

- system / developer instructions 不会被低优先级内容挤掉；
- 当前用户输入恰好出现一次；
- 不合格状态的消息不会被当作可靠 history；
- 同一 Turn 内相对顺序稳定；
- Tool Call 在对应 Observation 之前；
- 不会保留孤立 Tool Call 或孤立 Observation；
- 超预算时按完整 Turn 或完整 call / result 单元处理，不破坏协议；
- Tool Observation 始终作为不可信 tool data，不能覆盖 system policy；
- 第一次与第二次 sampling 都受同一预算策略控制；
- 同步与流式入口对同一输入生成相同 Context 语义；
- Context 决策可解释，但日志不保存完整 prompt、secret、raw result 或 chain-of-thought。

## 明确不在本阶段

- RAG、Embedding、向量数据库、rerank、Hybrid Search。
- PDF / Word / 网页解析与知识库后台。
- 自动长期记忆、用户画像、跨会话 Memory pipeline。
- 完整自动摘要、复杂 compaction、摘要版本替换和多 worker 竞争。
- 新数据库 canonical Tool facts、跨进程 Tool Loop 重建和 resume。
- Durable execution、stale run reconciliation、幂等 key、operation receipt。
- 写操作工具、Permission、Approval API、Human-in-the-loop。
- Multi-agent、MCP、Plugin、Skill、Hook、Workflow engine。
- 为 ContextPlan 新增前端展示页面。

这些能力分别留到阶段 7、阶段 8，或出现真实非结构化检索需求后的独立阶段。

## 阶段完成条件

只有 Task 0-5 分别满足“实施状态：已实现、验收状态：已通过”，并由用户明确确认阶段收口后，阶段 6 才能标记 Completed。

阶段级验收至少包括：

- [ ] 固定最近 12 条消息不再是唯一 Context 控制规则。
- [ ] `ContextPlan` 能返回合法 model items、预算和来源决策。
- [ ] 消息状态、当前输入、Turn 顺序和 Tool pair 有确定性测试。
- [ ] Context budget 有 completion reserve、safety margin 和明确超预算行为。
- [ ] Tool Observation 的来源、截断、投影和不可信数据边界可验证。
- [ ] 同步与流式 SEO Chat 共用同一 Context 构造路径。
- [ ] 普通回答、Tool Loop、零结果、abort、timeout 和错误路径无回归。
- [ ] 用户能够沿真实调用链解释 Context Engineering 的核心职责。

## 建议源码阅读顺序

```text
1. apps/api/src/seo/seo.service.ts
2. apps/api/src/seo/seo-context-builder.service.ts
3. apps/api/src/agent-runtime/agent-runtime.service.ts
4. apps/api/src/agent-runtime/agent-runtime.types.ts
5. apps/api/src/llm/model-input.types.ts
6. apps/api/src/agent-runtime/model-sampling-decision.ts
7. apps/api/src/tools/tool-observation.ts
8. apps/api/src/tools/tool-invocation.service.ts
9. apps/api/src/agent-runtime/agent-run-recorder.service.ts
10. prisma/schema.prisma 与相邻测试
```

## 研究依据

- [`../../research/README.md`](../../research/README.md)
- [`../../research/codex-reference/current-agent-baseline.md`](../../research/codex-reference/current-agent-baseline.md)
- [`../../research/codex-reference/context-history.md`](../../research/codex-reference/context-history.md)
- [`../../research/codex-reference/how-to-use.md`](../../research/codex-reference/how-to-use.md)
- [`../../research/learning-roadmap/phase-06-context-engineering/README.md`](../../research/learning-roadmap/phase-06-context-engineering/README.md)：只作深挖参考，不直接照搬完整 summary、compaction 和 durable facts 范围。

## 下一步

下一项正式动作是围绕 [Task 0](./task-00-context-baseline-and-contract.md) 创建一个独立 Issue。Issue 创建前可以继续源码阅读与本地实验，但不得修改正式 Agent Runtime 状态或直接开始 Task 1。
