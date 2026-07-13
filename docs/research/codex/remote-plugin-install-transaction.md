# Remote Plugin 目录、Bundle 与安装事务

本文研究 Codex 桌面端如何把“远程插件”从服务端目录变成本地可执行扩展，重点不是插件 UI，而是三个经常被混为一谈的事实：

1. 服务端目录声明“有哪些插件可见”。
2. 服务端 installed 集合声明“当前账号启用了哪些插件”。
3. 本地 Plugin Store 声明“哪些 bundle 已经物化且可被运行时装载”。

三者由不同组件维护，也可能短暂不一致。理解这个边界，比记住某个 API 路径更重要。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要证据包括：

- `codex-rs/core-plugins/src/remote.rs`
- `codex-rs/core-plugins/src/remote/catalog_cache.rs`
- `codex-rs/core-plugins/src/remote/remote_installed_plugin_sync.rs`
- `codex-rs/core-plugins/src/remote_bundle.rs`
- `codex-rs/core-plugins/src/plugin_bundle_archive.rs`
- `codex-rs/core-plugins/src/store.rs`
- `codex-rs/core-plugins/src/manager.rs`
- `codex-rs/app-server/src/request_processors/plugins.rs`
- `codex-rs/core/src/tools/handlers/request_plugin_install.rs`

本文把“源码当前行为”和“面向 AI SEO Agent 的迁移建议”分开。未发现的能力不会被反向推断为存在。

## 2. 先建立三个状态域

远程插件不是一个布尔值 `installed=true`，而是一组跨网络、内存与文件系统的投影：

```text
Remote directory catalog
  服务端可发现目录
  回答：用户现在能看到什么？

Remote installed snapshot
  服务端账号/工作区启用集合
  回答：控制面认为什么已安装？

Local bundle store
  $CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>
  回答：数据面实际能加载什么？
```

此外还有第四类状态：本地配置与运行中 MCP、Skill、App 投影。即使服务端 installed 集合和本地 bundle 都正确，正在运行的 Thread 也可能尚未刷新到新能力。

因此，“安装成功”至少可能有四种定义：

| 定义 | 成立条件 | 仍可能缺少什么 |
| --- | --- | --- |
| 服务端安装成功 | install mutation 返回 enabled | 本地 bundle |
| bundle 安装成功 | Store 已激活版本目录 | 服务端 installed 权威 |
| runtime 生效 | Plugin catalog、Skill、MCP/App 已刷新 | 外部 App OAuth |
| 用户任务可用 | runtime 能实际完成一次调用 | 业务级验证与回执 |

Codex 显式远程安装选择“先物化本地 bundle，再提交服务端 install mutation”。这是一个刻意的失败顺序，不是偶然的调用顺序。

## 3. 远程目录读取链

### 3.1 身份门

远程 Plugin Service 当前只接受 ChatGPT 身份。API Key 模式会得到不支持的认证错误，未登录则得到需要认证错误。

这意味着远程目录并不是通用 provider 能力，而是绑定 ChatGPT 账户与 workspace 的产品控制面。缓存键也因此包含：

- ChatGPT base URL
- account ID
- ChatGPT user ID
- 是否 workspace account

这些字段用于隔离目录投影，但缓存文件正文不重复保存完整 key。

### 3.2 Marketplace 不是一个集合

远端安装投影会把来源拆成多个逻辑 marketplace，例如：

- OpenAI curated remote
- 当前用户创建的插件
- Workspace directory
- Shared with me
- private / unlisted 等共享变体

这种拆分让来源、展示顺序和策略可以独立演进。`PluginId` 最终仍由插件名与 marketplace 名组成，而远端 remote plugin ID 是另一套服务端身份。

需要持续区分：

```text
remote plugin id
  服务端资源身份，用于 detail/install/uninstall API

PluginId = plugin name + marketplace name
  本地 Store、配置和运行时身份
```

显式安装时，客户端先请求 detail，再用服务端返回的 canonical marketplace 和插件名构造本地身份，不能直接信任 UI 请求中的 marketplace。

### 3.3 分页与网络预算

目录请求具有以下局部限制：

