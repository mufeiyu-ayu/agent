# Skill 多 Authority Runtime：Host、Executor、Orchestrator、Opaque Resource 与代际缓存

本文继续研究新 Skills extension 如何把本机文件、选中执行环境和Orchestrator MCP resources统一成一个catalog，同时不把远程resource伪装成本地路径。重点是authority绑定、package/resource handle、显式选择、缓存代际、`skills.list/read`以及legacy Skill注入迁移期的冲突语义。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/ext/skills/**`、`codex-rs/core-skills/src/model.rs`、`codex-rs/core-skills/src/loader/environment.rs`、`codex-rs/core/src/session/turn.rs`

## 1. 新 Extension 在解决“Path不再是全局语言”

单机Agent可以用`/Users/x/.agents/skills/foo/SKILL.md`标识Skill；多环境Agent不能：

- Host看到的是macOS path。
- Executor可能是Linux container或Windows VM。
- Orchestrator资源根本没有filesystem path。

因此新模型把Skill写成：

```text
Authority
  + Package ID
  + Resource ID
  + optional display path
```

调用者必须把opaque resource交回原provider读取，不能把它解析成ambient local path。

## 2. Authority由Kind与ID共同组成

`SkillAuthority`：

```text
kind = Host | Executor | Orchestrator | Custom(...)
id   = provider-specific opaque identity
```

例子：

- Host：`(Host, "host")`。
- Executor：`(Executor, selectedCapabilityRootId)`。
- Orchestrator：`(Orchestrator, "codex_apps")`。

Kind决定由哪类provider处理，ID区分该类下的具体authority。正确authorization必须同时校验二者，不能只看Kind。

## 3. Package ID与Resource ID职责不同

`SkillPackageId`标识整个package；`SkillResourceId`标识其中一个可读资源。

Catalog entry至少保存：

- package id。
- main prompt resource。
- authority。
- name/description。
- enabled/prompt_visible。

Orchestrator Skill后续可读取main prompt之外的reference，只要resource仍属于同package。Package是capability namespace，resource是namespace内object。

## 4. Display Path不能参与Authority判断

`display_path`只是给模型/用户看的短路径：

- Host通常展示normalized absolute path。
- Executor展示`skill://<root-id>/<environment-path>`。
- Orchestrator展示package `skill://...` URI。

真正read routing使用authority/package/resource。UI文本可能被截断、normalize或未来改版，绝不能作为数据库foreign key或权限证明。

## 5. Catalog Merge只按Authority + Package去重

`SkillCatalog::push_entry()`发现相同authority和package就保留第一项，忽略后项。Name、description、main resource不参与identity。

好处是同名不同authority可以共存；风险是多个provider错误宣称同一authority/package时，注册顺序成为winner，且没有collision warning。

Provider注册本身应保证authority ID空间不重叠，Catalog最好对内容不一致的重复项发诊断，而不是静默first-wins。

## 6. Provider Trait把List、Read、Search拆开

统一接口：

```text
list(query) -> SkillCatalog
read(authority, package, resource) -> contents
search(authority, package, query) -> matches
```

当前Host/Executor/Orchestrator的search都返回空结果，但port已预留。重要的是search也必须回到原authority，不能为了方便复制远程包到Host再失去provenance。

## 7. 多Provider Listing是Partial Success

`SkillProviders::list_matching()`按source注册顺序调用，每个失败转成warning，其他source继续。Orchestrator有单独路径以便Thread级cache。

因此catalog可以同时包含：

- Host成功。
- Executor A失败warning。
- Executor B成功。
- Orchestrator partial pages。

Catalog不是“全成功或全失败”的transaction。Consumer应显示warnings并保留source completeness，而不是只看entries非空。

## 8. Read按Kind挑Provider，具体ID由Provider自行校验

Provider registry筛选`source.kind == request.authority.kind`，依次尝试，首个成功返回；全失败只返回最后一个error。

它不会在registry层按authority ID定位唯一provider。这给Custom/multiple providers留扩展性，也把关键责任下放：每个provider必须拒绝不属于自己的authority ID。

当前各provider严谨程度并不完全一致，是后文的重要风险。

## 9. Host Provider依赖Turn的Immutable Snapshot

Host list必须收到`HostSkillsSnapshot`，把Core loader outcome映射成authority-aware entries：

- package = canonical Skill path。
- resource = 同一path。
- authority = `(Host, host)`。
- disabled与allow implicit分别映射到enabled/prompt_visible。

Read也只能读取snapshot里存在的path，避免请求任意Host file。

这保留了Core discovery边界；但正文仍按当前文件读取，延续metadata/body TOCTOU。

## 10. Host Read没有显式校验Authority ID与Package

Host provider当前：

- 要求snapshot存在。
- 按`request.resource`在已加载Skill path中查找。
- 不检查`request.authority == (Host, host)`。
- 不检查`request.package`与resource匹配。

正常调用来自catalog entry，所以不会自然伪造；但trait文档宣称authority-aware contract，provider边界本身仍应编码不变量。

内部调用者或未来新Tool若构造错误request，Host provider可能接受“错误authority ID + 正确loaded path”。

## 11. Executor Authority绑定Selected Capability Root

每个`SelectedCapabilityRoot`生成一个Executor authority：

```text
authority.id = selectedRoot.id
```

List只扫描当前ready selected roots。Root location带：

- environment ID。
- PathUri root。

若environment不存在，返回warning并跳过，不把remote path退化成Host path。

这把Skill可见性绑定到已经选择的环境capability，而不是所有已配置环境。

## 12. Executor Resource内部携带Environment绑定

模型看到的是display string：

```text
skill://root-123/workspace/.agents/skills/foo/SKILL.md
```

内部`SkillResourceId`额外保存：

- environment_id。
- 原生PathUri。

Read使用内部binding找到EnvironmentManager和对应filesystem。Opaque ID可读，真正authority metadata不必暴露给模型，也不必从string反解析。

## 13. Executor Provider校验Package等于Resource

当前Executor Skill每package只有main `SKILL.md`，所以Read要求：

```text
request.package == request.resource.id
```

并要求resource有environment binding、environment仍存在。

它检查authority kind是Executor，却没有验证`authority.id`等于最初selected root ID；真正读取能力来自resource内部environment/path binding。若request只能由catalog构造，仍安全；provider API若开放给不可信调用者，这个ID校验不完整。

## 14. Executor Read不重新验证Path仍在Selected Root内

List阶段由root discovery生成resource；Read阶段直接信resource内部PathUri，没有再次做root containment，也没有携带root path供复核。

这是一种“capability object不可伪造”的内部设计假设。Rust struct字段private能降低伪造面，但serialization/跨进程后必须改成签名handle、server-side lookup或重新containment，不能只传plain path。

## 15. Executor Catalog按Root缓存整个Thread寿命

`SkillsThreadState`对每个完整`SelectedCapabilityRoot`缓存第一次catalog，直到Thread state drop：

- 无filesystem watcher。
- 无mtime/hash invalidation。
- environment暂时不可用也不主动清cache。

源码明确把selected roots当stable。

好处是Turn之间catalog不漂移且避免remote scan成本；代价是环境新增/删除Skill不会被看见，旧entry可继续展示但Read时失败。

## 16. Executor World State只在内容变化时发Delta

Executor Skills作为World State section：

- 初次有catalog就发developer fragment。
- snapshot body/includeInstructions相同则不重复。
- 从有到无时发“No selected-environment skills”。
- 配置隐藏时发“not listed automatically”。

这比每Turn重复整份Skill表节省context，也让模型看到capability change。World State更新仍是projection，不代表remote filesystem当前实时状态。

## 17. Orchestrator Skill来自MCP Resource，不来自Tool Schema

Orchestrator provider只连接特定`CODEX_APPS_MCP_SERVER_NAME`，通过`resources/list`发现：

- MIME必须是`mcp/skill`。
- Resource URI是package ID。
- `_meta`提供skill/plugin名称和source。
- description提供路由描述。
- main prompt约定为`<package-uri>/SKILL.md`。

Skill发现复用MCP resource plane，而真正业务Tool仍走Tool plane。Resource是内容，Tool是动作，两者没有混成一个API。

## 18. Orchestrator只在无Local Environment的Thread开放

Thread start时，如果environments中出现`LOCAL_ENVIRONMENT_ID`，`orchestrator_skills_available=false`。还要同时满足config enabled和provider存在，才会：

- 在Thread context列出Orchestrator Skills。
- 注册`skills.list/read`Tools。

这是产品surface gating，不是provider自身authorization。配置动态变化通常只改enabled，不重新计算environment availability。

若Thread state异常缺失、Config change路径重建state时，代码默认`orchestrator_skills_available=true`，与正常Thread start判断不一致，值得收敛成同一resolver。

## 19. Orchestrator Discovery有全局10秒Deadline

最多：

- 10 resource pages。
- 100 Skill resources。
- 所有pages共用10秒absolute deadline。

不是每页重新10秒，因此慢服务器不能通过分页把总耗时放大到100秒。

第一页失败整体返回error；完成至少一页后失败则保留partial catalog并发warning。这是清晰的partial-progress语义。

## 20. Duplicate Cursor与Malformed Resource都被显式统计

Provider维护seen cursors，重复就停止并warning，防恶意/buggy pagination loop。

Malformed `mcp/skill`资源被skip并汇总数量。超过pages/skills上限也给truncated warning。

不过`skill_resources_seen`在resource验证前递增：前100个全是malformed也能耗尽上限，挤掉后面的valid Skill。计数应区分examined、accepted和malformed budgets。

## 21. `skill://` URI验证比普通字符串严格

Package/Resource URI要求：

- scheme精确`skill`。
- nonempty host。
- 无username/password/port/query/fragment。
- path segments非空。
- parse后canonical string与输入完全相同。
- 无whitespace/control/`<`/`>`。
- package最长1024 chars，resource最长2048。

这种canonical validation防同义URL、credential confusion和prefix绕过。

## 22. Resource Belongs-to-Package按URL Segment比较

Read不是字符串`starts_with`，而是：

- scheme相同。
- host相同。
- resource segments严格比package多。
- resource前缀segments等于package segments。

因此：

```text
skill://h/foo
```

不会错误授权：

```text
skill://h/foobar/secret
```

Segment-aware containment是任何URI namespace都应采用的做法。

## 23. Orchestrator Authority执行Exact Match

Read要求request authority精确等于：

```text
(Orchestrator, CODEX_APPS_MCP_SERVER_NAME)
```

再校验resource属于package、MCP resource client存在。三层边界分别回答：

1. 哪个source owner。
2. 哪个package namespace。
3. 当前session是否仍有transport。

这比Host/Executor provider对authority ID的校验更完整。

## 24. Orchestrator Read只接受Matching Text Content

MCP `read_resource`可返回多个content。Provider只取：

- `ResourceContent::Text`。
- content URI与请求resource完全相同。

Blob、不同URI text全部忽略。没有matching text就失败。

这防server把请求A的响应替换成B，也不允许模型把binary blob当指令文本。

## 25. 单Resource Content限制1MiB，但检查发生在Response Materialize之后

匹配text超过1MiB会拒绝。Read有10秒timeout。

上限保护后续cache/model层，却是在MCP client已经返回完整`String`后检查；若transport本身没有更早body/frame cap，大response仍造成一次内存峰值。

预算应尽可能靠近I/O边界流式执行，而不是只在业务对象已构造后检查。

## 26. Orchestrator Description被XML Escape但没有Ingestion字符上限

Name/plugin label限制64 chars，qualified name限制128，并拒绝`&<>`。Description被压成单行并escape `&<>`，但未在catalog ingestion阶段限制总字符；render时才截1024 chars。

和Host description一样，display projection cap不等于metadata memory cap。100个超长description仍可放大catalog cache。

## 27. Orchestrator Catalog Cache绑定MCP Client Generation

Thread state用`McpResourceClient::cache_key()`作为generation：

- 同key：OnceCell catalog只discover一次，失败warning也缓存。
- key变化：整代catalog和resource cache替换。

这比TTL更符合transport ownership：MCP runtime重建才允许新resource view。代价是同一连接上的server-side catalog更新不会自动看见。

## 28. Orchestrator Resource Cache有双上限

同generation最多缓存：

- 100个resources。
- 8MiB content bytes。

单resource最大1MiB。超过cache总预算的read仍可成功，只是不缓存。

Cache key包含authority/package/resource，防同URI在不同package/authority下串值。没有singleflight，并发首次Read仍可能重复RPC。

## 29. Cache Generation变化会整体遗忘旧Content

MCP cache key改变时创建新的`OrchestratorGenerationCache`，旧Arc在没有使用者后释放。

这解决“同URI在新MCP session代表不同内容”的ABA问题；但模型只看到URI，没有显式content version/hash。若旧Turn输出被replay到新generation，仍需要Turn snapshot/rollout记录来解释当时读到哪一版。

## 30. Thread Context、World State、Turn Input各负责不同来源

Extension把来源分开投影：

- Thread context：Orchestrator catalog及usage instructions。
- World State：当前selected Executor roots catalog变化。
- Turn input：Host + Orchestrator +当前Step Executor catalog，用于解析explicit mentions和注入main prompts。

Host默认catalog仍由Core legacy initial context负责，新extension处于迁移期，因此存在去重桥接逻辑。

## 31. Available Skills Fragment固定8KiB且按Catalog顺序First-Fit

新extension：

- 只展示enabled且prompt_visible entries。
- description优先short description，单项最多1024 chars。
- 总line bytes最多8000。
- 放不下的entry跳过，最后追加omitted count。

它不会像Core旧renderer那样round-robin分配description，也没有scope priority；provider/catalog顺序影响谁被保留。

同一产品同时存在两套budget算法，可能让legacy和extension展示集合不同，应最终统一。

## 32. Main Prompt注入限制8KiB

Explicit Skill选中后，extension读取main resource，再：

- content按UTF-8 char boundary截到8KiB。
- name截256 bytes。
- path截1024 bytes。
- 发truncation warning。
- 作为User-role `<skill>` fragment注入。

“读取完整resource”和“注入主Prompt”是两个不同预算。Orchestrator resource可达1MiB，但自动main prompt只用前8KiB；其余应通过Skill内指示再用`skills.read`加载相关resource。

## 33. Explicit Plain Name在Extension中取First Match，不要求唯一

这是与Core legacy selector的重要差异。Extension扫描`$name`时：

```text
catalog.entries.find(enabled && name == mention)
```

没有统计同名Skill，也没有检查connector collision。Winner由catalog/source注册顺序决定。

Path mention仍可精确选择多个同名package，但plain name存在authority confusion。应与旧逻辑统一为“name唯一才解析，否则要求resource link”。

## 34. Structured Invalid Path会Block同名Plain Fallback

和旧Core一致，结构化Skill/Mention先把name加入blocked set，再按path选。即使path没匹配，也不会在同一输入中退化成plain name选择。

这是好设计：UI已经提供明确handle，失败应显式失败，不应偷偷改选另一个authority的同名Skill。

## 35. 非Host同名Skill会抑制Legacy Host注入

迁移期为了避免同名Skill重复，若extension选中Executor/Orchestrator entry，会把Host snapshot中所有同名Skill path标为“已经注入”，Core legacy随后过滤它们。

这不是按package identity去重，而是按name跨authority抑制。若用户显式选择remote同名Skill，意图通常正确；但同名不一定等价，且plain-name first-match又可能不明确。

迁移完成前应记录实际winner authority/package，并让legacy只按相同identity去重，不用name推断替代关系。

## 36. `skills.list/read`目前只暴露Orchestrator Authority

Tool schema的authority enum只有`orchestrator`。Host/Executor Skill正文走explicit mention与各自filesystem注入，不让模型任意用Skill Tool读Host文件。

Tool仅在：

- Orchestrator provider存在。
- 当前Thread允许Orchestrator Skills。

时注册。

缩小工具面比做一个万能`read_any_skill`更安全，也让handle语义稳定。

## 37. `skills.list`输出也有独立预算

List只返回enabled且authority匹配的Skill：

- package/main resource handle必须非空、无control、最多2048 bytes。
- description截1024 chars。
- warnings最多4条，每条256 bytes。

Provider catalog最多100 Orchestrator Skill，所以List整体有间接count上限；但output总bytes仍依赖100项handle/description上限的乘积，没有单独统一截断器。

## 38. `skills.read`先重新验证Package仍在Catalog

模型必须传list返回的authority/package/resource。Read Tool：

1. 校验handle基本格式/2KiB。
2. 从当前generation catalog确认package enabled且authority匹配。
3. 才调用provider读取resource。
4. 确认provider返回同一个resource。

这防模型凭猜测直接读取未列出的package。Provider还会校验resource在package URI namespace内，因此“package可见”不会授权整个skill:// host。

## 39. Read失败对模型Generic，对日志Detailed

Provider错误会记录turn/call/resource和完整原因，但模型只收到`failed to read skill resource`。

这避免把MCP内部server、路径或transport细节暴露到模型上下文；同时降低自修复能力。可考虑返回稳定typed reason：not found、stale generation、too large、temporarily unavailable，而不是完整底层error或完全generic二选一。

## 40. Skill Tool Output标记External Context

`skills.list/read`使用`JsonToolOutput::with_external_context()`。这让后续context/memory pipeline知道内容来自外部authority，而不是Agent自己的可信结论。

这是重要provenance信号：被读取的Skill正文仍可能包含恶意instruction，不能因为它通过typed Tool返回就升级为system truth。

## 41. Search Port存在但产品Tool尚未暴露

Provider trait已有search，Catalog也定义match title/snippet/resource；当前三个provider返回空，Skill Tools只有list/read。

这体现了先稳定authority contract、再接搜索实现的演进方式。未来search结果必须：

- 绑定authority+package。
- 返回opaque resource。
- 有count/snippet bytes预算。
- 防snippet prompt injection升级。
- 读取时重新校验package generation。

不能把search result URL直接交给ambient fetch。

## 42. 优质设计总结

最值得当前 AI SEO Agent 学习的部分包括：

1. Authority、Package、Resource三元组替代全局Path。
2. Host/Executor/Orchestrator保留各自读取机制。
3. Display path与authorization handle分离。
4. Catalog partial success携带warnings。
5. Executor Skill只来自ready selected capability roots。
6. Environment ID与PathUri作为内部resource binding。
7. Orchestrator URI做canonical和segment-aware containment。
8. 全分页共享absolute deadline、duplicate cursor防循环。
9. Catalog/resource cache绑定MCP client generation。
10. Resource cache有count+bytes双预算。
11. Thread/World State/Turn三层投影分工。
12. Main prompt、list、read分别限额。
13. Read Tool先验证package仍在catalog。
14. Provider返回resource必须与request一致。
15. Skill Tool output标记external provenance。

## 43. 当前实现的主要风险边界

需要继续保持批判性的部分包括：

1. Catalog重复authority+package静默first-wins，无collision warning。
2. Registry只按kind路由，provider authority ID校验不一致。
3. Host read不校验authority ID/package。
4. Executor read不校验authority root ID或root containment。
5. Executor catalog整个Thread永不invalidate，可能长期stale。
6. Orchestrator同MCP generation不刷新server-side catalog。
7. Config change缺state时默认允许Orchestrator，与Thread start条件不一致。
8. Malformed Orchestrator resources会消耗100项budget。
9. 1MiB content限制发生在完整response materialize之后。
10. Orchestrator description ingestion无总字符上限。
11. Resource cache无singleflight，首次并发Read重复RPC。
12. Extension Skill列表first-fit，与Core round-robin/scope priority不一致。
13. Plain name选择first-match，不要求跨authority唯一。
14. Legacy去重按同名跨authority抑制，不按package identity。
15. Catalog/content generation没有进入durable Run receipt。

## 44. 对当前 NestJS + Vue 项目的迁移结论

当前项目未来可能同时读取：

- 当前服务数据库中的tenant SEO playbook。
- 用户连接的Google Drive/Notion文档。
- Browser/远程执行环境中的workspace instructions。
- 平台内置模板。

不要把它们都转换成server本地path。建议协议先固定：

```ts
type InstructionAuthority = {
  kind: 'platform' | 'tenant' | 'connector' | 'environment'
  id: string
  generation: string
}

type InstructionPackageRef = {
  authority: InstructionAuthority
  packageId: string
  version: string
}

type InstructionResourceRef = {
  package: InstructionPackageRef
  resourceId: string
  contentHash?: string
}
```

关键不变量：

- Catalog entry唯一键是authority+package+version。
- Read必须由authority owner执行，不能ambient fetch/path read。
- Plain name只有全catalog唯一才允许解析。
- Run记录实际winner authority/package/version/content hash。
- Provider必须自己验证完整authority ID，不只看kind。
- Remote resource用segment-aware containment或server-side opaque lookup。
- Catalog与resource cache都绑定generation并支持明确invalidate。
- Listing、main prompt、manual read分别有count/bytes/deadline预算。
- External instruction永远保留provenance，不进入高信任memory。
- 迁移新旧系统时按identity去重，不按display name猜等价。

多Authority Skill Runtime真正解决的不是“从更多地方读文档”，而是让每一段能改变Agent行为的内容始终带着所有者、命名空间、代际和读取权限一起流动。
