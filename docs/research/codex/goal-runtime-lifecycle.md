# Goal Runtime 生命周期：持久目标、增量记账、Idle Continuation 与状态所有权

本文研究 Codex 实验性 Goal extension 如何让一个用户明确目标跨多个Turn持续推进，如何记录token/时间预算，如何在Thread变空闲时自动继续，以及模型、用户和系统分别能改变哪些状态。重点不是`create_goal`三个Tool本身，而是长任务如何避免“一个Turn结束就等于任务完成”。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/ext/goal/src/**`、`codex-rs/state/src/{model,runtime}/goals.rs`、`codex-rs/app-server/src/request_processors/thread_goal_processor.rs`

## 1. Goal 是 Thread 级持久控制状态，不是更长的Prompt

每个Thread最多一条`thread_goals`记录：

```text
thread_id             SQLite主键与外键
goal_id               当前目标generation
objective             用户明确目标
status                控制状态
token_budget          可选预算
tokens_used           已记账非缓存input + output
time_used_seconds     已记账wall time
created_at/updated_at 生命周期时间
```

Goal状态保存在SQLite，Turn内的active goal、token baseline与wall-clock baseline只在`GoalAccountingState`内存中。持久业务事实与运行期计量器明确分层。

## 2. 状态不是简单“进行中/完成”二态

当前状态：

```text
Active
Paused
Blocked
UsageLimited
BudgetLimited
Complete
```

控制权被刻意拆分：

- 模型Tool只能创建，或标记`Complete` / `Blocked`。
- 用户/App Server可修改objective、status和budget。
- 系统在额度错误时标`UsageLimited`。
- 记账达到token budget时标`BudgetLimited`。
- Turn terminal error会标`Blocked`，防自动续跑死循环。

这比让模型随意`pause/resume`安全：预算与外部额度属于产品控制面，不是模型自我授权。

## 3. `goal_id`是目标Generation，解决同Thread的ABA

替换目标时生成新UUID并重置usage/time；更新与usage accounting多数路径可携带`expected_goal_id`：

```text
Thread A: goal G1 active
  -> async accounting snapshot expects G1
user replaces with G2
  -> stale G1 accounting update WHERE goal_id=G1 affects 0 rows
```

没有generation fencing，旧Turn的迟到事件可能给新目标扣费、改状态或错误完成。`thread_id`只能标识容器，`goal_id`才标识这一代工作。

## 4. 模型不能从普通任务自动推断Goal

Tool description明确要求：只有用户或system/developer显式要求时才能`create_goal`；`token_budget`也必须显式请求才设置。

这是必要的产品边界。持久目标会触发跨Turn自动工作与额度消耗，不能因模型认为任务“看起来很长”就自行扩大执行寿命。

在云端Agent中，创建后台Run/定时Job同样属于显著状态变更，应由显式API或用户确认驱动。

## 5. 创建Goal使用条件Upsert，未完成目标不会被模型覆盖

`insert_thread_goal()`：

- 无记录时insert。
- 仅当现有status为`complete`时替换。
- 其他状态返回None，Tool提示先完成现有Goal。

因此模型不能用第二次`create_goal`绕过Paused、Blocked或BudgetLimited状态。用户/App Server的`set`则可以更新已有objective，属于更高权限控制面。

## 6. Objective 校验与预算校验是服务端事实

Tool与external API都会trim/校验objective；budget存在时必须为正数。Schema里的说明不是唯一防线，后端再次验证。

外部更新objective时保留原`goal_id`、usage和created time；只有不存在目标时才创建新代。也就是说“编辑当前目标”和“替换成新目标”语义不同。

当前API在已有目标上设置新objective不会生成新generation，这适合轻量纠偏；若objective发生根本变化，旧usage仍归入新文本，审计上可能难以解释。未来可显式区分`editObjective`与`replaceGoal`。

## 7. Goal-first Thread 用Objective填空Preview

创建或首次外部设置objective时，若Thread preview为空，State DB best-effort填入objective。这样尚无用户Turn的Goal-first Thread也能被列表发现。

Preview失败只warning，不回滚Goal；它是查询投影而非Goal事实。这个取舍合理，但客户端不能用preview存在与否判断Goal是否创建成功。

## 8. Turn Start 建立本Turn的Usage Baseline

`on_turn_start`把：

- Turn ID。
- Turn开始时累计TokenUsage。
- collaboration mode。

写入内存计量器。普通模式会读取SQLite Goal；Active或BudgetLimited都绑定到本Turn。Plan mode明确`account_tokens=false`并清active goal，不给Goal扣token。

Plan mode排除体现“思考如何做”和“执行目标”可以采用不同计费口径。但它仍使用模型资源；这只是Goal业务账本，不是平台真实账单。

## 9. Token口径是Non-cached Input + Output

单次增量计算：

```text
max(input_delta - cached_input_delta, 0)
  + max(output_delta, 0)
```

Reasoning output没有单独再次相加，依赖provider的output统计口径；总量使用saturating arithmetic，避免计数器回退造成负扣费。

这与Rollout Budget的浮点权重账本不同：Goal使用整数且无可配置input/output权重。两个“预算”不是同一个系统，产品层应避免都只叫token budget。

## 10. Token Event 只更新内存，Tool/Turn边界才Flush到SQLite

`on_token_usage`记录当前累计usage，但不每次写DB。持久flush发生在：

- handler实际执行后的Tool finish。
- `update_goal`前。
- Turn stop/abort/error。
- external goal mutation前。

这是write coalescing：高频token事件留内存，关键生命周期边界写持久账本。相比每delta更新数据库，锁竞争与I/O更小。

代价是进程在两次flush之间崩溃会少记账；Goal budget是soft/product budget，不能当精确财务账本。

## 11. Progress Accounting 用单许可锁防重复Flush

每个Thread有一个`progress_accounting_lock`。调用方从：

1. 读取snapshot。
2. SQLite原子累加。
3. 标记内存baseline已accounted。

全程持有permit。多个并发Tool finish不会对同一token/time delta重复扣费。

如果DB写失败，baseline不前移，后续边界可以重试相同delta。这是正确的“持久化成功后才ack内存进度”。

## 12. Wall Clock 只在Goal Active期间累计

计量器以`Instant`保存`last_accounted_at`和active goal ID。激活新Goal时重置baseline；clear时也重置。Snapshot把自上次account以来的整秒数写DB。

Goal在Turn间保持Active时，idle时间也会累计；恢复Thread时Active Goal重新从当前进程时间开始，不可能补回应用关闭期间的wall time。

因此`time_used_seconds`准确表达“本进程观察到的active elapsed time”，不等于从created_at到现在的日历时长。

## 13. Database 在一次UPDATE中累加Usage并切BudgetLimited

`account_thread_goal_usage()`单条SQL完成：

```text
tokens_used += token_delta
time_used_seconds += time_delta
if eligible status and tokens_used + delta >= token_budget
  status = budget_limited
```

WHERE同时限制Thread、允许状态和可选expected goal ID；`RETURNING`给出提交后的完整状态。累加与状态转移不会被并发writer拆开。

Budget是post-paid soft limit：本次采样/Tool已经发生，提交usage后才发现越界。它能阻止下一轮自动续跑，却不能精确截断当前model response。

## 14. 不同Flush场景使用不同Status Filter

`GoalAccountingMode`区分：

- `ActiveStatusOnly`。
- `ActiveOnly`：Active或BudgetLimited。
- `ActiveOrComplete`。
- `ActiveOrStopped`：Active/Paused/Blocked/UsageLimited/BudgetLimited。

例如模型先把Goal Complete，再补记同一次Tool前积累的usage，需要允许Complete状态接收最后delta；标Blocked也需对Stopped状态收尾。

状态过滤不是多余复杂度，而是解决“业务状态切换”与“迟到usage flush”的提交顺序。

## 15. Tool Attempt 是否记账取决于Handler是否真正执行

Tool lifecycle只对以下情况flush：

- Completed。
- Failed且`handler_executed=true`。

Blocked、执行前失败、Aborted不在Tool finish边界扣本次增量；最终Turn stop仍可能统一flush已记录token。`update_goal`自己被排除，避免同一call在lifecycle与Tool内部重复account。

这里记的是模型token，不是Tool CPU/外部API费用。Tool失败是否产生业务成本，需要另一份Tool usage ledger。

## 16. 达到预算时先注入Steering，让当前Turn有机会收口

Tool finish flush后若Goal变为BudgetLimited：

1. 内存仍可暂时保留active goal。
2. 每个goal ID只报告一次budget limit。
3. 向运行中的Turn注入内部goal context。
4. Prompt要求停止新 substantive work、尽快总结、不要因预算耗尽假装完成。

这比立即硬中断更友好：模型可以留下进度和下一步。但注入本身仍会产生后续模型token，预算会继续overshoot。

## 17. Goal Prompt 把Objective当不可信数据并做XML Escape

Continuation、Budget Limit、Objective Updated模板都会转义`&<>`，并明确objective是user-provided data，不是高优先级instruction。

这降低objective闭合标签注入风险。仍需注意：XML escape只保护模板结构，不会消除自然语言prompt injection；真正权限仍由Tool registry、sandbox和服务端policy决定。

## 18. Idle Continuation 只在Active Goal且Thread真正Idle时启动

Thread idle hook调用`continue_if_idle()`：

1. Goal tools必须可见。
2. 获取per-thread goal state permit。
3. ThreadManager与live Thread必须存在。
4. SQLite Goal必须仍是Active。
5. 构造内部continuation item。
6. 调`try_start_turn_if_idle()`原子准入。

若用户Turn已经占用Thread，启动被拒绝；它不会排队挤在用户输入后面。准入后再检查accounting是否确实绑定active goal，否则清状态。

## 19. Goal State Permit 防External Mutation与Idle Start交错

External set/clear在读取旧状态、结算progress、写DB期间持有单许可锁；idle continuation也从读Goal到尝试start全程持锁。

因此不会出现：

```text
idle读取G1 active
user暂停G1
idle仍用旧快照启动新Turn
```

这是状态控制面与调度面的正确互斥范围：锁不包整个Goal Turn，只包“决定是否启动”的短窗口。

## 20. Objective在Active Turn中更新时通过Steering生效

External更新同一Goal objective后：

- 若当前Turn active，向其注入`objective_updated`内部item。
- 若Thread idle且状态Active，触发idle continuation。
- 若是新goal ID或从停止态恢复，重置相应accounting baseline。

模型不必等下一个用户消息才知道目标变化。Steering内容同时给出used/budget/remaining，帮助它调整当前工作。

## 21. Resume 只恢复“Active事实”，不恢复内存计时断点

Thread resume从SQLite读取Goal：

- Active：标记idle goal active，记录resumed metric。
- 其他/不存在：clear active accounting。

App Server先按listener顺序发resume response和Goal snapshot，再触发Thread idle lifecycle；因此客户端先看见持久状态，后台续跑才可能开始。

这是优质的可观察顺序：`resume`成功回执不应被自动Turn事件抢在前面。

## 22. Turn Error 自动Stop，避免无限错误续跑

非usage-limit terminal error将Active Goal改为Blocked；UsageLimitExceeded改为UsageLimited。状态更新前先结算ending Turn usage。

源码注释特别指出compaction error可能导致自动continuation循环消费token，因此任何重试耗尽/不可重试错误都停止Goal。

“自动续跑”必须配套error circuit breaker；否则普通Agent的一次失败会升级为无人值守的费用事故。

## 23. `Blocked`不是所有失败的通用垃圾桶

Tool description要求模型只有在同一阻塞条件连续至少三次Goal Turn出现且真正无法推进时才标Blocked；困难、缓慢、需要澄清或未完成都不够。

系统Turn Error却会立即Blocked，这是不同authority的语义：Runtime知道本Turn terminal failure，模型自报则需更严格阈值防逃避任务。

同一个status由不同actor写入时，最好额外记录`status_reason`与`status_actor`；当前表没有这两个字段，审计只能结合analytics/event推断。

## 24. Complete Tool 返回结构化最终Usage提示

`update_goal(complete)`响应包含Goal完整字段、remaining tokens，并在有budget或time usage时附`completion_budget_report`，提示模型把最终usage报告给用户。

这是“业务提交后再生成用户声明”：最终数字来自DB返回值，不让模型凭记忆估算。

但Tool update本身不是一个durable user-facing receipt；若模型在Tool成功后stream断开，Goal已Complete，用户可能没看见总结。Resume/Get Goal可以恢复状态，但产品应明确显示最后提交事实。

## 25. App Server 使用Response→Notification→Runtime Effect顺序

外部`thread/goal/set`流程：

1. 定位materialized非ephemeral Thread与State DB。
2. 先reconcile rollout/State投影。
3. Goal Service结算旧progress并写SQLite。
4. live Thread best-effort追加Goal Event到rollout。
5. 发RPC response。
6. 按listener FIFO发Goal updated notification。
7. 应用runtime effect，可能steer或idle continue。

前端先得到set结果，再观察后续运行效果，顺序清晰。Runtime effect失败只warning，已提交Goal不会回滚。

## 26. Goal事实、Rollout Event与客户端通知存在Partial Commit

SQLite写成功后，rollout append失败只warning，RPC仍成功；非live Thread外部设置也不会在这里追加live rollout item。Goal的authoritative read来自State DB，rollout event更多是历史/preview投影。

这必须在文档中明确，否则恢复代码可能错误地认为“rollout没有goal event，所以goal不存在”。跨存储写入若都要审计，应使用outbox，而不是best-effort双写。

## 27. Clear 是删除事实，不是Terminal Status

`thread/goal/clear`先结算active/idle progress，再DELETE row；成功后发`ThreadGoalCleared`notification并清runtime active state。

Clear不保留objective、usage或结束原因。若产品需要长期Goal历史、复盘或计费，当前单行模型不够；应append GoalExecution记录，另有current pointer。

## 28. Goal Tool Update 存在一个值得警惕的Generation窗口

Runtime内部accounting通常携带expected goal ID，但模型`update_goal`在结算后执行最终status UPDATE时传`expected_goal_id=None`。External mutation使用goal-state permit，Tool update本身没有持有同一permit。

因此理论交错为：

```text
Tool为G1完成usage accounting
external control把当前记录替换/修改为G2
Tool无expected ID把当前行标Complete/Blocked
```

创建规则使常见替换受限，但外部set拥有更强控制能力，这个窗口仍不应依赖“通常不会并发”。最终status commit应绑定Tool开始时观察到的goal ID；所有Goal writer共享同一fencing策略。

## 29. Event ID 不等于持久幂等键

Goal Event使用Tool call ID或合成的`turn:turn-stop`、`turn:error-progress`等字符串。它们便于归因，但SQLite accounting没有独立operation receipt表；正确性主要来自内存baseline、锁与goal ID CAS。

若DB commit成功后进程在baseline ack前崩溃，恢复时内存baseline丢失，通常不会自动重放同一delta；但也没有“这个usage operation已提交”的可查询证据。精确账本需持久`operation_id UNIQUE`。

## 30. Feature Disable 会隐藏Tools，但不会删除持久Goal

Config changed只更新extension enabled flag。关闭时不清SQLite Goal；重新开启/Resume可恢复Active状态。

这是合理的可逆feature gate，但关闭瞬间若已有active Turn，旧runtime hook之后会因disabled跳过flush/stop，可能留下未结算delta。Feature切换应定义：立即暂停、等待Turn收口，还是只影响下一Turn。

## 31. 对当前 AI SEO Agent 的迁移价值

当前阶段可以学习Goal思想，但不应直接复制无人值守续跑。更适合先做：

```text
AgentRun.status        = durable run fact
AgentRun.objective     = current user intent snapshot
AgentRun.generation    = optimistic concurrency fence
AgentRun.usage         = provider usage receipt accumulation
AgentRun.stopReason    = user | error | usage | budget | complete
```

等单Turn Tool Calling、HITL、错误恢复稳定后，再引入：

- 持久长目标。
- Idle auto continuation。
- Soft budget steering。
- 跨Turncompletion audit。

否则Goal会把现有Run边界的所有不确定性放大。

## 32. 可验证的不变量清单

未来实现长任务时可先写这些测试：

1. 普通任务不会隐式创建持久Goal。
2. 同Thread未完成Goal不能被模型创建的新Goal覆盖。
3. 旧generation的usage/status更新不能影响新Goal。
4. 并发Tool finish不会重复account同一usage delta。
5. DB失败时内存baseline不前移，重试仍能提交。
6. Plan/inspection mode是否计费有明确且测试覆盖的规则。
7. Budget越界后不再启动新的automatic Turn。
8. Budget-limited当前Turn只收口，不被误标Complete。
9. Terminal Turn error阻止idle continuation死循环。
10. User pause/set与idle start不能交错启动陈旧Goal。
11. Resume snapshot先于automatic continuation事件可见。
12. Complete后的最终usage来自持久提交结果。
13. Feature disable对active Turn和未flush usage有确定语义。
14. Clear可幂等重试并给出是否曾存在的receipt。

## 33. 最终结论

Codex Goal Runtime最值得学习的是：它把“长期做一件事”建模为持久状态、generation、增量记账、状态authority、idle准入、error熔断和用户可见投影的组合，而不是用一个更强硬的Prompt要求模型“不要停”。

当前实现的强项是goal ID fencing、DB原子usage累加、持久成功后才ack baseline、Goal状态控制权分离、goal-state permit与idle start互斥、budget steering和resume ordering；主要风险是soft budget必然overshoot、进程崩溃少记未flush usage、wall time不覆盖离线时段、状态缺actor/reason、SQLite/rollout双写partial commit、Tool最终status未绑定expected goal ID，以及feature动态关闭的收口语义不完整。

对服务端Agent而言，只有当Run identity、usage receipt、停止原因和恢复策略已经可靠时，自动续跑才是能力；在此之前，它只是把一个不可靠Turn变成会重复消耗资源的不可靠循环。