- 单次 HTTP 请求超时 30 秒。
- 单页请求上限 200 条。
- 推荐插件接口单独使用 5 秒超时，并限制最多 50 条。
- 非 2xx 的 bundle 下载错误正文有单独小预算，但普通 catalog decode 路径不是同一套实现。

当前普通目录分页没有看到统一的：

- 最大页数；
- 最大总条目数；
- 最大累计响应字节数；
- 重复 cursor 检测；
- 整个分页操作的总 deadline。

`send_and_decode` 会先把 response text 完整读入内存再反序列化。于是“每页 200 条”和“每个请求 30 秒”并不能推出一次目录刷新是严格有界的。

对服务端 Agent 的启示是：分页必须同时绑定 cursor generation、页数、总条目、总字节和总 deadline。只限制 page size 不是资源治理。

## 4. Global 目录磁盘缓存

### 4.1 缓存路径与键

Global remote catalog 会写入 `$CODEX_HOME` 下的磁盘缓存。文件名由 cache key 的 JSON 经过一个轻量 64 位哈希得到，而正文主要包含：

- schema version
- plugin summaries

优点是不同 account/base URL 能落到不同文件。局限是文件自身没有保存 key，离线诊断时难以证明“这个哈希文件属于哪个身份快照”。

### 4.2 读取语义

如果 Global 目录缓存存在，读取 marketplace 时会直接复用缓存目录，同时仍会请求远端 installed 集合。没有缓存时，目录与 installed 请求并发执行，成功后再写缓存。

这形成一个重要语义：

```text
directory freshness != installed freshness
```

UI 可能展示旧目录，却以新 installed 状态标记插件。这个选择提高了冷启动可用性，但客户端必须能表达 stale，而不是把旧缓存伪装成实时事实。

### 4.3 失效与写入

当前磁盘缓存：

- 通过 schema version 拒绝不兼容数据；
- JSON 解析失败或 schema 不匹配时尝试删除坏文件；
- 没有明确 TTL 或 `fetched_at` freshness 字段；
- 写入使用直接文件写，不是 temp + fsync + rename；
- 写入错误不会阻断主要目录读取流程。

因此缓存是 availability 优先的辅助投影，不是 durable source of truth。它也可能无限期陈旧，直到后台刷新成功。

缓存文件名的短哈希适合定位，不应被当作抗碰撞安全标识。更完整的缓存 manifest 应保存规范化 key、响应 generation、ETag/fetchedAt、payload digest 和写入版本。

## 5. 背景刷新调度

`PluginsManager` 分别维护：

- remote installed plugins cache refresh state；
- global remote catalog cache refresh state；
- non-curated marketplace cache refresh state。

前两者采用“一个 in-flight worker + 一个 latest requested slot”的合并方式：

```text
schedule(request A)
  -> in_flight=false，启动 worker

schedule(request B/C while running)
  -> 不再启动 worker
  -> requested slot 只保留/合并最新意图

worker finishes A
  -> take latest requested
  -> 继续一轮
```

这是轻量 singleflight/coalescing，能避免刷新风暴。installed 刷新还会合并 `AfterSuccessfulRefresh` 通知强度和已物化插件列表，防止 mutation 后的关键通知被普通刷新覆盖。

但它是进程内协调，不是跨进程 lease。多个 Codex 进程仍可能同时下载、写缓存或清理同一 Plugin Store。

## 6. 显式远程安装事务

App Server 的显式远程安装主链可以概括为：

```text
1. 加载最新配置并检查 Plugins feature
2. 校验 remote plugin id
3. 获取当前 ChatGPT auth
4. 请求 remote detail + download URL
5. 采用服务端 canonical marketplace/name/PluginId
6. 检查 admin availability 与 install policy
7. 标记本地 cache mutation in-flight
8. 校验 bundle 元数据
9. 下载、解包并安装到本地 Store
10. 调服务端 install mutation
11. 调度 installed cache refresh
12. 刷新 telemetry、MCP OAuth、Apps auth 投影
13. 返回 apps_needing_auth
```

### 6.1 为什么本地先于服务端

