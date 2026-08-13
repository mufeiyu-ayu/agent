# Phase 7：Context Engineering

状态：**Active / Task 0-1 Completed / Task 2 已实现待验收 / Draft PR #45**。

本阶段已经由 GPT 与用户确认作为 Phase 6 之后的 Agent 主线。Task 0 `Context Boundary & Snapshot` 与 Task 1 `Model-aware Budget & Dynamic History` 均已完成 GPT 技术验收、用户确认验收并合入 `master`。Task 2 `Loop-aware Context & Observation Governance` 已按 Issue #44 实现，当前等待技术验收；Task 3 未启动。

## 1. 阶段目标

Phase 7 不追求“尽可能把模型 Context Window 塞满”，而是建立一层明确、可测试、可观察的 model-visible context 治理能力，让系统能够回答：

> 这一轮模型为什么看到这些信息，而不是另外一些信息？

阶段结束时，当前 Agent 应从“History、Tool Observation、Prompt 各自维护局部限制后直接拼模型输入”，升级为：

```text
Instructions / Current User / History / Tool Exchange
                      ↓
               Context Boundary
                      ↓
          model-aware Context Budget
                      ↓
        selection / assembly / normalization
                      ↓
               ModelInputItem[]
                      ↓
                     LLM
```

核心目标：

- 明确 `UI transcript`、`model-visible context`、`runtime events`、`durable AgentStep` 的职责边界；
- 让 `ModelProfile.contextWindowTokens` 真正参与输入预算，而不是只作为静态元数据；
- 把固定 `historyLimit = 40` 从主要 Context 策略降级为候选读取 / 安全保护边界，历史选择由 Context Budget 决定；
- 让多轮 sampling 中新增的 Tool Call / Tool Result 进入统一 Context 管理；
- 保持 Tool Call / Result 配对、顺序和低信任数据边界；
- 让字符级硬截断继续保留为最后一道 safety net，而不是主要 Context 决策机制；
- 为 Admin Console 建立安全的 Context Inspector，只展示预算、来源、选入 / 排除 / 截断等元数据，不暴露完整 Prompt、reasoning 或敏感 Tool payload。

## 2. 为什么现在做

Phase 6 已经建立 bounded sequential Agent Loop、两个 Article Tool、Run / Tool / DB deadline、终态可靠性与真实 Observability Baseline。当前 Runtime 已经具备学习 Context Engineering 的必要前置条件。

Task 0 建立独立 `ModelContext` 边界与安全 Context Snapshot；Task 1 进一步让模型 Context Window 参与真实预算，建立 DeepSeek V4 TokenEstimator、动态 History Selection 与安全 initial Context summary。Phase 7 后续仍需要：

1. 把 Context Budget 从 initial History 扩展到完整 Tool Loop；
2. 统一治理 Tool Call / Tool Result 追加后的 remaining budget；
3. 让 Observation 的字符级上限继续作为 safety ceiling，而不是唯一 Context 策略；
4. 把 Context 决策安全投影到 Admin Context Inspector；
5. 基于真实数据决定是否需要 Minimal Compaction。

这意味着 Task 0-1 已完成 Context Boundary 与 initial Context Budget 基线，但完整 Context Engineering 闭环仍需要 Task 2-3。

## 3. 本阶段要学会什么

完成本阶段后，应能够解释并实现以下问题：

1. **模型实际看到了什么**：一次 sampling 的 model input 由哪些来源组成；
2. **模型最多能看到多少**：Context Window、输出预留、安全余量和输入预算的关系；
3. **哪些信息更值得保留**：Instructions、当前用户输入、最近可靠 History、Tool Exchange 的优先级与不可破坏不变量；
4. **空间不足时如何处理**：先选择 / 排除，再结构化缩减，最后才使用硬截断；
5. **多轮 Agent Loop 如何持续受控**：每轮新增 Tool Call / Result 后重新核对 Context Budget；
6. **如何验证 Context 决策**：通过确定性测试和 Context Inspector 观察 included / excluded / truncated / estimated usage。

