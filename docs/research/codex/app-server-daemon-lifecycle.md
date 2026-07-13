# App Server Daemon 生命周期：PID Generation、Control Socket、Graceful Restart与Updater供应链

本文研究 Codex 实验性`app-server daemon`如何在Unix机器上启动长期后台App Server、串行化生命周期命令、识别PID复用、验证Control Socket readiness，并由独立Updater下载新版本后重启。重点是后台进程“已经spawn”与“协议可用”、PID与进程身份、设置写入与进程切换、自动更新与供应链信任之间的边界。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/app-server-daemon/src/**`、`codex-rs/app-server-transport/src/transport/unix_socket.rs`、`codex-rs/app-server-daemon/README.md`

## 1. Daemon是独立Lifecycle Controller，不是App Server内部模式

Daemon crate负责：

```text
CLI lifecycle command
  -> per-CODEX_HOME operation lock
  -> persisted settings + PID backend
  -> detached managed Codex process
  -> Unix control socket protocol probe
  -> structured lifecycle output
```

真正的Agent runtime仍在`codex app-server --listen unix://`进程。Lifecycle controller可以失败、退出或升级，而长期server继续运行。

这种拆分比让后台服务自己接受“杀死/替换自己”的命令更易测试和恢复。

## 2. 当前只支持Unix PID Backend

实现依赖：

- `flock`。
- Unix signals/process groups。
- `setsid`。
- Unix domain socket。
- `ps`读取process start time。

Windows直接返回unsupported。README明确contract仍experimental。

跨平台daemon不应通过大量`cfg`假装相同；Windows需要Service/Job Object/Named Pipe等独立backend语义。

## 3. 所有本地状态按CODEX_HOME隔离

`CODEX_HOME/app-server-daemon/`保存：

- `settings.json`。
- `app-server.pid`。
- `app-server-updater.pid`。
- `daemon.lock`。
- 各PID reservation lock与stderr log。

Control socket位于独立`app-server-control/`目录。

不同CODEX_HOME可运行不同daemon，不共享lock/PID/settings。若它们最终竞争同一外部remote identity或Keyring，则还需更高层coordination。

## 4. Mutating Lifecycle命令用全局Operation Lock串行

Start、Restart、Stop、Bootstrap、enable/disable remote control都先获取`daemon.lock`独占flock：

- 每50ms重试。
- 最长75秒。
- lock file descriptor生命周期即ownership。

Version/probe是只读，不取operation lock。

这防止两个CLI同时stop/start；75秒大于普通start 10秒，但Stop grace可到70秒，留出的margin很小，慢filesystem/diagnostics可能让等待者timeout。

## 5. PID Backend还有第二层Reservation Lock

每个PID file有`.pid.lock`，只保护该backend的start/pid record发布。Global operation lock保护Daemon API，reservation lock还防Updater或其他直接backend调用并发。

双层锁职责不同：

- daemon.lock：业务操作序列。
- pid.lock：进程记录创建/清理原子性。

Updater使用try-lock global operation；Busy时50ms重试，避免与用户生命周期命令交错替换进程。

## 6. Empty PID File表示“Startup Reservation”

Start在reservation lock下用`create_new`创建空PID file，再spawn。其他观察者看到：

- 空文件且lock仍被持有：Starting。
- 空文件且lock可取得：stale reservation，删除。
- JSON完整：Running candidate。

这把“正在创建record”建模成显式中间态，避免把短暂空文件当corruption或NotRunning。

## 7. PID Record绑定Process Start Time防PID ABA

Record为：

```json
{"pid":1234,"processStartTime":"..."}
```

判断active时同时：

1. `kill(pid, 0)`确认进程存在/无权限但存在。
2. `ps -p PID -o lstart=`读取启动时间。
3. 与record精确比较。

OS复用旧PID时start time不同，不会误杀无关进程。这是PID lifecycle最重要的fencing。

依赖外部`ps`和locale格式仍较脆弱；Linux可读`/proc/<pid>/stat`starttime，macOS可用更typed系统API。

## 8. Spawn后先取得Identity，再发布PID Record

启动顺序：

1. 创建空reservation。
2. 打开并truncate stderr log。
3. `setsid`后spawn managed binary。
4. 读取child process start time。
5. 写固定temp PID JSON。
6. rename替换空PID file。
7. 释放reservation lock。

读取identity或写record失败会terminate child并清理文件。不会留下“已运行但完全无owner record”的正常成功路径。

Temp+rename优于直接写PID，但仍未看到fsync，断电durability不是保证。

## 9. Detached Process关闭Stdin/Stdout并保留Stderr文件

Child：

- stdin `/dev/null`。
- stdout `/dev/null`。
- stderr写PID旁的log。
- 新session via `setsid()`。

每次start truncate旧stderr，启动失败时最多读取尾部4096 bytes加入错误context，并尽量从下一条完整line开始。

日志没有轮转/累计，但可能包含路径、配置错误或secret，应限制文件permissions和最终错误外显范围。

## 10. Spawn成功不等于Start成功

Daemon最多10秒、每50msprobe control socket。只有完整完成：

```text
Unix connect
  -> WebSocket upgrade
  -> JSON-RPC initialize
  -> matching response
  -> initialized notification
  -> parse app-server version
```

才返回Started。Probe整体有2秒timeout。

这是正确readiness：端口/文件存在只证明listener创建，协议initialize成功才证明客户端能用。

## 11. Readiness失败不会自动Stop刚Spawn的Process

`start_managed_backend()`成功后若`wait_until_ready()`超时，当前`start()`直接返回错误，源码路径未在这里显式调用backend.stop。PID record仍可让下一次Start发现“starting or running”并再次等待。

保留进程可能让慢启动最终自愈，也可能留下永远不ready的daemon。应定义失败策略：

- readiness deadline后terminate并返回rolled-back。
- 或返回`Starting/NotReady`状态与后续status API。

单纯Error让调用方不知道进程是否仍活着。

## 12. Start是幂等的，但Foreign Socket处理偏宽松

Start先probe socket；只要协议probe成功，就返回AlreadyRunning，并尝试报告running backend，可能为None。它不会像Restart/Stop那样拒绝“socket上是非daemon管理实例”。

Restart/Stop遇到probe成功但无managed PID明确报错，避免杀死他人进程。

Start的宽松语义适合作为“ensure service exists”，但返回状态应明确`managed=false`，否则调用者可能误以为后续daemon stop/upgrade可控制它。

## 13. Control Socket依赖Filesystem Authority

Unix listener启动时：

- 创建/校验private parent directory。
- socket已有live connection则AddrInUse。
- connection refused且确认是stale socket才删除。
- 普通非socket path拒绝覆盖。
- bind后chmod 0600。
- acceptor Drop guard删除socket file。

没有额外Bearer auth；本机访问权来自private directory与0600 socket。这对单用户桌面合理，前提是目录创建与所有权校验可靠。

## 14. App Server还有独立Startup Lock

App Server Unix startup先取得`app-server-startup.lock`，prepare socket path、初始化DB/配置，直到listener启动后才释放。即使绕过Daemon直接启动两个App Server，它们也不会同时清理/绑定同一control socket。

Daemon operation lock与App Server startup lock跨进程分层防护，避免生命周期controller之外的入口破坏不变量。

## 15. Stop先Graceful，再Force

PID backend：

- 先SIGTERM。
- 每50ms检查pid+start time。
- 60秒仍活跃则SIGKILL。
- 总deadline 70秒。
- 进程结束后在reservation lock下只删除仍匹配expected record的PID file。

Start-time fencing保证PID在等待期间被复用时不会删除/杀错新进程。

App Server force只kill PID，不kill整个session/process group；其child helpers可能继续残留。Updater force则kill process group。

## 16. Restart拒绝接管非Daemon实例

若control socketready但PID backend没有active record，Restart/Stop返回：running but not managed。它不会通过socket反查PID后强行接管。

Ownership优先于便利性：能连上服务不等于有权杀它。要接管需显式迁移/关闭原实例，而不是猜process identity。

## 17. Settings是Launch Intent，不是Running Fact

当前setting只有`remoteControlEnabled`。Enable/Disable：

1. 读旧settings。
2. 相同则返回Already*。
3. 保存新settings。
4. 若daemon运行，stop+start使其立即生效。

Settings direct `fs::write`，没有temp rename；parse失败会阻止后续操作。更关键的是保存成功、restart失败时，新intent已持久但running process可能停止/仍旧。

响应应区分`desired setting committed`与`running generation reconciled`。

## 18. Bootstrap是多步跨进程Operation

Bootstrap：

1. 校验managed standalone binary存在。
2. 持久settings。
3. stop现有managed server。
4. start新App Server。
5. stop旧Updater。
6. start新Updater。
7. 等App Server ready。
8. 返回versions与paths。

任何中间失败都可能留下partial state；没有transaction rollback。它更像可重试reconciliation，应在每一步读取current state，而不是承诺全有或全无。

## 19. Lifecycle输出是机器可解析Receipt

成功命令stdout恰好一个JSON object，包含：

- status。
- backend/PID。
- managed binary path/version。
- control socket path。
- CLI version。
- running app-server version。

路径与双版本对远程诊断非常有价值：执行命令的CLI不一定等于后台实际binary。

缺少operation ID、startedAt、process start identity和settings generation，无法把后续日志精确关联到某次restart。

## 20. Running Version来自协议User-Agent，不是Binary Hash

Probe从InitializeResponse `user_agent`中取第一个`originator/version`片段。Managed version则执行binary `--version`。

版本相等不证明bytes相等；Updater另用SHA-256 full binary identity判断自身与managed binary是否一致。

Readiness receipt最好同时返回build hash/installation identity，避免不同构建共享semver。

## 21. Updater不是系统服务，也不跨Reboot

Bootstrap另起pid-managed updater：

- 初始等待5分钟。
- 之后每小时运行一次。
- SIGTERM只让循环在select检查点退出。
- Reboot后不会自动恢复，需再次bootstrap。

因此`auto_update_enabled=true`表示当前Updater process已启动，不是持久OS级开机自启保证。

产品文案必须区分process-live与reboot-persistent。

## 22. Update直接下载并执行Remote Shell Script

每轮：

```text
GET https://chatgpt.com/codex/install.sh
  -> read full bytes
  -> /bin/sh -s via stdin
  -> discard stdout/stderr
  -> wait exit
```

在这一层未看到script bytes cap、下载/child deadline、signature/hash pin或内容审计；信任主要依赖HTTPS endpoint与installer内部逻辑。

这是最高风险供应链路径之一。至少应下载signed manifest/artifact、验证签名与version policy，再执行固定本地installer逻辑。

## 23. Update错误在主Loop中被静默吞掉

`update_once()`返回Err时loop分支不记录内容，随后等待下一小时。Install stdout/stderr也被丢弃。

自动更新best-effort不应打扰Agent，但完全无health会让长期失败不可见。应保留last attempt、last success、error category、next retry并使用有界backoff。

## 24. Update Step不响应Terminate Cancellation

SIGTERM通过Tokio signal stream处理，但`install_latest_standalone().await`内部download、write、child wait没有与terminate做select。若网络或script挂起，Updater可能长期不退出，也没有内部timeout。

持有信号handler后OS默认终止不再自动发生；每个长I/O都要接受cancellation/deadline。

## 25. Binary Identity用Full SHA-256，代价是整文件读内存

Updater计算当前executable与managed binary SHA-256；不同则：

- 强制重启running App Server。
- readiness成功后`exec` managed binary替换Updater自身。

先保证新App Server可用，再替换Updater，是优质升级顺序。

实现用`fs::read`整binary，缺文件size cap/stream hash；普通Codex binary可控，但被异常替换成巨大文件会造成内存压力。

## 26. 没有Running App Server时Updater不会Reexec自身

Managed binary改变但App Server NotRunning时，`try_restart_if_running`返回NotRunning；`should_reexec_updater`只对Restarted为true。

所以旧Updater继续运行到下轮，仍可安装/尝试；直到某次成功重启App Server才切换自身。这个顺序保守，但意味着Updater实现本身的安全修复不会在server停机期间立即生效。

## 27. Updater锁竞争会高频50ms重试

若用户生命周期操作持有daemon lock，Updater返回Busy后50ms再试，直到成功或收到terminate。长Stop最长70秒会产生大量poll。

可以用blocking flock/notify或指数backoff降低无意义wakeups；同时保持terminate可响应。

## 28. Managed Path是固定Authority

所有Daemon start/restart使用：

```text
CODEX_HOME/packages/standalone/current/codex
```

不会启动当前PATH中的任意`codex`。这避免用户在不同shell/PATH下控制到不同binary。

`current`可能是symlink；Updater使用canonicalized path计算identity，而Daemon spawn使用managed path。安装切换应保证symlink替换原子。

## 29. Stderr Log只保留上一代Startup诊断

每次start truncate固定stderr log，因此成功运行期间stderr会持续增长到下次start；下次启动又清空旧代。没有size cap/rotation。

Readiness失败错误只附最后4KiB，有输出预算；磁盘文件本身仍可能被长期高频stderr写爆。Daemon log同样需要rotation/global cap。

## 30. Control Socket Connection不等于远程Control已Connected

`ensure_remote_control_ready()`先确保local daemon started，再通过local control socket启用remote control并返回remote connection status、server name、environment ID与timed_out。

本地App Server ready与remote relay connected是两个阶段；结构化输出保留二者，不能把daemon Started等同于手机/桌面远端已经可访问。

## 31. 对当前 AI SEO Agent 的迁移价值

云端NestJS部署通常交给systemd/Kubernetes，不应复制PID daemon。但可直接学习：

```text
desired deployment generation
  -> exclusive rollout controller
  -> spawn/start
  -> protocol readiness
  -> traffic switch
  -> drain old generation
  -> structured rollout receipt
```

在Agent内部后台Job同样要区分：

- row已创建。
- worker进程/任务已启动。
- dependency ready。
- generation已接管新流量。
- 旧generation已drain。

不要只用一个`running=true`覆盖所有阶段。

## 32. 可验证的不变量清单

未来实现后台worker/daemon时可先写这些测试：

1. 并发Start只有一个spawn，其他返回同generation。
2. PID复用不会误判或误杀无关进程。
3. Empty reservation在owner死亡后可回收。
4. Start只有协议readiness成功才返回Started。
5. Readiness失败后进程存活/回滚语义明确可查询。
6. Foreign service绝不会被Stop/Restart接管。
7. Settings提交与running reconciliation分别有receipt。
8. Graceful deadline后force kill仍绑定原process generation。
9. Control socket stale cleanup不覆盖普通文件/live socket。
10. Update artifact有size/deadline/signature验证。
11. Update失败可观测且不会破坏当前running binary。
12. 新App Server readiness成功后才切Updater/traffic。
13. Updater cancellation能中止download与installer child tree。
14. Reboot persistence能力与实际service manager事实一致。

## 33. 最终结论

Codex App Server Daemon最值得学习的是：后台生命周期由多个独立identity和barrier组成——operation lock、PID reservation、PID+start time、socket path、protocol readiness、binary version/hash、remote connection status。任何一个布尔“是否运行”都不足以表达真实状态。

当前实现的强项是全局+PID双锁、空reservation中间态、PID start-time fencing、temp PID publish、协议级readiness、foreign process不接管、60秒grace/70秒stop、private 0600 Unix socket、双版本结构化receipt和App Server先成功再reexec Updater；主要风险是readiness失败不明确清理child、Start对foreign ready socket返回AlreadyRunning、settings/bootstrap跨步骤partial commit、无operation generation、自动更新执行远程shell且无size/deadline/signature、update错误静默、terminate不打断在途install、旧Updater停机时不自更新、stderr无rotation，以及App Server force kill不清child process group。

对服务端Agent而言，进程管理通常应交给平台；但“先验证新generation可用，再宣布切换成功”的思想必须进入Agent Run、Tool worker和所有后台任务的状态设计。
