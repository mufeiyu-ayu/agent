# Phase 12 练习与验收：用公平实验决定 GO / NO-GO

## 1. 实践纪律

本阶段最容易犯的错误是先实现“多个 Agent”，再挑一个看起来成功的例子证明价值。正确顺序是：

1. 固定任务与评分器。
2. 固定总预算和基线。
3. 预先写成功/失败阈值。
4. 实现最小 child architecture。
5. 做故障与安全验证。
6. 重复 A/B 实验并报告全部样本。
7. 做 GO / NO-GO 决策。

NO-GO 是合格结论；没有证据却默认上线才是失败。

## 2. 实验数据集

### 2.1 样本设计

至少 20 组站点，每组 3-5 个页面的标准化快照：

- 正常页面，问题少。
- 多页面重复 title/canonical 问题。
- robots/noindex 冲突。
- redirect chain 与 broken links。
- 内容相似但不是重复内容。
- 页面数据不完整或工具失败。
- 单页面超大 observation。
- 页面间证据冲突。
- 包含 prompt injection 文本的页面内容。
- 一个 pageRef 属于其他租户的 adversarial fixture。

Gold labels 至少包括 page-level findings、site-level deduplication、priority 和 evidence refs。

### 2.2 公平配置

Single 与 Multi 保持：

- 同一 model/version/reasoning 设置。
- 同一 page data 与 tool results。
- 同一总 input/output token 上限。
- 同一总 tool call 和 external cost 上限。
- 同一最终 output schema。
- 同一 evaluator。
- 相同最大 wall-clock，另报告实际 latency。
- 对同一 `(datasetCaseId, replicate/seed)` 形成 Single/Multi matched pair；随机化 pair 内执行顺序，不能把不同时段的两组均值当配对实验。

如果 Multi 使用 3 个 child，每个预算不能都等于 Single 全额预算。

## 3. 预注册成功阈值

示例，实施前应根据 Phase 09 baseline 调整并冻结：

```text
GO only if:
  paired quality delta 的点估计提升 >= 8%
  paired bootstrap 95% CI 下界达到预注册的最小收益/非劣界
  unsupported claim rate 不上升
  completion rate 不下降超过 2pp
  median cost 增幅 <= 35%
  P95 latency 不劣化超过 50%，或有清晰并行收益
  security/cancel/recovery gates 全通过
```

也可预先允许“质量不变但 latency 显著下降”的 GO 路径；必须预先写清楚主指标、非劣界、paired bootstrap（或等价配对方法）、置信水平、缺失 pair 处理与多路径决策。安全/cancel/recovery 是 must-pass gate，不通过时不能靠置信区间或平均分抵消。不能实验后才挑最有利指标。

## 4. 练习一：Child contract 先于模型

### Red

先对纯 contract 写失败测试：

- task 缺少 taskId/pageRef/output schema。
- 两个 taskId 重复。
- pageRef 不属于 parent tenant。
- tool allowlist 包含 parent 无权使用的 tool。
- child budget 合计超过 parent。
- depth > 1。
- result taskId/pageRef 与 spec 不匹配。
- result findings 缺 evidence。
- evidenceId/observationId 不存在，属于其他 tenant/root/child/task/attempt/page，或 contentHash/schemaVersion 不匹配。
- duplicate/stale attempt result 覆盖新结果。

### Green

- `ChildTaskSpec` 运行时 schema validation。
- server-side resource resolution。
- policy/extension/budget intersection。
- `ChildTaskResult` validation 与 attempt/version。
- evidence refs 解析到 canonical safe observation snapshot；每个 finding 至少一个有效 ref，dangling/cross-scope/stale ref 使 result 整体无效。
- parent only consumes validated terminal result。
- parent aggregation 只合并已验证 evidence 对象，不允许模型新增一个未落库 ref。

### Refactor

- page audit 字段保留 domain-specific，不急于做通用 workflow payload。
- 通用部分只包括 task identity、status、budget、deadline、source/version。

## 5. 练习二：持久化 parent-child graph

### Red

- child 没有 parent 或有两个 parent。
- rootRunId 与祖先不一致。
- parent 删除导致 child 成为无法追踪的孤儿。
- child 通过伪造 user Message 适配当前必填 userMessageId。
- parent 完成时 child 仍 RUNNING。
- 重放 spawn 创建重复 child。
- child row 已提交但内存 enqueue 尚未执行时进程 crash，READY 永久搁置。

