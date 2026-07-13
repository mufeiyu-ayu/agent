# SQLite Corruption Recovery：隔离损坏库、保留证据、重建投影与启动降级

本文研究 Codex App Server启动时如何识别本地SQLite损坏、只搬走故障数据库及WAL sidecars、创建fresh DB并从Rollout回填查询投影。重点是“自动修复”究竟恢复了哪些数据，哪些只是保留备份后重新开始。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. 先按故障域拆数据库

Codex在SQLite home声明五个runtime DB：

| 文件 | 主要职责 |
| --- | --- |
| `state_5.sqlite` | Thread metadata、spawn graph、jobs等查询状态 |
| `logs_2.sqlite` | 诊断日志 |
| `goals_1.sqlite` | Thread goals |
| `memories_1.sqlite` | memory生成/选择状态 |
| `thread_history_1.sqlite` | Paginated history预留存储 |

StateRuntime当前实际初始化并持有前四个pool；`thread_history` 路径和migration已声明，但注释说明未来由paginated history projector接管，当前init还未打开它。

分库能减少锁竞争，也能让logs损坏时只替换logs，而不是同时丢掉Thread metadata和goals。它也意味着恢复必须按DB说明数据可重建性，不能笼统说“SQLite已恢复”。

## 2. 每个Pool顺序打开，失败时关闭已打开Pool

`StateRuntime::init_inner()` 依次：

1. 创建SQLite home目录。
2. open/migrate state。
3. open/migrate logs。
4. open/migrate goals。
5. open/migrate memories。
6. 检查backfill singleton row。
7. 查询Thread最大updated/recency时间，初始化进程内monotonic counters。
8. 运行logs startup maintenance。

中间任一必需步骤失败，会关闭之前已打开的pool再返回error。Logs maintenance失败只warning，不阻止runtime可用。

这是合理的“核心schema/基线fail-closed，清理维护best-effort”分级。

## 3. SQLite配置表达性能与持久性折中

每个普通runtime DB使用：

- WAL journal mode。
- synchronous Normal。
- busy timeout 5秒。
- pool max connections 5。
- 新DB incremental auto-vacuum。

WAL与分库降低读写互斥；Normal比Full更偏性能，在系统掉电场景不提供最强同步保证。Recovery设计因此主要处理SQLite报告的结构损坏，不等同于防止最近事务在突然断电时丢失。

## 4. 错误必须是SQLite corruption，不靠字符串猜路径

`is_sqlite_corruption_error()` 遍历anyhow error chain，只检查 `sqlx::Error::Database`：

- code 11 / 26。
- `sqlite_corrupt` / `sqlite_notadb`。
- 典型message如database disk image is malformed、file is not a database。

`database locked/busy` 单独分类，不当作corruption。测试还验证路径名里包含 `sqlite_corrupt` 而真实错误是permission denied时不会误判。

这是重要安全边界：不能因为任意error text含“corrupt”就自动移动用户数据库。

## 5. RuntimeDbInitError 保留故障库路径

Open/migrate error被包装为：

- DB label。
- operation：open或migrate。
- exact path。
- source error。

App Server用 `runtime_db_path_for_corruption_error()` 从typed wrapper提取具体数据库路径。若error是corruption但没有wrapper，则fallback到state DB路径；当前post-init必需查询都发生在state pool，因此这个兜底有上下文依据。

精确路径让恢复可以只处理失败库，不需要清空整个SQLite home。

## 6. App Server 的恢复循环支持多个损坏库

启动函数执行：

```text
try_init
  -> corruption?
  -> backup failed DB + sidecars
  -> retry full init
  -> next DB corruption?
  -> backup next DB
  -> retry
  -> success + notice
```

`attempted_backups: HashSet<PathBuf>` 防止同一路径反复失败导致无限循环。若同一DB被搬走后fresh init仍在同路径报错，启动返回明确失败。

因此多个库同时损坏时可以逐个隔离；每次都从头初始化，确保之前新建的DB与其migration也通过验证。

## 7. Backup 同时移动 main、WAL 与 SHM

对一个DB，backup候选为：

- `database.sqlite`。
- `database.sqlite-wal`。
- `database.sqlite-shm`。

存在的文件用rename移入 `db-backups/sqlite-{unixSeconds}-{sequence}/`。Backup目录通过atomic `create_dir`与sequence冲突重试生成，避免同秒命名覆盖。

把sidecars和main file作为同一故障单元是必须的；只搬main留下旧WAL，新fresh DB可能遇到不匹配的日志状态。

## 8. SQLite home本身是文件时也可自愈