前端类比：本阶段相当于把散落在多个组件中的状态拼装和限制逻辑，收敛成一个明确的数据选择 / selector 层；页面状态依然存在，但真正发给下游的数据由统一边界负责。

## 4. 阶段设计原则

### P-01：Context Window 是容量上限，不是使用目标

模型支持更大的 Context，不意味着每轮都应该尽量填满。目标是相关、充分、可控，而不是“利用率越高越好”。

### P-02：硬截断继续存在，但降级为 safety net

现有 `maxObservationChars` 和全局 Observation hard max 不会因为 Phase 7 自动删除。它们继续承担局部安全上限；真正的 Context 决策由更高一层的 Budget / Selection 负责。

### P-03：UI Message 不等于 Model Context

`Message` 继续表示用户可见 transcript；Tool Call、Tool Result、中间 assistant text、未来 Context Summary 等模型输入事实不能为了方便全部塞进 `Message.content`。

### P-04：Tool Call / Result 配对优先于“多塞一点内容”

任何预算 / 裁剪策略都不得制造 orphan Tool Result、missing Tool Result 或错误 callId 顺序。无法安全组装有效模型输入时，应显式失败，而不是发送结构不完整的 Context。

### P-05：Tool / Retrieval 数据始终是低信任 Context

Tool Result 只能作为受控的 tool / observation 数据进入 model context，不能升级为 system / developer policy，也不能修改 Runtime 权限规则。

### P-06：先建立可观测证据，再决定是否 Compaction

Phase 7 Baseline 不把自动 Summary / Compaction 作为必做项。先完成 Context Budget、History Selection、Loop Governance 和 Inspector；只有证据表明旧 Context 被频繁驱逐、任务连续性受损或 Context 压力真实存在时，才启动 Compaction follow-up。

## 5. Task 看板

| Task | 状态 | 目标 |
| --- | --- | --- |
| Task 0：Context Boundary & Snapshot | **Completed / #40 / #41 / merge `415e866a`** | 把当前 model input 组装收敛到独立 Context 边界，并建立不改变现有行为的 Context Snapshot |
| Task 1：Model-aware Budget & Dynamic History | **Completed / #42 / #43 / merge `6df72f0`** | 让模型 Context Window 参与预算，历史选择从固定条数升级为 token-budget 驱动 |
| Task 2：Loop-aware Context & Observation Governance | **已实现 / 待验收 / #44 / Draft PR #45** | 统一管理后续 sampling 的 Tool Exchange、剩余 Context Budget 与 Observation 裁剪 |
| Task 3：Context Inspector & Phase Baseline | Planned | 将 Context 决策做成安全可观察的 Runtime / Admin Inspector，并完成阶段回归 |
| Gated Follow-up：Minimal Compaction | Gated | 只有 Task 1-3 的真实证据证明需要时，才单独设计最小 Compaction |

正式实现仍遵守“一 Issue = 一明确 Task”。Task 2 当前等待验收；Task 3 不会因为本文存在而自动启动。

---

# Task 0：Context Boundary & Snapshot

状态：**Completed / Issue #40 / PR #41 / merge `415e866a`**。

- 实施状态：已实现
- 验收状态：已通过
- 用户确认：已确认
- 合并状态：已合并

## 目标

在不改变当前 Agent 外部行为和 Context 选择结果的前提下，把“模型这一轮实际看到什么”形成独立内部边界，并输出可测试的 Context Snapshot。

Task 0 是结构基线，不负责优化 History 数量，也不实现 token-budget 动态裁剪。

## 学习重点

- `Message[]`、`ChatMessage[]`、`ModelInputItem[]` 分别解决什么问题；
- 初始 sampling 和 Tool 后续 sampling 的 model-visible context 如何演进；
- Context Source、信任级别和模型输入角色为什么不能混为一个结构；
- 为什么应先建立可观察边界，再修改 Context 策略。

## 范围