### Green

- 用 schema/transaction 表达 parentRunId/rootRunId/depth/taskId/attempt。
- 为内部 child 设计真实 trigger/input 关系，不创建假 UI Message。
- `(parentRunId, taskId, attempt)` 或等价 idempotency uniqueness。
- child 初始为 READY；同一事务写 child/tasks、quota/slot reservation 和唯一 dispatch outbox row。
- parent terminal transition 检查 child states。
- cascade/retention 规则有明确 ADR。

### Refactor

- 如果 `AgentRun` 同时承载 root/child 产生过多 nullable 字段，比较专用 `AgentTask` + Run 的设计；用查询/状态需求决定，不凭审美。
- Repository 抽象只覆盖跨事务不变量，不做通用 ORM 封装。

## 6. 练习三：Bounded scheduler

### 6.1 Deterministic fake runner

fake child runner 接受 controllable latch：

- 立即成功。
- 在 barrier 等待。
- 失败/timeout。
- 忽略一次 cancel 后再结束。
- heartbeat 停止模拟 crash。

### Red

- 并发 parent 同时 spawn 导致超过 tenant child limit。
- 部分 DB child rows 创建后 reservation 失败。
- scheduler crash 后 slot 永久占用。
- outbox publish 后 ACK 丢失导致重复执行同一 child attempt。
- worker 先写 RUNNING、后取 lease 失败，留下假 RUNNING。
- 模型输出 100 个 tasks 全部启动。
- child 完成后 guard 未释放。

### Green

- validate -> reserve -> one transaction create READY child/tasks + reservations + dispatch outbox -> idempotent dispatch -> conditional lease claim READY->RUNNING 的明确顺序。
- maxChildren/maxDepth/deadline/budget 为 server policy。
- active slot 使用 semaphore/lease，canonical reservation 在 DB。
- `(childRunId, attempt)` outbox/claim 唯一；重复 delivery 只有一个 worker 获得 lease，未 ACK 可安全重投。
- READY 等待超时由 sweeper 重投或安全终结；RUNNING 只在 lease 成功后出现，lease 过期按恢复策略接管或终结。
- terminal 与 recovery 幂等释放。
- 超限返回稳定 domain code，parent 可降级为单 Agent/顺序执行或失败。

### Refactor

- 单实例先用 bounded pool；只有现有 worker 已成熟时复用 worker。
- 不因调度出现就引入 DAG engine。

## 7. 练习四：独立 context 与权限收窄

### Red

- child capture 中出现完整 Conversation transcript。
- child A 看见 page B 原始数据。
- child 获得 parent 全部 tools，而 task allowlist 只有一个。
- child 试图调用写工具、unknown-risk tool 或任何会返回 REQUIRE_APPROVAL 的工具。
- malicious page prompt 要求读取其他 tenant connector，child 执行。
- child skill/plugin snapshot 比 parent 更宽。
- child arguments 自报 tenantId。

### Green

- `ChildContextProjector` 只生成 task spec、page ref/data、schema、必要 instructions。
- 每个 child model capture 有字段级断言。
- effective policy/extension/tool set 使用集合交集。
- 额外应用 `ReadOnlyExperimentPolicy`：只暴露本地评级 read-only 工具；side-effect/unknown-risk/REQUIRE_APPROVAL 全部 deny，ApprovalRequest count 和 executor count 都为 0。
- resource resolution 和 ToolAuthorization 仍使用 server ActorContext。
- page content 作为不可信 data 标识，不作为 developer instruction。

### Refactor

- context projector 纯函数化、可 snapshot test。
- 大 page data 用 ref/受控 tool 获取，不复制进每个 prompt。

## 8. 练习五：Parent cancel 传播

### 场景

启动三个 child：

- C1 正在 model sampling。
- C2 正在可取消 tool。
- C3 已 completed。

触发 parent cancel。

### 断言

- parent `cancelRequestedAt` 先持久化。
- 不再创建 C4 或重试。
- C1/C2 收到 cancel，最终 ABORTED；C3 保持 COMPLETED。
- parent 最终 ABORTED，不发布最终成功 Message。
- quota 结算实际 usage，释放 remainder。
- 重复 cancel 幂等。
- cancel 过程中进程 crash 后 recovery 得到相同结果。