源码注释明确表达了这个不变量：不能让服务端 install 成功，而本地物化失败。

顺序是：

```text
local bundle commit
  -> remote install mutation
```

若本地失败，服务端不变；用户可以修复磁盘/网络问题后重试。

若本地成功、服务端 mutation 失败，则 Store 中多出一个未被远端 installed 状态授权的 cache entry。运行时以远端 installed 状态为 gate，因此这个孤儿缓存被视为相对无害，并可由后续 sync 清理。

这是典型的 saga 取舍：选择更安全的 partial state，而不是假装跨 HTTP 与文件系统存在 ACID 事务。

### 6.2 仍然是 ambiguous commit

服务端 POST 可能在服务端已提交后发生网络断开。客户端此时只看到错误，无法仅凭该响应判断 install 是否实际成功。

当前恢复依赖后续 `/installed` refresh，而不是 mutation operation ID 或 status query。理想设计应让服务端 install mutation 幂等，接受 stable idempotency key，并返回可查询 operation receipt。

### 6.3 canonical identity 防混淆

detail response 提供：

- canonical marketplace；
- plugin name；
- summary ID；
- release version；
- bundle download URL；
- app manifest。

客户端会解析 `summary.id` 为本地 `PluginId`，并在安装 bundle 时再次检查 manifest name 是否匹配请求目标。远端 install mutation 返回的 plugin ID 与 enabled 状态也会被核对。

这比“下载一个 zip 然后相信目录名”强得多，但 identity 尚未与 bundle 内容 digest 绑定。

## 7. Bundle 下载边界

### 7.1 URL 与 redirect

bundle URL 必须是 HTTPS；测试模式允许 loopback HTTP。reqwest 可能自动跟随 redirect，下载后会再次检查 final URL scheme。

当前未见 host allowlist 或“redirect 后必须仍属于签名 CDN 域”的约束。任何 HTTPS 主机都能成为最终下载源，只要服务端 detail 提供或 redirect 到该 URL。

这意味着安全根仍是 Plugin Service 与 presigned URL，而不是客户端独立验证的制品身份。

### 7.2 压缩与解压预算

下载和解压分别有明确上限：

- 下载 timeout 60 秒；
- 压缩 bundle 最大 50 MiB；
- 先检查 `Content-Length`，stream 时再累计实际字节；
- 解压总大小最大 250 MiB；
- 非成功响应只读取最多 8 KiB 错误正文。

这是一组值得学习的双层防线：不能只相信 `Content-Length`，也不能只限制压缩包而忽略解压膨胀。

压缩 body 当前会完整进入 `Vec<u8>`，再交给 blocking 线程解包。因此峰值内存至少包含压缩体、解压写入缓冲和后续 Store copy。50 MiB 是磁盘输入上限，也直接影响进程内存峰值。

### 7.3 Tar 解包规则

公共 archive extractor 会：

- 拒绝 absolute/root/prefix/parent traversal；
- 拒绝空路径；
- 拒绝 symlink 与 hardlink；
- 仅接受目录和普通文件；
- 逐 entry 累加声明大小，防止总解压字节溢出；
- 检查目标路径仍位于 extraction root；
- 保留可执行权限。

这些规则显著缩小了 tar traversal 与 link escape 攻击面。

当前未见统一 entry count、最大单路径长度、最大目录深度和最大文件数。大量零字节条目仍可能造成 inode/CPU 压力，GNU long-name 也会扩展路径处理面。

### 7.4 staging root

远程 bundle 会解压到：

```text
$CODEX_HOME/plugins/.remote-plugin-install-staging/<tempdir>
```

随后要求 extraction root 本身就是标准 plugin root；嵌套 wrapper directory 会被拒绝。这样 manifest 位置是确定的，不需要模糊搜索整个树。

Global remote bundle 的 release version 与 app manifest 会以服务端 detail 为权威写入 staging plugin root，再进入 Store。这样 catalog/control plane 可以修正制品内 metadata，但也意味着最终安装内容不是下载字节的纯函数；审计 digest 应在“规范化后制品”层再计算一次。

## 8. Plugin Store 提交模型

