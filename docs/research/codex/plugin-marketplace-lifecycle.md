# Plugin Marketplace Add、Upgrade、Remove 与 Cache 事务

Codex 中的 Marketplace 不是“已安装插件”的同义词。Marketplace 是插件目录来源；真正可运行的 Plugin 还要从 Marketplace source物化到 Plugin Store，再被运行时加载。

因此至少有四层状态：

```text
User config marketplace entry
  声明目录从哪里来

Installed marketplace root
  Git checkout或Local source目录

Plugin Store cache
  已选择安装/启用插件的版本化副本

Loaded runtime caches
  当前Thread实际看到的Skill/MCP/Hook/App
```

本文研究本地/自定义 Marketplace 的 add、startup auto-upgrade、manual upgrade、remove，以及它们如何与Plugin Store cache衔接。Remote Plugin Service的账号installed与bundle事务见独立专题，不在本文重复。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/core-plugins/src/marketplace_add.rs`
- `codex-rs/core-plugins/src/marketplace_add/source.rs`
- `codex-rs/core-plugins/src/marketplace_add/install.rs`
- `codex-rs/core-plugins/src/marketplace_add/metadata.rs`
- `codex-rs/core-plugins/src/marketplace_upgrade.rs`
- `codex-rs/core-plugins/src/marketplace_upgrade/git.rs`
- `codex-rs/core-plugins/src/marketplace_upgrade/activation.rs`
- `codex-rs/core-plugins/src/marketplace_remove.rs`
- `codex-rs/core-plugins/src/marketplace_policy.rs`
- `codex-rs/core-plugins/src/loader.rs`
- `codex-rs/core-plugins/src/manager.rs`
- `codex-rs/config/src/marketplace_edit.rs`
- `codex-rs/app-server/src/request_processors/marketplace_processor.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/plugin.rs`

## 2. 先分清 Marketplace 与 Plugin

### 2.1 Marketplace 安装

Marketplace add回答：

> 这个插件目录来自哪个Git仓库或本地路径？

它写入：

```toml
[marketplaces.example]
source_type = "git"
source = "https://..."
ref = "main"
sparse_paths = [".agents"]
last_updated = "..."
last_revision = "..."
```

Git source还会物化到 `$CODEX_HOME` 的 marketplace install root；Local source则直接引用用户目录。

### 2.2 Plugin 安装

Plugin install回答：

> Marketplace 中的某个插件是否复制到Plugin Store并由配置启用？

它使用另一棵目录：

```text
$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>
```

Remove Marketplace不会自动等于Uninstall Plugin。已物化的Plugin Store cache、plugin config和当前runtime可能继续存在。

### 2.3 Loaded runtime

Marketplace source或Plugin Store更新后，Manager还要失效：

- loaded plugins cache；
- tool suggestion metadata；
- Skill catalog；
- MCP/App/Hook投影。

所以“Git checkout已升级”不等于“当前Thread下一次Tool planning已使用新能力”。

## 3. Source Parsing

### 3.1 支持的Source

Add支持：

- GitHub shorthand：`owner/repo`；
- shorthand ref：`owner/repo@main`；
- HTTP/HTTPS Git URL；
- SSH URL：`ssh://...`或`git@host:path`；
- URL fragment ref：`https://...repo.git#v1`；
- absolute/relative/tilde local directory。

GitHub HTTPS URL会去尾斜杠并补`.git`，使shorthand与完整URL拥有相同source identity。

`file://`不会被当作Local path，也不是支持的Git URL。

### 3.2 Ref优先级

显式`ref_name`参数优先于source字符串中的`#ref`或`@ref`。空ref会归一成None。

Ref作为单独argv传给git，没有shell拼接，避免shell injection。但当前未见严格ref grammar，也没有在`git checkout`前统一插入`--`分隔；以`-`开头的值仍可能被git当作option。

Sparse paths同样作为独立argv，避免shell转义问题，但缺少统一条目数、总字符、`--` option-like值和目录深度校验。

### 3.3 Local path

Local source会：

- 展开`~/`；
- 相对当前Codex process cwd解析；
- canonicalize；
- 要求是目录，不是文件。