- 梳理并集中当前初始 History -> model input 的 assembly；
- 梳理并集中 Tool Call + Tool Result -> 下一轮 model input 的 append / normalization；
- 建立内部 Context Snapshot，至少能描述 source、item count、字符规模、是否 Tool Exchange 等非敏感元数据；
- 使用测试证明重构前后 direct-final、一次 Tool、两次 Tool 的 Provider-facing model input 语义一致；
- 保持 `historyLimit = 40`、现有 Observation 上限、外部 Chat / NDJSON 协议和数据库 schema 不变。

## 不做什么

- 不实现 token estimator；
- 不按 Context Window 动态选择 History；
- 不实现 Summary / Compaction；
- 不增加 RAG、Embedding、Memory；
- 不修改 Admin UI；
- 不持久化完整 Prompt、reasoning 或 raw Tool payload。

## Red：先定义失败用例

- [x] 当前 model input assembly 没有单一 Context 边界，测试应能暴露初始 History 与 Tool Exchange 分散拼装；
- [x] direct-final、一次 Tool、两次 Tool 的 Provider-facing items 没有统一 Snapshot；
- [x] Tool Call / Result pairing、当前用户消息恰好一次、UI Message 不含 Tool Exchange 等不变量必须先锁定。

## Green：最小实现

- [x] 建立内部 Context assembly / state 边界；
- [x] 让初始 Context 与后续 Tool Exchange 通过同一边界维护；
- [x] 输出只含安全元数据的 Context Snapshot；
- [x] 保持当前 Context 选择和请求行为不变。

## 验收标准

- [x] direct final、一次 Tool、两次顺序 Tool 的最终 Provider input 与现有语义一致；
- [x] 当前用户输入在初始 model context 中恰好一次；
- [x] Tool Call / Result 按 callId 配对且顺序稳定；
- [x] Context Snapshot 不包含 reasoning、完整 Prompt、raw arguments 或 ToolResult.data；
- [x] 外部 Chat / NDJSON、Prisma schema、Admin Contract 无行为变更；
- [x] 现有 Phase 6 关键回归继续通过。

## GitHub 交付状态

- Issue：#40 `[Phase 7][Task 0] 建立 Context Boundary 与安全 Context Snapshot` / Closed
- Clarification Gate：首轮 `BLOCKED`；D-05 / D-06 同步后第二轮 `READY`
- 分支：`codex/issue-40-context-boundary`
- PR：#41 `refactor: 建立 Context Boundary 与安全 Context Snapshot` / Merged
- GPT 技术验收：通过
- 用户确认验收：通过
- Merge commit：`415e866af4d4007b6bed43cd1f6e3df590575706`

## 实现与验证证据

