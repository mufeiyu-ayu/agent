# Rollout Budget Accounting：共享计费、阈值提醒、超额提交与恢复漂移

本文研究 Codex如何给一个Root Thread及其子Agent共享模型token预算。重点不是UI里的服务端Rate Limit，而是本地Rollout Budget状态机：哪些tokens计费、何时判断耗尽、提醒怎样进入model history、rollback/compaction/fork后预算是否回滚或恢复。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/core/src/{rollout_budget,agent/control}.rs`、`codex-rs/core/src/session/{rollout_budget,turn}.rs`、`codex-rs/core/src/session/mod.rs`、`codex-rs/core/src/config/mod.rs`

## 1. Rollout Budget 与 Context Window / Provider Quota 是三种限制

Codex同时存在：

- Context Window：单次model prompt能装多少tokens，超限触发Compaction。
- Rollout Budget：一次root-session tree累计允许消费多少加权tokens。
- Provider Rate Limit/Quota：远端账户的分钟/周等服务端限制。

Rollout Budget不会改变模型context size，也不代表服务端实际计费；它是Agent Runtime的本地工作量上限，用于阻止长任务/多Agent无限继续。

## 2. Budget 由 AgentControl 共享给整个 Root Tree

`AgentControl`持有`Arc<RolloutBudget>`。Root Thread创建时根据config初始化；spawn出的child复用同一control内部Arc。

因此：

- Root sampling计费。
- Child sampling计费。
- 多child并行竞争同一余额。
- 任一response使余额耗尽后，后续所有共享control的Thread都会看到exhausted。

这比每个Agent各有额度更能限制fan-out成本；`Thread ID`只用于reminder投递，不用于拆账。

## 3. Config 只在 OnceLock 第一次生效

RolloutBudget内部是`OnceLock<Mutex<RolloutBudgetState>>`。`configure()`只在首次初始化：

- 保存limit/thresholds/weights。
- weighted used从0开始。
- deliveries为空。

后续configure不会修改已存在state。父子Thread或Turn config变化不能中途重设共享budget，避免某个child通过自己的config扩大总额度。

缺点是runtime没有显式返回“新config被忽略”，也没有budget config generation。

## 4. 配置验证保证形状合法，但允许零权重

启用feature时必须：

- `limit_tokens > 0`。
- 显式提供`reminder_at_remaining_tokens`。
- 每个threshold大于0且小于limit。
- sampling/prefill weights是finite且非负。

默认两类weight都是1.0。没有要求threshold排序/去重，也允许weight=0。

两种weight都为0时，正数limit永远不会耗尽；这是合法但容易误配置的“只提示不限制/实际不计费”状态，应该在diagnostics中warning。

## 5. 只计 Output 与 Non-cached Input

每个provider `TokenUsage`按公式累计：

```text
weighted += max(output_tokens, 0) * sampling_weight
          + max(input_tokens - max(cached_input_tokens, 0), 0) * prefill_weight