Local路径身份稳定在canonical path，但目录内容本身可随时变化，不存在revision或digest。

## 4. Marketplace Policy

Enterprise requirements可启用`restrict_to_allowed_sources`。Allowed source支持：

- exact Git URL + 可选exact ref；
- Git hostname regex；
- exact normalized local path；
- Codex内置managed marketplace特殊路径/name约束。

Add在创建install root、clone或写config之前验证policy。被拒绝source不会产生网络或磁盘副作用，这是优质顺序。

Upgrade也会按当前传入ConfigLayerStack requirements重新验证每个Git source。已配置但现已被policy禁止的Marketplace不会继续拉取。

边界包括：

- policy关闭时允许HTTP明文Git和任意SSH/HTTPS目的地；
- host pattern是管理员提供的Regex，是否锚定取决于配置；
- SSH hostname靠字符串解析，不做DNS/IP/private network决策；
- policy约束source identity，不验证commit signature或publisher identity；
- Upgrade使用调用时的requirements snapshot，任务过程中requirements变化没有generation fencing。

## 5. Add 事务

### 5.1 App Server入口

`marketplace/add`先加载最新配置，取得requirements，再把blocking文件/Git工作放入`spawn_blocking`。

Response返回：

- marketplace name；
- installed root；
- already added。

它不返回commit SHA、config generation、cache refresh或runtime effective状态。

### 5.2 Existing source幂等路径

Add先扫描user config，查找source type、source、ref、sparse paths完全匹配的entry，并解析其root。

若root仍是合法Marketplace：

- 验证managed name约束；
- 重写/更新该config entry和last_updated；
- 返回`already_added=true`；
- 不重新clone。

这让重复Add相对幂等，但“配置匹配+manifest可读”不证明Git checkout content仍对应远端revision。

### 5.3 Local source Add

Local source不会复制到Marketplace install root：

1. 验证source root中的Marketplace manifest；
2. 取得并验证manifest name；
3. 拒绝与不同source同名的已配置Marketplace；
4. 只写user config；
5. installedRoot返回canonical local path。

这是开发模式的live pointer：用户修改Local目录后，Marketplace内容直接变化。它没有immutable generation、last_revision或rollback source copy。

### 5.4 Git source Add

Git Add主链：

```text
parse + policy
  -> create install root/.staging
  -> create marketplace-add-* temp directory
  -> git clone / sparse checkout / checkout ref
  -> validate marketplace manifest + name
  -> compute safe destination
  -> canonical parent containment check
  -> rename staged root to destination
  -> write user config
  -> success
```

Clone完整成功并验证manifest后才rename到稳定路径，避免Reader看到半个checkout。

### 5.5 Config失败rollback

若root已rename成功、config写入失败：

- 尝试把destination rename回staging path；
- rollback失败时返回同时包含root位置与rollback错误的诊断。

这避免“磁盘Marketplace存在但config完全不知情”成为默认partial state。

不过Add提前对TempDir调用`keep()`。Clone/validation/duplicate/config rollback后的staging目录可能残留，缺少自动RAII清理和retention扫描。

## 6. Add Git执行边界

### 6.1 Non-interactive

Git进程设置：

```text
GIT_TERMINAL_PROMPT=0
```

避免等待终端用户名/密码。但credential helper、SSH helper和Git config仍可能执行。

### 6.2 无timeout

Add使用`Command::output()`，没有显式deadline。DNS、credential helper、SSH、代理或server卡住时，Marketplace Add可长期占用blocking worker。

stdout/stderr在退出前由标准库完整收集，没有产品级bytes cap；失败消息会把两者拼进错误。

Upgrade已有30秒per-command timeout，Add与Upgrade的Git治理不一致。

### 6.3 继承环境

Git从PATH查找，继承Codex process environment、global Git config、proxy、credential helper和SSH config。

Marketplace Add是外部网络与本机helper执行操作，不应被误称为纯配置写入。

### 6.4 下载预算

普通clone不使用`--depth`，没有repo bytes、object count、checkout files或disk quota。Sparse模式使用`--filter=blob:none --no-checkout`，但仍缺总预算。

## 7. Config 写入语义

`record_user_marketplace`和remove path使用：

