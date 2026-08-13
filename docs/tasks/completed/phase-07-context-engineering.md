# Phase 7：Context Engineering

状态：**Completed / 已归档**。

完成日期：2026-08-13（Asia/Shanghai）。

本文件是 Phase 7 的最终归档事实来源。详细需求、澄清、实现过程、Review 与浏览器证据继续以对应 GitHub Issue / PR、最终代码和 Git 历史为准，不在 `docs/tasks/` active 区维护第二套状态。

## 阶段目标

Phase 7 将 model-visible context 从“固定 History 条数 + 各 Tool 局部字符限制后直接拼装”升级为明确、可测试、可观察的 Context Engineering 边界，使 Runtime 能够解释：

> 当前 sampling 为什么看到这些信息、预算是多少、哪些内容被保留或排除，以及发生缩减或失败的原因。

最终运行形态：

```text
Instructions / Current User / History / Tool Exchange
                      ↓
               ModelContext Boundary
                      ↓
          model-aware Context Budget
                      ↓
 Dynamic History / Observation Governance
                      ↓
               ModelInputItem[]
                      ↓
                     LLM
                      ↓
        durable safe Context metadata
                      ↓
            Admin Context Inspector
```

## 交付记录

| 工作项 | 状态 | Issue / PR | 最终结果 |
| --- | --- | --- | --- |
| Task 0：Context Boundary & Snapshot | Completed | Issue #40 / PR #41 | 单 Run `ModelContext`、Tool Exchange 成对维护与安全 Context Snapshot；merge `415e866a` |
| Task 1：Model-aware Budget & Dynamic History | Completed | Issue #42 / PR #43 | model-aware input budget、DeepSeek V4 TokenEstimator、token-budget Dynamic History Selection；merge `6df72f0` |
| Task 2：Loop-aware Context & Observation Governance | Completed | Issue #44 / PR #45 | per-sampling Context Plan、follow-up History exclusion、Observation 双层治理与 fail-closed；merge `2f06355c` |
| Task 3：Context Inspector & Phase Baseline | Completed | Issue #46 / PR #47 | 安全 Admin Read Model、Context Inspector、领域不变量、真实 API / PostgreSQL / 浏览器证据；merge `caf3d25b` |
| Gated Follow-up：Minimal Compaction | Gated | 未创建 Issue | 当前证据不足以证明必须实现，继续作为有客观触发条件才启动的后续能力 |

## 最终建立的能力

### Context Boundary

- 使用单 Run `ModelContext` 显式维护 Instructions、当前 User、可靠 History 和 Tool Exchange；
- UI transcript、model-visible context、runtime event 与 durable AgentStep 保持分层；
- 当前 User Message 始终是 mandatory context，并以 `(createdAt, id)` 对旧 History 建立因果上界；
- Tool Call / Tool Result 按 `callId`、顺序和完整 exchange 单元进入后续 sampling；
- DeepSeek `reasoning_content` 只作为当前 Run 内部 continuation data，不进入 UI 或安全 Inspector。

### Model-aware Budget 与 Dynamic History

输入预算唯一口径：

```text
modelInputCapacity
= contextWindowTokens - resolvedMaxOutputTokens - safetyMarginTokens

resolvedInputBudgetTokens
= min(applicationInputCapTokens, modelInputCapacity)
```

当前应用基线：

```text
applicationInputCapTokens       = 262144
contextSafetyMarginTokens       = 16384
historyCandidateBatchSize       = 50
historyCandidateHardLimit       = 1000
```

- DeepSeek V4 官方 tokenizer artifact 在本地加载；估算失败时禁止静默降级；
- History 通过 keyset pagination 读取可靠 `COMPLETED` 候选；
- 最终选入由 token budget 决定，不再以固定 40 条作为主要 Context 策略；
- 选择以最近消息优先，并保持整条 Message，不在 Message 内部任意截断；
- mandatory context 已超预算时在 Provider 调用前 fail closed。

### Loop-aware Context Governance

- 每轮 sampling 前重新执行完整请求估算；
- Context 不足时先排除最旧 initial History，再缩减较旧 Observation；
- Tool 自身 `maxObservationChars` 和全局 hard max 继续作为 `tool_ceiling` safety net；
- Context Planner 在其上增加 `context_budget` 二次治理；
- 已提交的 History 与 Observation 调整会进入下一轮真实 `ModelContext`，不会在后续 sampling 中恢复；
- direct-final、one-tool、two-tool 的 Tool Exchange 数量分别稳定为 `0`、`0/1`、`0/1/2`；
- minimum-context overflow 与 sampling estimator failure 均在 Provider 调用前明确失败。

### Context Inspector

Admin Read Projection 只消费 durable safe metadata：

```text
AgentStep.input.initialContext
AgentStep.output.contextPlan
AgentStep.output.messageCount
AgentStep.output.contextFailureReason
```

Inspector 按 sampling 展示：

- Budget：resolved model、Context Window、input cap、output reserve、安全余量、最终 input budget、estimated usage；
- Sources：pre-plan item、Provider-facing item、History candidate / included / excluded、Tool Exchange；
- Adjustments / Outcome：initial / follow-up History exclusion、`tool_ceiling`、`context_budget`、success、overflow、estimator failure；
- legacy、partial、unknown 或矛盾 metadata 安全降级为 unavailable，不使 Run Detail 500，也不把已知 Step 错误退化为 Generic。