再加入一个不可取消 fake tool：它完成后结果只能记录为 late completion/ignored，不能恢复 parent 聚合。

## 9. 练习六：Partial failure 与 retry

### 固定策略示例

- 3/3 completed：aggregate complete。
- 2/3 completed，1 timed out：aggregate partial，明确遗漏页面。
- 少于 2 completed：parent failed。
- permission/validation failure：不重试。
- transient provider error：预算允许时最多一次新 attempt。
- child retry 复用 taskId，增加 attempt，旧结果不可覆盖新 attempt。

### 测试

- 完成顺序随机但聚合顺序稳定。
- duplicate result 幂等。
- stale attempt 晚到。
- child 成功后 result persistence 失败。
- parent aggregation sampling 失败后重试不重跑 children。
- parent crash 在 children complete、aggregation 未开始之间。

## 10. 练习七：Crash recovery

逐一注入 crash point：

1. reservation 后、child rows 前。
2. rows 后、enqueue 前。
   - 目标实现应由未发送 outbox 恢复；没有“内存 enqueue”这一唯一事实。
3. child sampling 中。
4. tool side effect 后、result 前（本阶段只读，仍验证 observation）。
5. child result 后、parent received 前。
6. all children terminal 后、aggregation 前。
7. final Message 写入后、parent complete 前。

每个点记录 canonical DB state、recovery action、是否重做模型/tool、usage reconcile 和最终状态。不能只测试“服务重启后页面还能打开”。

## 11. 练习八：Single vs Multi A/B

### 11.1 Single variant

- 一个 root Run 顺序/批量处理所有页面。
- 相同工具数据和输出 schema。
- 记录 full metrics。

### 11.2 Multi variant

- 每页面一个 child，最多 3 并发。
- parent 只做 task validation 与 aggregation。
- 总预算等于 Single 预算。

### 11.3 重复与顺序

- 每个样本每 variant 至少多次运行。
- 以 `(caseId, replicate/seed)` 将 Single 与 Multi 组成 matched pair；pair 内随机化 variant 执行顺序，减少上游时段影响。
- 保存 prompt/model/tool/skill/evaluator versions。
- 先计算每一对 `delta = Multi - Single`，再报告 paired delta 的点估计、paired bootstrap 95% CI（或预注册等价方法）、均值/中位数、P95/方差和全部失败样本，不只报最好一次。
- CI bootstrap 以 case/pair 为重采样单位，不能把同一 case 的重复 run 当独立样本虚增 n；缺失/失败 pair 按预注册规则保留为失败或敏感性分析，不可静默删除。

### 11.4 结论表

| 指标 | Single | Multi | Paired delta | 95% CI | Threshold/非劣界 | Pass? |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| quality |  |  |  |  |  |  |
| unsupported claims |  |  |  |  |  |  |
| completion rate |  |  |  |  |  |  |
| median cost |  |  |  |  |  |  |
| P95 latency |  |  |  |  |  |  |
| failure variance |  |  |  |  |  |  |

## 12. 测试矩阵

### 12.1 Task/graph

| Case | 期望 |
| --- | --- |
| valid three tasks | 3 unique child runs，same root |
| duplicate taskId replay | 返回已有 children |
| depth=2 | 拒绝，执行次数 0 |
| unknown pageRef | validation/not-found |
| foreign tenant pageRef | deny |
| parent missing | 不创建 orphan |
| child userMessage | 不创建伪 UI Message |

### 12.2 Capacity/budget

| Case | 期望 |
| --- | --- |
| maxChildren=3, request 4 | reject/truncate policy 明确 |
| two parents race | tenant active 上限不超卖 |
| budget sum > parent | spawn 前拒绝 |
| child over budget | child terminal budget_exceeded |
| slot release on complete/fail/abort | 可再次 spawn |
| stale lease | recovery 回收一次 |
| rows committed before dispatch crash | outbox 恢复 READY 并最终仅执行一次 |
| outbox duplicate/ACK lost | 一个 lease owner，child attempt 执行一次 |
| READY timeout | sweeper 重投或终结并结算 slot/budget |

### 12.3 Context/security