若配置的SQLite home path被普通文件占据：

1. 在其parent下创建 `{homeName}.db-backups/sqlite-*`。
2. 把整个blocking file移入backup。
3. 创建正确目录。

这不是SQLite corruption，但属于可安全识别的filesystem shape错误，所以App Server也进入fresh-start流程。测试覆盖了该路径。

## 9. Backup 是保全证据，不是数据恢复事务

`backup_runtime_db_for_fresh_start()` 逐个rename现有文件，没有：

- 复制后checksum验证。
- backup manifest/schema version。
- 多文件atomic transaction。
- 中途失败rollback。
- fsync backup directory。

如果main rename成功而WAL rename失败，函数返回error，可能留下partial backup。App Server会停止启动，不会假装成功，这是fail-closed；但人工恢复需要从日志和目录自行判断文件集合。

更完整的实现应先写manifest、移动到staging目录、验证集合，再原子发布backup receipt。

## 10. Fresh Start 不等于所有数据都可回放

成功backup后，下一次init因 `create_if_missing=true` 创建空DB并跑migration。

对 `state_5.sqlite`：Thread metadata主要是Rollout的查询投影，startup backfill可以从session JSONL重建大量内容。

但其他库的数据性质不同：

- logs通常是辅助诊断，丢失后不会从Rollout完整重建。
- memories可能是派生状态，但当前恢复流程没有立即从backup或Rollout自动还原全部job/result。
- goals有独立DB，虽然Rollout可能保存部分goal event，也不能据此推断完整accounting状态自动恢复。
- thread history当前未由StateRuntime init打开，无法在这条启动链检测/重建。

因此用户提示“rebuild from saved data”应理解为fresh store + 各子系统后续重建能力，而不是backup内容已自动导回。

## 11. State Backfill 是恢复后的启动门

`rollout::state_db::try_init()` 在StateRuntime成功后还要通过backfill gate：

- singleton row状态Pending/Running/Complete。
- worker用SQL条件更新抢lease。
- non-expired Running不能被第二worker抢占。
- stale lease可接管。
- worker保存last watermark checkpoint。
- Complete后永久不再claim。

启动者最多等待30秒，每秒poll；超时关闭runtime并返回error。测试验证并发worker完成时第二启动者会等待并成功，stuck worker会有限超时。

Fresh state DB刚创建后正是通过这条路径从Rollout扫描恢复查询metadata。

## 12. Backfill gate防止半投影被当完整数据库

如果没有gate，App Server可能在只扫描到一半Rollout时开始用SQLite提供Thread List，导致旧Thread暂时消失、cursor排序变化或archive状态不完整。

当前做法要求startup init只在backfill Complete后返回handle。非owner进程等待lease owner，不自己并行重复扫。

这比“后台慢慢补，列表先凑合用”一致性更强，但也让大量Rollout/慢磁盘直接增加启动时延。30秒后是失败，不是降级到partial DB。

## 13. 不同入口的失败策略不同

- App Server主启动：使用 `try_init`，对corruption自动backup+fresh start；其他DB错误最终让App Server启动失败。
- Core通用 `state_db::init`：捕获init/backfill error，warning后返回None，允许依赖JSONL的部分功能降级运行。
- `get_state_db`：只做optional read，不运行backfill；DB不存在/error/backfill未Complete都返回None并记录fallback metric。

这体现“产品入口决定availability policy”。同一个StateRuntime错误，服务端API可能fail startup，本地核心调用可能继续走filesystem fallback。

## 14. 恢复结果会成为用户可见Warning

App Server只有在重新init最终成功后才构建 `SqliteRecoveryNotice`，包含：

- 原database path。
- backup folder。

同时写warning日志，并作为ConfigWarning notification发客户端。若tracing尚未设置，还直接写stderr，避免恢复动作静默发生。

这是好设计：自动移动用户数据必须可见、可定位、可人工取回。只是路径属于本机敏感信息，若warning被上传到远端support系统还需redaction策略。

## 15. Migration 兼容与Corruption恢复分开

Runtime migrator设置 `ignore_missing=true`，允许旧Codex二进制打开已被新版本应用更高migration version的DB；已知migration仍校验checksum，只放宽“DB比当前二进制更新”。

另有一次精确repair：历史上recency migration误用version 38时，只有checksum匹配目标migration且version 39不存在，才把migration record更新为正确version/description。

这两者都不是corruption fresh start：

- forward-version tolerance保留数据。
- known migration metadata repair保留数据。
- 只有SQLite明确报告损坏才移动DB。

避免把所有migration error都粗暴归类为“删库重建”。

