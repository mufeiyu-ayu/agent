# Deferred Tool Discovery：可执行注册、模型可见性与按需Schema加载是三张表

本文研究 Codex 如何把Dynamic Tool、MCP Tool和Extension Tool组合进同一个Registry，并用 `ToolExposure::Deferred + tool_search` 避免一次性把全部schema塞进模型上下文。重点是扩展系统为什么必须区分“Host能执行”“模型当前知道”“模型可以搜索发现”。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. Tool Registry 不等于 Prompt Tool List

`ToolRouter` 同时保存：

- `ToolRegistry`：当前Step可dispatch的runtime全集。
- `model_visible_specs`：本次sampling初始发送给模型的schema集合。

每个executor还有 `ToolExposure`：

| Exposure | Registry | 初始模型Tool List | Code Mode |
| --- | --- | --- | --- |
| Direct | 有 | 有 | 可作为nested tool |
| Deferred | 有 | 无 | 保留runtime；按配置提供deferred guidance |
| DirectModelOnly | 有 | 有 | 不进入nested tool surface |
| Hidden | 有 | 无 | 无 |

这是扩展容量的核心：Host可以注册很多能力，但模型每次只看到必要schema。把“已安装”“已启用”“本次可见”合成一个boolean，会让上下文预算和安全审计都失真。

## 2. StepContext 冻结一次可见性快照

Tool plan在Step开始时收集：

- Core tools。
- direct/deferred MCP tools。
- extension contributors提供的executors。
- Thread dynamic tools。
- hosted model tools。

随后构建同代的registry和model-visible specs。Sampling中途即使外部MCP/extension清单变化，当前Step也不会拿新schema配旧registry；下一Step重新plan。

这一点和Batch 103的Tool Call pipeline一致：spec/runtime必须同代，不应单独热更新prompt tool list。

## 3. Dynamic Tool Spec 是Thread输入协议

Canonical dynamic tool支持：

```ts
type DynamicToolSpec =
  | { type: "function"; name; description; inputSchema; deferLoading }
  | { type: "namespace"; name; description; tools: Function[] };
```

App Server在Thread Start时接收并验证；SessionMeta会保存dynamic tools。Resume时，如果新配置未提供dynamic tools，Session从历史Meta恢复旧列表；若调用者显式提供新列表，则使用新列表。

因此Dynamic Tool属于Thread capability snapshot，不是单次Turn临时参数。但“schema被恢复”不代表原客户端/远端执行者仍在线，恢复协议还需要能力owner/lease/version。

## 4. Legacy格式只做一次确定性归一化

旧格式是flat tool，带optional namespace、`exposeToContext`和 `deferLoading`。Normalizer：

- 禁止canonical与legacy格式混用。
- `deferLoading`缺失时，用 `!exposeToContext`转换。
- 按namespace分组为canonical namespace spec。
- 保持输入顺序，首次出现namespace决定容器位置。

拒绝混用比逐项猜测更好：同一数组只有一个schema generation，避免半数工具按新语义、半数按旧语义解释。

## 5. App Server 在Thread创建前校验命名空间

Validation覆盖：

- 名称非空且无前后空白。
- identifier仅ASCII字母、数字、`_`、`-`。
- tool name最长128，namespace最长64。
- namespace description最长1024。
- 禁止 `mcp` / `mcp__*`。
- 禁止与Responses保留namespace冲突，如browser、image_gen、terminal、tool_search、web等。
- 同一scope内名称唯一；同名可存在于不同namespace。
- namespace不能空。
- deferred dynamic tool必须处于namespace内。
- input schema必须能转成受支持的Responses schema。

这些检查发生在创建Thread前，避免运行到第一个模型请求才发现schema不可序列化。

## 6. Schema Parser 是兼容/压缩器，不是原样转发器

`parse_tool_input_schema()` 会：

1. sanitize不支持/异常shape。
2. prune不可达definition。
3. 大schema超过约5,000 compact JSON bytes时执行有损passes：去description、删definitions、折叠深层对象、裁composition。
4. 反序列化到Codex支持的JsonSchema subset。

它还处理boolean schema、nullable union、legacy keywords和local refs。这个边界很有价值：扩展输入不是直接透传给provider。

但5,000 bytes是best-effort proxy，不是hard cap；所有pass结束后仍可能超预算。Thread Start也没有统一的tool count、总schema bytes或function description长度上限，因此“单schema可压缩”不等于整个tool catalog有界。

## 7. Deferred Tool 保持可执行，只隐藏初始schema

`DynamicToolHandler` 构造时：

- Registry name是 `(namespace?, tool name)`。
- runtime spec保留完整function schema。
- `defer_loading=true` 映射为 `ToolExposure::Deferred`。
- 为初始runtime spec移除wire `defer_loading` marker；Exposure才是Core内部真相。

Deferred handler仍注册在Registry中，只是不出现在initial model specs。这比搜索后临时安装runtime更安全、更快：发现改变的是模型可见schema，不是Host执行代码。