```text
read config.toml
  -> parse toml_edit Document
  -> mutate marketplace table
  -> fs::write(config.toml, full document)
```

优点是尽量保留其他TOML格式与字段。风险是：

- 直接覆盖，不使用temp+rename；
- 无file/directory fsync；
- 无跨进程lock；
- 无compare-and-swap revision；
- 并发config editor可能lost update；
- crash/短写可能留下损坏config；
- upsert会重建该Marketplace table，未知扩展字段可能丢失。

Add/Upgrade对Marketplace root的rename比config persistence更原子。整个跨介质事务的durability上限由最弱的config写入决定。

## 8. Upgrade 候选与Remote Revision

### 8.1 只升级User Git Marketplace

Upgrade只从effective user config加载`source_type=git`的entries：

- Local source跳过；
- managed/project/admin marketplace不会由这个user写流程修改；
- entries按name排序；
- 单个parse错误记录为per-marketplace error，不阻断其他Marketplace。

Manual upgrade可选指定name；找不到Git Marketplace时返回InvalidRequest。

### 8.2 Remote revision

非full SHA ref通过：

```text
git ls-remote SOURCE REF
```

取得第一行SHA。若ref本身是40位hex，直接把它当remote revision，跳过ls-remote。

这减少固定SHA的网络请求，但不证明remote仍公开该commit；后续clone/checkout或现有sidecar负责实际可用性。

### 8.3 三方Skip条件

只有三项同时成立才跳过clone：

1. destination仍是合法Marketplace且manifest name匹配；
2. user config `last_revision`等于remote revision；
3. destination中的`.codex-marketplace-install.json`完整匹配source/ref/sparse/revision。

配置、目录manifest、installed sidecar三方一致才认为up-to-date，比只信`last_updated`强得多。

初次Add不会写activated revision sidecar，config last_revision也是None，因此第一次auto/manual upgrade通常会重新clone并建立可验证revision基线。

## 9. Upgrade Stage

Upgrade为每个Marketplace：

1. 当前policy复核source；
2. 查询remote revision；
3. 在`install_root/.staging/marketplace-upgrade-*`创建RAII TempDir；
4. clone source；
5. checkout ref/sparse paths；
6. `rev-parse HEAD`取得实际activated revision；
7. 验证manifest name与配置name完全一致；
8. 在staging写`.codex-marketplace-install.json`；
9. 准备config update；
10. 进入activation transaction。

分支可能在`ls-remote`与clone之间移动。代码最终把实际`rev-parse HEAD`写入sidecar和config，不会谎称激活的是早先remote revision。

## 10. Upgrade Git Deadline

Upgrade每个Git子命令有30秒timeout：

- ls-remote；
- clone；
- sparse-checkout set；
- checkout；
- rev-parse。

这是per-command budget，不是整个Marketplace总deadline。Sparse upgrade最坏可串行消耗多个30秒；多个Marketplace又顺序执行。

实现用100ms polling，超时kill direct child，再wait output。它不显式kill整个process group；credential/SSH helper descendants可能残留。

stdout/stderr用pipe，直到进程退出后读取。大量输出可能填满OS pipe，使child阻塞并最终超时。错误只展示stderr，仍没有统一redaction；带credential的source URL或helper输出可能进入App Server response/log。

## 11. Activation 与Rollback

### 11.1 Existing destination

已有Marketplace root时：

```text
destination -> marketplace-backup-*/root
staged root -> destination
after_activate callback
  -> ensure user config unchanged
  -> write new last_revision/last_updated
success -> backup TempDir drop删除旧root
```

若staged rename失败，先恢复backup。若rollback也失败，保留backup目录并把路径写入错误。

若config callback失败：

- 删除新destination；
- 把backup恢复为destination；
- rollback失败同样保留backup path。

### 11.2 New destination

不存在旧root时：

- staged rename到destination；
- config callback失败则remove新root；
- remove也失败会返回partial state位置。

### 11.3 Config CAS

在写config前，Upgrade重新读取user config并比较：

- name；
- source；
- ref；
- sparse paths；
- last revision。

若升级期间用户修改/删除Marketplace，activation会rollback root，不用旧任务覆盖新意图。