### 8.1 目录布局

本地 Store 分成 cache 与 data：

```text
plugins/cache/<marketplace>/<plugin>/<version>
plugins/data/<plugin>-<marketplace>
```

卸载删除 cache，不删除 data。这能让插件升级/重装保留业务数据，但必须把 data retention、隐私与 schema migration 单独治理。

### 8.2 active version

Store 没有单独的 `current` 指针文件。active version 通过扫描版本目录计算：

1. 名为 `local` 的版本永远优先；
2. 否则优先合法 semver 最大值；
3. 无法解析 semver 时退回字符串比较。

版本名只允许有限 ASCII 字符。这个模型简单，但 active selection 是目录集合的派生事实。垃圾目录、清理失败或手工篡改都可能改变选择结果。

### 8.3 安装 staging

Store 安装会：

- 验证 source directory 与 plugin manifest；
- 检查 manifest name 与请求 PluginId；
- 验证版本名；
- 在目标同级创建 staging；
- 递归复制目录和普通文件，忽略 symlink/其他类型；
- 通过 rename 激活。

同一父目录下 rename 提供了较好的可见性原子性，但当前没有发现目录与文件的 `fsync` 链。因此“其他 reader 不容易看到半棵目录”不等于“掉电后一定 durable”。

### 8.4 新版本与同版本替换

安装新版本时，如果 plugin root 已存在，Store 会把 staged version rename 到 root 下，再尝试删除旧版本。

删除旧版本失败会被分类处理：

- 如果残留版本会因 `local` 或版本排序继续成为 active，安装返回错误；
- 如果新版本仍然会胜出，部分清理失败可以被容忍。

同版本/整 root 替换时，Store 使用 backup swap：

```text
target root -> temporary backup
staged root -> target root
remove backup
```

若第二步失败，会尝试把 backup rename 回原位。若 rollback 也失败，错误会保留 backup path，避免把恢复线索吞掉。

这是优质的失败设计：错误不仅说“失败了”，还说明上一个可用状态在哪里。

### 8.5 remote identity sidecar

远程 bundle 安装后会写 remote plugin identity sidecar，用于把本地 PluginId 关联回服务端 ID。sidecar 使用临时文件、flush 与 persist，但未看到 `sync_all`。

若 bundle 已安装而 sidecar 写失败，安装返回错误，但文件系统已经发生提交。后台 sync 在发现 active version 与 release version 相同时，会跳过重新下载，只回填 identity。

这说明正确的重试语义不是“任何错误都从头下载”，而是先检查可验证的阶段事实，再补齐缺失 metadata。

## 9. 后台 installed bundle 对账

`remote_installed_plugin_sync` 是控制面与本地数据面的 reconciler。

### 9.1 输入快照

它并发拉取 global、workspace、user 三类 installed bundle 输入，并使用 `try_join!`。任一顶层来源失败，整轮在本地 mutation/cleanup 前终止。

这个选择偏向安全：不拿 partial installed snapshot 做 stale cleanup，否则一个来源临时失败可能被误判成“插件已卸载”。

### 9.2 逐插件物化

成功得到完整快照后，sync 会：

1. 先把插件名加入对应 marketplace 的 installed set；
2. 校验 release version 与 bundle metadata；
3. 若 active version 已相同，只回填 remote identity；
4. 否则下载并安装；
5. 记录 materialized 或 failed，不让单个坏 bundle 终止全部插件。

先加入 installed set 再尝试下载也很关键：某个新版本下载失败时，旧 cache 不会在本轮 stale cleanup 中被误删。

但“版本字符串相同”会被当作内容相同，没有 bundle digest 或 manifest hash 复核。本地同版本内容被篡改或损坏时，sync 不会主动自愈。

### 9.3 stale cleanup

物化完成后，reconciler 按 marketplace 删除不再出现在 installed set 的 cache。

显式安装与 stale cleanup 可能并发，因此 App Server 会为具体 cache root 建立进程内 mutation guard。guard 带引用计数，最后一个 guard drop 后才解除保护。

局限包括：