## 8. Tool Search 只有存在Deferred候选时才出现

`append_tool_search_executor()` 需要同时满足：

- model支持search tool。
- provider支持namespace tools。
- 至少一个Deferred runtime提供 `search_info()`。

然后才把client-executed `tool_search` 加入model-visible list。若没有候选，就不暴露一个永远返回空的搜索Tool。

反面边界也很重要：如果调用者把dynamic tool标Deferred，但当前model/provider不支持search/namespace，handler仍是Deferred却没有search入口，模型无法发现它。当前validation没有在Thread Start时把这种配置拒绝或自动降级为Direct。

## 9. Search Index 来自Tool语义，而非完整Schema JSON

默认search text拼接：

- function/namespace name。
- 下划线替换为空格的name。
- description。
- property name。
- schema description。
- items与`anyOf`子schema。

本地使用English BM25建索引，默认返回8个结果。Source info还会写进 `tool_search` description，让模型知道当前有哪些来源，例如Dynamic tools或某个Connector。

优点是无需把全部schema先发模型；缺点包括：

- 英文BM25对中文/代码别名未必好。
- search text不完整覆盖enum、`oneOf/allOf`等语义。
- metadata中的prompt injection文本可影响检索相关性。
- 没有embedding或业务热度/权限risk ranking。

Tool discovery是检索系统，也需要评测precision/recall，而不是只测能返回结果。

## 10. Search Handler Cache 按完整候选集相等复用

Session级 `ToolSearchHandlerCache` 只缓存一个handler。`get_or_build()`：

- 先持锁检查cached `search_infos == current`。
- 不同则在锁外构建BM25 index。
- 再持锁double-check，避免并发重复覆盖等价index。

这是良好的cache publication模式：构建CPU工作不占锁，发布前重新验证。

但cache key是完整Vec深比较，候选很多/schema很大时比较与clone成本明显；也没有catalog generation/hash。Extension catalog频繁抖动会反复重建整个index。

## 11. Search Output 返回“可加载Schema”，不返回执行结果

`tool_search` 输出 `ToolSearchOutput`：

- `execution = client`。
- status completed。
- call ID。
- tools数组。

每个命中tool被转换为 `LoadableToolSpec`：

- 强制 `defer_loading=true`。
- 移除 `output_schema`。
- 同namespace结果合并进一个namespace container。

模型在下一次sampling通过history中的ToolSearchOutput获得新schema，之后才能生成对应FunctionCall。Registry早已存在handler，所以调用可直接dispatch。

这形成两步协议：

```text
discover schema -> model receives schema -> call already-registered runtime
```

不是“搜索后立即执行”，也不是“搜索字符串等于tool name”。

## 12. Namespace Coalescing 保持Wire紧凑，但不做最终去重

不同搜索结果若属于同namespace，会合并tools数组；初始model specs也会按namespace合并并按tool name排序。

不过 `coalesce_loadable_tool_specs()` 只是append namespace tools，不按 `(namespace, name)`去重。若不同来源错误地产生同namespace+同tool，输出可能重复。Planner的Registry会对重复ToolName `error_or_panic`并保留先注册者，但发现输出与实际可dispatch runtime可能因此分叉。

App Server只验证dynamic tools内部重复；dynamic top-level function还可以与Core tool同名。Built-in先进入plan时，后来的dynamic duplicate通常不会成为model-visible spec，且Registry记录冲突。这应在Thread Start统一做全catalog collision validation，而不是到planner才跳过。

## 13. `limit` 有下限校验，没有上限

Search参数：

- query trim后不能为空。
- limit默认8。
- limit=0拒绝。

但没有max limit。一个大limit可以：

- 让BM25返回大量命中。
- 序列化大量schemas进ToolSearchOutput。
- 扩大下一次model history和network payload。
- 让namespace coalescing/clone占用更多内存。

单tool schema有best-effort compact，ToolSearchOutput却没有总bytes/count budget。扩展容量治理需要 `maxResults + maxSerializedBytes + maxNamespaces` 三重限制。

## 14. Dynamic Tool 执行依赖客户端反向RPC

模型调用dynamic function后，handler：

1. 把arguments字符串解析成任意JSON Value。
2. 以call ID在active Turn登记pending response。
3. 发 `DynamicToolCall` started item。
4. App Server向客户端发ServerRequest。
5. 客户端返回text/image content items与success。
6. 发completed/failed item。
7. 转成FunctionCallOutput给模型。

这让App Server client成为实际Tool host；Core只负责schema、lifecycle和Observation转换。

安全上必须把“能连接/订阅Thread的client”和“有权执行这个dynamic tool的client”分开。Batch 102已经确认generic reverse request会广播给多个订阅连接、first response wins，response不绑定声明的executor authority；Dynamic Tool继承这个风险。

## 15. Schema约束没有在Core执行时再次验证arguments

Handler执行时使用 `parse_arguments<Value>()`，只保证arguments是JSON，不用当初的input schema做本地validator。

通常模型provider按schema生成arguments，但以下路径仍可能绕过：

