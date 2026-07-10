# Phase 06 练习与验收：从“最近 12 条”升级为可解释 ContextPlan

## 1. 核心验收命题

> 给定同一组 canonical facts，ContextBuilder 必须产生确定、合法、受预算约束且可解释的 ModelInputItem；超预算、工具大输出、摘要失败和不合法 call/output 都不能静默污染模型输入。

本阶段测试以纯函数和 fixture 为主。真实模型摘要只用于最后实验，不能替代 deterministic normalization 与 budget tests。

## 2. Fixture 设计

建立一组固定 fixture：

1. 3 轮普通对话。
2. 当前 user input 已经落库的场景。
3. 数据库中的一个完整 ToolCall + ToolResult + success Observation，并带同一 Turn 内连续 item sequence。
4. 一个 ToolCall + error Observation。
5. 一个 orphan Observation。
6. 一个没有 Observation 的未完成 ToolCall。
7. 一个包含 secret、超长正文和大量无关字段的 tool output。
8. COMPLETED/FAILED/ABORTED/STREAMING 四种 assistant Message。
9. 一条 active summary 按 conversation item sequence 覆盖旧 item 区间，区间内同时含 Message 与 tool facts。
10. 一个 summary 生成时 Approval=PENDING、构建时已 APPROVED/REJECTED 的可变状态场景。
11. 一个接近 context window 的长会话。

每条 fixture 使用固定 ID、固定时间与固定 token estimator，避免快照不稳定。

## 3. TDD Cycle A：ModelInputItem 与 mapper

### Red

先证明现有 `ChatMessage` 不能表达：

- ToolCall 与 Observation 的 `callId`。
- ToolCall/Result/Observation 的 durable fact ID 与 item sequence。
- Summary 的来源范围。
- Business context 的 source/priority。
- tool error 与 assistant text 的区别。

写 mapper tests，要求从 canonical facts 输出项目自有 `ModelInputItem`，当前类型检查或断言应先失败。

### Green

- 定义最小 union。
- 为 Message、Tool facts、Summary 分别写 mapper。
- provider adapter 单独负责 SDK shape。
- 不添加暂时没有用例的多模态类型。

### Refactor

- 只有第二个 provider 或第二类 item 映射出现重复时才提取 adapter helpers。
- union 分支以业务语义命名，不照抄某 SDK 字段。

## 4. TDD Cycle B：History normalization

### Red

写失败测试：

1. current user input 在历史中已有时仍只出现一次。
2. orphan observation 被拒绝并返回稳定 reason。
3. duplicate callId 被拒绝。
4. 裁剪不会留下半个 call/output pair。
5. FAILED/STREAMING assistant 不进入历史。
6. ABORTED assistant 按明确规则处理。
7. system instructions 始终在正确位置。
8. summary 覆盖范围内的旧消息不重复发送。
9. 同一 Turn 的 user/tool call/observation/assistant 严格按 item sequence 保序，不能因 item type 分组而重排。
10. summary 中旧的 pending approval 描述不能覆盖当前 canonical decision/observation。

### Green

- 实现纯 `ContextNormalizer`。
- 输出 normalized items + warnings/errors，不静默吞掉关键异常。
- 对合法但被排除的 source 记录 decision reason。
- mapper 只从数据库 canonical ToolCall/ToolResult/Observation 构造工具 items；不接收旧 runtime 的隐藏数组作为事实源。

### Refactor

- 把状态过滤、pair validation、order 规则拆成小的纯函数。
- 不创建复杂 middleware pipeline；顺序只有在测试中具有真实差异时才抽象。

## 5. TDD Cycle C：Token budget

### Red

使用 fake estimator（例如每个 fixture 明确返回 token 数），要求：

- `inputLimit = window - completionReserve - overhead - margin`。
- system 和 current input 在正常可行预算下必保留。
- optional business enrichment 最先排除。
- recent history 按完整 Turn 选择。
- tool pair 不被拆开。
- 无法容纳必需内容时返回明确 `CONTEXT_BUDGET_EXCEEDED`，不无限裁剪。
- 每个 source 有 included/excluded/truncated reason。