```

Cached input不计入prefill部分；reasoning output没有单独weight，若provider把它包含在output_tokens中则随output计费。

负数usage被clamp，cached大于input时non-cached为0。这避免异常数据直接减少已用量。

## 6. F64 支持权重，但引入舍入与解释成本

内部`weighted_tokens_used: f64`，remaining计算为：

```text
floor(max(limit - weighted_used, 0))
```

非整数权重便于把prefill/output成本映射为统一单位；但浮点累计存在微小误差，边界判断`used >= limit`可能受表示影响。

更可审计的计费可使用定点整数，例如micro-token credits，回执记录原usage、weight version和rounded delta。

## 7. Budget 在 Response Completed 后才扣减

普通sampling收到`response.completed`后：

1. 更新Session token usage cache。
2. 记录Rollout Budget usage。
3. 通知TokenUsage Contributors。
4. 若exhausted，返回`SessionBudgetExceeded`。
5. 外层仍发送TokenCount event，再把错误向Turn传播。

因此Budget是“post-paid hard stop”，不是请求前reservation。把余额推过上限的那次完整请求已经发生、已产生成本和输出。

## 8. 超额不会回滚已记录 Output 或 Tool 副作用

一次sampling在Completed前可能已经：

- 记录assistant/tool-call items。
- 启动并完成Tool side effects。
- 写入Rollout。

Completed usage使budget超额后，Runtime停止后续sampling，但不会删除这些事实或补偿副作用。

这符合审计真实性；如果产品承诺“绝不超过预算”，就必须在请求前reserve safety margin，而不能只靠completed usage。

## 9. 并发 Child 的硬上限仍可能明显 Overshoot

`record_usage()`用Mutex原子累计，所以不会lost update；但多个child可在余额尚未扣减时同时发出请求。

例如余额1000，三个child各自发出最多800 output的请求，全部在完成后扣费，总消费可到2400才全部停止。

共享计数保证一致记账，不等于并发准入控制。需要：

- request reservation。
- per-attempt max output bound。
- concurrency-aware available credits。
- completed后actual-reconcile/refund。

## 10. Reminder 在每次 Sampling 前写入 History

Run loop在构造StepContext和prompt之前：

1. 用当前Thread ID + window ID查询pending reminder。
2. 构造developer-role `<rollout_budget>` fragment。
3. 记录到conversation history。
4. 再标记delivered。

模型看到的是：“shared session token budget还剩N weighted tokens”。它可以据此收敛任务，但这只是guidance，不是安全 enforcement。

## 11. 初始 Window 也会收到一次 Reminder

当某Thread/window还没有delivery记录时，即使没有跨过任何threshold，`pending_reminder()`仍返回当前余额，`reminder_index=0`。

之后只有：

- 跨过更多threshold。
- window ID变化。
- 显式rearm。

才会再次投递。

所以threshold列表控制“追加提醒次数”，不是是否发送首次余额声明。

## 12. Threshold Index 用“已跨过多少条”表示

当前remaining小于等于某threshold时视为跨过；`reminder_index`是满足条件的threshold数量。

优点：

- 无需保存具体threshold值。
- 一次usage跨过多条时直接跳到最新index。
- threshold顺序不影响count。

边界：重复threshold会让index一次增加多格，但只发一条相同格式message；config允许未排序/重复，diagnostics不提示。

## 13. Delivery Identity 是 Thread + Window，不是 Turn

State为每个Thread保存最后：

- window ID。
- reminder index。

同一window跨多个Turn不会重复0级提醒；Compaction产生新window ID后，即使remaining和index没变，也会重新声明余额。

这适合让压缩后的新context重新获得预算信息。多child各自也会投递一次，让每个Agent都知道共享余额。

## 14. Reminder 自身也消耗共享 Budget

Reminder被写进model history，下一次provider usage的non-cached input会包含它，按prefill weight计费。

因此：

- 每个child首次提醒有成本。
- 每次Compaction新window重发有成本。
- threshold越多，提醒越频繁。
- 接近0时提醒本身加速耗尽。

这是合理的控制开销，但预算配置应预留system overhead，而不是把limit全部当业务token。

## 15. Mark-delivered 在 History Insert 之后

代码先`record_conversation_items()`，再更新delivery map。设计意图是：若在插入前取消，下次仍可重试提醒。

但`record_conversation_items()`的持久化错误通常是best-effort；内存history已插入后仍会mark delivered。崩溃前未durable时，cold resume可能既没有message，也没有delivery state，因为两者都不在Budget持久状态中。

当前保证主要是进程内因果顺序，不是跨崩溃exactly-once。

## 16. Reminder 是 Model Guidance，不是 UI Typed State

余额只通过developer fragment进入模型；Budget本身没有通用typed snapshot API返回：

- weighted used。
- raw usage breakdown。
- current remaining。
- config/weight version。
- shared child list。

客户端主要在耗尽时看到`SessionBudgetExceeded`错误。用户很难在运行中准确观察本地预算与远端quota的区别。

应该同时提供typed runtime event/UI projection，模型提示只是一个consumer。

## 17. Compaction V2 也计费，但可能“付费后不安装”

Remote Compaction V2收到completed token usage后，先`record_rollout_budget_usage()`，再构造/安装replacement history。

如果compaction本身把Budget耗尽：

- usage已经累计。
- compaction request/output已发生。
- 函数返回SessionBudgetExceeded。
- replacement history尚未安装。
- Thread仍保留旧大history，却已无预算继续sampling。

这是重要partial outcome，应有专门`compaction_budget_exhausted_before_install` receipt，而不是普通失败。

## 18. Local Compaction 的超额也可能留下中间 Output

Local compaction drain：

- 每个OutputItemDone先写conversation history。
- Completed时更新token usage并扣Budget。
- 若超额，drain返回error。
- 后续summary extraction/replacement不执行。

因此旧history上可能留下compaction模型的assistant输出，但没有Compacted checkpoint。重试/恢复需要能识别这是失败compaction turn的中间fact。

## 19. 不同 Compaction 实现的计费覆盖并不完全相同

- Remote V2显式拿Completed TokenUsage并计入Budget。
- Local通过普通stream Completed路径计入。
- Token-budget window reset不调用模型，不计费。
- Remote V1专用compact endpoint路径没有同样明确的本地TokenUsage计费接口。

这意味着“同一个logical compaction”在不同provider/feature路径的预算accounting可能不同。Feature A/B或fallback时必须记录implementation，不能只比较最终remaining。

## 20. Rollback 不退款，只 Rearm 提醒

Thread rollback重建旧history、recompute当前context token estimate，并调用`rearm_reminder(threadId)`；它不会减少`weighted_tokens_used`。

这是正确的成本语义：远端模型调用已经产生，删除model-visible历史不能让账单消失。

Rearm让下一次sampling重新声明当前余额，因为rollback后的模型context可能已失去之前提醒。

## 21. Compaction 也不退款

Compaction减少active context tokens，只改变未来prompt成本；此前sampling output/non-cached input已真实消费，所以Rollout Budget不减。

这再次区分：

- Context usage是当前窗口状态，可因压缩下降。
- Rollout usage是累计成本，单调不减。

把两者共用`tokenUsage`字段会造成“为什么压缩后额度没回来”的产品困惑。

## 22. Cold Resume / Fork 不恢复已用 Budget

RolloutBudget state没有进入Rollout/SQLite；新`AgentControl`配置后从0开始。Cold resume同一Thread或从历史fork创建新root tree时，之前weighted usage不回放。

Live child共享是严格的，跨进程恢复则重置。这使Budget更像“当前进程session工作量限制”，不是Conversation lifetime quota。

如果产品要跨重启保证成本上限，必须持久化usage ledger和operation dedupe，而不只是最后余额。

## 23. Usage 缺少 Attempt / Response Idempotency Key

`record_usage()`只接收TokenUsage数值，没有：

- response ID。
- Turn/Step/attempt ID。
- provider request ID。
- model/provider。
- timestamp。

同一Completed usage若因上层bug/重放被调用两次，会重复计费；相反某条路径未调用则漏计。没有ledger就无法对账或修复。

## 24. Once Exhausted 后状态保持 Exhausted

`record_usage()`每次继续累加并返回`used >= limit`。没有单独exhausted flag，但由于used单调不减，后续调用永远返回true。

Reminder remaining被clamp为0，不会显示负余额/overshoot数值。用户只知道耗尽，不知道超了多少，也无法分析并发overshoot。

Typed snapshot应同时提供`remaining=0`和`overshootCredits`。

## 25. Budget Error 归类为明确 Codex Error

`SessionBudgetExceeded`有独立Core error、protocol error info和analytics kind，而不是映射成generic context/rate-limit error。

这很重要：

- ContextExceeded可Compaction重试。
- RateLimit可能等待reset。
- SessionBudgetExceeded是本地任务治理终止。

客户端应给不同恢复动作，不能统一显示“额度不足”。

## 26. 当前最值得保留的设计

1. Root与所有child共享同一Arc预算，控制fan-out总成本。
2. Output与non-cached input分权重，cached input不重复收费。
3. Mutex让并发completed usage不丢账。
4. Used单调不减，rollback/compaction不伪造退款。
5. Reminder按Thread+window投递，新context会重新获得预算提示。
6. History insert后才mark delivery，保持进程内因果。
7. Budget error有独立协议分类。
8. Config验证positive limit、合法threshold和finite nonnegative weights。

## 27. 当前需要改进或避免的边界

1. Post-paid检查不能保证hard cap，并发child可显著overshoot。
2. 缺reservation、actual reconcile和per-attempt max output。
3. Usage无operation/response idempotency key，可能重复或漏计。
4. F64累计/rounding不如定点ledger可审计。
5. Reminder自身消耗预算但缺system overhead说明。
6. 每个Thread/window首次都发提醒，多Agent fan-out增加隐形成本。
7. 余额只有model fragment，没有完整typed UI/API snapshot。
8. Remote V1/Local/V2等实现的计费覆盖不完全一致。
9. Compaction可能付费后不安装，缺专用partial outcome。
10. Cold resume/fork从0重置，无法提供Conversation-lifetime guarantee。
11. Threshold允许重复/乱序、权重全0而无warning。
12. Remaining clamp 0隐藏实际overshoot。

## 28. 更适合云端 Agent 的 Budget Ledger

```ts
type BudgetReservation = {
  reservationId: string;
  tenantId: string;
  runTreeId: string;
  operationId: string;
  attempt: number;
  reservedCredits: bigint;
  expiresAt: string;
};