这是很有价值的optimistic concurrency control。

局限是“check unchanged”和`record_user_marketplace`之间仍是两个独立步骤，没有file lock/CAS write。另一个writer可以在检查后、写入前修改config，仍可能lost update。

## 12. Crash Consistency

可见性原子性来自同父目录rename，但没有file/directory fsync。典型crash窗口：

| 窗口 | 恢复后可能状态 |
| --- | --- |
| old root已移到backup，新root未rename | destination缺失，backup残留 |
| new root已激活，config未写 | root新、config revision旧 |
| config direct write中crash | root可能已新，config损坏/截断 |
| config写成功，backup未清 | root/config新，旧backup残留 |
| sidecar写完但未fsync | root存在，metadata可能缺失/损坏 |

下次Upgrade的三方一致性检查能修复部分“root新/config旧/sidecar缺”的情况，但它不是完整transaction journal。Config损坏时甚至无法加载候选。

## 13. Plugin Store Cache Refresh

Marketplace root升级成功后，Manager对`upgraded_roots`运行`ForceReinstall`的non-curated plugin cache refresh。

它只处理当前config中已配置的non-curated Plugin IDs：

1. 从新Marketplace roots重建plugin source map；
2. materialize Local/Git/NPM plugin source；
3. 读取plugin version；
4. 即使version字符串不变，也强制写入Plugin Store；
5. 每个plugin独立记录error；
6. 只要Store有刷新，清理loaded plugin等cache；
7. 没有Store刷新时至少清tool suggestion metadata。

强制重装解决了“Marketplace commit变了但plugin manifest version没变”的内容更新问题。

Marketplace root activation与Plugin Store refresh不是一个事务。Upgrade response可能同时包含：

- upgraded root成功；
- 某些plugin cache refresh失败。

这时目录已经新，部分已安装plugin仍可能旧。Typed outcome比整体false更诚实，但仍需要runtime effective generation receipt。

## 14. Auto Upgrade 调度

Plugin startup task在Plugins feature开启时尝试启动一次Marketplace auto-upgrade OS thread。

进程内`ConfiguredMarketplaceUpgradeState { in_flight }`防同一个Manager重复启动auto worker。完成或spawn失败后清flag。

边界：

- 不是周期轮询；
- 没有next refresh/last success状态；
- manual upgrade不复用这个in-flight guard；
- 两个manual请求可并发；
- auto与manual可并发；
- 多Codex进程可同时升级同一root/config；
- 没有filesystem lock或SQLite lease。

Activation rollback对单事务很强，但跨事务并发仍可能相互rename/remove/覆盖config。

## 15. Remove 事务

### 15.1 顺序

Remove采用：

```text
validate exact marketplace name
  -> remove user config entry
  -> remove $CODEX_HOME marketplace installed root
```

Config先删，避免目录删除成功而config继续指向缺失root。

若root删除失败，config已移除、磁盘留下orphan。再次Remove时，即使config已不存在，只要root还在，仍能完成删除；这是可重试partial state。

### 15.2 Case mismatch

如果请求`Debug`但config中是`debug`，Remove拒绝并返回configured name，不做模糊大小写删除。对大小写不敏感filesystem，这是重要identity保护。

### 15.3 Local source

Local Marketplace没有复制到`$CODEX_HOME` install root。Remove只删config entry，不删除用户source目录，这是正确的ownership边界。

### 15.4 不卸载Plugin

Remove只处理Marketplace config与Marketplace checkout：

- 不删除Plugin Store cache；
- 不移除`[plugins."name@marketplace"]`配置；
- 不撤销当前Thread已加载Skill/MCP/Hook；
- App Server processor没有在response前显式触发Manager cache invalidation/effective-plugin callback。

这不是遗漏就能简单修补：Marketplace removal与Plugin uninstall是两个不同用户意图。产品应明确提示仍安装的plugins，并提供“仅移除目录”与“卸载其全部plugins”两个操作。

## 16. Add/Remove 后的生效边界

App Server Add/Remove processor只执行文件/config操作并返回response。它没有像Upgrade那样显式：

- force refresh Plugin Store；
- clear Manager caches；
- notify effective plugins changed；
- restart MCP/App；
- reload现有Thread config。