- guard 只在当前进程有效；
- 不是 filesystem lock，也不携带 PID/generation/TTL；
- 崩溃由进程退出隐式释放，但其他进程完全看不到；
- stale 删除逐项执行，后续删除失败时，前面可能已经成功删除；
- 某些错误返回路径可能只报告整轮失败，无法完整列出此前已删项。

### 9.4 sync singleflight

后台 bundle sync 以 plugin cache root 作为 key 做进程内 in-flight 去重。完成后清除 key；没有跨进程锁，也没有 durable sync checkpoint。

结果对象会区分：

- materialized remote plugins；
- removed plugin caches；
- failed plugin materializations。

这是有价值的 typed receipt，但还不足以恢复一次崩溃中的清理事务。

## 10. Uninstall 的反向顺序

远程 uninstall 采用：

```text
resolve remote target
  -> 服务端 uninstall mutation
  -> 删除本地 cache
```

它优先让控制面不再授权插件，再清本地 cache。若本地删除失败，会返回 `CacheRemove`，但服务端很可能已经禁用。

App Server 对 `Ok` 和 `CacheRemove` 都会：

- 记录 uninstall telemetry；
- 清除 remote installed cache；
- 触发 installed refresh。

这与安装顺序形成对称的安全不变量：

```text
install：先确保本地可用，再让远端授权
uninstall：先撤销远端授权，再删除本地内容
```

两者都选择“授权状态不会指向明显缺失或已撤销的数据面”作为主要安全目标。

## 11. 模型为什么不能静默安装插件

`request_plugin_install` Tool 的职责是建议安装，不是直接执行安装。

链路是：

```text
model calls request_plugin_install
  -> Core 只接受之前 discoverable catalog 中的 exact tool id/type
  -> 向 Codex Apps MCP/client 发 elicitation
  -> 用户 Accept / Decline / Cancel
  -> client/UI 负责实际安装交互
  -> Core 刷新 installed/plugin/connector 状态并验证结果
  -> Tool observation 返回 user_confirmed + completed
```

关键优点：

- 模型不能提交任意未列出的 plugin ID；
- `suggest_reason` 必须非空；
- 用户确认和实际完成是两个布尔事实；
- Decline 可选择持久禁用此类建议；
- remote plugin 完成后会刷新 installed cache 与 connector tool cache；
- Tool observation 只声称验证到的结果，不把 Accept 等同于安装完成。

当前 remote suggestion 的 completed 验证更偏向 installed/connectors 可见性，并不等价于校验 bundle digest、MCP server health 或插件完成了一次业务调用。

## 12. 一张失败顺序表

| 阶段 | 失败时已发生状态 | 当前恢复方向 |
| --- | --- | --- |
| detail 请求失败 | 无本地/远端 mutation | 重试读取 |
| bundle 校验失败 | 无安装 | 修复服务端 metadata/bundle |
| bundle 下载失败 | staging temp 由生命周期清理 | 重试下载 |
| Store 激活失败且 rollback 成功 | 旧版本仍可用 | 修复磁盘后重试 |
| Store 激活失败且 rollback 失败 | backup path 被保留 | 人工/自动恢复 backup |
| sidecar 写失败 | bundle 可能已 active | 同版本 sync 回填 identity |
| local 成功、remote install 失败 | 孤儿 cache | 查询 installed；重试 mutation或清理 |
| remote mutation 已提交但响应丢失 | 状态不明 | `/installed` 对账 |
| remote install 成功、refresh 失败 | 服务端已启用，本地已物化，runtime 投影旧 | 后台 refresh / 重启恢复 |
| uninstall mutation 成功、cache 删除失败 | 服务端已禁用，磁盘残留 | 后续 stale cleanup |
| sync 顶层来源失败 | 不做 cleanup | 下轮完整快照再对账 |
| 单 plugin materialize 失败 | installed set 保留，旧 cache 不误删 | 保留旧版并单项重试 |

这张表揭示一个通用原则：失败结果必须描述“提交到哪一层”，而不是只返回一个字符串 `install failed`。

## 13. 值得直接学习的设计

### 13.1 控制面与数据面分离

