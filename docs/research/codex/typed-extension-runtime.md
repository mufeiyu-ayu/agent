# Typed Extension Runtime：不可变 Registry、分层 Store、Contributor 合并与失败隔离

本文研究 Codex如何在不把Core runtime对象直接暴露给扩展的情况下，允许Goal、MCP、Context、Tool和Lifecycle等功能接入。重点是Typed Extension的三个边界：扩展代码何时安装、扩展状态活多久、多个Contributor冲突或失败时Core如何合并。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/ext/extension-api/src/**`、`codex-rs/core/src/session/**`、`codex-rs/core/src/tools/{router,lifecycle}.rs`、`codex-rs/core/src/stream_events_utils.rs`

## 1. Extension API 暴露 Ports，不暴露 Session 内部结构

扩展拿到的是：

- stable Thread/Turn/Tool IDs。
- typed `ExtensionData` stores。
- config before/after snapshots。
- prompt/world-state contribution types。
- ToolExecutor与event/item injection capabilities。
- lifecycle input DTO。

它不直接拿`Session.state` mutex、ActiveTurn、ContextManager或Rollout writer。这减少Core重构对扩展的破坏，也限制扩展绕过生命周期不变量。

这种“窄capability port”比把Nest service container整个交给插件更可维护。

## 2. Registry 是 Build-time Mutable、Runtime Immutable

Host启动时使用`ExtensionRegistryBuilder<C>`按注册顺序加入：

- Thread/Turn lifecycle。
- Config/Token usage/Skill invocation observer。
- Context/WorldState/TurnInput。
- MCP server/Tool contributors。
- Tool lifecycle/TurnItem post-processors。
- Approval reviewer。

`build()`消费builder，产出只读`ExtensionRegistry`；Session持有`Arc<Registry>`。运行中不会往同一个Registry动态插拔Contributor。

优点是每个Thread看到稳定的扩展顺序和类型集合；热安装必须创建新Host/Registry代际，而不是让一次Turn中途变更行为。

## 3. Contributor 类型本身就是权限分级

不同trait只看到完成职责所需的信息：

- `ToolContributor`拥有Tool executor，但没有通用history写权限。
- `ToolLifecycleContributor`只看身份和outcome，不看Tool input/output payload。
- `TurnItemContributor`可改已解析UI item，但不改raw model ResponseItem。
- `ContextContributor`只能返回结构化Prompt/WorldState fragment。
- `ApprovalReviewContributor`只接收渲染后的review prompt并返回decision。
- `SkillInvocationContributor`只观察opaque resource identity与explicit/implicit分类。

这比一个万能`onEvent(any)`接口更容易评审数据边界和副作用。

## 4. ExtensionData 用 TypeId 做进程内 Typed Attachment

`ExtensionData`内部是：

```text
level_id + Mutex<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>
```

支持：

- `get<T>()`。
- `get_or_init<T>()`。
- `insert<T>()`并返回旧值。
- `remove<T>()`。

同一scope内每个Rust类型只能有一个attachment；类型就是key，避免字符串拼写/反序列化错误。Mutex poison会恢复inner map继续运行。

但TypeId只在当前binary/runtime有意义，不是持久化schema，也不能跨语言或进程恢复。

## 5. Init Snapshot 与 Mutable Store 是两种东西

`ExtensionDataInit`在scope创建前收集host inputs，clone时冻结TypeId→Arc映射；之后用`new_with_init()`种入真正的`ExtensionData`。

源码明确说明：

- Clone只冻结attachment map，Arc指向的值若有内部可变性仍共享。
- Init不安装extension。
- Init不提供持久化。
- 重型lazy工作应放在attachment内部，不要在持有map lock的`get_or_init` closure里执行。

MCP resolution同时可看thread init与thread store：前者代表稳定host输入，后者代表扩展运行态，不能混为一谈。

## 6. Session、Thread、Turn 三层 Store 表达状态寿命

Codex创建：

- Session store：宿主Session runtime共享。
- Thread store：单Thread runtime生命周期。
- Turn store：每次TurnContext新建，以Turn ID为level ID。

大多数Contributor同时拿三层引用，自行选择状态落点。比如缓存跨Turn连接放Thread，单Turn去重放Turn，全Host共享client放Session。

这类似前端`app provide → route store → component instance state`，关键是不要把短寿命状态误放到长寿命容器造成跨Turn污染。

## 7. 这些 Store 默认都不 Durable

`ExtensionData`只是进程内HashMap。Thread resume会创建新的store，再由lifecycle contributor基于外部持久事实自行rehydrate。`ThreadStartInput.persistent_thread_state_available`只告诉扩展host是否具备持久Thread状态，不会自动序列化attachments。

因此文档中所谓“extension-private state”需要区分：

- Runtime attachment。
- 扩展自己管理的State DB/文件/API事实。
- Resume时重建到attachment的缓存。

直接把业务关键状态只insert进Thread store，进程崩溃后一定丢失。

## 8. Thread Init 与 Lifecycle State 刻意隔离

MCP contributor文档说明：thread-scoped resolution可以看host-seeded `thread_init`，但不包含lifecycle contributor后来写入的state。这样早期MCP启动不依赖`on_thread_start`执行顺序。

Session初始化还会并行进行Thread persistence、State DB、auth/MCP等任务；稳定Init snapshot让这些独立任务可并行，而不读取正在变化的Thread store。

这是优秀的startup dependency控制：需要成为并行初始化输入的事实必须提前冻结，不能靠某个callback恰好先跑。

## 9. Lifecycle Contributors 按注册顺序串行 Await

Thread start/resume/idle/stop、Turn start/stop/abort/error、Tool start/finish等callback都用for-loop逐个await。

因此：

- 后Contributor可以观察前Contributor已写入的store状态。
- 总延迟是各Contributor耗时之和。
- 没有默认并发竞态。
- 一个永不返回的Contributor会卡住整个lifecycle gate。

Trait多数返回`()`,没有标准timeout、error或failure policy；panic也没有统一隔离层。顺序确定性换来了明显的延迟/可靠性耦合。

## 10. Thread Idle 是观察点，不是执行所有权

Core只在：

- 没有ActiveTurn。
- input queue没有可触发Turn的mailbox items。

才调用`on_thread_idle`。扩展可通过已捕获host capability提交follow-up input，但Host仍决定该输入启动Turn、排队还是忽略。

这避免Extension直接创建ActiveTurn破坏single-owner不变量。Idle callback本身结束后状态可能已变化，所以任何提交仍需重新做admission check。

## 11. MCP Contributions 使用“后注册者同名覆盖”

`McpServerContributor`按注册顺序运行，返回：

- Set server。
- SelectedPlugin server/package provenance。
- Remove server。

同name后来的contribution替换前者。Contributor必须只贡献自己拥有的namespace，并在返回前应用来源policy。

Global resolution没有Thread inputs，不能暗示local fallback；Step resolution还拿到当前ready environment IDs，必须省略不在snapshot内的selected roots。

这种overlay适合配置资源，但需要冲突diagnostic；“last wins”若无owner namespace容易静默劫持server name。

## 12. Approval Review 使用“第一个 Claim 获胜”

Registry按注册顺序调用ApprovalReviewContributor；第一个返回`Some(ReviewDecision)`就停止，后续不运行。全部返回None才交回其他Reviewer路径。

这表达责任链，而不是投票。顺序本身是安全配置，必须可审计；一个过宽的前置Contributor会永久遮蔽后面的更严格Reviewer。

建议Contributor同时返回`claimReason + policyVersion`，而不是只有decision。

## 13. Context Contributions 使用“All Append + Slot Grouping”

所有ContextContributor按注册顺序串行执行，fragment按slot分组：

- DeveloperPolicy。
- DeveloperCapabilities。
- ContextualUser。
- SeparateDeveloper。

同slot内容全部保留；SeparateDeveloper各自形成独立top-level message，其余再聚合。Thread context用于稳定输入，Turn context可读取Turn store和model context window。

当前Contributor API不强制单扩展/总prompt token预算，也没有per-fragment provenance随ResponseItem持久化。一个扩展可显著挤压model context。

## 14. TurnInput Contributors 串行聚合，但 Cancellation 会丢整个结果

Turn开始时Host构造：

- Turn ID。
- 原始user inputs。
- 当前可转换为host-native path的环境摘要。

Contributor按注册顺序执行，并用Turn cancellation token包裹；输出的`ContextualUserFragment`全部转成ResponseItems。

如果某个Contributor在等待时被cancel，函数返回None，先前Contributor已经算出的items也不会交付。Foreign OS cwd当前因PathBuf限制会被省略，源码TODO要求迁移PathUri。

## 15. WorldState Section 用 Stable ID，重复直接 Panic

ContextContributor可以返回`WorldStateSectionContribution`：

- static stable ID。
- JSON snapshot。
- 基于Previous Absent/Unknown/Known的diff renderer。
- legacy/retained fragment matchers。

WorldState使用有序map存section，Core built-ins和extensions共享ID namespace；重复ID触发assert panic，而不是last-wins。这保护diff/replay不被两个owner同时解释，但缺启动期catalog collision validation，错误可能到sampling Step才爆发。

## 16. Tool Contributions 是“All Collect”，冲突留给 Tool Planner

每个ToolContributor同步返回它拥有的executors，Core把所有vector展平，再与built-in/MCP/dynamic tools一起进入spec planner与registry。

Extension API没有全局工具name reservation；重复name由下游planner记录冲突/保留先注册者。Contributor调用是同步的，不能在`tools()`里执行重I/O，否则阻塞每次plan构造。

工具catalog应在Thread启动时做一次owner-aware collision report，而不是执行路径临时发现。

## 17. Tool Lifecycle 只观察 Identity 与 Outcome

`on_tool_start`发生在Host接受Tool Call执行后；`on_tool_finish`覆盖：

- Completed `{success}`。
- Blocked。
- Failed `{handler_executed}`。
- Aborted。

Source区分Direct与CodeMode，并在后者携带cell ID/runtime tool call ID。Aborted可能发生在start之前，所以扩展不能假设start/finish严格成对。

不暴露payload减少敏感数据面，也让observer无法改写结果；需要策略检查的扩展应使用Hook而不是Lifecycle Contributor。

## 18. TurnItem Contributors 是有序原地 Rewrite

模型ResponseItem解析成`TurnItem`后，所有TurnItemContributor按注册顺序拿同一个`&mut TurnItem`修改。某个Contributor返回Err时：

- warning。
- 继续后续Contributor。
- 不回滚它在报错前已经做的部分mutation。

只要Registry存在TurnItemContributor，streaming item会延迟到finalized阶段再发客户端，避免UI先看到未改写版本；这提高一致性，但增加首个流式可见item延迟。

## 19. TurnItem Rewrite 不修改 Raw Model Fact

Tool pipeline先持久化/处理raw ResponseItem，再映射TurnItem。Contributor修改的是产品/UI item，不是model history本身。

因此：

- UI可对agent message加扩展标记。
- 不会反向改变下一轮模型看到的原始assistant/tool item。
- Replay若重新跑Contributor，结果可能随扩展版本变化；若持久化final TurnItem，则需记录contributor generation。

这延续了“model fact与产品projection分离”的核心原则。

## 20. Config Contributor 在 Commit 后同步观察 Before/After

Session settings update先在state lock内应用并commit新配置，随后构造effective previous/new snapshots并同步调用ConfigContributor。

Callback无返回值，不能否决配置变化；适合更新扩展cache或记录观察。它也没有标准错误/timeout，且运行在配置变更关键路径。

如果扩展需要验证配置，应该在commit前的typed config validation阶段，而不是在observer里尝试补救。

## 21. Token Usage Contributor 位于客户端通知之前

Host从provider记录usage并更新缓存后，逐个await TokenUsageContributor，之后才发TokenCount客户端通知。

这让Goal/Budget扩展能先更新自己的accounting，UI收到token notification时相关扩展状态已经同步推进。

但慢Contributor会延迟每次model response的UI usage更新；trait注释要求保持cheap，却没有代码强制deadline。

## 22. Extension Failure Policy 不统一

当前不同接口的失败形态不同：

- Lifecycle多数不能返回Result，只有完成或panic/hang。
- TurnItem返回Err，warning后继续。
- TurnInput被Turn cancellation中断时整个extension input构建失败。
- Approval用None表示未claim，不是error。
- WorldState重复ID直接panic。
- Tool collision由planner处理。

这些差异有业务依据，但缺统一extension health和degraded receipt。用户难以知道某次Turn少了context，是Contributor返回空、被cancel、冲突还是runtime错误。

## 23. Registry 稳定，不代表 Contribution 结果稳定

Registry vector不可变，但Contributor可读取：

- mutable ExtensionData attachments。
- 当前config。
- ready environments。
-外部服务/DB。

所以相同Registry下每个Step产出的WorldState、MCP、tools和context仍可能变化。StepContext必须捕获需要同代使用的结果，不能只记录“registry没有变”。

尤其Tool specs与Tool dispatch registry必须来自同一次plan，避免模型看见A代spec却路由到B代executor。

## 24. ExtensionData 的 Type Identity 也有命名空间风险

TypeId避免字符串冲突，但如果多个Contributor共享同一个公共类型T，它们会读写同一slot；后insert者替换前值。相反，语义相同但来自不同crate版本的类型可能拥有不同TypeId，互相不可见。

这适合单binary内强类型协作，不适合作为插件ABI。动态/跨进程扩展仍需要`namespace + schemaVersion + serialized value`。

## 25. 当前最值得保留的设计

1. Build-time Registry可变、runtime Registry不可变。
2. Contributor按职责拆trait，默认最小数据可见性。
3. Session/Thread/Turn三层typed store表达状态寿命。
4. Init snapshot与mutable runtime store分离，支持并行startup。
5. 不同资源显式使用all/first-claim/last-wins/reject-duplicate合并语义。
6. WorldState使用stable section ID和Previous状态做diff/replay。
7. Tool lifecycle区分Blocked/Failed handler执行与否/Aborted。
8. TurnItem projection rewrite不污染raw model history。
9. 有TurnItem Contributor时延迟stream，避免先发未finalized内容。
10. Config/Token observers放在host commit与客户端notification之间的明确位置。

## 26. 当前需要改进或避免的边界

1. ExtensionData不是durable store，必须防止业务关键事实只留内存。
2. Lifecycle串行await无deadline/error隔离，慢/挂起扩展阻塞Core。
3. Panic缺统一catch/unhealthy quarantine。
4. Prompt/context/world-state贡献无per-extension和总token/bytes预算。
5. WorldState ID冲突到Step才panic，应启动期验证owner catalog。
6. Tool name冲突到planner才发现，缺统一provenance report。
7. TurnItem Err不回滚部分mutation。
8. Registry无显式generation，动态贡献结果也缺snapshot hash。
9. Approval first-claim顺序是安全配置但回执无claim provenance。
10. TypeId无法充当跨进程ABI/schema identity。
11. TurnInput PathBuf省略foreign environment。
12. Contributor outcome缺统一degraded health/telemetry。

## 27. 更适合 NestJS Agent 的 Extension 结构

TypeScript服务端可以借鉴职责分层，但不要用全局DI容器随意取service：

```ts
type ExtensionManifest = {
  id: string;
  version: string;
  capabilities: Array<
    | "context.contribute"
    | "tool.provide"
    | "tool.observe"
    | "approval.review"
    | "run.observe"
  >;
  failurePolicy: "fail-open" | "fail-closed" | "disable-extension";
  timeoutMs: number;
};

type ExtensionSnapshot = {
  registryGeneration: string;
  extensionVersions: Record<string, string>;
  toolCatalogHash: string;
  contextContributorHash: string;
};
```

每次AgentRun捕获snapshot，Step只用该snapshot构建model specs与dispatch；扩展私有durable state使用有tenant/run namespace的Repository，不塞进任意内存map。

## 28. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Registry | 注册顺序、build后不可变、新generation不影响旧Thread |
| Store scope | Session/Thread/Turn隔离、insert替换、remove、get_or_init并发、poison恢复 |
| Durability | crash/resume、rehydrate、只存在attachment的数据丢失 |
| Startup | init clone、内部可变Arc、MCP不依赖lifecycle state、并行初始化 |
| Lifecycle | 顺序、慢Contributor、panic、stop/abort、finish无start |
| Merge | MCP last-wins、approval first-claim、context all、world-state duplicate、tool collision |
| Context | slot顺序、巨大fragment、separate developer、provenance与budget |
| Turn input | cancel中途、prior results丢弃、foreign cwd、多个environment |
| World state | Absent/Unknown/Known、legacy matcher、retained matcher、duplicate ID |
| Turn item | 多次mutation、Contributor Err后的partial state、stream延迟、raw fact不变 |
| Snapshot | 同Registry外部状态变化、spec/dispatch同代、resume generation漂移 |
| Health | degraded extension、quarantine、用户可见warning、per-extension latency |

## 29. 对当前项目的学习结论

当前AI SEO Agent不应现在引入插件市场，但可以提前保持扩展友好的边界：

1. AgentRuntime依赖窄Tool/Context/Approval ports，不依赖任意全局service locator。
2. 每次Run冻结Tool catalog、policy和context contributor generation。
3. Run/Conversation/Request三层状态寿命明确，业务事实进入Repository。
4. 多provider/业务扩展的merge policy按资源类型定义，不能统一last-write。
5. 观察者不能改输入；能改输入的policy必须走独立typed接口和重新校验。
6. Extension超时、错误、冲突和降级都进入Run receipt。
7. Model history与UI/analytics projection保持分离。

Codex最优质的部分是不可变typed Registry、三层Store、Init/runtime分离、职责型Contributor、字段/资源级merge语义、WorldState stable ID和raw/projection分离。需要避免的是把ExtensionData误当持久化、同步串行回调无deadline、冲突到执行时才发现、缺registry/contribution generation，以及扩展失败缺统一health与隔离策略。