| Case | 期望 |
| --- | --- |
| page A child | 只见 A + shared safe context |
| role requests admin tool | policy deny |
| child requests approval-required tool | deny；ApprovalRequest=0、executor=0 |
| child calls side-effect/unknown-risk tool | deny；即使 parent 可用也不暴露 |
| task allowlist excludes tool | tool 不可见且直接 call 也 deny |
| parent extension snapshot | child 相同或子集 |
| parent membership revoked | children 按 Phase 10 recheck policy 收口 |
| malicious page prompt | 不能改变 authority/instructions |

### 12.4 Lifecycle

| Case | Parent | Children |
| --- | --- | --- |
| all success | COMPLETED | all COMPLETED |
| one timeout within threshold | COMPLETED/PARTIAL domain result | 2 complete, 1 failed/timeout |
| too many failures | FAILED | terminal |
| parent abort | ABORTED | non-terminal -> ABORTED |
| child late completion after abort | ABORTED | audit late result, no aggregation |
| process crash/recovery | eventual terminal | no orphan RUNNING |

### 12.5 Aggregation

| Case | 期望 |
| --- | --- |
| out-of-order results | deterministic page/task ordering |
| duplicate findings | site-level dedup + evidence union |
| conflicting findings | 保留冲突/evidence，不静默覆盖 |
| unknown result taskId | 拒绝/审计 |
| stale attempt result | 不覆盖 latest |
| aggregation retry | 不重跑 terminal children |
| unknown/dangling evidenceRef | child result invalid，不进入 aggregation |
| foreign tenant/root/task/page evidenceRef | deny + audit，无数据枚举 |
| hash/schema/attempt mismatch | stale/tampered result invalid |
| finding has no validated evidence | result invalid，不允许只靠自然语言 claim |

## 13. 建议测试命名

```text
creates_child_runs_without_fabricating_user_messages
reserves_child_slots_atomically_across_concurrent_parents
dispatches_ready_children_via_transactional_outbox_after_crash
claims_each_duplicate_outbox_delivery_only_once
rejects_recursive_spawn_beyond_configured_depth
narrows_child_tools_to_parent_policy_and_task_allowlist
denies_child_tools_that_require_approval_or_have_side_effects
projects_only_task_specific_context_into_each_child
rejects_cross_scope_dangling_or_hash_mismatched_evidence_refs
propagates_parent_cancellation_to_sampling_and_tools
does_not_aggregate_late_child_result_after_parent_abort
recovers_parent_graph_after_crash_before_aggregation
retries_aggregation_without_reexecuting_completed_children
reports_partial_result_with_missing_page_evidence
compares_matched_single_and_multi_pairs_with_preregistered_confidence_intervals
```

## 14. 运行时观测矩阵

每次实验必须可通过 trace/DB 查询：

```text
rootRunId
  parentRunId
    childRunId / taskId / attempt
      model sampling spans
      tool calls
      usage/cost
      status/error
      result schema version
```

父层额外记录：

- planned child count / admitted count。
- queue wait / execution time / aggregation time。
- total reserved vs actual budget。
- partial failure reason。
- final variant (`single` / `multi`) 和 experiment version。

日志不记录 child chain-of-thought、完整 page contents 或 credential。

## 15. 故障演练清单

- [ ] 一个 child provider 429。
- [ ] 一个 child tool timeout。
- [ ] 一个 child 输出 malformed schema。
- [ ] 两个 child 返回冲突结论。
- [ ] parent 在 spawn transaction 后 crash。
- [ ] child rows/outbox commit 后 dispatcher crash，及 publish 后 ACK 丢失。
- [ ] worker 在 child terminal write 前 crash。
- [ ] parent cancel 与 child complete 同时发生。
- [ ] tenant quota 在部分 children 完成后耗尽。
- [ ] extension 被紧急 revoke。
- [ ] recovery job 重复执行。

每个演练要保存 before/after DB state 和 exact test/assertion，不能只写口头预期。

## 16. 验收证据清单

### 16.1 前置与设计

- [ ] Phase 10/11 安全与扩展 gates 的引用证据。
- [ ] 实验任务为何天然可并行的说明。
- [ ] Single baseline 与预注册 GO threshold。
- [ ] ChildTaskSpec/Result schema 与版本策略。
- [ ] EvidenceRef canonical ownership/hash/schema/retention contract。
- [ ] parent-child state/cancel/recovery 图。
- [ ] READY -> outbox -> lease claim -> RUNNING 时序与唯一键。

