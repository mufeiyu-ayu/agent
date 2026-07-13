# Codex 架构研究进度

## 当前基线

- Codex：`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- Agent 起点：`master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 研究分支：`codex/issue-6-rebuild-codex-research`
- 状态含义：`Completed` 已形成可审计闭环；`Partial` 有可靠证据但仍有明确缺口；`Not Researched` 尚未取证。

## 架构覆盖矩阵

| 优先级 | 领域 | 状态 | 主要证据入口 | 正式文档 |
| --- | --- | --- | --- | --- |
| P0 | Repository 与产品入口 | Completed | `codex-rs/cli/src/main.rs`、TUI `AppServerTarget`、app-server dispatch、SDK facade 与入口测试 | [架构报告](./architecture-report.md)、[源码地图](./source-reading-map.md) |
| P0 | 协议与生命周期 | Completed | protocol v2 Thread/Turn/Item/Goal、`Op`、ThreadManager、start/resume/fork/steer/interrupt/goal tests | 同上 |
| P0 | Agent Runtime 主循环 | Completed | submission_loop、RegularTask、run_turn、Turn/StepContext、sampling/follow-up、abort/capability tests | 同上 |
| P0 | 模型适配 | Completed | `ModelClient`、turn-scoped `ModelClientSession`、`ResponseEvent`、client transport/auth/retry tests | 同上 |
| P0 | Tool Calling | Completed | ToolSpec、Router/Runtime/Registry/Handler/Orchestrator、hook rewrite、并行/取消与 malformed tests | 同上 |
| P0 | Context 与历史 | Completed | ContextManager/normalize/world state、token-budget compaction、rollback/truncation/resume tests | 同上 |
| P0 | 持久化与恢复 | Completed | rollout policy/recorder、ThreadStore、Legacy/Paginated projection、reconstruction/failure tests | 同上 |
| P0 | 权限与安全 | Completed | permission profile、exec policy、approval、Guardian、sandbox/network attempt 与拒绝测试 | 同上 |
| P1 | 并发、取消与背压 | Completed | bounded submission、single active Task、TurnInputQueue、ordered tool futures、listener/unsubscribe 边界测试 | 同上 |
| P1 | 扩展体系 | Completed | typed ExtensionRegistry、MCP/skills/plugins/hooks/apps/environments、注册顺序与集成测试 | 同上 |
| P1 | Multi-agent | Completed | 独立 child Thread、spawn graph/fork、InterAgentCommunication、execution/residency capacity 与边界测试 | 同上 |
| P1 | 可观测性与质量 | Completed | transport/sampling/tool/persistence telemetry、analytics reducer、四层测试架构 | 同上 |
| P1 | 产品层投影 | Completed | EventMsg→notification、paginated rollout→history、unsubscribe/reconnect 边界 | 同上 |

> 本矩阵在每个批次落盘后更新。当前 `Partial` 只表示旧文档路径已存在且第一轮路径复查通过，不能替代本轮完整取证。

## 批次记录