## 16. Integrity Check 是诊断能力，不是启动前全扫

State crate暴露 `sqlite_integrity_check(path)`：

- read-only打开existing DB。
- 单connection。
- 执行 `PRAGMA integrity_check`。
- 返回所有结果行。

正常init并不会对每个DB先跑完整integrity check；它依赖open/migrate/post-init query暴露corruption。这减少启动成本，但潜在坏页若暂时未读到，可能在运行中后续查询才暴露，而自动fresh-start流程只在App Server启动阶段。

运行期corruption需要明确策略：停止该store、进入只读/fallback、提示重启修复，不能让每个业务query自行移动活跃DB。

## 17. 恢复缺少跨进程Fencing

Recovery loop的 `attempted_backups` 只在当前进程内。Backup目录创建防止命名冲突，但没有看到围绕“移动这个DB及sidecars”的专用跨进程lease/fencing token。

Unix socket transport启动时有App Server startup lock，但其他transport/另一个旧进程仍可能持有同一SQLite inode。一个进程rename文件并创建fresh DB时，另一个进程可能继续写已打开的旧文件，形成split storage。

真正多进程安全的fresh start应：

- 获取SQLite-home恢复锁。
- 确认所有pool已关闭/owner lease过期。
- 写recovery generation。
- backup并发布新generation。
- 旧进程发现fencing token变化后停止写。

## 18. Backup 没有Retention与隐私生命周期

恢复成功后backup永久保留；当前代码没有：

- 总bytes cap。
- 过期清理。
- 加密/访问权限校正。
- 上传support前consent。
- 用户确认后删除。

保留原始损坏库有助debug和人工恢复，也可能包含完整日志、memory、目标、路径和用户内容。Recovery设计必须与privacy/retention一起评审。

## 19. 更适合云端Agent的恢复分层

云端PostgreSQL不应照搬“rename本地DB”，但应复制故障域与事实优先级：

```text
canonical Run/Step/Event tables      -> 不能自动丢弃，需备份/恢复/只读
query/search projections             -> 可按checkpoint重建
telemetry/log partitions             -> 可按retention丢失，需告警
derived memory/evaluation artifacts  -> 可重算但要记录generation
```

恢复receipt至少包含：

```ts
type RecoveryReceipt = {
  recoveryId: string;
  store: string;
  reasonCode: string;
  detectedAt: string;
  backupArtifactId?: string;
  canonicalCheckpoint?: string;
  projectionRebuiltTo?: string;
  dataLossClass: "none" | "derived-only" | "unknown" | "canonical";
};
```

## 20. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Classification | SQLite 11/26、message、lock/busy、permission denied、path含corrupt |
| Targeting | state/logs/goals/memories各自失败，只备份目标库 |
| Sidecars | main-only、WAL/SHM、sidecar rename中途失败、partial manifest |
| Multi-corruption | 两个库连续损坏、同一路径再次失败、恢复循环有界 |
| Blocking path | SQLite home是文件、parent无权限、备份目录冲突 |
| Rebuild | state backfill完整、logs/goals/memories数据损失分类 |
| Backfill | 并发lease、stale takeover、checkpoint、30秒timeout、超大Rollout集 |
| Migration | newer version、known checksum mismatch、legacy 38→39 repair |
| Runtime | 启动后才读到坏页、只读降级、提示重启、禁止活跃库被移动 |
| Concurrency | 两个进程同时恢复、旧pool仍写、fencing generation |
| Notice | 成功后才通知、路径redaction、backup位置准确 |
| Retention | backup bytes cap、过期清理、用户导出/删除、support consent |

## 21. 对当前项目的学习结论

当前AI SEO Agent使用PostgreSQL，最值得迁移的不是SQLite文件操作，而是：

1. canonical数据与可重建projection分级。
2. 不同子系统分故障域和恢复SLO。
3. corruption/schema/lock/permission错误分类，不混为一谈。
4. 自动恢复先保全证据，再重建，不静默删除。
5. backfill有lease、checkpoint、Complete gate和有限等待。
6. 恢复结果返回data-loss classification与用户可见receipt。

Codex 最值得学习的是多DB隔离、typed error path、只备份目标DB及WAL/SHM、多损坏库有界循环、blocking path恢复、成功后warning、migration兼容与corruption分轨、backfill lease/checkpoint/gate和optional filesystem fallback。需要改进/避免的是backup多文件非原子且无manifest/fsync、fresh start文案未细分不可重建数据、运行期corruption无同等自动流程、thread history DB声明与init ownership尚未接通、恢复缺跨进程fencing，以及backup无retention/privacy生命周期。
