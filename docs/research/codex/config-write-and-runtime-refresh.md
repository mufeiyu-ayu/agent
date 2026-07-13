# Config 写入、Layer Version、Runtime Refresh 与 Live Thread边界

Codex 的“修改配置”至少包含三个不同动作：

1. 把一个值安全写进用户 `config.toml`；
2. 重新计算某个 cwd 下的有效 Layer Stack；
3. 决定哪些变化可以进入已经加载的 Thread，何时进入下一 Turn。

这三步不是一个完全原子的热更新事务。`config/batchWrite`可以成功落盘，但live Thread只刷新部分layer-backed能力；model、notify、permission等Session静态字段继续使用旧值；MCP runtime还有单独刷新协议。

本文重点回答：

- Config version究竟是哪一份状态的版本？
- App Server如何防止同进程并发写？
- `reloadUserConfig=true`具体刷新什么？
- 配置落盘、Thread runtime、当前Turn和客户端UI之间怎样产生代际差异？

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/app-server/src/config_manager.rs`
- `codex-rs/app-server/src/config_manager_service.rs`
- `codex-rs/app-server/src/request_processors/config_processor.rs`
- `codex-rs/app-server/src/request_serialization.rs`
- `codex-rs/app-server/src/mcp_refresh.rs`
- `codex-rs/app-server/src/effective_plugin_change.rs`
- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/config.rs`
- `codex-rs/config/src/state.rs`
- `codex-rs/config/src/fingerprint.rs`
- `codex-rs/core/src/config/edit.rs`
- `codex-rs/core/src/config/mod.rs`
- `codex-rs/core/src/path_utils.rs`
- `codex-rs/core/src/session/mod.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/session/handlers.rs`
- `codex-rs/core/src/context_manager/updates.rs`
- `codex-rs/tui/src/config_update.rs`
- `codex-rs/tui/src/app_server_session.rs`

## 2. 五个配置状态域

理解热更新前，先分清五份状态：

| 状态 | 例子 | 主要寿命 |
| --- | --- | --- |
| 文件事实 | `$CODEX_HOME/config.toml` | 跨进程持久 |
| Layer Stack | User、Project、Session、Managed、Requirements | 一次load snapshot |
| ConfigManager process overlay | runtime feature enablement、cloud/thread loader、CLI override | App Server进程 |
| SessionConfiguration | model、permission、cwd、collaboration mode等concrete字段 | Thread |
| TurnContext / StepContext | 本Turn冻结的Config、ModelInfo、Skills、MCP snapshot | Turn / Step |

一次写入只直接改变第一层。后续层是否重建、替换或冻结，由不同路径决定。

不能用一个“current config”概念覆盖所有状态。

## 3. ConfigManager不是内存配置对象

`ConfigManager`主要保存重建配置所需的输入：

- `codex_home`；
- CLI overrides；
- process内runtime feature enablement；
- loader overrides；
- strict config开关；
- cloud config bundle loader；
- arg0 executable paths；
-可替换的ThreadConfigLoader。

每次 `load_latest_config`、`load_for_cwd`或`load_config_layers`都会重新读取配置层并构造新的 `Config`。

所以它更像：

```text
ConfigSnapshotFactory
```

而不是单个可变的global Config。

### 3.1 Read-time cwd

`config/read`带cwd时读取Project `.codex`等cwd相关层；不带cwd时读取thread-agnostic stack。

同一个用户文件，在不同cwd下可能得到不同effective value和origin metadata。

### 3.2 运行时overlay

runtime feature enablement不写文件，而是在ConfigManager的 `BTreeMap<String, bool>`中叠加到每次新构造Config的`features`对象。

它只允许一小组实验feature，并且不会覆盖：

- 任意配置层已经明确写出的feature key；
- managed requirements保护的feature key。

这是一种低优先级进程overlay，不是持久用户配置。

## 4. Config Read 返回有效值、Origins和可选Layers

`config/read`先加载Layer Stack，再：

1. 取得effective TOML；
2. 反序列化为typed `ConfigToml`；
3. 转成API Config；
4. 返回每个key path的origin metadata；
5. `includeLayers=true`时返回高优先级优先的完整layer列表，包括disabled layers。

随后ConfigRequestProcessor还会用完整 `load_latest_config`覆盖少数受支持实验feature在response里的显示值，以反映process runtime enablement。