| 批次 | 研究范围 | 落盘结果 | 批次前 / 后周额度 |
| --- | --- | --- | --- |
| 0 | 启动检查、最新 main、旧文档与路径基线 | 固定完整 SHA；确认原路径无缺失；新增本进度页 | 97% / 97% |
| 1 | 产品入口、协议生命周期、Runtime 主循环、模型适配 | 更新全局拓扑、生命周期、`run_turn` 图；补稳定符号、正常/失败测试与不变量 | 97% / 97% |
| 2 | Tool、Context、持久化恢复、权限安全 | 更新 tool loop/分层、context/durable、操作语义、安全决策图；补 hook rewrite 与 paginated history 新事实 | 97% / 97% |
| 3 | P1 并发、扩展、Multi-agent、质量、产品投影 | 补 typed extensions、agent communication/residency、Event/Item/history 边界与两张专题图 | 97% / 97% |
| 4 | 学习指南、清单与兼容 phase 路径 | 重写 Core/Advanced/Optional 主线、矩阵与学习 tracker；14 个模块增加分类并核验当前快照入口 | 96% / 96% |
| 5 | 收尾、全量索引与验收校验 | 新增 closeout；55 个原路径、57 个 Markdown、17 个 Mermaid 与变更范围校验通过 | 96% / 95% |
| 6 | 完成性补审 | 补 Goal、StepContext、tool search/argument streaming；82 个 literal / 240 个全量 Codex 路径 token 校验通过 | 95% / 95% |
| 7 | PR 交付 | commit `60401fb` 推送并创建 Ready PR #7；远程 head/mergeability/范围复核通过 | 95% / 94% |
| 8 | App Server RPC 并发、能力协商与重连原子性 | 补资源级 shared/exclusive 序列化、ConnectionRpcGate、listener command、resume/subscribe 与 idle unload 不变量 | 94% / 94% |
| 9 | Model adapter 传输与恢复 | 补 Session/Turn/attempt 三种寿命、WS 增量等价、prewarm trace、401/stream retry/HTTP fallback 与断流事实边界 | 94% / 94% |
| 10 | Rollout writer、ordinal 与 state DB 恢复 | 补 deferred materialization、pending suffix/reopen barrier、逆向 ordinal、leased backfill、DB 定点备份与 filesystem fallback | 94% / 93% |
| 11 | Hook、动态权限、Sandbox、Network 与 Guardian 组合 | 补 hook fail-open/结果过滤边界、权限交集与 scope、二次 sandbox review、网络归因 key、Guardian 隔离与拒绝熔断 | 93% / 93% |
| 12 | Typed Extension 的状态寿命与合并规则 | 补不可变 registry、Session/Thread/Turn attachment、all/first-claim/last-write 合并、失败隔离与流式 Item 延迟成本 | 93% / 93% |
| 13 | Multi-agent V2 control plane | 补 root-scoped control、身份/驻留/执行三容量、fork flush/filter、V2 reload 限制、mailbox answer boundary 与 V1/V2 差异 | 93% / 93% |
| 14 | Context normalization 与 compaction rewrite | 补 pair-aware repair、rollback/context baseline、world-state diff、tail token 估算、Total/BodyAfterPrefix、三类 compaction 与位置不变量 | 93% / 93% |
| 15 | Tool parallel admission、ordered observation 与 cancellation | 补 RwLock read/write gate、StepContext 快照、FuturesOrdered、argument preview、terminal exactly-once、cleanup wait 与 timing 分解 | 93% / 93% |
| 16 | Submission loop 与 ActiveTurn ownership | 补单消费者控制面、task=None reservation、steer/replaced、finish/abort 双屏障、100ms cleanup、identity recheck 与 idle work 竞态 | 93% / 93% |
| 17 | Legacy ThreadHistory 与 Paginated projector | 补双投影边界、implicit/explicit Turn、late event归属、snapshot upsert、ChangeSet dedupe/rollback 与 Error status保护 | 93% / 92% |
| 18 | App Server connection ownership 与 teardown | 补processor/outbound双状态、initialize提交顺序、RPC gate与资源queue正交、入站/出站request id、pending approval重放、慢连接断开和responder校验边界 | 92% / 92% |
| 19 | MCP Runtime generation、refresh 与 exposure | 补Step级不可变snapshot、catalog多来源解析、无效环境变化复用manager、新旧runtime共存、required/cache/reconnect、tool可见性、elicitation跨refresh路由 | 92% / 92% |
| 20 | Config layers、requirements composition 与 constraints | 补普通偏好/强制约束双管线、精确precedence/provenance、领域合并规则、normalize/fallback/fatal、permission重物化和refresh重建边界 | 92% / 92% |
| 21 | Environment selection、reconnect 与 capability snapshot | 补Manager/Thread/Step三层、initial失败与reconnect差异、Deferred Executor starting/wait、fail-fast inspection、handle-bound capability root和PathUri兼容风险 | 92% / 92% |
| 22 | Unified Exec process、output 与 remote recovery | 补call/process/chunk三身份、yield后后台存活、三条输出投影、seq乱序补读、stdin幂等、Exited/Closed barrier、LRU和network approval寿命 | 92% / 92% |
| 23 | OTEL、Analytics 与 Feedback 数据边界 | 补signal/敏感度分流、trace-safe限制、lossy typed reducer、完整上下文join、feedback consent/附件边界，以及任意PathBuf与大附件风险 | 92% / 91% |
| 24 | App Server protocol evolution 与 schema contract | 补非标准JSONRPC方言、v1/v2同union、宏登记表、field-level experimental运行/生成双门、outbound降级选择、fixture陈旧文件检查 | 91% / 91% |
| 25 | Auth snapshot、401 recovery 与账户身份边界 | 补缓存/revision与存储形态、reload→refresh有限状态机、account guard、并发refresh与永久失败隔离、external provider、HTTP/WS恢复位置和重建header | 91% / 91% |
| 26 | Agent Role discovery、Config layer 与 fork inheritance | 补role metadata/config双层、声明与目录发现、跨layer字段继承、SessionFlags重载和requirements重应用、sticky runtime设置、full-history fork拒绝覆盖与role供应链边界 | 91% / 91% |
| 27 | Skills catalog、authority、snapshot 与按需正文 | 补多来源root/namespace、metadata与policy、config-aware cache、Host/Executor/Orchestrator不同寿命、路径化选择、catalog/main prompt预算、watch invalidation和双注入迁移边界 | 91% / 91% |
| 28 | TUI thread projection、interactive replay 与 streaming render | 补AppEvent/AppCommand分层、thread-scoped buffer和snapshot rebase、pending prompt精确重放、committed/active cell、stable/tail streaming、table/resize、显示背压与Lagged恢复边界 | 91% / 91% |
| 29 | Plugin marketplace admission、atomic store 与 supply-chain boundary | 补catalog/install/enable三态、requirements source policy、staging与rollback、manifest/resource containment、remote bundle大小/路径防护、local→backend事务顺序、无内容签名风险和cache generation | 91% / 91% |
| 30 | Realtime media session、handoff 与 backpressure | 补Thread旁路生命周期、WS/WebRTC gate、媒体/文本不同队列策略、response.create合并、barge-in truncate、普通Agent handoff/steer、generation收口、startup context预算与敏感日志风险 | 91% / 91% |
| 31 | Remote Control pairing、virtual connection 与 relay recovery | 补managed/SQLite/desired-state三门、账户绑定enrollment与短寿命server token、pairing身份复核、client/stream映射、seq/segment/ack重放、buffer背压、完整控制面授权和relay明文信任边界 | 91% / 91% |
| 32 | Config mutation、乐观并发与runtime refresh | 补active user layer唯一写边界、canonical TOML fingerprint、Replace/Upsert/null语义、raw/requirements/effective三重验证、DocumentMut保格式与atomic replace、override metadata、cache/Thread刷新分层和版本检查TOCTOU窗口 | 91% / 91% |
| 33 | Memories生成、使用反馈与遗忘边界 | 补startup资格和额度fail-open、Phase 1 lease/过滤/并行/结构化抽取、Phase 2全局锁/usage selection/git diff/受限Agent、读路径scoped tools与citation反馈、external context pollution和reset非原子删除 | 91% / 90% |
| 34 | Apply Patch预览、权限与partial commit | 补freeform/shell拦截、streaming provisional preview、hook后全量verification、source/destination权限与hardlink sandbox、顺序非事务写入、失败committed delta/exactness、sandbox retry副作用和Turn净diff失效策略 | 90% / 90% |
| 35 | Goals持久状态、usage accounting与idle continuation | 补goal_id generation、六状态控制权、普通Turn记账、non-cached token与wall time、并发flush、soft budget steering、idle自动续跑锁、error/usage-limit停止和App Server response/snapshot/notification顺序 | 90% / 90% |
| 36 | Model catalog、Turn能力快照与服务端reroute | 补bundled/cache/remote合并、auth/visibility、dynamic/static fallback差异、ETag同步刷新背压、provider cache-key缺口、longest-prefix fallback metadata、Turn snapshot、actual model mismatch与verification独立语义 | 90% / 90% |
| 37 | 多SQLite state runtime、migration兼容与定点恢复 | 补五库ownership、WAL/NORMAL/pool参数、顺序init与跨库非原子边界、future migration兼容/checksum、只读审计、corruption/lock分类、单DB main/wal/shm备份、fresh schema重建和partial backup风险 | 90% / 90% |
| 38 | Apps目录、connector access、tool policy与auth elicitation | 补directory/access/plugin/config四态、account-keyed stale cache、双异步App list、workspace fail-open、风险hint与managed policy、direct/deferred exposure、mention仅作归因、可信auth failure校验和Accept后手动retry | 90% / 89% |
| 39 | File watcher路径身份、订阅ownership与cache invalidation | 补shared ref count、requested/canonical/actual三路径、missing ancestor迁移、mutating-only粗事件、debounce/throttle、connection-scoped watch/unwatch barrier、noop可靠性、workspace外观察风险和Skills next-Turn失效语义 | 89% / 89% |
| 40 | Config lock有效配置物化、严格重放与安全边界 | 补effective layer→resolved Session/Config字段、feature规范化、生成输入剔除、load时普通层替换但requirements保留、root发布前strict diff、版本兼容开关、non-root/后续动态状态覆盖缺口和非原子导出风险 | 89% / 89% |
| 41 | AGENTS.md发现边界、Thread快照与恢复差异 | 补host/project user级组装、Project layer不可改root marker、override/primary/fallback、remote/multi-Environment、byte截断、selection-only cache、普通Turn冻结、cold resume/fork world-state replacement、child live继承和source hash审计缺口 | 89% / 89% |
| 42 | Log DB异步队列、durability与feedback隐私边界 | 补try_send静默drop、batch/timer、flush FIFO但DB错误仍ack、full span/event field保存、无通用脱敏、thread/process分区保留、startup-only 10天清理、feedback subtree/process关联和跨库删除非原子顺序 | 89% / 89% |
| 43 | Agent Jobs批处理调度、owner CAS与crash恢复缺口 | 补CSV/job transaction、local-only路径、并发上限、spawn-before-claim补偿窗口、worker-only exposure+assigned thread CAS、schema软约束、timeout无heartbeat、cancel遗留pending、loop helper非startup recovery和CSV非原子artifact提交 | 89% / 89% |
| 44 | App Server graceful restart准入、drain与force边界 | 补首次signal继续accept/RPC、新Turn可延迟归零、assistant Turn计数不含普通RPC、二次Ctrl-C/TERM force而SIGHUP不force、DisconnectAll前后、顶层RPC gate无timeout、background/Thread各10秒best effort和terminal通知未必送达 | 89% / 88% |
| 45 | Current Time authority、提醒窗口与可中断sleep | 补System/External Thread-aware provider、sampling前Fatal、developer提醒持久化、window/interval/boundary消费、compaction强制刷新、主动curr_time不改delivery state、sleep pending-check防lost wakeup、steer/mailbox中断和进程内等待不可恢复 | 88% / 88% |
| 46 | 图像输入prepare、缓存、权限与resume漂移 | 补LocalImage host read与octet defer、history前统一decode/resize、remote/low/invalid逐项placeholder、High/Original dimension+patch预算、format/ICC/EXIF、SHA-1+mode 64MiB LRU、view_image sandbox差异和legacy rollout不回写导致算法版本漂移 | 88% / 88% |
| 47 | Code Mode V8能力、nested tool dispatch与process host | 补无Node/import的V8编排、nested call回到当前Turn ToolRouter、cell-ready gate、yield/wait/observer、completion-time KV commit、truncate前无界内存、共享child process V1 handshake、NotFound-only fallback、host crash丢live cell/KV和shutdown/open状态机 | 88% / 88% |
| 48 | 外部Agent Session检测、lossy投影与导入提交 | 补30天/50个mtime候选、canonical root validation后的symlink TOCTOU、SHA-256 ledger、只保留user/assistant并文本化tool、synthetic Legacy Turn、current Codex config/model、ThreadStore多步partial state、ledger非原子导致重复和import id后台通知语义 | 88% / 88% |
| 49 | Managed Network Proxy配置上界、执行归因与SSRF决策 | 补full-access不投影但保留代理对象、Environment独立listener、env+sandbox同snapshot、execution attribution token、deny→local/private→allowlist→decider不可逆顺序、Limited method/CONNECT/UDP、constraints热更上界、reload失败保留旧state和handle收口 | 88% / 88% |
| 50 | Credential Broker、MITM Hook与CA信任边界 | 补GitHub/OpenAI provider host binding、shape-preserving random dummy、唯一dummy才注入、DetectTls避免非TLS泄密、plaintext危险开关、hooked host no-match硬拒绝、matcher/body未支持、broker后hook覆盖顺序、进程内CA私钥与hash trust bundle | 88% / 87% |
| 51 | Deferred Executor starting投影、显式等待与handle一致性 | 补shared resolution future、non-blocking ready/starting、每sampling Step重捕获、wait只等当前snapshot且下一Step才扩展能力、pending/upsert Arc replacement、首次失败终态与运行中reconnect差异、capability passive/lazy/exact-handle三语义 | 87% / 87% |
| 52 | Remote Exec Noise Relay身份、授权、多路复用与背压 | 补Registry双bundle、hybrid IK pinned key、prologue绑定、encrypted短授权后二次Registry验证、128流/32验证/8失败上限、validation/instance id抗复用、seq先重排后decrypt、60KiB record/64MiB message、单流try_send隔离和registration reconnect语义 | 87% / 87% |
| 53 | App Server WebSocket入口认证、Origin与连接撤权边界 | 补non-loopback无auth硬拒绝和旧unsafe flag删除、capability SHA-256常量时比较、HS256 exp/nbf/iss/aud、Origin对全路由403、health无Bearer、官方client拒绝non-loopback明文token、auth后仍是全RPC surface、startup secret snapshot与已连接socket不撤权 | 87% / 87% |
| 54 | Shell Snapshot捕获、wrapper优先级与Secret落盘风险 | 补login rc真实副作用、functions/options/aliases/all exports物化、10秒capture+validation、temp rename但无显式0600/nofollow/hash、exact cwd+peek导致同Turn渐进启用、source失败静默、policy/proxy/profile/PATH二次恢复、Drop与rollout-mtime cleanup及cold resume漂移 | 87% / 87% |
| 55 | Shell Environment Policy投影顺序、runtime mutation与误配置 | 补默认All且ignore excludes=true导致secret继承、KEY/SECRET/TOKEN黑名单漏报误报、配置文档称regex但实际case-insensitive WildMatch、exclude→set→include顺序、thread/profile仅标签、PATH/proxy/CA按attempt重算、Windows PATHEXT和experimental_use_profile当前无runtime消费 | 87% / 87% |
| 56 | App Server Daemon PID身份、服务ready与自动更新partial state | 补daemon/pid双flock、空PID reservation、PID+start time抗复用、unmanaged socket拒绝、SIGTERM 60秒后SIGKILL/70秒上限、Initialize才ready、settings先写后restart非原子、bootstrap多进程partial state、install.sh直接执行供应链、binary digest驱动server-first restart与updater reexec | 87% / 87% |
| 57 | Unix Control Socket权限、stale清理、startup lock与连接背压 | 补默认0700目录/0600 socket承担认证、custom父目录被强制chmod、startup flock跨SQLite初始化且无timeout、connect-refused后只删真实socket、Guard按path非inode导致replacement unlink、每连接handshake task无显式上限、Request queue满返回-32001而其他event await和shutdown path不等于连接收口 | 87% / 87% |
| 58 | Attestation能力协商、客户端证明与header失败语义 | 补ChatGPT auth在ModelClient构造期冻结能力、custom provider目的地边界、Thread订阅者按最小ConnectionId单选且无fallback、请求参数无thread/request binding、100ms关键路径、迟到response只删callback、opaque token不验证与`{v,s,t}`区分无参与/生成失败 | 87% / 86% |
| 59 | Models refresh worker、ETag触发与cache原子性 | 补立即Online+完成后3分钟fixed-delay、shutdown不取消in-flight、5分钟cache仅绑client version且漏provider/future timestamp、direct write无锁、memory→etag→disk非原子、Responses ETag同步阻塞sampling、无singleflight导致旧请求晚回覆盖与offset cursor不绑generation | 86% / 86% |
| 60 | App Server Initialize提交、能力协商与全局身份漂移 | 补OnceLock先提交后response的partial init、WebSocket两阶段ready与in-process差异、experimental门只约束connection不约束共享Thread、opt-out exact notification过滤、first originator+last UA suffix混合身份、自报client name非principal，以及未初始化Response/Error仍可触达全局callback边界 | 86% / 86% |
| 61 | Remote Compaction V2 stream、retention与checkpoint提交 | 补普通Responses+CompactionTrigger而非compact endpoint、只重写连续尾部tool outputs、单transport最多2 retry但WS→HTTP重置、exactly-one compaction且extra items丢弃、InvalidRequest模型fallback返回原error、64k仅计文本/图片近零成本、started无failed terminal和post-hook abort发生在提交后 | 86% / 86% |
| 62 | Responses Metadata canonical投影、动态富化与隐私边界 | 补Memory仅在canonical blob省略identity但flat metadata仍带ID、WS握手兼容header跨Turn陈旧、Git enrichment让同Turn后续Step渐进变化、raw remote URL与绝对repo path外发、client extra手工reserved/无size上限、steer replace-last-write不绑定Input，以及多RwLock无generation快照 | 86% / 86% |
| 63 | Rollout Budget共享记账、提醒与恢复语义 | 补Completed后才计费导致已耗尽仍发请求、输出/history副作用不回滚、只信server usage且无attempt去重、f64权重与zero weights、per-thread/window提醒自耗、compaction计费后不安装、rollback不退款，以及live child共享但fork/cold resume从0重置 | 86% / 86% |
| 64 | Hook command trust、timeout、输出与spill资源边界 | 补config hash后才做env替换且不含shell/PATH/rc/script内容、host全权限继承env执行、stdin write在timeout外可挂死、wait_with_output无界内存、只kill direct child、event stdout/exit语义分裂，以及2500-token spill发生太晚且temp文件无private mode/cleanup、HookCompleted仍可保留全量 | 86% / 86% |
| 65 | MCP OAuth多store authority、refresh transaction与删除恢复 | 补Auto启动时resolve并生命周期pin、跨process仍可能File/Keyring分叉、store key漏resource/scope/client/headers且URL不规范、File direct write后chmod非原子、aggregate/per-credential双lock、Direct keyring跨CODEX_HOME失配、caller取消后refresh继续、persist-before-install及delete失败先丢内存retry intent | 86% / 86% |

## 最近检查

- 命令：`python3 "$HOME/.local/bin/codex-weekly-usage.py"`
- 读数：已用 14%，剩余 86%
- 采样时间：`2026-07-13 12:52:13 CST`
- 判断：高于 50%；按用户明确停止条件继续做源码深挖，不能以首轮闭环或 PR 已创建为由停止。

## 下一批次

继续从模型传输、持久化修复、安全决策和扩展容量四个横切面补“失败顺序—状态所有者—恢复不变量”；每批落盘并复查额度。只有周额度剩余低于 50% 后，才进入最终校验和 PR 收尾。