远端 installed 是授权事实，本地 bundle 是执行制品。两者分开后，系统才能明确选择安装/卸载的安全提交顺序。

### 13.2 双层制品预算

同时约束 compressed 和 extracted bytes，并在 header 与 streaming 两个位置检查下载大小，是处理用户/远端制品的基础要求。

### 13.3 解包拒绝 link 与 traversal

拒绝 symlink/hardlink、限定 entry 类型、segment-aware containment，比“解压后再扫描危险路径”可靠。

### 13.4 同父目录 staging + rename

把完整版本准备好后再切换可见状态，避免 reader 看到半安装目录。backup rollback 则给同版本替换保留了恢复锚点。

### 13.5 Reconciler 不用 partial snapshot 删除

顶层来源任一失败便跳过 stale cleanup，是一个重要负面证明规则：只有已知扫描完整，缺失才有资格表示删除。

### 13.6 用户确认与完成分开

安装建议 Tool 不拥有直接 mutation authority，且 Accept 不代表 completed。这种协议适合所有“模型建议、用户确认、客户端执行”的高影响操作。

## 14. 不能照搬的缺口

### 14.1 缺少制品完整性身份

当前主要信任 HTTPS download URL 与 control-plane metadata，未见 bundle SHA-256、签名、透明日志或 publisher key 验证。

至少应把：

```text
remote plugin id
release version
bundle digest
manifest digest
publisher identity
```

绑定进安装 receipt。版本字符串不能替代内容身份。

### 14.2 缺少跨进程事务协调

refresh、sync、mutation guard 都主要是进程内状态。桌面 App、CLI、daemon 多进程共享 `$CODEX_HOME` 时，应使用 filesystem lock 或 SQLite lease，并携带 owner generation。

### 14.3 缓存没有 freshness 与原子写

目录 cache 无 TTL/fetchedAt，直接覆盖写；Store rename 有可见性原子性但缺 crash durability。辅助缓存可接受降级，但必须对外标注 stale，并能从 source of truth 重建。

### 14.4 分页与条目数未全局有界

page limit 不能抵御无限 cursor 或超大正文。目录、manifest、文件数、路径长度和总解析深度都应有统一预算。

### 14.5 运行时生效回执仍偏弱

installed refresh、MCP reload、App auth 和业务可用性是不同阶段。最终响应应明确：

- bundle committed；
- control-plane enabled；
- catalog refreshed；
- MCP started/failed；
- external auth required；
- effective next turn/generation。

## 15. 映射到 AI SEO Agent

当前项目不应直接引入插件市场，但 Tool Registry 与未来第三方集成可以提前采用同样的不变量。

### 15.1 建议的数据模型

```ts
type ExtensionRelease = {
  extensionId: string
  version: string
  artifactSha256: string
  manifestSha256: string
  publisherId: string
  status: 'published' | 'revoked'
}

type TenantExtensionInstall = {
  tenantId: string
  extensionId: string
  desiredVersion: string
  desiredState: 'enabled' | 'disabled'
  operationId: string
}

type ExtensionMaterialization = {
  tenantId: string
  extensionId: string
  version: string
  artifactSha256: string
  state: 'staging' | 'ready' | 'failed' | 'quarantined'
  generation: number
}
```

对于云端 Agent，`desiredState` 类似远端 installed 控制面，`Materialization` 类似 worker 数据面。不要把二者压进一个 `installed: boolean`。

### 15.2 建议的安装 Saga

```text
1. 创建 operationId 与 desired install intent
2. 校验 policy、publisher、release digest
3. 下载到隔离 staging，校验 compressed/extracted/file-count budgets
4. 扫描并验证 manifest/tool schemas
5. 原子发布 immutable artifact generation
6. 在数据库事务中切换 tenant desired version
7. 通知 worker generation refresh
8. worker 回报 loaded generation + health
9. operation 进入 effective 或 degraded
```

服务端架构不需要复制本地目录 rename，但需要复制“先准备不可变制品，再切换引用”的思想。

### 15.3 建议的回执

