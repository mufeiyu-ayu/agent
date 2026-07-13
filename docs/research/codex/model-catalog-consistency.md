# Model Catalog 一致性：Bundled/Remote/Cache合成、Turn快照与Server Reroute

本文研究 Codex 如何发现可用模型、合并bundled与remote metadata、缓存catalog、选择默认模型，并在服务端实际路由到另一模型时向客户端解释。重点不是模型列表UI，而是“模型名、能力metadata、请求时快照、实际执行模型”为什么是四个不同事实。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/models-manager/src/**`、`codex-rs/core/src/session/{mod,turn,turn_context}.rs`、`codex-rs/app-server/src/{models,models_refresh_worker}.rs`

## 1. Model Catalog 不只是Picker数据

`ModelInfo`同时影响：

- base instructions与personality模板。
- reasoning levels与summary参数。
- shell/apply_patch/web search Tool类型。
- parallel tool calls。
- image modalities/detail能力。
- context window与auto compaction。
- Tool output truncation。
- experimental tools、search、code mode与multi-agent版本。
- service tier与speed tier。

因此错误metadata不是“模型名字显示错了”，而可能直接改变Agent runtime行为和安全边界。

## 2. Manager有Dynamic与Static两种Authority

- `OpenAiModelsManager`：bundled models起步，结合disk cache与remote `/models`。
- `StaticModelsManager`：传入catalog就是authoritative，不访问网络。

自定义provider/固定测试适合Static；Codex backend适合Dynamic。二者实现同一trait，但fallback语义并不完全一致，调用方不能假设所有provider行为相同。

## 3. Bundled Catalog 是离线安全底座

Dynamic manager启动时读取编译进crate的`models.json`。即使remote/cache失败，仍有已知模型metadata、instructions和能力默认值。

Bundled并不保证用户账号当前有权限使用某模型；它只是客户端理解能力的seed。可用性仍需auth过滤与server响应证明。

## 4. Refresh Strategy 明确区分Online/Offline/Cache-first

三种策略：

- `Online`：忽略cache，发remote请求。
- `Offline`：只尝试fresh cache，不联网。
- `OnlineIfUncached`：fresh cache优先，否则remote。

Root Thread启动使用OnlineIfUncached；非root Agent使用Offline，避免每个child都发模型catalog请求。App Server `model/list`同样使用OnlineIfUncached。

“子Agent继承模型能力”不应触发新的全局catalog I/O，这是好的资源边界。

## 5. 只有有能力认证的Endpoint才Refresh

Dynamic manager仅在：

- 当前auth使用Codex backend，或
- endpoint支持command-scoped auth

时尝试remote refresh。否则Offline/OnlineIfUncached只读cache并保留bundled。

这避免向不支持catalog的provider发送无意义请求。Provider capability应由adapter声明，不用URL/名称猜测。

## 6. Cache TTL为5分钟并绑定Client Whole Version

`models_cache.json`保存：

- `fetched_at`。
- optional ETag。
- `client_version`，只取major.minor.patch。
- 完整remote models数组。

读取要求version完全一致且age不超过300秒。Prerelease变化不会使cache失效，因为whole version剥离`-alpha`等后缀。

若同一semver prerelease之间catalog schema/能力发生变化，旧cache可能被复用；cache compatibility最好绑定schema version与build capability hash。

## 7. Cache没有Provider Identity

源码TODO明确：fresh cache只校验client version/TTL，不校验provider identity。用户切换provider后可能读到上一provider写的`models_cache.json`。

这会污染：

- picker模型列表。
- 默认模型。
- metadata prefix匹配。
- Tool capability planning。

Cache key至少应包含provider ID、base URL、auth audience/catalog API version与tenant/account scope。

## 8. Cache Direct Write不是Crash-safe

Cache使用`tokio::fs::write`直接覆盖pretty JSON，没有temp+fsync+rename。崩溃可留下truncated file；下次读取解析失败会log并fallback remote/bundled。

Catalog可重建，所以可接受best-effort durability；但应避免一个partial cache在offline child中造成静默能力退化。Atomic replace成本很低，仍值得做。

## 9. Wall Clock异常会影响Freshness

Fresh判断为`now - fetched_at <= TTL`。若cache timestamp在未来，age为负，也满足条件，直到本机时间追上后才可能过期。

来自不可信/同步异常filesystem的timestamp应同时限制：

```text
-allowed_clock_skew <= age <= ttl
```

不能只检查上界。

## 10. Remote Catalog在ChatGPT模式下可成为完整Source of Truth

若remote：

- 非空。
- 至少一个`visibility=List`。
- 当前是ChatGPT account auth。

则完全替换内存catalog，包括移除bundled中remote未返回的模型。

这是账号级availability的正确方向：server有权隐藏/下架模型。要求至少一个visible model是防御性条件，避免异常空/hidden-only响应把picker清空。

## 11. 其他Auth模式采用Slug覆盖+追加Merge

非ChatGPT或remote缺有效visible model时，从bundled重新开始：

- 同slug remote覆盖bundled metadata。
- 新slug追加。
- remote未提及bundled model继续保留。

这适合API/custom provider仍需客户端fallback metadata的场景，但会保留provider实际上不支持的bundled模型。后续auth filter只看`supported_in_api`，不能证明具体endpoint支持。

## 12. 每次Merge都从Bundled重建，而不是在旧Remote上增量叠加

非authoritative路径加载bundled，再应用本次remote。这样remote曾提供、下一次不再提供的额外model会消失，不会无限积累stale entry。

这比直接修改现有内存Vec更可预测。Catalog generation仍未显式暴露，读者只能拿clone snapshot。

## 13. Picker Projection先Priority排序，再Auth过滤

构建ModelPreset：

1. `priority`升序。
2. ModelInfo转Preset。
3. ChatGPT模式保留全部；其他auth只保留`supported_in_api=true`。
4. 第一条picker-visible model设为default；若无visible则第一条。

Hidden model仍可存在于catalog和metadata lookup，只是默认`model/list`不返回；`include_hidden=true`可显示。

“不在Picker”不等于“不可通过配置使用”，这是迁移/实验模型常见需求。

## 14. Default是Catalog顺序的派生事实

没有显式配置model时，default取第一条标记`is_default`的Preset。也就是说remote priority变更可以改变新Thread的默认模型。

已创建Thread应把实际选择持久化到SessionMeta/config lock，不能在resume时重新跟随最新catalog，否则同一Thread行为漂移。

Codex session setup会把resolved model与base instructions纳入运行配置；可选config lock还能固化从catalog解析出的字段。

## 15. Static与Dynamic的Provider Fallback语义不对称

`StaticModelsManager`在`allow_provider_model_fallback=true`时：

- 显式requested model在available列表中则保留。
- 不存在则换provider default。

Dynamic manager使用trait默认实现，只要显式model存在就直接保留，不检查available，即使allow flag为true。

这可能是不同provider策略的有意差异，也容易让调用方误解同名flag。Fallback policy应成为显式provider capability/enum，而不是布尔值加实现分叉。

## 16. Model Metadata采用Longest-prefix匹配

给定请求slug，Manager从catalog找所有`requested.starts_with(candidate.slug)`，选择slug最长者。用于date suffix、variant等继承基础metadata。

若普通匹配失败，还允许一个简单namespace：`provider/model-name`，只剥一段且namespace仅ASCII字母数字、`_`、`-`。

匹配成功后把结果`slug`改回完整requested slug，同时复制候选能力。

## 17. Prefix匹配缺少Delimiter Boundary

纯`starts_with`意味着candidate `gpt-5`也会匹配`gpt-50-unknown`或`gpt-5evil`。Longest-prefix只能解决多个候选谁更具体，不能证明后缀是合法variant。

更稳设计应由catalog声明：

- exact aliases。
- version family ID。
- 允许的suffix grammar。
- namespace mapping。

模型能力是安全相关数据，不宜依赖自由字符串前缀推断。

## 18. Unknown Slug使用显式Fallback Metadata并标记

完全匹配失败时构造minimal ModelInfo：

- requested slug/display name。
- 默认Codex instructions。
- 272k context/max context。
- 10k bytes tool output。
- parallel=false、search=false等保守能力。
- `supported_in_api=true`。
- `used_fallback_model_metadata=true`。

Turn会向用户发warning，说明metadata缺失可能降级。

保守关闭高级Tool是好选择；默认272k与API-supported仍是乐观假设，未知provider可能窗口更小或根本不接受slug。

## 19. Config Override在Metadata之后应用

用户可覆盖context window、auto-compact limit、Tool output token limit、base instructions与personality。Context override会被`max_context_window`clamp；Tool token limit按原truncation mode换算bytes/tokens。

自定义base instructions会清catalog instruction template；关闭personality也会移除相关模板字段。

这体现优先级：catalog给provider defaults，config做session-specific override。Override不能反过来声明provider并不支持的Tool capability。

## 20. TurnContext持有不可变ModelInfo快照

新Turn根据当前session configuration调用`get_model_info()`，构造Arc TurnContext。Tool planning、compaction、warnings和model request使用这一代快照。

后台catalog refresh不会在Turn中途替换能力。下一Turn才可能观察新metadata。

这和MCP runtime Step snapshot同理：外部catalog可热更，单次执行必须generation-stable。

## 21. 后台Refresh Worker立即执行并每3分钟Online刷新

App Server启动worker后先Online fetch一次，之后每180秒重复；Drop/cancel token停止。Manager用Weak引用，主对象消失时worker退出。

Fetch失败只被Manager记录，worker继续下轮。这个自愈行为合理。

但worker、用户`model/list`、Turn stream ETag refresh可能并发发请求；Manager没有看到singleflight/fetch generation guard。较慢旧response可能晚于较快新response写入内存和cache。

## 22. RwLock保证单次Vec替换原子，不保证Response新旧顺序

Remote models、ETag各自用独立RwLock。Fetch完成顺序：

1. apply models。
2. 写etag。
3. persist cache。

并发fetch可交错，读者可能短暂看到models generation N+1与etag N。更稳应使用单一`CatalogSnapshot { generation, models, etag, fetchedAt, source }`原子swap，并以request sequence丢弃迟到response。

## 23. Stream中的Models ETag会同步触发Refresh

Model response event携带ETag时：

- 与当前非空etag相同：只renew cache TTL。
- 不同/当前None：Online fetch。

Turn event loop会await该refresh，catalog网络延迟可能阻塞后续stream event处理。Catalog刷新不是完成当前Turn的必要条件，应投递background singleflight并保留observability。

ETag同值renew会重写整个cache；cache不存在则log error，不影响Turn。

## 24. ETag不是HTTP Conditional Request实现

这里的ETag来自model response event，作为“server提示catalog已变化”的signal；`list_models()`调用接口返回新catalog和optional etag。源码路径没有在Manager层展示`If-None-Match`条件请求。

因此ETag相同可免fetch，ETag变化仍下载完整catalog。它是版本hint，不是完整缓存验证协议。

## 25. App Server Model List分页Cursor只是一条Offset

`model/list`：

- 默认过滤hidden。
- limit至少1并clamp总量。
- cursor解析为usize offset。
- next cursor为end字符串。

Cursor没有绑定catalog generation、auth filter或include_hidden。两页之间后台refresh/登录状态变化时，会跳项或重复。

小列表可接受offset pagination；若要强一致，cursor需包含snapshot generation，或一次RPC返回完整model catalog。

## 26. `try_list_models`明确允许Busy而不阻塞

Manager提供try-read路径，内部RwLock竞争时返回TryLockError，而不是让同步/渲染路径等待。普通async list则clone快照。

这是低延迟UI的好边界：展示可以保留上一帧catalog，不应因后台刷新阻塞输入。但调用方必须把Busy与Empty区分，不能把锁竞争显示成“没有模型”。

## 27. Server Reported Model是实际执行事实

Response stream可能发`ServerModel(server_model)`。Codex与requested slug做case-insensitive比较：

- 相同：记录match。
- 不同：每Turn只发一次ModelReroute event与warning。

Catalog/TurnContext说明客户端请求了什么；ServerModel说明服务端实际用了什么。二者都应保留，不能用后者悄悄覆写历史requested config。

## 28. 当前Mismatch被硬编码解释为Cyber Reroute

任意server model mismatch都会：

- reason设`HighRiskCyberActivity`。
- warning固定提到gpt-5.3-codex→gpt-5.2。
- 提供trusted access链接。

若未来存在容量降级、区域路由、模型alias或A/B测试，这个解释会错误。Server event应携带typed reroute reason；缺reason时只能说“实际模型不同”，不能推断安全标记。

## 29. Reroute只做通知，不重建本Turn Capability Snapshot

Mismatch发生时，Turn仍使用requested model的ModelInfo：

- context/truncation预算。
- Tool specs与parallel能力。
- base instructions。
- compaction hash。

Server实际模型可能能力更弱。请求已经发出，无法回溯重建；后续follow-up如果仍在同Turn也继续用旧快照。

真正安全的reroute应由server保证actual model兼容已声明request contract，或在首event后返回完整actual capability descriptor并让client有受控降级路径。

## 30. Model Verification是独立事件，不等于Reroute状态

Stream另有`ModelVerifications`，每Turn只发一次，当前包含TrustedAccessForCyber。它被独立投影给App Server。

“当前用户具备某verification”与“本次请求发生reroute”是两个事实，不应互相推断。Verification也需要账号scope、有效期与服务端签名语义；当前event仅是枚举列表。

## 31. Catalog Error全部降级为旧内存Snapshot

`raw_model_catalog()`刷新失败只error log，然后返回当前`remote_models`。这保证Picker与Thread创建仍可用。

但响应没有`stale/degraded/source/fetchedAt`字段，客户端无法知道列表来自bundled、cache还是失败前remote。可靠fallback必须保留可用性，也要暴露置信度。

## 32. 对当前 AI SEO Agent 的迁移价值

当前项目的LLM provider配置也应区分：

```text
ModelCatalogEntry       = provider声明的能力
ModelSelection          = Conversation/AgentRun请求
ModelCapabilitySnapshot = 本AgentRun规划时冻结
ProviderReceipt         = 实际model、usage、request ID
```

近期可做：

1. 每个AgentRun持久化requested model与actual provider/model。
2. Tool planning只使用Run开始时capability snapshot。
3. Provider adapter把真实usage、finish reason、reroute作为receipt。
4. Unknown model不默认开启Tool/长窗口能力。
5. Catalog cache按provider/tenant/schema version隔离。

无需现在实现在线模型picker，但应避免把模型字符串散落在Controller与Service里。

## 33. 可验证的不变量清单

未来实现Model Catalog时可先写这些测试：

1. Cache不能跨provider/account误用。
2. Invalid/partial cache不覆盖上一代有效内存snapshot。
3. 并发fetch的迟到旧response不能覆盖新generation。
4. 一次Turn内ModelInfo不随后台refresh漂移。
5. Hidden与Unavailable是不同状态。
6. Default变化只影响新Run，不改变已持久Conversation配置。
7. Prefix/alias匹配只接受catalog声明的family grammar。
8. Unknown model使用保守capability并发明确warning。
9. requested与actual model都进入Run receipt。
10. Reroute reason来自provider typed fact，不能由slug mismatch猜测。
11. Actual model不兼容Tool contract时明确失败/重规划。
12. Pagination cursor检测catalog generation变化。
13. Refresh失败时API返回stale/source metadata。
14. 子Agent不会各自触发相同catalog网络refresh。

## 34. 最终结论

Codex Model Catalog最值得学习的是：模型选择不是一个字符串，而是一组会随账号、provider和时间变化的能力声明；执行时必须冻结metadata，同时把服务端实际模型作为独立receipt观察。

当前实现的强项是bundled离线底座、三种refresh策略、ChatGPT remote authority、auth/visibility投影、Turn级快照、unknown metadata warning、ETag hint和后台自愈刷新；主要风险是cache缺provider identity与atomic write、future timestamp freshness、Dynamic/Static fallback不对称、prefix无delimiter、并发fetch无generation/singleflight、models与etag分锁、stream内同步refresh、offset cursor不绑定snapshot、任意mismatch硬编码为Cyber原因，以及actual model不重建capability snapshot。

对服务端Agent而言，最小正确实现不是先做模型下拉框，而是让每次AgentRun能回答：请求了谁、用哪一代能力规划、服务端实际执行了谁、两者不一致时是谁给出的什么原因。