### Green

- 实现 `TokenEstimator` interface 与 deterministic fake。
- 实现简单优先级/完整单元选择算法。
- 返回 ContextPlan budget report。

### Refactor

- 先保持贪心策略可解释；没有评测证据不引入复杂 knapsack/optimizer。
- 配置项集中到 model/context policy，而不是散落 magic numbers。

## 6. TDD Cycle D：Tool output projector

### Red

给定超长输出：

- secret 必须被删除或替换。
- 只保留 SEO 结论需要字段。
- 超过上限时带显式 truncated marker。
- `callId`、success/error、原始结果 reference 保留。
- 截断结果仍能被第二轮模型识别为 observation。

### Green

- 为第一类真实 SEO tool 写确定性 projector。
- 先结构化选字段，再做长度限制；不要只 `slice(0, n)`。
- 原始大结果根据真实需要保存引用，不塞进 AgentStep JSON。

### Refactor

- 只有第二个工具输出策略出现后才抽 `ToolObservationProjectorRegistry`。
- 共用 redaction 可提取，但工具业务字段选择留在工具侧。

## 7. TDD Cycle E：Compaction

### Red

使用 fake summarizer：

1. 超过阈值触发一次 compaction。
2. 未超过阈值不调用 summarizer。
3. summary 覆盖指定 conversation item sequence range，而不是只覆盖 Message ID。
4. 新 summary ACTIVE，旧 summary SUPERSEDED。
5. summarizer 抛错时旧 summary/原 history 仍有效。
6. candidate 超预算或缺少必需事实时不激活。
7. 两次并发 compaction 最多一个 active version。
8. compact 后 recent items 从 `sourceUntilItemSequence` 之后接续，不重复且不重排。
9. summary 生成时存在 PENDING approval，之后 decision 变化；新 plan 使用 canonical 当前状态/observation，不把旧 pending 描述当事实。

### Green

- 先实现触发策略、candidate、validation 和 atomic activation。
- fake summarizer 返回固定文本和 token。
- 真实模型 summarizer 放在最后实验。

### Refactor

- 抽出 `ContextSummaryStore` 只在持久化复杂度已经出现时进行。
- 不引入事件溯源或工作流引擎。

## 8. TDD Cycle F：统一同步与 Streaming

### Red

用相同 canonical fixture 分别调用同步/stream application entry，断言它们目前可能：

- 创建不同数量的 Run/Step。
- 使用不同 context items。
- 对 Message 状态处理不同。
- 一个有 tool loop，一个没有。

### Green

- 两个协议入口收敛到同一 runtime/context path。
- 如同步入口暂时不需要，明确弃用而不是复制功能。
- 外部返回方式不同，内部 ContextPlan 相同。

### Refactor

- Controller 只负责协议，不持有 context 策略。
- SEO service 只提供业务 contributor/config。

## 9. 单元测试矩阵

| 编号 | 对象 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| U06-01 | Message mapper | COMPLETED user/assistant | 正确 item + ID |
| U06-02 | status filter | FAILED/STREAMING | 排除 + reason |
| U06-03 | status filter | ABORTED partial | 符合明确策略 |
| U06-04 | normalizer | current input 已在 history | 只出现一次 |
| U06-05 | normalizer | call + observation | item sequence、顺序和 callId 合法 |
| U06-06 | normalizer | orphan observation | 稳定错误 |
| U06-07 | normalizer | duplicate call | 稳定错误 |
| U06-08 | normalizer | summary range | covered messages 不重复 |
| U06-09 | budget | 正常输入 | report 合计正确 |
| U06-10 | budget | optional 超限 | 先排 optional |
| U06-11 | budget | 必需项超限 | 明确 budget error |
| U06-12 | budget | pair 在边界 | 整对保留或排除 |
| U06-13 | projector | 大 tool output | 脱敏、截断、标记 |
| U06-14 | estimator | estimator failure | 保守 fallback |
| U06-15 | provider mapper | ModelInputItem | SDK shape 正确且 runtime 无 SDK 类型 |
| U06-16 | fact mapper | fresh runtime + DB facts | 不借助旧内存重建同一 ToolCall/Observation items |
| U06-17 | order | mixed items in one Turn | 严格按 item sequence，不按类型分组 |
| U06-18 | approval overlay | summary says pending, DB terminal | 当前 canonical decision/observation 获胜 |