```ts
type ExtensionInstallReceipt = {
  operationId: string
  requestedAt: string
  artifact: {
    version: string
    sha256: string
    committed: boolean
  }
  controlPlane: {
    desiredStateCommitted: boolean
    generation: number | null
  }
  runtime: {
    loadedGeneration: number | null
    health: 'pending' | 'ready' | 'degraded' | 'failed'
  }
  auth: {
    requiredConnectorIds: string[]
  }
}
```

这样前端可以准确展示“制品已安装，等待 worker 刷新”或“已启用，但还需授权 Search Console”，而不是统一显示模糊的失败 toast。

## 16. 最小验证矩阵

若未来实现类似扩展安装，至少覆盖：

### 16.1 目录与缓存

- 不同 tenant/account 不能命中同一目录 cache。
- cache schema mismatch 能降级到远端，不污染新 cache。
- stale cache 必须向调用方暴露 freshness。
- 重复 cursor、超页数、超总字节会终止。
- 旧 generation 的晚回响应不能覆盖新 cache。

### 16.2 制品

- `Content-Length` 欺骗时 stream 累计仍能拒绝。
- zip/tar traversal、absolute path、symlink、hardlink 被拒绝。
- compressed 合法但 extracted 超限被拒绝。
- 大量零字节文件命中文件数上限。
- manifest ID/version 与请求不一致被拒绝。
- digest/signature 不匹配进入 quarantine，不可激活。

### 16.3 提交与恢复

- staging 完成前 reader 只见旧 generation。
- 激活失败能回滚到旧 generation。
- rollback 失败保留可操作恢复位置与 receipt。
- 服务端 mutation commit 后断线可用同 operation ID 查询。
- local ready/desired state/runtime load 任一阶段崩溃都能重放。
- 两个进程并发安装同一插件只产生一个 winner generation。

### 16.4 卸载与保留

- 先撤销执行授权，再异步清理制品。
- 清理失败不重新授权插件。
- data retention 与 cache deletion 分开。
- in-use generation 具有引用计数/lease，不被清理。
- revoked release 能阻止新 Run，即使旧 worker 仍有缓存。

### 16.5 Human-in-the-loop

- 模型只能建议 catalog 中的 exact ID。
- 用户 Decline 不执行副作用。
- Accept 与 completed 分开记录。
- client crash 后 pending operation 可恢复。
- operation receipt 能说明最终生效 generation。

## 17. 推荐源码阅读顺序

1. 从 `app-server/src/request_processors/plugins.rs` 的 remote install response 开始，建立显式事务顺序。
2. 阅读 `remote_bundle.rs`，区分 metadata validation、download、extract、prepare 与 Store install。
3. 阅读 `plugin_bundle_archive.rs`，确认路径与 entry type 的安全不变量。
4. 阅读 `store.rs`，理解 active version、staging rename、backup rollback 和 data/cache 分离。
5. 阅读 `remote_installed_plugin_sync.rs`，观察完整快照、逐项失败与 stale cleanup 的顺序。
6. 回到 `remote.rs`，理解 directory/installed/detail/mutation 四类 API 与身份转换。
7. 阅读 `manager.rs` 的 refresh coalescing 和 callback 合并。
8. 最后阅读 `request_plugin_install.rs`，理解模型建议、用户确认、客户端执行与完成验证为什么必须分层。

## 18. 结论

Codex Remote Plugin 最值得学习的，不是“插件可以从服务器下载”，而是它已经显式面对了跨控制面、文件系统和运行时投影的 partial state：

```text
目录可见
  != 账号已启用
  != bundle 已物化
  != runtime 已刷新
  != 外部认证完成
  != 用户任务真正可用
```

它通过本地先行安装、卸载先撤权、完整快照后才清理、staging rename、backup rollback、typed sync outcome 和 Human-in-the-loop，构造了一个有明确安全偏好的 saga。

继续演进时最关键的补强是：以 digest/signature 固化制品身份，以 operation ID 固化 mutation 身份，以 generation 固化 runtime 生效身份，以跨进程 lease 固化 Store 写入所有权。只有这四类身份同时存在，“安装成功”才会从一个 UI 文案变成可验证、可恢复、可审计的事实。