- 新增单次 Run 内存 `ModelContext`，统一初始 model input assembly、Tool Exchange 成对追加与 sampling Snapshot；
- Snapshot 只投影 source、category、item / Tool Exchange 数量和字符规模，不包含任何原始 Context；
- Runtime 继续拥有 History 查询、Observation 上限、Tool 执行、Abort、deadline 与 terminalization；
- direct-final、一次 Tool、两次顺序 Tool 的完整 `ModelInputItem[]` 已加入回归断言；
- Codex Review 的 P1 流程建议因与 D-05 冲突未采纳并完成说明；P2 文档入口状态遗漏已修复，两个 thread 均已 resolved。

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/api test:tool-loop` | 通过，41 tests |
| `pnpm --filter @agent/api test:model-stream` | 通过，56 tests |
| `pnpm --filter @agent/api typecheck` | 通过 |
| `pnpm --filter @agent/api lint` | 通过 |
| `pnpm typecheck` | 通过，4 个 workspace project |

---

# Task 1：Model-aware Budget & Dynamic History

状态：**Completed / Issue #42 / PR #43 / merge `6df72f0`**。

- 实施状态：已实现
- GPT 技术验收：已通过
- 用户确认验收：已确认
- 合并状态：已合并
- Clarification Gate：READY
- Merge commit：`6df72f02242a1b8a23920d64c471ce721ccf558b`

## 目标

让 `ModelProfile.contextWindowTokens` 真正参与 Context 决策，把固定“最近 40 条”从主要 Context 策略升级为 model-aware input budget 下的动态 History Selection。

## 学习重点

- Context Window、input budget、output reserve、安全余量之间的关系；
- token estimation 与真实 Provider usage 的区别；
- 为什么 Context Budget 应以 token 为主，而不是 Message 条数或字符数；
- History candidate read limit 与“最终选入模型的 History”为什么是两个概念。

## 范围

- 建立可替换、可测试的 token estimation / accounting 边界；
- 基于 resolved model profile、resolved output budget 和安全余量计算本轮可用 input budget；
- History 从最新可靠消息向前选择，直到满足预算，再恢复模型需要的时间顺序；
- 只允许 previous `COMPLETED` Message 进入可靠 History；
- 当前用户输入保持完整且恰好一次；
- `SEO_CHAT_HISTORY_LIMIT` 不再读取；candidate policy 使用 `SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE=50` 与 `SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT=1000`；
- Context Snapshot 增加 estimated usage、budget、included / excluded reason。

## 不做什么

- 不做语义相关性检索；
- 不做 RAG；
- 不做自动摘要；
- 不为了“利用 1M Context”主动填满无关历史；
- 不提前实现 Task 2 的 loop-aware re-budget。

## 验收标准

- [x] 短消息会话可以在预算允许时选择超过 40 条可靠 History；
- [x] 超长消息会话可以在预算约束下选择少于 40 条；
- [x] 同一输入和模型 profile 下 Context Selection 结果确定性稳定；
- [x] 任何 selected input 都不超过应用定义的 input budget；
- [x] model profile 改变时预算随之变化，不再由固定 40 条决定；
- [x] direct final 与 Tool Loop 回归行为不被 History Selection 破坏。

## 实现与验证证据

- Context Budget：应用输入上限 `262_144`、固定 safety margin `16_384`，复用 resolved model / max output 配置结果；mandatory context 超预算时在 Provider 调用前 fail closed。
- TokenEstimator：本地固定 DeepSeek V4 Pro tokenizer artifact，通过 `@huggingface/tokenizers` 加载；ASCII、CJK、emoji、V4 special token 与 Tool Definition 向量同官方 Python encoding 结果一致。
- History Selection：只读取严格早于 current User `(createdAt, id)` 的 previous `COMPLETED` Message；按 `(createdAt, id)` newest-first keyset 分页；recency-first、whole-message、遇到首个不可容纳消息即停止。
- 性能边界：candidate batch 合法最小值为 50；默认最坏合法配置下 full-request estimate 次数不超过 28。
- 安全摘要：只持久化 model、预算、估算 token 数、candidate / selected / excluded 数量与安全原因，不记录原始 Prompt、Message、reasoning 或 Tool payload。
- Review：第一轮 3 个 P2 已在 `620a2d0` 修复并全部 resolved；第二轮 Codex Review 未发现新的主要问题。

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/api test:context` | 通过，9 tests |
| `pnpm --filter @agent/api test:tool-loop` | 通过，46 tests |
| `pnpm --filter @agent/api test:model-stream` | 通过，59 tests |
| `pnpm --filter @agent/api test:seo-service` | 通过，10 tests |
| `pnpm --filter @agent/api test:llm-config` | 通过，17 tests |
| `pnpm --filter @agent/api test:admin-runs` | 通过，15 tests |
| `pnpm --filter @agent/api build` | 通过 |
| `pnpm --filter @agent/api typecheck` | 通过 |
| `pnpm --filter @agent/api lint` | 通过 |
| `pnpm typecheck` | 通过，4 个 workspace project |
| `git diff --check` | 通过 |

---

# Task 2：Loop-aware Context & Observation Governance

状态：**Active / Issue #44 / Draft PR #45 / 已实现待验收**。