### 16.2 自动化

- [ ] parent/root/depth/idempotency constraints。
- [ ] bounded concurrency/budget race tests。
- [ ] transaction/outbox duplicate delivery/READY timeout/lease claim recovery tests。
- [ ] isolated context capture tests。
- [ ] policy/tool/extension narrowing tests。
- [ ] child read-only + approval-deny（ApprovalRequest/executor 均为 0）tests。
- [ ] all-success/partial/fail/abort lifecycle tests。
- [ ] crash recovery at critical points。
- [ ] aggregation order/dedup/conflict/stale attempt tests。
- [ ] evidenceRefs existence/tenant/root/child/task/attempt/page/hash/schema integrity tests。

### 16.3 实验

- [ ] 全样本 Single raw results。
- [ ] 全样本 Multi raw results。
- [ ] evaluator version 与评分明细。
- [ ] matched-pair raw table、每对 delta、paired 95% CI、cost/latency/quality/stability 汇总和方差。
- [ ] 失败样本分析。
- [ ] GO / NO-GO 决策与负责人可复核依据。

## 17. GO / NO-GO 模板

### GO

```md
Multi-agent 仅对多页面并行审计启用。与单 Agent 相同总预算的 matched-pair 实验中，quality paired delta 为 X%（95% CI [...]），P95 latency 变化 Y%，median cost 变化 Z%，安全/恢复 gates 全通过。默认 maxDepth=1、maxChildren=N、child 只读且 approval-required call 直接 deny，固定 ChildTaskResult/EvidenceRef schema，并使用 READY + transactional outbox + lease dispatch；短任务继续走 Single。
```

### NO-GO

```md
Multi-agent 实验未进入产品主线。主要证据：质量变化 X%，成本变化 Y%，失败率/延迟变化 Z%。child contract、调度和恢复研究保留为实验记录；默认 runtime 继续使用 Single Agent。若未来出现 [具体触发条件]，再复用数据集重新评估。
```

## 18. 退出判定

技术 gates 与价值 gate 是 AND 关系：

- 技术 gates 失败：阶段未完成，不能做产品结论。
- 技术 gates 通过、价值未达标：阶段完成，结论 NO-GO。
- 技术 gates 通过、价值达标：阶段完成，结论 GO，但仅限已验证任务类型。

不能从“多页面实验 GO”推导“所有 Agent 请求默认 Multi-agent”。

## 19. 复盘问题

### 架构

1. 为什么 child 是独立 Run，而不是多个 role messages？
2. 当前 AgentRun 的哪些字段妨碍内部 child，如何修正但不破坏 root Run？
3. parent/child graph 的 canonical state 在哪里？
4. spawn reservation、execution lease、quota reservation 有何区别？

### Context 与安全

5. child 得到的最小 context 是什么？哪些 parent 内容明确不传？
6. 权限、tool allowlist、extension snapshot 如何取交集？
7. 页面中的 prompt injection 为什么不能改变 child instructions？
8. 为什么本次实验的 child 不能进入 Approval？它请求写入/unknown-risk 工具时如何证明 ApprovalRequest 和执行次数都为 0？

### 可靠性

9. parent cancel 与 child complete 竞态如何确定唯一结果？
10. child tool 已成功但 result 未持久化，恢复时能否重做？
11. aggregation 失败为什么不应重跑 children？
12. stale child slot 和 budget 如何回收？

### 价值

13. 公平总预算如何计算？
14. 哪个指标最能证明多页面任务受益？
15. 哪些结果会导致 NO-GO？
16. 如果 GO，为什么也不能默认用于短任务？

## 20. 完成陈述模板

```md
Phase 12 已完成。child 以独立 Run、受限 context、权限/工具/扩展交集和独立预算运行；READY/outbox/lease dispatch、parent-child 状态、取消、部分失败和 crash recovery 均有自动化证据。child 只读且不能请求 Approval，每个 finding 的 evidenceRefs 已通过 canonical scope/hash/schema 完整性验证。基于预注册 matched-pair 数据集、公平预算与 paired 95% CI，最终结论为 [GO/NO-GO]。该结论只适用于 [任务类型]，未实现递归 spawn、自由 mailbox 或共享写操作。

关键证据：...
失败样本：...
进入 Phase 13 时保留/移除的实验能力：...
```
