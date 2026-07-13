# Local Log Database：非阻塞采集、分区Retention、Feedback导出与Durability边界

本文研究 Codex 如何把`tracing`事件写入独立SQLite logs DB，如何在不阻塞Agent主循环的前提下批量落盘，如何限制单Thread/进程日志体积，以及Feedback为什么会把Thread日志与同进程threadless日志组合导出。重点是“可观测性不能拖垮业务”，也不能因为是调试数据就忽略隐私、丢失和提交语义。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/state/src/{log_db,runtime/logs,model/log}.rs`、`state/logs_migrations/**`、`state/src/bin/logs_client.rs`

## 1. Logs使用独立SQLite故障域

StateRuntime为logs打开单独数据库文件与connection pool，而不是把高频日志写入主state DB。这样：

- 日志写锁不直接争用Thread/Goal/Memory表。
- retention与schema migration可独立演进。
- corruption recovery能精确指出logs DB。

但StateRuntime初始化仍把logs DB视为required：open/migrate失败会关闭已打开的state pool并返回错误。物理隔离不等于可用性隔离。

## 2. Tracing Layer默认采集范围很宽

默认level为TRACE，仅针对部分高噪声target降级/关闭：

- `hyper_util`只留WARN。
- bridged `log`关闭。
- OTEL专用log/trace-safe targets关闭。
- RMCP service降到INFO。
- Responses websocket timing关闭。

此外显式丢弃`opentelemetry_sdk` TRACE/DEBUG timer meta-event，因为实测高fanout环境中占保留日志30%以上。

保留策略应由测量驱动；“全开TRACE以后再说”会迅速把可用信号淹没。

## 3. `on_event`不等待数据库

普通log event：

1. 格式化成LogEntry。
2. `try_send`到bounded MPSC。
3. 立即返回。

Queue默认容量512。满或关闭时错误被忽略，事件静默丢弃。

这是优先保护Agent runtime延迟的正确取舍，但缺少dropped counter与rate-limited warning，运维无法区分“系统没报错”和“错误日志被背压丢了”。

## 4. Batch与Timer共同驱动Flush

后台inserter：

- buffer达到128条即flush。
- 最长每2秒flush一次。
- 收到显式Flush command立即flush。
- 所有sender drop、channel关闭时flush剩余buffer。

这把SQLite transaction摊薄，同时给低流量日志一个时延上界。进程kill/abort/runtime提前关闭仍可能丢失queue和buffer。

## 5. 显式Flush只证明Command被处理，不证明落盘成功

`flush()`把oneshot command通过`send().await`排入queue，等待writer reply。Writer调用DB insert后无论结果如何都reply，因为内部`flush`忽略`insert_logs`错误。

所以当前barrier语义是：

```text
accepted entries before Flush were attempted
```

不是：

```text
accepted entries are durably committed
```

诊断上传或退出前flush若需要可靠证据，应返回`Result<FlushReceipt>`，包含insert错误与最后committed log ID。

## 6. Queue Full与DB Failure形成两类不可见丢失

- Admission loss：`try_send`失败，entry从未进入writer。
- Persistence loss：entry已入queue，batch insert失败，整个split-off buffer被丢弃。

当前两者都没有retry/dead-letter/dropped metric。SQLite短暂busy、disk full或migration问题可能造成大段日志空洞。

日志系统不必无限重试，但至少应按原因计数并保留最近一次sink health。

## 7. Process UUID避免PID复用混淆

进程级OnceLock生成：

```text
pid:<os-pid>:<random-uuid>
```

Threadless logs用它做retention partition与Feedback关联。单独PID会在重启后复用，随机UUID使两次进程生命周期不会错误合并。

这个ID是process incarnation，不是installation/session/Thread ID，命名和用途清晰。

## 8. Thread ID优先取Event字段，否则继承Span Scope

Layer先看event自己的`thread_id`，没有则从root到leaf遍历span context，后遇到的非空thread ID覆盖前者，效果上选择更内层span。

显式event字段优先是好原则；span inheritance减少每条日志重复字段。

风险是任意业务span都可写字符串thread_id，没有格式/存在性验证。错误span nesting会把敏感日志归入错误Thread并影响Feedback导出。

## 9. Feedback Log Body保留完整Span Path与Fields

持久内容类似：

```text
root{fields}:child{fields}: event_fields
```

`DefaultFields`格式化所有span/event字段，`message`只作为旧调用方fallback。迁移后查询统一读取`feedback_log_body`。

这为诊断提供因果上下文，也扩大泄密面：command、path、URL、header、prompt fragment或error debug值都可能进入日志。Log layer本身没有统一redaction。

## 10. Debug Formatting会把结构体内部内容展开

Visitor对`record_debug`使用`format!("{value:?}")`。类型是否安全完全依赖其Debug实现；某个credential struct若派生Debug，可能把secret写入DB。

敏感类型应提供redacted Debug，日志field也应按semantic key/value经过统一scrubber。仅在上传时redact太晚，因为本地DB已经存明文。

## 11. Batch Insert与Partition Prune在同一Transaction

`insert_logs()`：

1. begin logs transaction。
2. 一条multi-values INSERT写整batch。
3. 只检查本batch涉及的partitions。
4. 超限则window-function删除旧rows。
5. commit。

读者不会观察“新日志已插入但旧日志尚未prune”的中间态。Retention是写入事务的一部分，不是最终一致后台清理。

## 12. 两类Partition使用不同Identity

- `thread_id IS NOT NULL`：按Thread ID分区。
- `thread_id IS NULL`：按process UUID分区。
- process UUID也为NULL的threadless rows共同作为一个特殊分区。

每分区同时限制：

- 约10 MiB `estimated_bytes`。
- 最多1000 rows。

这避免一个超活跃Thread或daemon process独占所有本地日志预算。

## 13. Prune严格保留“最新前缀”

SQL按`ts DESC, ts_nanos DESC, id DESC`计算：

- cumulative estimated bytes。
- row number。

删除累计bytes超过10 MiB或row number>1000的rows。ID作为同timestamp稳定tie-breaker。

若最新单条日志自身超过10 MiB，它的cumulative已越界，会连自己一起删掉；严格cap优先于“至少保留最新一条”。这应在测试和产品声明中明确。

## 14. Estimated Bytes不是SQLite真实空间

估算包含：

- feedback body。
- level、target。
- module path、file。

不含Thread/process ID、timestamps、row/index/SQLite page overhead等。String `len()`按UTF-8 bytes，适合响应budget近似，但不是DB file size。

因此“每partition 10 MiB”指reader-visible content近似值，不能推导磁盘上限。

## 15. 全局Logs DB仍可能远大于10 MiB

上限是per Thread/per process：

```text
10 MiB × 活跃Thread数
  + 10 MiB × 近10天process incarnation数
```

没有global DB bytes cap。大量短命进程会各自获得threadless partition预算；大量Thread同理。

时间retention提供第二层限制，但10天内仍可增长很大。应再加global high-water mark与按价值/时间的全局淘汰。

## 16. Partition Prune只触达本Batch涉及的Partition

写入后先查本batch的Thread/process partitions是否超限，再做heavy window delete。这个优化避免每批扫描全表。

历史遗留超限partition若不再产生新log，不会被size prune；startup只做10天时间清理。通常无害，但repair/constraint升级后不能保证全库立即满足新cap。

需要独立maintenance cursor逐批修复旧partition，而不是把全表工作塞进foreground insert。

## 17. Startup只删除10天前Rows

StateRuntime初始化后best-effort：

1. 删除`ts < now - 10 days`。
2. 执行`wal_checkpoint(PASSIVE)`。

失败只warning，不阻止Runtime继续。PASSIVE不会等待活跃reader/writer，符合“不让日志维护阻塞前台”。

时间基于event自报ts；异常未来timestamp可能长期保留，异常过旧timestamp会在下次startup被删。

## 18. Incremental Auto-vacuum开启但没有看到主动Incremental Vacuum

DB open设置`auto_vacuum=Incremental`。代码搜索未发现`PRAGMA incremental_vacuum`调用；startup只有PASSIVE WAL checkpoint。

删除rows释放SQLite free pages，不一定把主DB文件空间归还OS。配置incremental模式只是准备条件，不执行回收。

磁盘治理需定期有界`incremental_vacuum(N)`，并把执行时机、耗时和剩余freelist暴露为maintenance telemetry。

## 19. 普通Query API没有默认Limit

`query_logs(LogQuery)`只在调用方提供limit时加SQL LIMIT；否则可把所有匹配rows加载为Vec。CLI backfill默认200，tail用after_id，但库API本身允许无界读取。

内部库也应设置hard max或stream pagination，不能完全依赖每个调用方自律。

## 20. ID Cursor适合Tail，但不是跨重建稳定Cursor

Logs client：

- 先倒序读取最近N条再正序展示。
- 记录max ID。
- 每500ms查询`id > last_id`。

SQLite AUTOINCREMENT在单DB内单调，非常适合live tail。DB fresh recovery、备份替换或migration重建后ID世代可能改变，长期cursor需绑定DB generation/path identity。

## 21. Filters全部参数化，避免SQL Injection

Level、time、thread、after ID、search和LIKE substrings都通过QueryBuilder bind。Module/file filters用`LIKE '%' || ? || '%'`，body search用`INSTR`。

参数化保护SQL语法，但leading wildcard不能有效利用普通index；大范围模糊搜索仍可能全表scan。Log检索需要deadline/limit与FTS策略，而不是仅确保安全。

## 22. Feedback导出先SQL粗预算，再做Exact Whole-line Budget

`query_feedback_logs_for_threads()`最大10 MiB：

1. SQL newest-first累计`estimated_bytes`，提前排除越界rows。
2. 每row格式化RFC3339 timestamp+level+body。
3. exact bytes累加，超限停止。
4. 最后reverse为chronological bytes。

双层budget避免加载整个over-retained partition，也保证输出不截断半行。

这是大文本导出的优质模式：storage估算做cheap pruning，最终序列化后再做exact cap。

## 23. Oversized Newest Row会让Feedback结果为空

SQL cumulative从最新开始。若第一条estimated body>10 MiB，它不满足cap；更旧rows的cumulative只会更大，也全部不满足。

这保持“输出必须是最新连续前缀”的语义，但会丢掉本可容纳的较旧诊断。另一种策略是单条truncation+marker，或跳过oversized row并记录omission；需明确产品选择。

## 24. Feedback会混入同Process的Threadless Logs

对每个requested Thread先找其最新non-null process UUID，然后把该process全部threadless logs一起纳入。

目的合理：crash、startup、network/auth等全局事件可能没有Thread ID，却对诊断有价值。

风险是一个process同时服务多个Thread时，threadless log可能包含其他用户/Thread相关内容。Process correlation不能替代tenant/privacy scope。

## 25. Threadless关联只取该Thread的Latest Process

若Thread跨多次resume运行于不同process，Feedback只加入最新process的threadless logs，旧process的全局错误不会被带上；Thread自身有ID的logs仍都保留。

这是控制导出体积与相关性的heuristic，不是完整因果图。更准确做法是每条threadless event显式记录关联Thread set或Run/execution ID。

## 26. Feedback Body字段替换是一次Schema兼容迁移

Migration把旧`message`列rename表后复制到`feedback_log_body`，重建indexes。Write path仍接受旧`LogEntry.message`作为fallback，Reader只读新列。

这是渐进迁移好例子：wire/caller旧字段可暂时兼容，storage/read语义先统一。长期应删除旧write-only字段，避免调用方误以为message与完整body是两个都持久的视图。

## 27. Logging的隐私边界早于Feedback Consent

即使用户最后拒绝上传Feedback，日志已经在本地DB保存最多10天/分区cap。Consent控制外发，不控制本地采集。

因此必须分别说明：

- local diagnostic collection。
- retention/delete能力。
- support upload selection。
- remote telemetry。

“上传前会询问”不能替代本地敏感数据最小化。

## 28. Log Delete与Thread Delete不是同一Transaction

Logs DB独立且thread_id没有外键到state DB。删除Conversation不会自动CASCADE日志；只能依赖time/partition retention或显式跨DB清理。

这会影响“删除我的数据”承诺。跨数据库删除应有可重试cleanup job和per-store receipt，不能只删主Thread row。

## 29. 专用Logs Client本身会初始化完整StateRuntime

CLI解析logs DB路径后取parent作为codex_home，调用`StateRuntime::init`，因此会打开/迁移state、logs、goals、memories等数据库，而不是只以read-only方式打开指定logs DB。

这增加诊断工具副作用和故障耦合：某个无关DB损坏会阻止查看logs。只读日志CLI应直接打开指定DB、禁migration，或提供显式repair mode。

## 30. 日志Target过滤仍可能出现双重桥接与重复

Layer专门忽略target=`log`，因为`tracing-log`桥接在outer filter前使用原target判断，单靠Targets无法可靠过滤。这是库生态组合产生的非直觉行为。

观测系统需要集成测试证明单event只入库一次，不能只看单个filter配置推断。

## 31. 对当前 AI SEO Agent 的迁移价值

当前NestJS Agent应先构建结构化RuntimeEvent/AgentStep，再决定哪些投影到日志。可借鉴：

```text
request path tracing
  -> non-blocking bounded sink
  -> batch persistence
  -> per tenant/run partition budget
  -> explicit dropped counters
  -> support artifact projection + consent
```

关键区分：

- AgentStep是用户可审计业务事实，不能因queue满丢弃。
- Debug log是best-effort诊断，可丢但必须计数。
- Provider usage/Tool receipt是计费与恢复事实，不能只存在日志。

## 32. 可验证的不变量清单

未来实现日志sink时可先写这些测试：

1. 普通log写入不阻塞Agent主循环。
2. Queue满时dropped count准确增加且不会递归日志风暴。
3. Flush receipt区分accepted、attempted、committed。
4. DB短暂失败有有界retry或明确loss metric。
5. Batch insert与retention prune对读者原子。
6. 单partition同时满足row与bytes cap。
7. Global DB也有明确磁盘high-water mark。
8. Oversized单行的保留/跳过/截断策略固定。
9. Debug/field redaction在本地落盘前执行。
10. Feedback导出不能混入其他tenant/Thread日志。
11. 导出严格bytes cap且不截断半条结构记录。
12. Delete Conversation最终清理所有日志投影。
13. Read-only诊断不会migration或写其他数据库。
14. DB recovery后tail cursor能检测generation变化。

## 33. 最终结论

Codex Local Log DB最值得学习的是把日志采集从Agent热路径剥离，并用bounded queue、batch、独立DB、写入事务内分区淘汰和双层导出预算控制资源。

当前实现的强项是non-blocking event admission、128/2秒批量flush、process incarnation ID、Thread/span归属、insert+prune原子性、10 MiB/1000行双cap、10天startup清理、parameterized query和whole-line Feedback预算；主要风险是queue/DB丢失完全静默、Flush不证明commit、无本地redaction、per-partition无global磁盘cap、incremental auto-vacuum未实际调用、普通query可无界、oversized最新日志清空导出、process级threadless日志可能跨Thread污染、Thread删除不级联，以及logs CLI为读日志却初始化全部可写DB。

对服务端Agent而言，日志是可丢的观测投影，不是Run事实仓库。只有先把恢复、计费、审批和Tool结果保存为typed durable facts，日志系统才能大胆采用best-effort低延迟策略而不破坏业务正确性。