- 实施状态：已实现
- 验收状态：待验收
- 分支：`codex/issue-44-loop-context-governance`
- Draft PR：#45

## 目标

把 Context Budget 从“第一轮 History”扩展到完整 bounded Agent Loop，保证每次 Tool Call / Result 追加后，下一轮 sampling 仍处于受控、有效且可解释的 Context 内。

## 学习重点

- 为什么 Agent Context 会在每次 sampling 后增长；
- Tool Exchange 为什么应作为成对 Context unit 管理；
- per-tool Observation cap、global hard max 与整轮 Context Budget 的不同职责；
- 结构化缩减、排除、截断和显式 overflow failure 的边界。

## 范围

- 每次 sampling 前重新核对 Context usage / remaining budget；
- Tool Call / Result 作为配对单元进入 Context；
- Tool Definition 的 `maxObservationChars` 与 global hard max 继续作为局部 ceiling；
- Context 层根据剩余预算决定 Observation 最终可进入模型的规模；
- 截断时保留明确 marker、来源和 truncated metadata；
- 无法在不破坏必要不变量的情况下安全构造下一轮 model input 时，返回受控 Context overflow / limit failure，而不是把非法结构发给 Provider；
- Tool Result 继续保持低信任角色，不得覆盖 system / developer instructions。

## 不做什么

- 不实现并行 Tool Call；
- 不实现 Tool retry planner；
- 不实现 Summary / Compaction；
- 不新增写工具 / Permission / HITL；
- 不把 ToolResult.data 或 raw payload 全量持久化用于 Context。

## 验收标准

- [x] direct final、一次 Tool、两次 Tool 每轮 input 均受 Context Budget 约束；
- [x] Tool Call / Result pairing 在裁剪后仍完整；
- [x] 超大 Observation 不会仅依赖 Tool 自己的固定字符上限决定最终模型输入；
- [x] 现有 16K / 64K / global hard max 仍作为 safety ceiling 生效；
- [x] malicious Tool Observation 仍处于低信任 tool context，不能升级指令优先级；
- [x] Context overflow 有明确、可测试的失败语义。

## 实现与验证证据

- Full-request estimator：initial、一次 Tool、两次顺序 Tool 共用 DeepSeek V4 provider-aware 编码；固定向量来自官方 `encoding_dsv4.py@b5968e9`，生产只读取仓库本地 tokenizer，不使用近似 fallback。
- Per-sampling plan：每轮 Provider 调用前完整重估；超预算时先排除最旧 initial History，再按旧到新缩减 Observation，成功结果在当前 Run 内单调收缩。
- Tool continuation：callId、name、raw arguments、`reasoning_content`、intermediate assistant content 和 Tool Result 配对顺序保持不变；仅 `tool_result.content` 可受控缩减。
- Observation：继续先应用 16K / 64K / 128K ceiling；Context marker 同时记录 `tool_ceiling` / `context_budget`，Unicode-safe，且二次缩减不会突破原 Tool ceiling。
- 失败与安全：最小结构仍超预算或 estimator 失败时，对应 Provider 调用不发生，Sampling Step / Assistant Message / Run 稳定收口；Step 只保存数字、布尔和枚举型 Context Plan 摘要。

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/api test:context` | 通过，23 tests |
| `pnpm --filter @agent/api test:tool-loop` | 通过，51 tests |
| `pnpm --filter @agent/api test:model-stream` | 通过，64 tests |
| `pnpm --filter @agent/api test:tools` | 通过，40 tests |
| `pnpm --filter @agent/api test:seo-service` | 通过，10 tests |
| `pnpm --filter @agent/api test:llm-config` | 通过，17 tests |
| `pnpm --filter @agent/api test:admin-runs` | 通过，15 tests |
| `pnpm --filter @agent/api build` | 通过 |
| `pnpm --filter @agent/api typecheck` | 通过 |
| `pnpm --filter @agent/api lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `git diff --check` | 通过 |

---

