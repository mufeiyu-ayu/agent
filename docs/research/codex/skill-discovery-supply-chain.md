# Skill 发现与供应链：Root 优先级、Frontmatter、Prompt 注入、缓存与远程导出

本文研究 Codex 如何从系统、管理员、用户、插件、仓库和执行环境发现 `SKILL.md`，怎样把metadata压进模型上下文、在显式mention后读取完整指令，以及文件变化、symlink、optional policy和远程zip如何影响最终authority。重点是：Skill不是普通帮助文档，而是一段能改变Agent工作方式的指令供应链。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/core-skills/**`、`codex-rs/skills/**`、`codex-rs/ext/skills/**`、`codex-rs/app-server/src/skills_watcher.rs`、`codex-rs/core/src/session/turn.rs`

## 1. Skill 有发现、暴露、选择、读取、执行五个阶段

主链不是“扫描到文件就整篇塞进Prompt”：

```text
discover roots
  -> walk SKILL.md candidates
  -> parse small frontmatter + optional agents/openai.yaml
  -> build immutable Turn catalog snapshot
  -> render bounded name/description/path list
  -> model/user selects a skill
  -> read current full SKILL.md body
  -> inject as contextual user fragment
  -> model follows instructions and calls ordinary tools
```

Skill自己不执行代码。它通过instruction influence让Agent再调用shell、MCP或其他Tool，因此其安全性同时依赖Prompt authority和后续Tool治理。

## 2. Skill Scope 是来源分类，不是自动权限等级

Host Skill有四种scope：

| Scope | 典型来源 |
| --- | --- |
| `System` | binary内嵌并缓存到`$CODEX_HOME/skills/.system` |
| `Admin` | `/etc/codex/skills`等system config folder |
| `User` | `$CODEX_HOME/skills`、`$HOME/.agents/skills`、plugin roots、extra roots |
| `Repo` | project `.codex/skills`、project root到cwd各层`.agents/skills` |

Scope参与排序、telemetry和产品展示，但Skill最终仍通过普通Tool调用产生副作用。不能因为叫System就跳过approval，也不能因为叫Repo就允许越过workspace边界。

## 3. Root 发现同时兼容两套生态目录

User层保留旧的`$CODEX_HOME/skills`，同时加载跨Agent生态的`$HOME/.agents/skills`。

Repo层同时支持：

- 每个有效Project config layer的`.codex/skills`。
- 从project root到当前cwd之间每一级目录的`.agents/skills`。

后者让monorepo可以逐层叠加领域Skill：root放通用构建规则，`apps/web`放前端Skill，深入目录时自动获得更局部能力。

## 4. Project Root 由Marker向上探测

Loader从cwd向上并发probe `project_root_markers`，第一个匹配的ancestor成为边界；默认marker来自Config模块。

然后按root→cwd顺序检查每层`.agents/skills`。若没有marker，cwd本身就是project root。

这比永远扫到filesystem root更可控，但marker本身决定了ambient instruction范围。错误marker会让上级目录的Skill意外进入或应该进入的Skill消失。

## 5. Disabled/Untrusted Project Config Layer 仍提供 Skill Root

`skill_roots_from_layer_stack_inner()`读取config layers时使用`include_disabled: true`。源码测试明确验证“marked untrusted”的Project layer仍会加入其`.codex/skills`。

这意味着Project config的TOML能力可因trust被禁用，但同目录Skill discovery并不随之关闭。原因可能是Skill被当作workspace content而非可执行config；安全上却不能忽略：Repo Skill描述会进入Agent指令面，选中后完整正文会影响Tool调用。

更清晰的产品应分别展示：

- workspace已信任执行config。
- workspace允许发现instruction packages。
- 某个Repo Skill本轮已激活。

单个“trusted project”boolean无法表达这三个状态。

## 6. Root 去重与 Skill 去重都基于Path，不基于Name

Root列表先按路径保留第一项；加载后canonicalize root和Skill path，再按`path_to_skills_md`去重。

同名但不同路径的Skill都会保留。例如Repo和User都可以叫`deploy`。这避免高优先级来源静默覆盖另一个package，却要求选择阶段处理ambiguity。

Name不是identity，Path才是host Skill的稳定handle。

## 7. 最终Catalog排序与Prompt预算排序不相同

合并后的普通列表按：

```text
Repo -> User -> System -> Admin
```

再按name/path排序，适合UI先展示当前工作区相关能力。

当模型上下文预算不足、必须丢完整Skill条目时，Prompt优先级反转为：

```text
System -> Admin -> Repo -> User
```

同一份数据为不同consumer使用不同projection顺序。不要把UI排序误当authority precedence。

## 8. Scanner 有明确的广度、深度与并发上限

每个root：

- 最大深度6。
- 最大目录2000。
- 最大entries 20,000。
- 最多64个Skill并发load。
- ancestor probes最多256并发。

Walk若truncated或部分路径失败，会保留已发现结果并产出warning，而不是整root fail closed。

这是availability优先的partial inventory语义；调用方必须看到`inventory_complete=false`的事实，不能把“返回15个”理解成“root里只有15个”。当前warning主要进log/部分API，catalog本身没有generation completeness字段。

## 9. Hidden Directory与Symlink策略按来源不同

Host scanner默认跳过root下hidden directories：

- User/Repo/Admin跟随directory symlink。
- System忽略directory symlink。

如果visible alias指向hidden target，仍可能通过alias发现。

Execution environment scanner则跟随directory symlink并包含hidden directories，因为环境filesystem本身被视为authority owner。

来源策略不同是合理的，但symlink意味着“位于root路径下”不等于“真实文件也在root内”。Canonical path会成为identity，可避免alias重复，却没有因此自动限制目标必须留在root。

## 10. Canonicalization是Identity归一化，不是Containment检查

发现到Skill后，Loader尝试canonicalize其路径：

- 成功则用真实absolute path作为`path_to_skills_md`。
- 失败则保留原路径。

对于允许follow symlink的scope，这会让root外目标以真实路径进入catalog。系统没有在这里执行`canonical.starts_with(root)`。

这可能是用户有意用symlink共享Skill；同时也意味着root只能证明discovery入口，不能证明content ownership。安全审计应同时记录declared root、discovered alias和canonical target。

## 11. Plugin Namespace来自最近有效Manifest

Skill base name可被最近plugin manifest限定：

```text
plugin=figma, skill=use
  -> figma:use
```

解析优先级是：

1. Plugin manager显式提供namespace。
2. 最深canonical symlink root或nested plugin root。
3. 扫描root继承的namespace。

只probe实际Skill ancestors，避免无关sibling manifest改变名称或制造大量I/O。Invalid nested manifest会被忽略，由更外层namespace接管。

## 12. Frontmatter要求很小，正文完全自由

`SKILL.md`必须以`---`起始并有closing delimiter。核心字段：

```yaml
---
name: optional-name
description: required routing description
metadata:
  short-description: optional
---
```

Name缺失时默认使用Skill目录名；description必须非空。Name最多64字符，plugin-qualified name最多128字符。

Frontmatter struct没有`deny_unknown_fields`，未知字段会被忽略，有利于跨生态兼容，也可能让拼错字段无声失效。

## 13. YAML Repair只修常见的未加引号Scalar

第三方Skill常写：

```yaml
description: Build for AWS: ECS
```

标准YAML会把其中colon误解为结构。Loader首次parse失败后，会逐行把疑似plain scalar单引号包裹再parse一次。

Repair不尝试修任意破损YAML，block scalar和已加引号内容保持原样。兼容层应窄而可解释，否则“修复”会把恶意/错误结构变成另一份有效policy。

## 14. Main Description没有在Parse阶段使用1024字符上限

源码定义`MAX_DESCRIPTION_LEN=1024`，但当前parse主description只校验非空，未调用对应长度校验；1024上限实际用于short description、default prompt、dependency fields，并在render时单独截断catalog description。

因此超长description仍会完整驻留metadata内存，只是在默认Prompt投影中最多保留约1024字符。

这是典型区别：display limit不是ingestion limit。面对大量Skill，仍应给单文件、frontmatter和总metadata bytes独立上限。

## 15. Optional `agents/openai.yaml` 承载UI、Dependency与Policy

可选metadata包含：

- display name、short description。
- small/large icon、brand color、default prompt。
- Tool dependencies。
- `allow_implicit_invocation`。
- product restrictions。

它与`SKILL.md`并行读取，减少startup latency。Environment-owned Skill只提取dependencies/policy，不把host-only icon path伪装成环境资源。

## 16. Optional Metadata 是 Fail Open

`openai.yaml`不存在、stat失败、read失败或YAML无效时，Loader记录warning并继续加载`SKILL.md`，metadata变成None。

这对UI装饰合理；对policy存在危险语义：

- 本想写`allow_implicit_invocation: false`，文件损坏后恢复默认true。
- 本想限制products，文件损坏后products为空，等价于不限制。

Policy和cosmetic metadata不应共享同一个fail-open故障策略。更稳健方案是：UI字段可忽略，权限/路由限制parse失败则Skill不可隐式使用或直接禁用。

## 17. Policy Default允许Implicit Invocation

没有policy或字段为空时，`allows_implicit_invocation()`返回true。

这里的implicit有两层含义：

- Skill metadata可自动出现在模型可见列表，模型按description决定是否使用。
- 后续执行shell读取该Skill文档/运行其script时，系统可识别usage并记录implicit invocation telemetry。

`allow_implicit_invocation=false`主要阻止自动model routing；显式path mention仍可选中。它不是“Skill永远不能运行”。

## 18. Product Restriction在Load Outcome阶段过滤

有效policy可声明适用Product。Service加载所有roots后按当前restriction product过滤：

- skills列表。
- filesystem mapping。
- root mapping。
- implicit path indexes。

这比仅在UI隐藏更完整，避免被path mention绕过。

但如前所述，optional policy parse失败会丢掉restriction，形成fail-open缺口。

## 19. Dependency Metadata只是声明，不是安装Authority

Tool dependency保存type/value/transport/command/url等字符串，单字段有长度校验。解析成功不代表：

- Tool已安装。
- command可信。
- URL允许访问。
- dependency版本兼容。

Turn在显式Skill选中后可触发MCP dependency elicitation，但真正安装/启用仍要经过独立流程。Package metadata只能提出需求，不能自授能力。

## 20. Icon Path有Lexical围栏，但不是完整Filesystem证明

普通Skill icon必须是`assets/...`相对路径；absolute path和`..`被拒绝。Plugin Skill允许`..`，前提是lexically normalize后落在plugin-level `assets/`下。

这防普通path traversal，但只做lexical normalize，未在此canonicalize目标、验证symlink或文件类型。`assets/icon`若本身是symlink，仍可能指向外部。

展示层读取asset前还应做realpath containment、size/MIME限制，而不是只信metadata path。

## 21. Config Disable规则只有Name或Path二选一

User config与SessionFlags可以按：

- canonical path。
- qualified/exact name。

设置enabled。后出现的同selector覆盖前者；name selector会同时影响所有同名Skill。

同时写name和path的entry会被忽略，避免含糊的AND/OR语义。Path适合精确禁用，Name适合批量策略。

规则应用后Skill仍留在load outcome供UI显示enabled=false，但不会进入自动Prompt或显式selection。

## 22. Snapshot Cache Key不包含文件Content Generation

`SkillsService`有：

- cwd cache。
- effective config cache。

Config key包含roots、scope、plugin ID/namespace和skill config rules，不包含：

- file mtime。
- inode/hash。
- directory inventory generation。
- Skill正文hash。

因此cache语义明确是“直到显式invalidate”，不是自动content-addressed cache。

## 23. Local File Watcher以10秒Throttle清整张Cache

App Server为local environment注册recursive roots watcher。事件经10秒throttle后：

1. 清cwd/config全部Skill cache。
2. 发`SkillsChanged` notification。

Plugin roots由plugin lifecycle单独invalidate，不重复watch。Remote environment不注册本机watcher。

Noop watcher fallback只记warning；此时变化要靠force reload、config/plugin操作或新进程看到。通知表示“可能变了”，不携带changed paths或new generation。

## 24. TurnContext冻结Catalog Snapshot

每个Turn构建时从SkillsService获取`HostSkillsSnapshot`并放进TurnContext。该Turn的：

- metadata列表。
- enabled/disabled判断。
- path→filesystem映射。

保持不变。File watcher清的是未来查询cache，不会修改已开始Turn的snapshot。

这与ToolRegistry Step快照一致：执行中的推理不应因文件事件突然更换可选能力集合。

## 25. Snapshot不冻结Skill Body，存在Metadata/Body TOCTOU

`HostSkillsSnapshot`保存metadata与filesystem mapping，但`read_skill_text()`在Skill真正被选中时重新从path读当前文件。

因此可以出现：

```text
Turn catalog saw:
  name=lint, description="review style only"

file changes before explicit selection

injected body now says:
  run unrelated destructive commands
```

Watcher/cache清理不能消除同一Turn内的这个窗口。若要求能力快照强一致，应在discovery时保存content hash，并在injection时验证hash或直接保存bounded immutable body snapshot。

## 26. Model默认只看到Bounded Metadata，不看到全部正文

默认metadata预算：

- 有context window时取2%，至少1 token。
- 无window时8000 characters。
- 单description先截到1024 chars。

若超预算：

1. 先保留所有name/path，round-robin公平分配description字符。
2. 连最小行都放不下时，按System/Admin/Repo/User优先保留完整entry。
3. 记录included/omitted/truncated telemetry与warning。

这比为前几个Skill塞满description更公平，避免alphabetical early entries垄断上下文。

## 27. Path Alias只在确实改善预算时启用

Absolute paths过长造成metadata预算浪费时，Renderer会构建：

```text
### Skill roots
- r0 = /very/long/root

- skill-name: description (file: r0/pkg/SKILL.md)
```

只有alias版本：

- 包含更多Skill；或
- 少截description；或
- 总cost更低

才替换absolute版本。

优化不是永远缩写路径，因为alias table自己也有成本，并增加模型解引用步骤。

## 28. Explicit Selection优先Path，Plain Name必须唯一

Selection顺序：

1. 结构化`UserInput::Skill { name, path }`按exact path选。
2. Markdown resource link按path选。
3. `$name` plain mention只有在enabled Skill中exact name唯一，且不与connector slug冲突时才选。

Structured input中的name不会替代path authority；它还会block同名plain fallback，避免UI传了无效path后悄悄选中另一份同名Skill。

这是正确的anti-confusion设计：human-facing name用于展示，opaque/canonical path用于identity。

## 29. Mention Parser刻意排除常见环境变量

文本扫描支持字母数字、`_`、`-`、`:`，但排除`$PATH`、`$HOME`、`$PWD`等常见env var，避免shell讨论意外触发Skill。

Linked mention还能根据`app://`、`mcp://`、`plugin://`、`skill://`区分resource kind，防一个统一`$name` parser把App、Plugin和Skill混成同一namespace。

字符串heuristic只能降低误触发，不能替代结构化UI selection。

## 30. Skill正文作为User Context Fragment注入

Legacy injection把选中Skill包装为：

```xml
<skill>
<name>...</name>
<path>...</path>
...完整SKILL.md...
</skill>
```

其role是`user`，而不是system。这样来源指令不会在协议层自动高于developer/system policy。

但模型仍会认真执行它，因此Skill body必须被视为active instructions，不是无害attachment。

## 31. Legacy Path读取完整正文且没有独立Bytes上限

`build_skill_injections()`对每个mentioned Skill直接`read_file_text()`，源码未见单Skill或本Turn总body bytes限制。

新Skills extension的main prompt会截到8KiB；Core为兼容extension避免重复注入，却仍先读取legacy body再根据`InjectedHostSkillPrompts`过滤重复项。

因此extension的8KiB模型投影上限并不完全等于I/O/内存上限。大Skill仍可在legacy读取阶段消耗资源；extension未接管的路径也可能完整进入上下文。

## 32. Read Failure是Per-Skill Warning，不阻断其他Skill

多个explicit Skill逐个读取：

- 成功项注入并记录analytics/OTEL。
- 失败项生成Warning。
- 其他项继续。

Partial success适合多Skill组合，但模型需要知道缺了哪一份，否则可能以为全部instructions都已加载。

当前warning含Skill name/path和底层error，诊断性强，也需注意远程filesystem错误是否可能泄漏内部路径。

## 33. Implicit Usage Detection基于实际Shell Command

系统还会分析Unified Exec/Shell command：

- 是否通过python/node/bash等runner执行某Skill `scripts/`下的脚本。
- 是否通过可识别read command读取exact `SKILL.md`。

Path会canonicalize，scripts目录按ancestor匹配。每Turn同scope+path+name只记录一次usage event。

这不是在执行前授予权限，而是观察“Agent实际上使用了哪个Skill”，用于analytics和extension contributor。它比只统计模型提到`$skill`更接近真实使用。

## 34. `allow_implicit_invocation=false`不阻止Usage Detection

Final indexes收录所有enabled Skill，而非只收录允许implicit routing的Skill。源码注释明确：即使Skill不能自动被模型路由，只要其文件/script实际被读/执行，也应检测usage。

Policy控制“是否推荐/自动选择”，telemetry检测“是否实际使用”，二者不应混为一条boolean。

## 35. Environment Skill保留URI Authority，不伪装Host Path

Remote/selected execution environment Skill使用`PathUri`：

- discovery/read走该environment的`ExecutorFileSystem`。
- 不强制转换成host absolute path。
- metadata只保留可跨authority表达的字段。

这避免模型拿到一个看似本地`/tmp/...`、实际只能由remote executor读取的路径。Resource identifier必须连同authority一起传递。

## 36. System Skill安装是Embedded Cache，不是不可变只读区

Binary内嵌Skill目录，startup计算fingerprint：

- marker匹配且`.system`存在就跳过安装。
- 不匹配则先删除整个`.system`，再逐文件写入，最后写marker。

Fingerprint使用Rust `DefaultHasher`，目标是cache invalidation，不是cryptographic authenticity。更关键的是startup只信marker，不重新hash落盘文件：本地修改Skill但保留marker可长期存在，并仍被标为System scope。

“由binary提供”与“当前磁盘内容仍等于binary”是两件事。

## 37. System Skill更新不是原子目录切换

安装流程是remove existing→逐目录/文件写→marker。如果中途I/O失败，会留下partial `.system`且无新marker；下次startup再尝试修复。

它具备eventual repair，但当前启动可能看见部分目录。更强实现应写temp versioned目录、验证manifest/hash，再atomic rename/symlink切换。

System scope parse error被静默忽略，不进入普通Skill errors列表，降低内置坏包对用户噪声；代价是内置能力消失时诊断较弱。

## 38. Remote Skill API目前是未接入产品面的低层代码

`core-skills/remote.rs`源码注释明确：为未来wiring保留，当前active product surface未使用。

它要求ChatGPT/Codex backend auth，支持workspace/all/personal/example scopes，GET list与export都设30秒timeout。

研究这段代码应标注“潜在供应链路径”，不能把未接线能力写成当前用户功能。

## 39. Remote Zip防Traversal，但缺少下载/安装事务预算

Export：

- 先把response完整读成bytes。
- 仅检查PK zip magic。
- `safe_join`只允许Normal path components，拒绝absolute、`..`等Zip Slip。
- blocking task逐entry写到`$CODEX_HOME/skills/<skill_id>`。

未见：

- body compressed bytes上限。
- entry count/uncompressed bytes/ratio上限。
- signature/manifest/content hash。
- temp directory+atomic publish。
- existing directory rollback。
- private file mode。

网络timeout不能防zip bomb或大body内存峰值。

## 40. Remote `skill_id` 本身未做Path Component校验

Zip entry走`safe_join`，但output directory直接：

```text
codex_home / skills / skill_id
```

若未来调用方允许不可信`skill_id`包含absolute path或`..`，可能逃出skills root。当前API可能预期ID来自受信backend，但函数边界没有编码该不变量。

正式接入前应把ID解析成受限opaque identifier，不能只依赖服务端“应该返回安全字符串”。

## 41. Scope Provenance不等于Content Integrity

几种典型错觉：

- System：磁盘cache可能被本地修改。
- Admin：symlink可指root外。
- Plugin：package目录可在安装后变化。
- Repo：disabled/untrusted config layer仍可能被发现。
- Remote：HTTPS/auth只证明response来源，不证明package签名/version pin。

Scope回答“从哪条发现链进入”，不回答“内容是否未被篡改”。后者需要hash、signature、immutable package version和receipt。

## 42. 优质设计总结

最值得当前 AI SEO Agent 学习的部分包括：

1. Discovery metadata与完整instructions渐进式加载。
2. Root/Skill identity以canonical path为主，name只作展示与路由。
3. 同名Skill不静默覆盖，plain mention要求唯一。
4. Scanner depth/directory/entry/concurrency有界。
5. Partial inventory保留warnings，不伪装完整成功。
6. Plugin namespace取最近有效manifest。
7. Turn持有immutable catalog snapshot。
8. Model-visible Skill metadata使用context percentage预算。
9. Description空间round-robin公平分配。
10. System/Admin/Repo/User在预算压力下显式排序。
11. Path alias只有收益时才启用。
12. Host与environment resource保留各自filesystem authority。
13. Structured selection按path，避免name confusion。
14. 实际script/doc usage另做implicit telemetry。
15. 普通Tool权限链不因Skill来源而缩短。

## 43. 当前实现的主要风险边界

需要继续保持批判性的部分包括：

1. Disabled/untrusted Project layer仍加载`.codex/skills`。
2. Repo/User/Admin symlink可指root外，canonicalization不做containment。
3. Optional metadata fail open会丢implicit/product policy。
4. Main description在ingestion阶段无实际1024字符限制。
5. SKILL.md正文读取无统一bytes/Turn总量上限。
6. Catalog snapshot不冻结正文，存在metadata/body TOCTOU。
7. Cache key无content generation，依赖watch/手动invalidate。
8. Local watcher 10秒throttle且remote environment无同等watch。
9. Icon lexical围栏不验证symlink realpath/MIME/size。
10. System cache只信marker，不复核落盘内容。
11. System目录更新非原子、失败可留下partial tree。
12. Remote export无size/ratio/signature/atomic publish。
13. Remote skill ID未在函数边界限制为单path component。
14. Scope label容易被误读为完整integrity/authority证明。

## 44. 对当前 NestJS + Vue 项目的迁移结论

当前AI SEO Agent暂时不需要Skill marketplace，但很快会出现“SEO模板、品牌规则、站点规范、分析流程”这类可复用instruction package。建议先建轻量、可审计边界：

```text
InstructionPackage
  id
  tenantId / projectId
  name
  description
  immutableVersion
  bodyHash
  bodyStorageKey
  allowedToolNames
  activationMode(explicit | suggested)
  status

AgentRunInstruction
  runId
  packageId
  version
  selectedBy(user | model | policy)
  bodyHash
  injectedAt
```

关键约束：

- 先展示bounded metadata，选中后再读正文。
- Run冻结package version/body hash，避免TOCTOU。
- Tenant/Project/User/System scope与数据库ownership绑定。
- Policy字段parse失败不能默认扩大权限。
- package只能声明Tool dependency，不能自动安装或自授权限。
- explicit selection使用ID/version，不用display name作identity。
- 正文和引用资源分别设bytes、count、MIME预算。
- 导入包用temp storage、manifest/hash验证、atomic publish。
- Skill instructions仍低于系统安全策略，Tool照常校验、审批、超时和审计。

最重要的学习不是如何写一份`SKILL.md`，而是如何把“会影响Agent行为的文本”当作有版本、有来源、有完整性、有激活回执的软件供应链。
