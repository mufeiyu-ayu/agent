# Context Compaction Transaction：触发窗口、三种实现、历史替换与恢复提交

本文研究 Codex 如何在长对话接近上下文上限时，把活跃model history重写为一个新窗口。重点不是“让模型总结一下”，而是Compaction作为状态迁移：何时触发、使用哪一代模型、哪些历史被保留、什么时候算安装成功、失败后旧历史是否仍有效。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/core/src/compact*.rs`、`codex-rs/core/src/session/{turn,context_window}.rs`、`codex-rs/core/src/session/mod.rs`、`codex-rs/core/src/state/auto_compact_window.rs`

## 1. Compaction 是替换 History Window，不是删除 Rollout

Codex保留append-only Rollout事实，同时把当前`ContextManager`替换成更短的model-visible history：

```text
old live history
  -> compact request / summary
  -> validate + normalize replacement
  -> assign new window identity
  -> replace in-memory ContextManager
  -> append CompactedItem(replacement_history)
  -> append WorldState / TurnContext baseline
  -> recompute token usage
```

旧ResponseItems没有从Rollout物理删除；恢复时reducer遇到最新`CompactedItem`，把其`replacement_history`作为新基线。Compaction因此是append-only日志上的逻辑checkpoint。

## 2. 触发点分 Pre-turn、Mid-turn 和 Standalone

Codex有三种phase：

- `PreTurn`：新Turn正式记录context diff与用户输入之前。
- `MidTurn`：一次sampling产生Tool Call/需follow-up后，继续采样前。
- `StandaloneTurn`：用户显式请求manual compact。

Pre-turn先检查模型兼容切换，再检查token limit；Mid-turn只在仍需follow-up且token limit达到，或model/tool请求新context window时触发。Standalone会发独立`TurnStarted`。

触发phase会改变初始context的插入位置，不能把三条路径合并成一个“summarize(history)”函数。

## 3. 当前 Pre-turn 估算尚未包含即将注入的输入

`run_turn()`在记录新一轮context updates、skills/plugins和user input之前执行pre-sampling compact。源码TODO明确指出：当前判断只看既有history，没有估算即将加入的full/diff context和本轮输入。

结果是pre-turn检查可能认为仍有空间，真正构造首次sampling prompt后才越界。更完整设计应在准入时计算：

```text
existing active tokens
+ expected context reinjection/diff
+ user input
+ selected skill/plugin prompt
+ tool schema budget
+ reserved output tokens
```

这是服务端Agent尤其需要的“Admission Budget”，不能等provider返回context exceeded才补救。

## 4. Total 与 BodyAfterPrefix 是两种计费口径

`context_window_token_status()`同时计算完整context和auto-compact scope：

- `Total`：全部active context tokens都计入auto-compact threshold。
- `BodyAfterPrefix`：从active tokens减去当前window的prefill baseline，只对prefix之后的增长计费。

无论scope如何，完整model context window达到上限都会触发。`tokens_until_compaction`取scope remaining与full-context remaining的更小值。

这让稳定的大prefix不必每个window都侵占同样的“增长预算”，但仍不能突破模型真实context上限。

## 5. Prefill Baseline 有 Estimated → ServerObserved 的单向升级

每个AutoCompactWindow记录：

- window number。
- first / previous / current window UUIDv7。
- new-context请求位。
- prefill input tokens。
- reminder是否已发。

Resume/recompute可以先写estimated prefill；当前window第一次拿到server usage后，用`usage.input_tokens`替换估算。ServerObserved一旦存在，后续estimated或其他server sample不再覆盖。

这是优秀的事实优先级：恢复时先允许近似值维持可用，真实provider测量到达后单向提升，不在多个估算之间抖动。

## 6. 模型切换先判断 Compaction Compatibility

每轮保存previous model与`comp_hash`。下一轮：

- 旧/新hash都存在且不同，优先用旧模型执行compaction。
- hash缺失不视为不兼容，因为证据不足。
- hash相同但新模型context window更小，且现有tokens超出新limit时，也用旧模型先compact。
- OpenAI/Codex backend特定条件下，旧模型返回InvalidRequest可用当前模型fallback。

为什么用旧模型：它最理解产生当前history的compaction格式与能力。为什么只对InvalidRequest fallback：其他错误不证明模型不兼容，贸然换模型会掩盖真实故障。

## 7. Compaction Implementation 是策略路由，不是一个端点

`run_auto_compact()`选择：

1. Token Budget feature：不调用模型，直接新建context window。
2. Provider支持remote compaction + V2 feature：普通Responses stream + `CompactionTrigger`。
3. Provider支持remote compaction但V2未启用：专用compact conversation endpoint。
4. 其他provider：本地summarization prompt。

Manual路径也映射到相应实现。Analytics明确记录implementation、trigger、reason和phase，避免把不同质量/成本/失败模型混成一个指标。

## 8. Local Compaction 是一次真实模型Turn

本地实现：

1. 发`ContextCompaction` started item。
2. 把summarization prompt作为临时user input追加到克隆history。
3. 新建一个ModelClientSession，并在重试间复用。
4. stream直到`response.completed`。
5. 每个`OutputItemDone`先记录进真实conversation history。
6. completed usage更新token state。
7. 从本次Turn最后assistant message构造带固定prefix的summary。
8. 用最近真实user messages + summary构造replacement。

这不是纯函数：summary模型输出会先成为旧history上的事实，然后Compacted checkpoint再把model-visible history重写。

## 9. Local ContextExceeded 会逐项裁旧 Prompt，但不修改原事实

本地compaction请求若provider返回ContextWindowExceeded且prompt仍有多个items：

- 从临时history开头删除一个item。
- 重置普通stream retry计数。
- 重新尝试summarization。

删除只发生在compaction用的clone，不立即改live history/Rollout。这样失败时旧history仍完整；成功summary可能没有看见被裁掉的早期内容。

随后replacement仍从live history收集真实user messages，所以会保留最多20k近端user-message tokens；但summary对被裁内容的语义覆盖无法保证。这里需要analytics记录最终summary实际输入范围。

## 10. Local Replacement 保留最近 User Messages，再追加 Summary

`collect_user_messages()`只收能投影为真实`TurnItem::UserMessage`的items，排除已有summary。每条保留metadata passthrough。

`build_compacted_history()`从后往前在20,000 token总预算内选最近user messages；边界消息按token截断，然后反转回原顺序。最后追加一个user-role summary message。空summary会写`(no summary available)`。

这种“原始用户意图 + 压缩叙事”双轨，比只保存summary更能防止模型改写用户原话。不过固定20k只计算文本，不代表整个replacement一定在安全预算内。

## 11. Remote V1 返回完整替代 History

Remote V1在调用compact endpoint前：

- clone当前history。
- 估算base instructions + history tokens。
- 只从尾部连续改写Function/Custom Tool output或ToolSearchOutput，直到可放进context或遇到不可改写item。
- 捕获StepContext下的model-visible tool specs。
- 发送prompt并获得`new_history`。

本地改写仅用于compact请求，不改canonical Rollout。被改写output保留call ID与success，只把body替成统一“超出上下文已截断”文本，ToolSearch tools清空。

“只改连续尾部”很保守，但如果history最后一个item不是可改写output，即使更早存在巨型tool output也不会继续扫描，compact请求仍可能超限。

## 12. Remote 输出不能直接成为 Canonical Context

`process_compacted_history()`过滤remote结果：

- 丢developer messages，防止服务端返回陈旧/重复instructions。
- user-role只保留能解析为真实UserMessage或HookPrompt的内容。
- 保留assistant/AgentMessage和Compaction item。
- 丢reasoning、tool calls/outputs、tool search、web/image call等执行过程items。
- 丢`CompactionTrigger`，因为它是request control，不是durable response item。

然后从当前Session重新生成canonical initial context。这里明确区分“模型压缩出的语义历史”和“本地authority拥有的当前指令/环境事实”。

## 13. Remote V2 用 Responses Stream，但要求 Exactly One Compaction Item

V2不调用专用compact endpoint，而是在普通Responses prompt尾部追加`ResponseItem::CompactionTrigger`，带当前tools和base instructions采样。

Collector：

- 统计所有OutputItemDone。
- 只保留第一个Compaction item候选。
- 必须看到`response.completed`。
- 最终`compaction_count`必须精确等于1，否则Fatal。
- completed token usage单独返回。

这比“取最后一条输出当summary”更严格。额外非Compaction output只参与count，不进入replacement；provider若输出0或2个Compaction items，整个attempt失败。

## 14. V2 Retention 是最近消息 + 加密 Compaction Output

V2先从原prompt input筛选message items，再经过通用remote过滤，实际主要留下真实user/HookPrompt；developer/system会被过滤。随后从后往前按64k文本token预算保留，并追加provider返回的Compaction item。

图片token在retention计数中按0处理，图片仍保留并另记`retained_image_count`。因此64k是文本近似预算，不是payload bytes、图片patch tokens或provider真实总token预算。

巨量图片可以绕过文本预算，仍造成请求/内存/历史负担；应增加image count、decoded bytes和estimated vision tokens三类上限。

## 15. Remote Stream Retry 与 Model Fallback 是两层 Attempt

V2每个model attempt内部最多取provider stream retries与常量2的较小值。连接/流错误按Responses retry handler处理；若整个旧模型attempt以InvalidRequest失败，外层才可能换当前模型重试。

这意味着总请求次数可能是：

```text
(旧模型初始 + 最多2次stream retry)
+ (当前模型初始 + 最多2次stream retry)
```

当前缺统一compaction deadline、attempt count和cost ceiling。单层限制不能替代operation总预算。

## 16. Mid-turn 与 Pre-turn 的 Context Injection 位置不同

Pre-turn/manual使用`DoNotInject`：replacement不含initial context，`reference_context_item`清空；下一次普通Turn会完整重新注入当前context。

Mid-turn必须立即继续同一Turn，使用`BeforeLastUserMessage(world_state)`：

- 生成与该WorldState匹配的完整initial context。
- 优先插在最后一个真实user message之前。
- 没有真实user时插在summary/Compaction item之前。
- 保持compaction summary/item位于history末尾，符合模型训练期望。
- 同时保存WorldState full baseline和TurnContext reference。

位置是协议不变量，不是展示排序。

## 17. 新 Window 有显式 Lineage

每次compaction：

- `window_number`饱和加1。
- `previous_window_id = old window_id`。
- 创建新UUIDv7 `window_id`。
- `first_window_id`保持不变。
- 清空new-context request和reminder状态。

`CompactedItem`持久化这组identity。Resume优先从最新compaction恢复lineage；旧格式缺字段时才用session fallback。

相比只记`compactionCount`，lineage能把sampling、usage、trace和checkpoint关联到明确window，避免同一Thread内跨压缩代际混账。

## 18. Install Boundary 是 History Replacement，不是 Request Completed

Remote trace区分：

- endpoint/Responses attempt完成。
- compaction output被验证。
- replacement history被安装。

`record_installed()`记录真实compact输入history与replacement history。只有后者才改变后续sampling语义。请求成功但在normalize/install前失败，不能宣称Compaction完成。

这是值得迁移的“计算成功 ≠ 状态提交成功”模型。

## 19. 当前 Commit 顺序是 Memory-first，再异步持久化

`replace_compacted_history()`：

1. 必要时为replacement items补ID。
2. 在Session state lock内替换live history/reference context，并设置WorldState baseline。
3. append `RolloutItem::Compacted`。
4. 再appendWorldState full item。
5. 再appendTurnContext item。
6. queue下一次Compact来源的SessionStart hook。

写入接口在失败时多为记录错误而非回滚live state。进程若在memory替换后、Compacted落盘前崩溃，冷恢复仍看到旧history；若Compacted已写而WorldState/TurnContext未写，则replacement存在但baseline不完整。

这是一组跨item partial-commit窗口，需要checkpoint transaction ID与complete marker才能严格恢复。

## 20. PostCompact Hook 发生在提交之后

三种模型compaction实现都是：核心impl完成replacement install后，才运行PostCompact hook。若Post Hook返回Stopped：

- API向上返回`TurnAborted`。
- Analytics在部分路径仍基于impl result记录已完成status。
- 已安装history不会回滚。

Token-budget实现同样先`start_new_context_window()`，再Post Hook。

因此Post Hook的“Stop”只阻止后续Turn继续，不是Compaction事务否决。Hook命名/文档必须明确pre-hook可阻止提交，post-hook只能观察并中止后续流程。

## 21. Token Budget Compaction 是无模型的 Window Reset

Token Budget feature启用时，compaction跳过summary/remote endpoint：

- 构建当前Step的WorldState。
- 发started item。
- 新建window。
- 用完整initial context直接替换history。
- 持久化Compacted + WorldState + TurnContext。
- recompute token usage。
- 发completed item。

它丢弃此前对话body的model-visible语义，只保留当前环境/指令上下文。适合强调“新窗口”而非“长对话连续性”的实验，不应与summary compaction宣称同等记忆质量。

## 22. Pending Input 在 Mid-turn Compact 后有特殊 Drain 规则

普通loop每次sampling后可消费Steer/pending input。Mid-turn compact后：

- 若模型本身仍需follow-up，下一轮先继续原model/tool链，暂不drain新Steer。
- 若只是pending input导致needs_follow_up，则可在下一轮drain。

这避免Compaction恰好插入时把新用户输入混到尚未收口的Tool continuation前面，维护了原Turn因果顺序。

## 23. Lifecycle Event 与 Durable Checkpoint 不是同一事实

Compaction发：

- `ContextCompaction` item started。
- replacement checkpoint持久化。
- token usage recompute。
- item completed。

失败路径可能只有started，没有completed；反之post-hook失败时checkpoint已提交但调用返回Aborted。UI不能只靠started/completed判断history是否切换，恢复也不能只看UI item，必须读取Compacted checkpoint。

建议显式事件：`compactionComputed`、`compactionInstalled`、`compactionDurable`、`compactionPostHookFailed`。

## 24. 质量退化被提示，但没有可验证评分

Local compaction成功后会warning：长Thread和多次compaction可能降低准确度，建议新开Thread。Analytics记录before/after active tokens、summary tokens、cached tokens、retained images、duration和状态。

目前没有：

- summary覆盖率。
- 用户原始约束保留率。
- tool side-effect引用完整性。
- compact后回答一致性eval。
- 多次compaction的语义漂移分数。

只有token减少不能证明压缩质量。成熟Agent应把“能继续采样”和“仍正确理解任务”分开评测。

## 25. 当前最值得保留的设计

1. Rollout append-only，CompactedItem作为逻辑checkpoint，不物理删审计事实。
2. Pre/Mid/Standalone phase明确，Context插入位置由phase决定。
3. Total/BodyAfterPrefix双预算，真实context上限始终兜底。
4. Estimated baseline被ServerObserved单向升级。
5. 模型切换优先使用旧compaction-compatible模型，fallback受错误类型约束。
6. Remote输出剥离developer/tool过程，再注入当前canonical context。
7. V2要求exactly-one Compaction output和completed terminal。
8. Window lineage用first/previous/current ID表达。
9. Trace区分attempt完成与replacement installed。
10. Mid-turn compact后维护Tool continuation与Steer的因果顺序。

## 26. 当前需要改进或避免的边界

1. Pre-turn admission不估算即将加入的context、input、skills和schemas。
2. Local超限逐项裁旧prompt，但缺最终effective-input range receipt。
3. Remote预裁只处理连续尾部output，遇到普通item立即停止。
4. V2 64k只算文本，图片近似0成本且无bytes/count cap。
5. Stream retry + model fallback无统一deadline/attempt/cost预算。
6. Memory-first、Compacted→WorldState→TurnContext多步提交缺事务complete marker。
7. Post Hook Stop发生在install后，返回Aborted容易被误解为未提交。
8. Started/completed item不足以证明checkpoint durability。
9. Token Budget reset与summary compaction共享UI生命周期，但语义保留能力不同。
10. 缺compaction quality eval与多代语义漂移检测。

## 27. 更适合云端 Agent 的 Compaction Checkpoint

```ts
type ContextCheckpoint = {
  checkpointId: string;
  conversationId: string;
  sourceRevision: number;
  previousCheckpointId?: string;
  strategy: "summary" | "structured-state" | "window-reset";
  effectiveInputRange: { fromStep: number; toStep: number };
  retainedMessageIds: string[];
  summaryArtifactId?: string;
  worldStateRevision: string;
  tokenEstimateBefore: number;
  tokenEstimateAfter: number;
  status: "computed" | "installed" | "durable" | "superseded";
};
```

数据库事务应同时提交checkpoint、replacement projection和baseline revision；内存runtime只有看到durable commit后才切换，或至少通过WAL/operation receipt在崩溃后完成roll-forward。

## 28. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Trigger | pre-turn、mid-turn、manual、tool请求新window、无需follow-up不compact |
| Admission | 大context diff、大user input、大schema让首次prompt越界 |
| Scope | Total、BodyAfterPrefix、estimated→server baseline、full window兜底 |
| Model switch | hash相同/不同/缺失、downshift、InvalidRequest fallback、其他错误不fallback |
| Local | stream retry、context exceeded逐项裁剪、20k user保留、空summary |
| Remote V1 | trailing tool outputs、非连续大output、filter stale developer、endpoint失败 |
| Remote V2 | 0/1/2 Compaction item、额外output、无Completed、图片绕文本预算 |
| Placement | 最后真实user、只有summary、只有Compaction、空history、mid/pre差异 |
| Commit | memory后崩溃、Compacted后崩溃、WorldState后崩溃、flush失败 |
| Hooks | Pre Stop零提交、Post Stop已提交、事件/返回值一致性 |
| Resume | window lineage、replacement优先、legacy缺字段、baseline缺失 |
| Quality | 一次/多次压缩约束保留、side-effect引用、任务目标一致性 |

## 29. 对当前项目的学习结论

当前AI SEO Agent未来做Context压缩时，最值得迁移的是：

1. 压缩是带source revision的checkpoint transaction，不是直接覆盖Message表。
2. UI transcript、canonical Run/Step事实和model-effective context继续分离。
3. 压缩输出不能携带旧系统指令；租户、权限、Tool schema和当前WorldState由服务端重新注入。
4. 触发前做完整admission estimate，保留output/tool/schema safety margin。
5. checkpoint必须绑定effective input range、retained message IDs和baseline revision。
6. 计算、安装、耐久化和post-hook是四个不同状态。
7. 除token下降外，还要评估目标/约束/已完成副作用是否保真。

Codex最优质的部分是Compacted append-only checkpoint、phase-aware context placement、window lineage、canonical context reinjection、exactly-one V2 output、旧模型兼容压缩和install trace。需要避免的是pre-turn估算缺口、图片/总payload预算不足、多层retry无总预算、memory-first多步partial commit，以及post-hook Aborted与已提交checkpoint的语义混淆。