因此response中同时包含：

- layer-derived config；
- ConfigManager runtime overlay投影。

客户端不能只看user file判断最终值。

## 5. 写入authority只允许active User Config

`config/value/write`和`config/batchWrite`都只允许写 `ConfigManager.user_config_path()`。

调用方可传 `filePath`，但必须在path normalization后与allowed path匹配，否则返回 `ConfigLayerReadonly`。

不能通过通用Config RPC直接修改：

- Project config；
- System/MDM/enterprise layer；
- Session flags；
- managed requirements。

这是清晰的写权限边界。`config/read`可以解释多层，`config/write`只拥有用户层。

### 5.1 Symlink处理

写入前会解析symlink write paths：

- 读真实target；
- 写到resolved destination；
- 若路径不存在则按root写。

allowed/provided path比较发生在写入前的规范化路径层，实际写入再使用symlink resolver。它避免直接覆盖symlink inode，同时保留用户把config path链接到别处的能力。

## 6. Key Path与Merge策略

Key path支持：

- dot分段；
- 引号包围包含dot的segment；
- quoted segment内反斜杠escape；
- `sample@catalog`等宽松bare key。

显式禁止写legacy `profile`和`profiles.*`非null值，要求使用profile-v2独立文件。

JSON `null`表示clear path，不是TOML null。

### 6.1 Replace

Replace直接用新值覆盖目标key。中间parent不是table时，会把它替换成table后继续下钻。

这提高写入可用性，也意味着写 `a.b`可以破坏原本非table的`a`值。调用方应把它视为明确replace，而不是无损patch。

### 6.2 Upsert

只有existing和incoming都是TOML table时，Upsert递归merge；其他情况退化为replace。

数组不会按元素identity merge。

### 6.3 Batch validation

所有edits先在内存user config snapshot上依次应用，再统一验证：

1. user layer能反序列化成`ConfigToml`；
2. 带codex_home base的typed deserialize成功；
3. feature requirements允许；
4. 更新后的完整effective config仍能反序列化。

只有全部通过才生成和执行文件edits。因此同一个batch内部是all-or-nothing validation，不会写一半key。

## 7. Version是Canonical TOML Content Hash

每个 `ConfigLayerEntry.version`是：

```text
sha256(canonical_json(toml_value))
```

object keys递归排序，array顺序保留，最终格式为：

```text
sha256:<hex>
```

它不包含：

- 文件mtime；
- whitespace；
- comments；
- TOML原始格式；
- path；
- inode；
- managed/project layer版本。

所以它是 **解析后user layer语义内容版本**。

两个只改注释/排版的文件可能有相同version；同内容位于不同path也可相同。

## 8. Expected Version是可选CAS

写RPC允许传`expectedVersion`。App Server加载当前active user layer后比较：

```text
expected != current user layer version
  -> ConfigVersionConflict
```

这给客户端提供optimistic concurrency control。

但TUI的常用`write_config_batch`和显式reload路径都传 `expectedVersion=None`。它们依赖App Server内部串行队列，而不是read-modify-write CAS。

### 8.1 App Server内的global config队列

协议把：

- ConfigWrite；
- ConfigBatchWrite；
- ExperimentalFeatureEnablementSet；
- External config import；

放进 `Global("config")` exclusive queue。

ConfigRead和PermissionProfileList等使用同key的SharedRead；连续shared reads可并行，但不会越过前面的exclusive mutation。

因此 **同一个App Server进程、经过RPC入口** 的配置写是FIFO串行的。

### 8.2 CAS仍有外部竞态

expected version检查和实际file edit之间不是一次OS级compare-and-swap：

1. ConfigManager先加载Layer并检查version；
2. 构造ConfigEdit；
3. `ConfigEditsBuilder`在blocking task里重新读取文件；
4. 应用edit；
5. atomic rename发布。

另一个进程、编辑器或绕过serialization queue的代码可在步骤1与3之间修改文件。

Builder重新读取最新文件能降低无意覆盖，但expected version已经不再复核。于是CAS承诺只对App Server受控串行域强，对外部writer没有真正fencing。

### 8.3 Response version可能不是最终磁盘版本

response version来自步骤1内存`updated_layers`计算，不是rename后重新读取文件得到。