# Task 3：Context Inspector & Phase Baseline

状态：Planned。

## 目标

把前 3 个 Task 的 Context 决策变成可复盘、可验收的 Observability 信息，并在现有 Admin Console 上建立最小 Context Inspector。

## 学习重点

- 可观测性为什么应记录“决策元数据”而不是完整 Prompt；
- Context usage、budget、included / excluded / truncated reason 如何辅助调试；
- Runtime Domain Model、Admin Read Projection 和 UI Inspector 如何保持分层。

## 范围

- 每次 model sampling 提供受控 Context summary；
- 安全投影至少覆盖：resolved model、context window、input budget、estimated input usage、output reserve、source totals、included / excluded / truncated 计数或原因；
- Admin Read Contract / API / UI 增量展示 Context Inspector；
- Generic Inspector 继续兼容未来未知字段；
- 使用真实 Run 覆盖 direct-final、一次 Tool、两次 Tool、History 被排除、Observation 被截断 / 限制等场景；
- 完成 Phase 7 自动回归与浏览器验收基线。

## 不做什么

- 不展示完整 system / developer prompt；
- 不展示 reasoning content；
- 不展示 raw Tool arguments、完整 Tool Result 或敏感数据；
- 不因为 Inspector 需求反向污染 Runtime Domain Model；
- 不自动启动 Admin Task 4 Auth / RBAC。

## 验收标准

- [ ] 开发者可以解释某次 sampling 为什么包含 / 排除某类 Context；
- [ ] Inspector 可看到预算与估算使用量，而无需暴露原始敏感 Context；
- [ ] Context 数据与 Run / Sampling Step 一一对应，不出现跨 Run stale 数据；
- [ ] Admin 继续满足现有 loading / error / retry / stale-response 边界；
- [ ] Phase 6 Agent Loop 与外部 Chat 协议完整回归通过。

---

# Gated Follow-up：Minimal Compaction

状态：**Gated / 当前不启动**。

Compaction 是 Context Engineering 的一种手段，不是阶段完成的默认条件。

只有 Task 1-3 的真实数据出现至少一种情况时，才重新讨论：

- 长会话中重要旧 History 因预算持续被驱逐，明显影响任务连续性；
- Context Inspector 显示 History 长期逼近预算并造成高频裁剪；
- 成本、延迟或模型质量测试证明仅靠动态 History Selection 不足；
- 需要跨较长 Turn 保留已确认决策，但直接保留原始 Message 不经济。

如果触发，必须另建正式 Task / Issue，先决定：

- compact 的对象是什么；
- summary 是否 durable；
- 如何避免 summary 漂移；
- 如何版本化 / 失效；
- 如何验证压缩前后的关键事实没有丢失。

不直接复刻 Codex `ContextManager`、`world_state_baseline`、rollback 或完整 history version 机制。

## 6. Phase 7 完成标准

Phase 7 Baseline 完成需要 Task 0-3 全部验收通过，并满足：

```text
模型输入有统一 Context 边界
        ↓
模型 Context Window 参与真实预算
        ↓
History 不再由固定 40 条主导
        ↓
Tool Loop 每轮 Context 都受预算治理
        ↓
硬截断退回 safety net
        ↓
Context 决策可通过 Inspector 解释
```

Minimal Compaction 不属于默认完成条件；是否加入 Phase 7 收口范围，必须在 Task 3 之后基于证据重新决定。

## 7. 当前 GitHub 交付状态

- Phase 7：Active
- Task 0：Completed / Issue #40 Closed / PR #41 Merged / `415e866a`
- Task 1：Completed / Issue #42 Closed / PR #43 Merged / `6df72f0`
- Task 2：Issue #44 / Draft PR #45 / 已实现 / 待验收
- Task 3：Planned
- Minimal Compaction：Gated
- Active Agent Task：Task 2 / #44 / 待验收

下一正式动作：对 Task 2 的 Draft PR 做技术验收；Task 3 仍为 Planned，不自动启动。