Inspector、API、fixture 和截图不暴露：

- 完整 system / developer instructions；
- 完整 Prompt 或 Conversation Context dump；
- `reasoning_content`；
- raw Tool arguments；
- 完整 Tool Result / Observation 或被裁掉的原文；
- tokenizer raw cause、secret 或 credential。

## Task 3 最终验收证据

最终 PR #47 head：`e0eaa33e449486a5b30a0a87ba654460fe62fbaf`。

Merge commit：`caf3d25b7af0e5b30ae47d3c96faab4138fbdb9e`。

```text
Context tests       24 / 24
Tool Loop tests      52 / 52
Model Stream tests   65 / 65
Admin Run tests      22 / 22
Admin checks          3 / 3

API build             PASS
API typecheck         PASS
API scoped lint       PASS
Admin build           PASS
Admin typecheck       PASS
Admin scoped lint     PASS
workspace typecheck   PASS
git diff --check      PASS
```

根 `pnpm lint` 仍存在 106 个既有 `docs/research/**` Markdown / 代码块 baseline 问题；本阶段改动对应的 API / Admin scoped lint 均通过。仓库未配置该 head 的 GitHub Actions status checks，上述数量来自 Codex 本地验证记录，GPT 已结合最终 PR diff、测试内容、Codex Review 与浏览器证据完成技术验收，用户已明确确认验收和合并。

GPT Review 发现的 Context metadata 领域不变量问题已在最终 head 修复：

- initial budget 必须满足 Runtime 唯一公式；
- Observation chars 与 truncation flags 必须一致；
- fail-closed outcome 的 Provider item 必须为 `0`；
- two-tool pre-plan / Provider 序列为 `4 / 6 / 7` 与 `4 / 5 / 7`；
- History、Tool Exchange 与已提交 Observation 按 sampling 单调演进；
- 矛盾 metadata 只降级 Inspector。

最终独立 Codex Review 针对 `e0eaa33e44` 未发现新的主要问题。

浏览器证据位于：

- `docs/assets/admin-console/phase-07-context-inspector/direct-final-light.png`
- `docs/assets/admin-console/phase-07-context-inspector/one-tool-sampling-2-light.png`
- `docs/assets/admin-console/phase-07-context-inspector/two-tool-sampling-1-light.png`
- `docs/assets/admin-console/phase-07-context-inspector/two-tool-sampling-2-history-tool-ceiling-light.png`
- `docs/assets/admin-console/phase-07-context-inspector/two-tool-sampling-3-context-budget-dark.png`
- `docs/assets/admin-console/phase-07-context-inspector/legacy-unavailable-dark.png`
- `docs/assets/admin-console/phase-07-context-inspector/unknown-generic-dark.png`
- `docs/assets/admin-console/phase-07-context-inspector/loading-dark.png`
- `docs/assets/admin-console/phase-07-context-inspector/api-error-retry-dark.png`
- `docs/assets/admin-console/phase-07-context-inspector/retry-success-dark.png`

## Phase 7 最终不变量

- Context Window 是容量上限，不是使用目标；
- current User、Instructions 和 Tool Call / Result pairing 不因预算不足被破坏；
- History 只能从可靠、因果上更早的 Message 中选择；
- Tool / Retrieval 数据始终是低信任 Context；
- 每轮 Provider 请求都先完成完整估算和 Context Plan；
- Context 调整只能单调收缩，不能在后续 sampling 中恢复被排除或裁掉的数据；
- 无法安全组装请求时 fail closed，不伪造正常 sampling；
- durable metadata 与 Admin Read Model 分层，UI 不解析 Prisma JSON；
- Context Inspector 解释决策结果，不成为 Prompt / reasoning viewer；
- 外部 Chat / NDJSON、Conversation / Message 产品语义与 Prisma schema 未因本阶段改变。

## 已接受的能力边界

以下不是 Phase 7 缺陷，而是明确后置能力：

- Summary / Compaction；
- RAG、Embedding、Hybrid Retrieval；
- 长期 Memory；
- Permission / Approval / Human-in-the-loop；
- Durable Recovery / Resume；
- MCP、Plugin、Skill、Hook；
- Planner / Workflow DSL、并行 Tool Call；
- Multi-agent；
- Prompt / reasoning viewer、Context replay / edit / resend。

Minimal Compaction 继续保持 `Gated`。只有真实 Inspector 数据证明旧 Context 被频繁驱逐并造成任务连续性、质量、成本或延迟问题时，才另建正式 Task / Issue。

## 阶段收口

Phase 7 已完成 GPT 技术验收、用户确认验收，并通过 PR #47 合入 `master`；Issue #46 与 PR #47 均已关闭。

当前 Agent 主线状态：

```text
阶段 1-7：Completed
Active Agent Task：无
Minimal Compaction：Gated
下一阶段：尚未定案
```

后续必须基于最新 `master`、真实产品需求和学习收益重新比较 RAG、HITL、Recovery、MCP / Skill、Workflow / Planner、Multi-agent 等候选方向；任何候选都不会因为研究资料已经存在而自动进入正式实现。