若外部writer在检查后修改了其他key，Builder可能把edit应用到新文件并保留外部变化，但response version仍只对应旧snapshot+本次edit，不一定等于最终磁盘全文。

这也是为什么多进程配置写需要文件锁或写前二次CAS。

## 9. 文件发布是Atomic Rename，不是Durable Commit

`ConfigEditsBuilder`读取现有TOML为`DocumentMut`，保留未改部分的format/comments，应用edits后调用：

```text
NamedTempFile in same parent
  -> write contents
  -> persist(destination)
```

同目录rename避免读者看到半个文件，是很好的原子可见性保证。

但当前helper未显式：

- flush/fsync tempfile；
- fsync parent directory；
- 获取跨进程file lock；
- 比较目标inode/version后再rename；
- 保留backup。

因此它是atomic visibility，不是断电durability或multi-process transaction。

## 10. Write Response解释“已写但被覆盖”

写入后，ConfigManager把新user layer放回原Layer Stack，计算effective值，并检查本次edit是否被更高优先级layer覆盖。

response返回：

- `Ok`；
- `OkOverridden`；
- 第一条被覆盖edit的message；
- overriding layer metadata；
- effective value；
- user layer version；
- canonical file path。

这是优秀的产品语义：

> 文件写成功，不代表配置立即生效。

不过batch只返回第一条overridden edit，不是所有冲突列表。

## 11. Value Write与Batch Write热更新语义不同

`config/value/write`只有落盘和cache clear，不提供`reloadUserConfig`字段。

`config/batchWrite`额外允许：

```json
{ "reloadUserConfig": true }
```

为true时，写成功后才尝试刷新所有loaded Threads。

因此同样写一个key：

- value/write：已有Thread通常不refresh；
- batchWrite reload=false：同样只影响未来load；
- batchWrite reload=true：进入受限runtime refresh路径。

客户端必须显式理解这个差异，不能认为所有Config RPC都自动热生效。

## 12. 空Batch是显式Reload命令

TUI需要在外部流程直接改过文件后刷新runtime时，会发送：

```text
ConfigBatchWrite {
  edits: [],
  expectedVersion: None,
  reloadUserConfig: true
}
```

ConfigManager仍会加载、验证当前config并返回version，但不产生file edit；processor随后刷新Threads。

这避免再增加一个独立RPC，却也让“write response”同时承担no-op reload ack，语义略显隐蔽。

## 13. App Server Runtime Refresh只替换User Layers

`ConfigRequestProcessor.reload_user_config`先构造一个最新thread-agnostic Config，然后遍历全部Thread：

```text
for thread_id in loaded_threads:
  get thread
  thread.refresh_runtime_config(next_config.clone())
```

Core `refresh_runtime_config`不会直接用整个next Config覆盖Session。它执行：

```text
current original Config clone
  -> current ConfigLayerStack.with_user_layer_from(next stack)
  -> recompute tool_suggest
  -> replace original_config_do_not_use Arc
```

因此它保留当前Thread中的：

- Project layer；
- Session flags/request overrides；
- CLI/managed等现有非User layers；
- 当前requirements snapshot。

只把next snapshot里的User base/profile layers复制进来。

这避免一个无cwd全局Config把每个Thread各自的Project层抹掉。

## 14. Runtime Refresh不会重建整个Typed Config

当前实现只显式重新派生：

- `config_layer_stack`中的User layers；
- `tool_suggest`；
- Hooks；
- Skills cache；
- Plugins cache。

它不会从新的effective TOML重新构建 `Config`的所有derived fields。

源码测试明确验证：即使传入next Config修改：

- `model`；
- `notify`；

refresh后live Session仍保留original值。

注释也说明feature gates与legacy notify等derived fields是session-static。

所以“User Layer已换新”与“Config所有field已换新”可以同时为真和假：Layer Stack显示新值，但某些concrete field继续旧值。

## 15. 哪些能力在下一Turn生效

### 15.1 Plugins与Skills

refresh清全局/Session的Plugins和Skills cache。下一次构造TurnContext时：

1. 从per-turn Config的Layer Stack计算plugin config input；
2. 解析effective plugins；
3. 得到plugin Skill roots；
4. 构造Skills load input；
5. snapshot该Turn的Skills。

因此plugin enable/disable和Skill相关User Layer变化主要在 **下一Turn snapshot** 生效，不会改已经运行的Turn。

### 15.2 Tool Suggest