## 10. Compaction 测试矩阵

| 编号 | 场景 | 断言 |
| --- | --- | --- |
| K06-01 | 未达阈值 | summarizer=0 |
| K06-02 | 达阈值 | summarizer=1，candidate activated |
| K06-03 | summarizer error | 旧 active/原历史未变 |
| K06-04 | candidate 太大 | 不激活，稳定错误/回退 |
| K06-05 | item sequence range/version 变化 | optimistic conflict，不覆盖新 items |
| K06-06 | 两个并发 compact | 只有一个 ACTIVE |
| K06-07 | 第二次 compaction | v1 SUPERSEDED，v2 ACTIVE |
| K06-08 | compact 后 plan | summary + range 后消息，无重复 |
| K06-09 | pending approval | 摘要只保留未完成意图与 approval/toolCall 引用；当前状态由 canonical overlay 提供 |
| K06-10 | denied tool | 不写成成功事实 |
| K06-11 | mutable approval changed | summary 不固化旧 PENDING/APPROVED 状态；当前 projection 获胜 |

## 11. Runtime/Contract 测试矩阵

| 编号 | 场景 | 证据 |
| --- | --- | --- |
| I06-01 | 普通 stream | ContextPlan 与实际 provider input 一致 |
| I06-02 | tool follow-up | 第二轮含完整 call/output pair |
| I06-03 | large observation | provider 只收到投影，不收原始大对象 |
| I06-04 | context 超限 | Run/Step 进入明确失败，Message 不悬挂 |
| I06-05 | compaction 成功后继续 | sampling 继续，summary source 可追踪 |
| I06-06 | compaction 失败 | 原 history 可继续或稳定失败，无半替换 |
| I06-07 | abort during compaction | summary 不激活，Run ABORTED |
| I06-08 | sync vs stream | 内部 plan 相同 |
| I06-09 | old runtime destroyed | 新建完整 service graph，只读测试 DB 重建相同 ordered tool history，并完成下一轮 sampling |

## 12. 属性测试/不变量练习

如果当前测试栈支持 property-based testing，可加入；否则用参数化表驱动测试：

- 任意合法 Turn item sequence 经过 normalize 后保持相对顺序，且 observation 前必有同 callId 的 call。
- 任意 budget 裁剪后，call/output 数量配对。
- 任意 source 顺序中，current input 最多且至少一次。
- 任意 summary item-sequence range 下，被覆盖 items 与 recent projection 不相交。
- 任意 ContextPlan 的 `estimatedInputTokens <= inputLimit`，除非返回明确 error。
- 任意失败不会修改 active summary。

## 13. 质量评测实验

建立 8-15 条固定 SEO 问题，至少覆盖：

- 用户早期给出的目标关键词在长会话后仍被记住。
- 用户后来纠正市场/语言后，以新事实为准。
- tool observation 中关键 title/description 被使用。
- tool output 中无关 HTML 未挤掉目标。
- tool error 不被模型描述为成功。
- 用户拒绝发布后模型不声称已发布。
- summary 后未完成任务仍保留。
- 当前 user input 不被重复解释。

比较三组：

1. 固定最近 12 条。
2. token budget，无 summary。
3. token budget + summary。

记录：答案正确性、关键事实召回、错误工具事实、estimated/actual tokens、总成本和延迟。样本小也可以，但必须固定、可重跑。

## 14. 故障注入

| 故障 | 预期 |
| --- | --- |
| TokenEstimator 抛错 | 使用保守估算或稳定失败，不无限发送 |
| Summary provider timeout | 旧 active summary 保留 |
| Summary 写库失败 | candidate 不激活 |
| 激活时 source version 已变 | conflict，重新构建而非覆盖 |
| Tool projector 抛错 | tool step/context build 明确失败，原始 secret 不进入 fallback |
| Provider 报 context length | 记录估算偏差；有界重建/压缩，不无限 retry |
| AbortSignal 触发 | compaction/sampling 停止，Run 状态一致 |