后续plugin/list会加载最新config，但已经运行的Thread可能继续使用旧snapshot，直到配置watch/reload、下一次规划或显式刷新。

Response中的installedRoot只能证明目录/config操作，不证明runtime effect。

## 17. 失败顺序表

| 操作阶段 | 已发生状态 | 当前恢复方向 |
| --- | --- | --- |
| Add policy拒绝 | 无网络/磁盘 | 修改source或requirements |
| Add clone挂起 | staging/child可能存在 | 无内建deadline，外部取消有限 |
| Add clone/validate失败 | kept staging可能残留 | 人工/未来GC |
| Add root rename成功、config失败、rollback成功 | stable root无新Marketplace，staging残留 | 重试Add |
| Add rollback失败 | destination或stagingpartial | 错误携带路径 |
| Upgrade单Marketplace失败 | 其他Marketplace继续 | per-item重试 |
| Upgrade root激活失败、rollback成功 | 旧root仍在 | 修复磁盘后重试 |
| Upgrade config CAS发现变化 | root回滚旧版本 | 以新config重算 |
| Upgrade config write损坏 | root可能回滚，config未必 | 需config backup/repair |
| Root升级成功、Plugin cache失败 | 目录新、部分执行cache旧 | force refresh/reinstall |
| Remove config成功、root删除失败 | 配置无、orphan root有 | 再次Remove可清理 |
| Remove Marketplace但Plugin已安装 | Store/config/runtime仍可能有效 | 单独Uninstall Plugin |
| 多进程并发Upgrade | backup/destination/config竞争 | 当前无统一fencing |

## 18. 值得学习的设计

### 18.1 Source policy先于I/O

不被允许的source不会先clone再拒绝。

### 18.2 Stage、Validate、Rename

Marketplace manifest/name验证发生在稳定路径可见前。Reader不会读到半checkout。

### 18.3 Upgrade三方一致性

Remote SHA、config last revision、installed sidecar和manifest root共同决定skip，不只信单一timestamp。

### 18.4 Config变化检测

Long-running clone完成后重读config，旧operation不会覆盖用户新source/ref意图。

### 18.5 Backup rollback保留恢复路径

Activation和rollback都失败时，错误不吞掉backup位置。

### 18.6 Partial outcome

多个Marketplace、多个Plugin cache refresh独立失败，response保留selected/upgraded/errors，而不是首错丢掉全部进度。

### 18.7 Marketplace remove不删除Local source

Codex只删除自己拥有的installed checkout，不删除用户拥有的开发目录。

## 19. 不能照搬的缺口

### 19.1 Config不是原子CAS文件

需要temp+fsync+rename、file lock、expected revision和backup，而不只是写前再读一次。

### 19.2 Add没有Git timeout

Add/Upgrade应共享同一个Git executor：总deadline、process-group kill、stdout/stderr cap、redaction和network policy。

### 19.3 缺source制品预算

Repo objects、checkout bytes/files、sparse patterns都应有配额。Git SHA提供内容寻址，不提供大小治理。

### 19.4 缺commit签名/publisher身份

HTTPS/SSH和Git SHA只说明拿到某个repository object，不说明publisher受信、commit已签名或source未被接管。

### 19.5 并发只保护Auto worker

Manual/auto/multi-process需要统一operation lease与marketplace generation。

### 19.6 Root与Plugin Store不是同一generation

Root更新后cache refresh partial failure会造成目录/执行内容分裂。每次Run应pin实际Plugin Store digest，而不是只看Marketplace latest。

### 19.7 Add/Remove缺runtime receipt

Config写入、catalog刷新、plugin cache、MCP reload应分阶段返回。

## 20. 映射到 AI SEO Agent

当前项目不需要插件市场，但会有类似的“数据源目录→执行制品”场景：

- SEO Tool provider版本；
- crawler规则包；
- prompt/template catalog；
- tenant connector definitions；
- content policy/rubric bundle。

### 20.1 推荐数据模型