`tool_suggest`在refresh时从新Layer Stack重新计算，下一Turn拿到的新per-turn Config会看到新disabled/discoverable规则。

### 15.3 Hooks

refresh先发布新Config Arc，再异步构建Hooks。构建完成后重新锁Session，并用 `Arc::ptr_eq`确认当前Config仍是自己对应的snapshot，才发布Hooks。

如果更晚的refresh已替换Config，旧hook build结果被丢弃。

这是高质量generation fencing：慢构建不能覆盖新配置。

### 15.4 Config Contributors

Extension config contributors会收到previous/new effective session Config回调，但只在两者不相等时触发。

它们是同步callback，不返回transaction result。不同extension自行决定如何响应变化。

## 16. 哪些能力仍保持Session静态

`SessionConfiguration`把很多字段从初始Config提取成concrete state：

- active model/collaboration mode；
- reasoning effort/summary；
- approval policy；
- permission profile；
- workspace roots/environment selections；
- service tier；
- personality；
- provider；
- client metadata；
- dynamic tools。

普通User Layer refresh不更新这些字段。

`build_per_turn_config`虽然克隆最新`original_config_do_not_use`，随后又用SessionConfiguration中的concrete fields覆盖cwd、workspace roots、reasoning、service tier、personality、reviewer和permissions。

因此下一Turn也继续使用Session静态值，除非客户端通过Thread settings/turn overrides显式修改。

## 17. Feature Runtime Enablement对Loaded Thread的边界

`experimentalFeature/enablement/set`把enablement写进ConfigManager process overlay，并调用`reload_user_config`。

新 `load_latest_config`会把overlay应用到Config.features，因此：

- 后续config/read能看到；
- 新建Thread能看到；
- thread-agnostic Skills List等重新load Config的入口能看到。

但live Thread `refresh_runtime_config`只从next Config复制User Layer，保留当前Config的`features`对象；runtime overlay本身不在User Layer里。

由此可推断：调用reload all并不等于现有Thread的feature object被替换。当前集成测试覆盖global/thread config read和Skills List等重新load路径，没有证明已加载Thread的下一Turn feature snapshot同步变化。

这是典型的“控制面读已更新、运行面Session仍旧代际”边界。

## 18. Requirements与Managed Layer不会随User Reload更新

`with_user_layer_from`明确：

- 从other复制User layers；
- 保留self的全部非User layers；
- 保留self requirements和requirements TOML；
- 保留ignore exec-policy标记与warnings。

因此企业managed config、requirements或Project layer在磁盘/远端变化后，普通`reloadUserConfig`不会刷新loaded Thread的对应authority。

新Thread/完整Config load会看到新requirements；旧Thread继续使用启动时snapshot。

对安全策略来说，这比普通偏好设置更敏感。若管理员撤销权限，不能假设User Config热更新路径会立刻撤权旧Session。

## 19. MCP Runtime有独立Refresh协议

MCP manager不是只读Layer Stack即可动态变化。App Server有单独的：

```text
queue_strict_refresh
queue_best_effort_refresh
Op::RefreshMcpServers
pending_mcp_server_refresh_config
```

它会为每个Thread：

1. 读取该Thread当前Config；
2. 用ConfigManager加载latest config for thread；
3. 保留Session layers并刷新外部layers；
4. 解析runtime MCP config；
5. 提交RefreshMcpServers Op；
6. 在安全边界由Session刷新manager。

普通 `config/batchWrite reloadUserConfig=true`没有自动调用这条MCP refresh链。

Remote Plugin materialization change callback则会：

- 清Plugin/Skill cache；
- best-effort queue全部Thread MCP refresh；
- 另行处理Hook trust config写。

这说明不同配置消费者有独立刷新事务，不能靠一个global“config changed”广播解决。

## 20. 当前Turn不会被中途改写

Turn创建时构造不可变 `Arc<TurnContext>`，其中冻结：

- per-turn Config；
- ModelInfo；
- provider；
- approval/permission；
- Skills snapshot；
- environment snapshot；
- collaboration/personality；
- network proxy handle；
- Step捕获的MCP runtime snapshot。

User Config refresh替换Session保存的Config Arc，只影响后续Turn/Step显式重新捕获的消费者，不会修改已经持有旧Arc的TurnContext。