- provider bug/兼容差异。
- raw history injection。
- 测试/内部直接构造FunctionCall。
- compromised客户端链路。

真正的Tool host必须再次验证schema和业务权限，不能把model structured output当安全输入。Core若保留schema，也可以在dispatch前统一校验并形成 `invalid_arguments` Observation。

## 16. Pending Dynamic Call 仍以call ID为唯一键

重复call ID会覆盖旧oneshot sender，只warning。Response Op也仅携带call ID；late response找不到entry时warning。没有expected Turn ID、tool name、arguments hash或executor ID。

这与Request Permissions相同，存在覆盖/ABA边界。动态工具尤其可能有外部副作用，建议identity至少绑定：

```text
(threadId, turnId, callId, toolCatalogGeneration, executorId, argumentsHash)
```

客户端重连重放request时也应使用稳定operation ID，Tool host才能幂等处理。

## 17. Response 做类型/图片来源检查，但没有容量预算

App Server将client response反序列化为：

- InputText。
- InputImage `{ imageUrl }`。
- success boolean。

远程HTTP image URL被拒绝并转换为失败文本，避免模型在后续history中隐式拉取外部图片。Malformed response和普通client error也变成`success=false`的fallback Observation；Turn transition error则不再提交response。

当前没有content item count、text bytes、data URL bytes或总response预算。一个客户端可返回巨量文本/图片，后续虽然通用history可能截断文本，却仍会先发生反序列化、clone、TurnItem event和内存占用。

## 18. Dynamic Tool 生命周期的持久化不完整

Dynamic specs保存在SessionMeta；Paginated mode的 `ItemCompleted(DynamicToolCall)`可持久化UI item，FunctionCall/Output也进入model history。

但普通 `DynamicToolCallRequest/Response` legacy events属于transient；pending callback只在内存。冷恢复后：

- 可恢复catalog schema。
- 可看到已完成call/output。
- 不能恢复正在等待客户端的in-flight request。
- 不能证明原executor client仍具备能力。

需要为dynamic host增加lease、catalog generation和call receipt，而不是只恢复静态schema。

## 19. 建议的扩展Catalog模型

```ts
type ToolCatalogEntry = {
  toolId: string;
  canonicalName: string;
  namespace?: string;
  ownerExtensionId: string;
  executorId: string;
  catalogGeneration: number;
  schemaHash: string;
  exposure: "direct" | "deferred" | "hidden";
  riskClass: "read" | "write" | "external-side-effect";
  leaseExpiresAt?: string;
};

type ToolDiscoveryReceipt = {
  query: string;
  catalogGeneration: number;
  returnedToolIds: string[];
  serializedBytes: number;
};
```

Model-visible schema从Catalog snapshot投影；Registry按同一个generation构建；Tool call提交时再次校验executor lease和schema hash。

## 20. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Validation | reserved name、namespace collision、duplicate、mixed legacy/canonical、empty namespace |
| Schema | >5KB compact、仍超budget、cyclic ref、unsupported shape、description injection |
| Exposure | Direct/Deferred/Hidden/DirectModelOnly在普通与Code Mode的矩阵 |
| Capability | model/provider不支持search/namespace时Deferred fail-closed或降级 |
| Search | 中文、别名、property、enum、oneOf/allOf、无结果、相关性评测 |
| Budget | result count、schema bytes、namespace count、超大limit、index rebuild cost |
| Collision | Core/MCP/extension/dynamic同名、同namespace工具重复、registry与spec一致 |
| Dispatch | argument schema二次校验、unknown tool、catalog generation变化、lease过期 |
| RPC | 多连接抢答、executor authority、重连重放、call ID ABA、幂等operation |
| Output | remote image拒绝、data URL cap、item count、text bytes、malformed fallback |
| Resume | catalog恢复但host离线、in-flight call、旧schema hash、owner变更 |

## 21. 对当前项目的学习结论

当前AI SEO Agent暂时不需要插件市场，但未来接入Search Console、CMS、Analytics等工具时，应先学这三个分离：

1. Registry：后端真实可执行能力。
2. Catalog：可搜索、带owner/risk/schema hash的能力元数据。
3. Prompt projection：当前Step真正展示给模型的少量schema。

最小阶段可以全部Direct；当schema总量真实成为上下文瓶颈时，再引入Deferred discovery。引入前必须有catalog generation、全局命名冲突检查、搜索结果bytes cap、dispatch二次参数校验、executor authority和幂等call receipt。

Codex 最值得学习的是Exposure四态、spec/runtime同代快照、Deferred runtime预注册、只有候选时才暴露tool_search、schema sanitize/compact、BM25本地发现、namespace coalescing、exact-candidate cache与Dynamic specs恢复。需要改进/避免的是Deferred在不支持search时静默不可达、全catalog缺count/bytes预算、search limit无上限、中文/复杂schema检索覆盖弱、跨来源冲突到planner才发现、dispatch不二次验证schema、reverse RPC不绑定executor authority，以及catalog恢复不等于host能力恢复。