```ts
type CatalogSource = {
  id: string
  tenantId: string
  sourceType: 'git' | 'managed' | 'local-dev'
  canonicalSource: string
  ref: string | null
  desiredState: 'enabled' | 'disabled'
  configRevision: number
}

type CatalogGeneration = {
  id: string
  sourceId: string
  sourceRevision: string
  artifactSha256: string
  manifestSha256: string
  state: 'staging' | 'validated' | 'active' | 'failed'
  createdAt: string
}

type RuntimeMaterialization = {
  tenantId: string
  catalogGenerationId: string
  componentId: string
  componentVersion: string
  contentSha256: string
  state: 'ready' | 'degraded' | 'failed'
}
```

不要用一个`updatedAt`同时代表source、catalog checkout、component cache和worker runtime。

### 20.2 推荐Upgrade Saga

```text
1. 创建operation + expected config revision
2. policy验证source/publisher
3. fetch immutable source revision
4. stage with byte/file/deadline budget
5. validate manifest + signatures
6. build immutable catalog generation
7. DB transaction CAS active generation
8. materialize affected runtime components
9. workers ack loaded generation
10. GC old generation after leases drain
```

配置与active pointer放数据库事务，制品存object storage；不要把TOML direct write当跨介质事务中心。

## 21. 最小验证矩阵

### 21.1 Source与Policy

- shorthand/URL/ref归一后identity唯一。
- ref/sparse option-like参数不会变成Git options。
- HTTP、SSH、private host按policy拒绝。
- requirements变化会取消或使旧operation CAS失败。
- Local path symlink/内容变化语义明确。

### 21.2 Git执行

- clone/checkout/ls-remote共享总deadline。
- 超时kill完整process group/helper。
- stdout/stderr有bytes cap和secret redaction。
- repo bytes/files/objects有磁盘quota。
- branch在probe与clone间移动时记录actual SHA。

### 21.3 Activation

- Reader只见旧或新完整generation。
- config expected revision变化使旧operation失败。
- root rename、config commit每个crash point可恢复。
- rollback失败保留backup manifest/path。
- sidecar包含source/ref/sparse/revision/content digest/processor version。

### 21.4 并发

- auto/manual/multi-process共享marketplace lease。
- lease带owner generation与TTL/heartbeat。
- 旧operation迟到不能覆盖新active generation。
- Remove与Upgrade并发有确定winner。
- Add同source幂等key不重复clone。

### 21.5 Cache与Runtime

- Marketplace同version内容变化仍刷新Plugin Store。
- 单Plugin失败不伪装整体成功。
- runtime receipt显示loaded generation/digest。
- Remove Marketplace不隐式卸载Plugin，UI明确列出依赖。
- Uninstall全部时按控制面撤权→runtime卸载→cache GC分阶段执行。

## 22. 推荐源码阅读顺序

1. 从App Server marketplace processor看Add/Remove/Upgrade的公开response。
2. 阅读source parser和MarketplacePolicy，先确定网络/本地source authority。
3. 阅读Add主链，画出Local config-only与Git staged copy的分叉。
4. 阅读config marketplace edit，确认root rename与TOML direct write的原子性差异。
5. 阅读Upgrade remote revision和三方skip条件。
6. 阅读activation rollback，逐个列出rename/config crash窗口。
7. 阅读Manager upgrade后的ForceReinstall，连接Marketplace generation到Plugin Store generation。
8. 最后阅读Remove，确认它为什么不是Plugin uninstall。

## 23. 结论

Codex Marketplace生命周期已经具有一套清晰的Saga偏好：

```text
Add
  policy -> stage -> validate -> activate root -> commit config

Upgrade
  probe revision -> stage exact content -> validate -> backup swap
  -> config unchanged check -> commit revision -> refresh Plugin Store

Remove
  remove config intent -> delete owned checkout
```

它最值得学习的是source policy前置、manifest name验证、remote/config/sidecar三方一致性、staged activation、backup rollback、config变化检测和partial outcome。

真正的系统边界则在四个generation之间：

```text
config revision
  != Marketplace source revision
  != Plugin Store content generation
  != live Runtime generation
```

后续应使用统一operation identity、跨进程lease、原子config CAS、Git资源预算、制品签名/digest和runtime ack把这四层串起来。否则“Marketplace已升级”仍只是目录层事实，而不是Agent能力已安全生效的证明。