这是正确的Run snapshot语义。否则同一Agent Turn中途换工具、权限或model会难以审计和恢复。

## 21. Thread Settings是另一条动态配置通道

Thread settings update不是User Config reload。

`Op::UpdateThreadSettings`或带`thread_settings`的UserInput会构造 `SessionSettingsUpdate`，显式更新SessionConfiguration中的concrete字段，并在成功后发送：

```text
EventMsg::ThreadSettingsApplied
  -> App Server thread/settings/updated
```

snapshot包括model、provider、service tier、approval、reviewer、permission、cwd、reasoning、personality和collaboration mode。

App Server listener还会与last settings去重，只在实际变化时通知订阅者。

User Config runtime refresh不发ThreadSettingsApplied，所以客户端不会把“偏好文件变了”误认为“live Thread model/permission已切换”。

两条通道的语义是：

```text
Config write/reload
  -> 更新可刷新的Layer-backed能力和未来defaults

Thread settings update
  -> 修改这个live Thread的显式运行设置
```

## 22. Model可见Context更新只跟随Thread Settings

当Thread settings改变model、permission、collaboration mode、personality或realtime状态时，下一Turn会比较previous/current `TurnContextItem`并注入developer context diff。

它还持久化新的TurnContext snapshot，保证resume/backtrack有可恢复基线。

User Config reload若只改变Plugin/Skill/Hook等Layer-backed能力，未必产生同类model-visible settings diff。Skill正文和tool specs通过下一Turn输入/工具集合体现，Config文件变化本身不是一条Conversation message。

## 23. Refresh遍历全部Thread是Best-effort无回执

ConfigProcessor先成功写文件，再遍历loaded Thread。

`reload_user_config`返回`()`：

- latest config load失败只warn；
- Thread在list后消失就skip；
- `refresh_runtime_config`没有Result；
- 每Thread hook build失败由内部语义处理；
- response不列出refreshed/skipped/failed Thread；
- 没有runtime generation或effective receipt。

因此ConfigBatchWrite成功response证明：

- 用户文件edit已提交；
- in-process refresh流程已被调用并等待遍历结束。

它不证明所有Thread所有consumer都采用新配置。

## 24. Refresh性能与竞态

### 24.1 顺序遍历

所有Thread逐个await `refresh_runtime_config`。每个Thread都会清cache并重建Hooks。

大量loaded Threads或慢Hook discovery会拉长config RPC响应，没有统一total deadline。

### 24.2 并发refresh

RPC config mutations被global queue串行，但其他内部路径可直接调用Core reload/refresh。Core用Config Arc identity保护Hooks的最终发布，却没有一个通用monotonic config generation字段。

Plugins/Skills cache clear是全局副作用，多个Thread重复clear可能造成额外抖动。

### 24.3 先发布Config，后发布Hooks

refresh在state锁内先替换Config Arc，之后才build Hooks。

这个窗口中：

- 下一Turn可能读取新Layer Stack；
- `services.hooks`仍是旧snapshot；
- 构建完成才原子store新Hooks。

Arc fencing防止旧结果覆盖新结果，但没有让Config和Hooks同时切换。

这是availability-first的eventual consistency，不是multi-consumer atomic snapshot。

## 25. Legacy Core File Reload更宽松

Core还保留 `reload_user_config_layer()`：

1. 从当前Session Layer Stack找全部User layer文件；
2. 同步`std::fs::read_to_string`；
3. TOML parse；
4. 任一文件失败则warn并return，不改state；
5. 缺失文件视为空table；
6. 替换这些User layers；
7. 调用同一个refresh_runtime_config。

优点是base+selected profile一起刷新，且任一parse失败时不做partial publish。

边界是：

- 在async函数里同步读取文件；
- 只做TOML语法parse，没有App Server写路径的完整typed/effective/requirements validation；
- 不重载新出现的User profile path，只读取Session已知路径；
- 仍只刷新受限runtime字段。

App Server能提供materialized Config时，源码注释明确建议优先`refresh_runtime_config`。

## 26. TUI配置写的实际策略

TUI统一helper发送：

```text
ConfigBatchWrite
expectedVersion = None
reloadUserConfig = true
```

用于model selection、service tier、feature、memory、project trust等设置持久化。

但“写model默认值”不等于当前Thread立即换model。TUI往往还要更新自己的内存config、发Thread settings或在新Thread生效。