## 15. 验收证据模板

```md
### Requirement：ContextPlan 不拆散 ToolCall/Observation

- Fixture：`call-C1 + observation-C1 + long history`
- Unit test：`context-normalizer.spec.ts / preserves complete tool pairs`
- Budget report：pair estimated=..., decision=included/excluded
- Provider input：callId=C1 两个 item 顺序正确
- Result：PASS
- Remaining risk：真实 provider 对 error observation 的字段差异待 adapter contract test
```

```md
### Requirement：新 runtime 只从数据库重建工具历史

- First runtime：写入 ToolCallFact/ToolResultFact/ObservationFact，记录 turnId + itemSequence
- Restart boundary：销毁旧 service graph、清空所有 in-memory event/context buffer
- Second runtime：从测试数据库读取 facts 并构建 ContextPlan
- Provider input：callId、arguments、observation 及相对顺序与第一次一致
- Next sampling：成功完成，未重新执行工具
- Result：PASS
```

## 16. 阶段验收清单

### 类型与边界

- [ ] UI、model、runtime、persistent 四层有明确类型/mapper。
- [ ] ModelInputItem 不依赖 provider SDK。
- [ ] SeoContextBuilder 已成为业务 contributor 或职责等价清晰。
- [ ] 同步与 stream 不再维护两套 context 逻辑。

### 规范化

- [ ] current input 恰好一次。
- [ ] call/output 配对、孤立、duplicate 均有测试。
- [ ] mixed Turn items 按 item sequence 保序。
- [ ] fresh runtime 只从 DB 重建 ToolCall/Observation 并完成 follow-up sampling。
- [ ] Message 状态过滤规则明确。
- [ ] summary item-sequence range 与 recent history 不重叠。
- [ ] mutable Approval 由当前 canonical projection 覆盖，summary 不固化旧状态。

### 预算

- [ ] completion reserve 和 safety margin 已配置。
- [ ] source priority 有确定规则。
- [ ] 每个 source inclusion decision 可解释。
- [ ] 必需内容超限有稳定失败。
- [ ] estimated 与 provider actual usage 可对比。

### 工具输出

- [ ] 结构化字段选择优先于盲目 slice。
- [ ] secret 被脱敏。
- [ ] truncated 明确标记。
- [ ] 原始大结果不无限进入 Step JSON/model input。

### Compaction

- [ ] 触发阈值先于摘要算法定义。
- [ ] summary 有 source range/version/model/prompt metadata。
- [ ] 原始事实保留。
- [ ] 失败和并发不会破坏 active summary。
- [ ] 长会话评测可重跑。

### 工程验证

- [ ] unit/integration/contract/eval 命令记录完成。
- [ ] API/Web/workspace typecheck 通过。
- [ ] lint 通过。
- [ ] Prisma 有改动时 generate/validate 通过。
- [ ] `git diff --check` 通过。

## 17. Teach-back 复盘

1. 为什么 model history 不等于数据库 Message 列表？
2. `record` 与 `project for provider` 为什么分开？
3. token 预算为什么必须预留 completion？
4. 一个 orphan observation 应修复、拒绝还是忽略？当前选择及理由？
5. 为什么 tool pair 要作为裁剪原子？
6. summary 是事实、缓存还是投影？哪些 metadata 让它可审计？
7. compaction 失败后如何证明旧 history 没被破坏？
8. 哪个评测样本最能证明固定 12 条策略不足？
9. 为什么摘要不能替代权限过滤？
10. Provider 报 context length 时，如何区分估算偏差与 policy bug？

## 18. 阶段完成记录

```md
### 我现在能解释
- ...

### 我仍不确定
- ...

### 最关键的 Context 不变量
- ...

### 当前项目没有照搬 Codex 的部分
- ...

### 评测前后对比
- fixed 12：...
- budget：...
- budget + summary：...

### Phase 07 前置
- [ ] context 可从 canonical facts 重建
- [ ] summary activation 原子且可版本冲突
- [ ] tool side effect / observation 缺口有明确恢复策略
```