type UsageReceipt = {
  providerResponseId: string;
  reservationId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  weightVersion: string;
  chargedCredits: bigint;
  committedAt: string;
};
```

请求前原子reserve；请求完成后用provider receipt实际结算，多退少补；相同response ID幂等。Child必须在同一run-tree账户下reserve，不能各自读余额后并发超发。

## 29. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Config | 缺limit、非正limit、坏threshold、重复/乱序、NaN/Inf/负/零weight |
| Formula | cached/non-cached、cached>input、负token、fractional weight、rounding边界 |
| Shared tree | root+child、多个child并发、child config不能重置、不同root隔离 |
| Hard cap | 单请求overshoot、三child并发overshoot、reservation过期/退款 |
| Reminder | initial index 0、跨一/多threshold、每Thread、每window、rearm |
| Reminder cost | 提示自身prefill、Compaction反复重发、100 child fan-out |
| Ordinary Turn | cache update、Contributor、TokenCount、Exceeded错误顺序 |
| Compaction | Local中间output、V2付费未安装、V1计费差异、Token reset零成本 |
| History ops | rollback不退款但rearm、compaction不退款、delete/archive |
| Recovery | cold resume、fork、新进程、ledger replay、重复response receipt |
| Observability | remaining、raw breakdown、weight version、overshoot、error分类 |

## 30. 对当前项目的学习结论

当前AI SEO Agent未来需要按租户/Run限制模型成本时，应直接采用ledger/reservation，而不是只在内存累加：

1. Conversation context budget、AgentRun cost budget、供应商quota分别建模。
2. Root Run与所有child/Tool-evaluator共享一个run-tree budget account。
3. 请求前reserve最坏成本，请求后按provider response ID幂等结算。
4. Cached input、output、工具外部费用按versioned定点权重计费。
5. Rollback/压缩不退款；被取消且provider未提交的reservation才释放。
6. Model reminder与用户UI都消费同一typed BudgetSnapshot，提示只是projection。
7. 超额、并发overshoot、partial compaction和恢复重放都有durable receipt。

Codex最优质的部分是root-tree共享、non-cached/output分权重、单调成本语义、Thread+window提醒和独立错误分类。需要避免的是completed后才检查导致overshoot、无request reservation/idempotency ledger、提醒自耗无透明度、compaction路径计费不齐，以及cold resume/fork把累计成本归零。