TUI显式reload同样发送空Batch。外部agent config import完成后，它会：

- 重新从disk刷新TUI内存config；
- 刷新plugin mentions；
- 提交ReloadUserConfig；
- 重新fetch plugin list。

这再次证明UI config、App Server factory和live Thread是三份状态，需要分别同步。

## 27. 没有通用Config Changed广播

App Server提供：

- ConfigWrite response给发起Connection；
- startup ConfigWarning；
- ThreadSettingsUpdated；
- SkillsChanged/AppListUpdated等特定consumer notification。

当前没有一个“用户Config version changed”的global notification，让其他已连接客户端自动刷新设置页。

多客户端下，Connection A写config后：

- A收到write response；
- live Threads可能部分refresh；
- B不会必然收到config version/effective diff；
- B的设置页可能继续展示旧read snapshot。

ExpectedVersion可以让B下次写时检测旧版本，但TUI常用路径不传expected version。

## 28. Cache Clear与实际Runtime生效不是一回事

每次Config mutation成功后，processor都会清：

- Plugins Manager cache；
- Skills Service cache。

Batch reload内部每个Session又清一遍并重建Hooks。

Cache clear只表示“下次查询不能复用旧值”，不表示：

- 当前Turn工具被替换；
- MCP connections重启；
- UI mentions已经刷新；
- 已排队Turn采用新snapshot；
- remote plugin materialization已经完成。

把cache invalidation当成effective receipt是常见误判。

## 29. Plugin Toggle telemetry与effective值

ConfigProcessor在写前从requested edits收集plugin enabled candidates，写成功后发enable/disable telemetry。

若higher-precedence layer覆盖User值，write response会是`OkOverridden`，但pending telemetry candidate仍来自请求值。

因此telemetry更接近“用户尝试切换”，不一定等于effective runtime transition。若分析端把它当最终状态，会高估生效次数。

## 30. 优质设计总结

### 30.1 Layer origin与override回执

Read能解释值来自哪里，Write能明确告知落盘成功但被高优先级覆盖，避免把文件事实和effective事实混为一谈。

### 30.2 Content hash version

Version忽略comments/format，只绑定语义TOML，适合作为optimistic concurrency token。

### 30.3 同进程global serialization

所有Config RPC mutation在同一FIFO exclusive queue，SharedRead只在安全窗口并行，降低进程内lost update。

### 30.4 Batch先全量validation再写

User config、feature requirements和完整effective config都在写前验证，避免产生已知不可加载文件。

### 30.5 Atomic file visibility

同目录temp+rename让reader不会看到partial TOML。

### 30.6 User Layer定向替换

Live Thread refresh只替换User layers，保留每个Thread的Project/Session等上下文，避免全局无cwd snapshot污染Thread特有配置。

### 30.7 Turn snapshot稳定

当前Turn不被Config热更新中途改变，下一Turn才重新计算Plugins/Skills等能力。

### 30.8 Hook build generation fencing

慢旧refresh的Hook结果通过Config Arc identity被拒绝，避免迟到覆盖。

## 31. 当前风险与改进方向

### 31.1 定义Config Capability Matrix

协议应明确每个key：

| Key类型 | 文件写 | 新Thread | 下一Turn | 当前Turn | 需restart |
| --- | --- | --- | --- | --- | --- |
| model default | 是 | 是 | 否，除非Thread settings | 否 | 否 |
| plugin enable | 是 | 是 | 是 | 否 | 否 |
| hooks | 是 | 是 | eventual | 当前hook snapshot依事件 | 否 |
| MCP servers | 是 | 是 | 需MCP refresh | 否 | 可能 |
| feature gate | 是/overlay | 是 | 依实现 | 否 | 部分 |
| managed requirements | 外部 | 是 | 普通user reload不刷新 | 否 | 应显式撤权 |

没有这个矩阵，用户会把“保存成功”理解成“立即生效”。

### 31.2 Runtime receipt

ConfigBatchWrite response可增加：

```text
fileVersion
effectiveAtFactoryGeneration
threadRefreshResults[]
requiresNewThreadKeys[]
requiresMcpRefreshKeys[]
requiresRestartKeys[]
overriddenEdits[]
```

### 31.3 真正跨进程CAS

写入blocking section中应：

1. 获取advisory lock；
2. 重新读取并计算version；
3. 比较expected；
4. 应用edit并完整validate；
5. 写temp、fsync；
6. rename、fsync parent；
7. 返回实际最终version。

### 31.4 Config generation

为每个Session维护monotonic runtime config generation，并让：

- Config Arc；
- Hooks snapshot；
- Skills/Plugin snapshot；
- MCP runtime；
- UI effective settings；

标注generation。允许不同consumer eventual更新，但必须可观测谁仍落后。

### 31.5 安全策略主动撤权

Managed requirements/permission revoke不能只影响新Thread。需要独立policy generation，loaded Thread在Turn/Tool边界复核；高风险撤权还应中止不再允许的active operation。

### 31.6 限制Refresh工作量

大量Thread刷新可：

- 并发但有上限；
- 每Thread独立Result；
- cache clear一次而不是N次；
- hook build按Config digest singleflight；
- RPC有总deadline并返回partial receipt。

### 31.7 Config Changed订阅

多客户端App Server应广播：

```text
config/versionChanged {
  userVersion,
  changedKeys,
  actorConnectionId?,
  runtimeGeneration
}
```

其他客户端据此重新read，不需要直接广播敏感完整Config。

## 32. 映射到当前 NestJS Agent项目

当前项目未来支持模型、工具、权限和Prompt配置时，建议明确四层：

```text
ConfigRevision
  durable，谁在何时改了哪些值

EffectiveAgentConfig
  tenant/project/agent多层合成结果

AgentRunConfigSnapshot
  Run开始时冻结

RuntimeConsumerGeneration
  Tool registry / MCP / cache实际加载代际
```

### 32.1 API写入

使用数据库事务和`expectedVersion`：

```sql
UPDATE agent_config
SET version = version + 1, value = ...
WHERE id = ? AND version = ?
```

返回conflict时让Vue重新拉取并显示diff，不能静默last-write-wins。

### 32.2 AgentRun冻结

Run记录至少保存：

- config revision ID；
- model/provider；
- prompt revision；
- tool registry generation；
- permission profile；
- environment snapshot。

设置页更新只影响后续Run，除非有显式“更新当前Conversation运行设置”的协议。

### 32.3 Consumer refresh

Tool/MCP/Prompt cache收到ConfigChanged event后异步加载新generation。加载成功才发布active pointer；失败保留old generation并暴露状态。

### 32.4 权限配置

权限撤销需在每次Tool execution前复核latest policy generation，不能只信AgentRun创建时snapshot。可用“规划snapshot + 执行时revalidation”双层。

## 33. 可直接采用的验收问题

1. 保存成功后，哪些设置立即影响live Conversation？
2. 哪些只影响下一Run，哪些必须重启worker？
3. 配置version绑定文件、effective config还是runtime generation？
4. 两个浏览器并发写时是否有CAS和可读diff？
5. 外部编辑文件能否绕过expected version？
6. Cache invalidated是否被误报为runtime已生效？
7. MCP/Tool/Hook各自刷新失败时是否保留旧runtime？
8. 当前Run会不会中途混用两代工具或权限？
9. 管理员撤权如何作用于已运行Run？
10. 多客户端如何收到config version changed？
11. Refresh partial failure是否有逐consumer回执？
12. 最终落盘是否有lock、fsync和实际version复核？

## 34. 结论

Codex Config系统最值得学习的是它没有把“写文件”和“有效配置”混为一谈：Layer origin、content hash version、`OkOverridden`、同进程global serialization和写前typed validation，都让配置控制面更可解释。

Live Thread刷新同样有意保持克制：只替换User layers，保留Thread自己的Project/Session layers；Plugins、Skills、Tool Suggest和Hooks进入后续Turn；当前Turn继续使用不可变snapshot；Thread model/permission则要走显式Thread Settings并发出Applied事件。

但这也形成明显代际差：Config Read可能显示新值，文件version已更新，live Session concrete fields仍旧，MCP runtime需要另行refresh，Hooks还在异步build，其他客户端也没有通用ConfigChanged通知。`reloadUserConfig=true`是受限、best-effort的runtime refresh，不是全量热替换事务。

映射到云端Agent时，应把durable Config Revision、Effective Config、AgentRun Snapshot和Runtime Consumer Generation分开建模。设置保存只证明控制面提交；真正运行生效必须有generation、逐consumer状态和明确的Run边界。
