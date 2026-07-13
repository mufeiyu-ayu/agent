# Shell Snapshot 捕获、重放与恢复边界

Shell Snapshot 解决一个桌面 Agent 特有的问题：Codex 进程的环境变量通常不等于用户在交互式终端里看到的环境。用户的 `.zshrc`、`.bashrc`、alias、function、shell option 与 PATH 初始化可能只在 shell 启动时存在，而 Tool Runtime 又希望避免每条命令重复执行 login rc。

Codex 的方案是：在线程环境准备时启动一次用户 shell，把可重放状态写成脚本；后续匹配的 `shell -lc` 命令改写为“source snapshot，再执行原脚本”。

这个优化同时引入新的安全与一致性边界。Snapshot 不是普通 cache：它包含可执行 shell 代码和完整 exports，既可能保存 secret，也会影响 sandbox 内每条命令的真实语义。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/core/src/shell_snapshot.rs`
- `codex-rs/core/src/environment_selection.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/tools/runtimes/mod.rs`
- `codex-rs/core/src/tools/runtimes/shell.rs`
- `codex-rs/core/src/tools/runtimes/unified_exec.rs`
- `codex-rs/core/src/tasks/user_shell.rs`
- `codex-rs/core/src/shell_snapshot_tests.rs`
- `codex-rs/core/tests/suite/shell_snapshot.rs`
- `codex-rs/core/src/tools/runtimes/mod_tests.rs`

本文不把 Snapshot 等同于 Shell Environment Policy。前者捕获用户 shell 初始化后的状态，后者决定每次 Tool 进程允许继承、删除或覆盖哪些变量；两者会在执行前重新合成。

## 2. 一句话模型

```text
Thread environment selection
  -> resolve local environment + exact cwd + shell
  -> async launch login shell capture
  -> write temp snapshot
  -> source snapshot once for validation
  -> rename to generation path
  -> TurnEnvironment holds Arc<ShellSnapshotFile>
  -> matching command peeks ready snapshot
  -> wrapper sources snapshot best-effort
  -> restores live policy/proxy/PATH variables
  -> exec original shell -c script
```

Snapshot 是 Thread Environment 级、cwd-sensitive、进程内引用计数管理的可执行 cache。它不是每 Turn 重新生成，也不会持久恢复成下一次 Codex 进程的运行状态。

## 3. 生命周期与身份

### 3.1 Feature 与 Thread 绑定

Session 初始化时，如果 `ShellSnapshot` feature 开启，会创建包含以下配置的 factory：

- `$CODEX_HOME`；
- Thread ID；
- telemetry；
- 可选 State DB handle。

随后 `ThreadEnvironments` 根据选中的 Environment ID 和 cwd 解析环境。只有本地环境才会构建 Snapshot；remote Environment 直接返回 `None`。

### 3.2 文件身份

最终路径类似：

```text
$CODEX_HOME/shell_snapshots/<thread-id>.<unix-nanos>.sh
```

PowerShell 预留 `.ps1` 扩展，但当前 create 主链在 PowerShell/Cmd 上会拒绝，Windows 相关代码仍处于部分能力状态。

临时路径类似：

```text
$CODEX_HOME/shell_snapshots/<thread-id>.tmp-<unix-nanos>
```

时间纳秒是 generation suffix，避免同一 Thread refresh 时旧 Arc 的 Drop 删除新文件。测试也确认两次 create 生成不同路径，旧 snapshot drop 不影响新 snapshot。

它不是随机 nonce，也没有用 exclusive create。碰撞极不常见，但文件名本身不是安全身份。

### 3.3 Arc ownership

`ShellSnapshotFile` 被 `Arc` 持有。最后一个引用 Drop 时同步 `remove_file`。

优点：

- 环境 snapshot 仍被 Tool 使用时文件不会由本进程主动提前删除；
- Environment selection 替换或 Thread shutdown 后能自然清理；
- 不需要一个独立 active pointer。

局限：

- 进程崩溃不会执行 Drop；
- 其他进程的 cleanup 不知道这个 Arc；
- 文件若已被外部删除，Drop 只记录 warning；
- 文件内容被原路径替换时 Arc 不能提供 inode/content identity。

## 4. 构建时机与渐进可用

### 4.1 Environment resolve 后异步构建

环境 ready 后，代码创建 `TurnEnvironment`，启动 `shell_snapshot.build(...)` future，并把 shared future 存入环境。

如果 Deferred Executor feature 让 environment snapshot 非阻塞，Turn 可以先看到 starting environment。即使 Environment 已出现，Snapshot task也可能还没完成。

### 4.2 命令只 peek，不等待

Tool Runtime 调 `turn_environment.shell_snapshot(&cwd)` 时：

1. 要求 command cwd 与 environment selection cwd 完全相等；
2. 只 `peek()` shared future；
3. 未完成则返回 `None`；
4. 完成且成功才返回路径。

这意味着同一个 Turn 中：

```text
早期命令
  -> snapshot尚未ready，按原login shell执行

后续命令
  -> snapshot ready，改成source snapshot + non-login shell
```

能力会渐进启用，但 Tool spec、Turn context 和命令本身没有记录“本次实际用了哪个 snapshot generation”。复现同一命令时可能得到不同结果。

### 4.3 exact cwd gate

即使 snapshot 已完成，命令 cwd 只要是 selection cwd 的子目录也不会使用。这样避免把 cwd-sensitive rc 状态错误套到别的目录，但会导致：

- project root 命令和子目录命令的 shell 初始化路径不同；
- 同一 Tool 在 `cwd=A` 用 snapshot，在 `cwd=A/packages/x` 回退 login shell；
- 使用者很难仅凭命令文本解释 PATH 差异。

更完整的 receipt 应记录 `snapshotGeneration`、captureCwd 和是否实际 source 成功。

## 5. 捕获阶段实际执行了什么

### 5.1 Host 进程与 login shell

Capture 使用 shell 的 login exec args，在选中 cwd 启动真实子进程：

- stdin 设为 null，避免 rc 等待交互输入；
- stdout/stderr 由 `Command::output()` 完整捕获；
- Unix child 脱离 TTY；
- `kill_on_drop(true)`；
- 10 秒 timeout。

这发生在 Tool 执行之前，不经过该 Tool 的 Approval、Exec Policy 或 Sandbox Orchestrator。用户 rc 中的任意副作用会以 Codex host 进程权限发生。

例如 `.zshrc` 中的：

- 网络请求；
- credential helper；
- `direnv`/project hook；
- telemetry；
- 文件写入；
- 长生命周期后台进程；

都可能在 Environment selection 时被触发。

这是 Shell Snapshot 最大的 authority 边界：它为“复刻用户终端”主动执行了用户 startup code，但这个执行不属于模型请求的命令审批链。

### 5.2 各 shell 的 rc 语义

Zsh capture 会根据 `ZDOTDIR` 选择 `.zshrc`，存在且可读时显式 source。由于外层又是 login shell，其他 zsh login startup 文件也可能已经执行。

Bash capture 在 `BASH_ENV` 为空且 `.bashrc` 可读时显式 source；外层 login shell 也有自身 profile 语义。

Sh capture 在 `ENV` 指向可读文件时 source。

因此 Snapshot 不是对某个干净 `.zshrc` 文件的静态解析，而是一次真实 process execution 的结果。

### 5.3 捕获内容

POSIX Snapshot 依次输出：

- marker `# Snapshot file`；
- `unalias -a`；
- 所有 functions；
- 当前开启的 shell options；
- aliases；
- exported environment variables。

明确排除的 export 只有：

- `PWD`
- `OLDPWD`

排除这两个变量避免在 source 时把命令 cwd拉回捕获位置，但 API key、token、cookie、proxy credential 等其他 exports都会进入文件。

变量名会过滤为 POSIX-like identifier；多行 export 会被保留。

### 5.4 preamble strip

rc 可能向 stdout 打印 banner。Capture 会寻找第一个 `# Snapshot file`，丢弃此前内容。

优点是 rc 噪声不会让 snapshot 无法 source。风险是：如果 rc 提前输出相同 marker，strip 会从错误位置开始。用户本就控制 rc，但 parser 仍以一个普通字符串作为 framing delimiter，没有随机 correlation marker。

### 5.5 输出资源预算

Capture 有 10 秒 wall-clock timeout，但 `Command::output()` 会把 stdout/stderr 全量收进内存，源码没有统一 byte cap。

大量 functions、alias、exports 或 rc 输出可以在 10 秒内造成高内存和大 snapshot 文件。时间预算不能替代输出预算。

timeout drop 会请求 kill direct child；rc 启动的 detached/background descendants 是否全部收口，不由这个 handle保证。

## 6. 写入与校验事务

### 6.1 Temp 写入

Capture 完成后：

1. `create_dir_all(shell_snapshots)`；
2. `fs::write(temp_path, snapshot)`；
3. source temp 文件做 validation；
4. rename temp 到最终 generation path。

Temp + rename 避免 Tool 看到半写最终文件，这是优质的 publish 顺序。

### 6.2 Validation 的真实含义

Validation 用同一 shell、同一 cwd、非 login 模式执行：

```sh
set -e; . "TEMP_SNAPSHOT"
```

通过只证明脚本在当时能成功 source。它不证明：

- 捕获的 PATH/functions 与真实终端完全等价；
- source 后业务命令可执行；
- exports 未泄露 secret；
- 文件未被随后替换；
- sandbox 中有读取权限；
- shell options 适合所有后续脚本；
- snapshot 未超出合理大小。

Validation 本身又会执行 snapshot 中的顶层 shell 语句，因此这是第二次 host-side code execution。

### 6.3 失败语义

失败只分类为两个 telemetry reason：

- `write_failed`
- `validation_failed`

Build 返回 `None`，Thread 仍继续运行；命令自然回退原 shell 路径。Snapshot 是优化，不是启动硬依赖。

### 6.4 文件权限与 durability

当前写入没有显式：

- private `0600` mode；
- `O_NOFOLLOW`；
- exclusive create；
- file `sync_all`；
- directory fsync；
- content hash/signature。

权限依赖 `$CODEX_HOME` 父目录和进程 umask。由于文件含 secrets，不能只假设父目录通常是 private。

rename 提供 namespace 可见性原子性，不提供掉电 durability。

## 7. 命令改写条件

`maybe_wrap_shell_lc_with_snapshot` 只处理：

- 非 Windows；
- snapshot path存在；
- command 至少三个 argv；
- argv[1] 正好是 `-lc`。

不匹配则原样返回。

匹配时：

```text
original:
  original-shell -lc ORIGINAL_SCRIPT args...

rewritten:
  session-shell -c '
    capture live overrides
    source SNAPSHOT best effort
    restore live overrides/proxy/PATH
    exec original-shell -c ORIGINAL_SCRIPT args...
  '
```

两个变化容易被忽略：

1. 外层从 login `-lc` 变成 non-login `-c`；
2. 原命令最终也从 `-lc` 变成 `-c`，依赖 snapshot替代 login初始化。

这正是 Snapshot 带来性能收益的地方，也使 source 失败时的 fallback 语义值得警惕。

## 8. Source 是 best-effort

Wrapper 核心是：

```sh
if . 'SNAPSHOT' >/dev/null 2>&1; then :; fi
exec 'ORIGINAL_SHELL' -c 'ORIGINAL_SCRIPT'
```

source 错误被静默忽略，随后仍以 non-login shell执行原脚本。

如果 snapshot 在 wrapper生成后、子进程 source 前被删除或权限改变：

- 不会退回原始 `-lc`；
- 不会通知模型/用户 snapshot 失败；
- 命令可能丢失 PATH/function/alias；
- 结果与“从未有 snapshot”不同。

这是 exists-check 与 source 之间的 TOCTOU，也是 best-effort wrapper 的隐性降级。

更稳妥的设计可以：

- 预先打开只读 fd并从 `/dev/fd/N` source；
- 校验 inode/hash；
- source 失败则明确 exec 原始 `-lc`；
- 在 Tool receipt 中记录 `snapshot_applied=false`。

## 9. Environment precedence 合成

Snapshot 会覆盖 source 时同名的 live env。为避免陈旧状态破坏当前安全配置，wrapper 在 source 前捕获关键变量，source 后恢复。

### 9.1 显式 policy override

Shell Environment Policy 的 `set` 变量优先于 Snapshot。wrapper只把变量值暂存在 shell 变量中，不把 secret 值直接嵌进 argv；测试专门确认 override secret 不出现在 rewritten script字符串里。

### 9.2 Runtime identity

当前 live env 中的以下变量会被恢复：

- `CODEX_THREAD_ID`
- `CODEX_PERMISSION_PROFILE`

Permission profile 即使当前 absent，也会显式 unset，防止 snapshot复活旧 profile。

### 9.3 Proxy 与 Custom CA

Managed proxy variables、custom CA variables 和 macOS `GIT_SSH_COMMAND` 有专用恢复逻辑。它区分：

- 用户自己的 proxy；
- Codex 管理的 proxy marker；
- snapshot 中的旧 managed value；
- 当前 execution attempt 的 live value。

这很重要：Snapshot 是 Thread 早期状态，Managed Network Policy 却可能按当前 attempt变化。安全边界必须以后者为准。

### 9.4 PATH

顺序大致是：

```text
snapshot PATH
  -> explicit policy PATH override（如有）
  -> Codex package/zsh-fork runtime prepend
```

runtime prepend 会去重并过滤空 PATH entry，避免空 entry把当前目录隐式加入 executable lookup。

### 9.5 未显式列出的变量

Snapshot source 不会先清空整个 environment：

- snapshot 有同名 export：覆盖 live value；
- snapshot没有该变量：live value继续存在；
- 当前 live 已删除、snapshot仍有：变量可能被复活；
- 只有显式 override/identity/proxy/CA/PATH集合得到二次恢复。

这是一种 overlay，不是完整 environment replacement。安全审计必须关注“哪些 live variables 具有 snapshot-after precedence”。

## 10. Sandbox 与 Snapshot 的关系

### 10.1 Capture 在 host 上

Snapshot capture/validation 由 Core 直接启动 shell，不是 Tool Runtime 的 sandbox attempt。它继承 Codex host capability。

### 10.2 Replay 在命令 sandbox 内

后续 source 发生在实际 Tool command process中，因此受该 attempt 的 filesystem/network sandbox影响。Snapshot path 位于 `$CODEX_HOME`，sandbox若不允许读，source会失败并被静默吞掉。

### 10.3 Snapshot 不应成为权限载体

Snapshot 只应恢复用户 ergonomics，不应恢复权限事实。Codex 已经针对 permission profile、managed proxy和CA做二次覆盖，方向正确。

但 exports 中仍可能包含 cloud credentials。即使 Shell Environment Policy希望排除某 secret，若该 key不在显式 override集合而 snapshot捕获了它，source 可能重新引入。

是否真正发生取决于 `create_env` 与 policy set/exclude组合，但架构上应明确：Snapshot export 必须再次经过允许列表过滤，不能绕过当前 environment policy。

## 11. Staleness 与 Refresh

同一个 Environment selection（Environment ID + cwd）会复用已解析环境与同一个 Snapshot future。只要 selection 不变且 resolution没有失败，以下变化不会自动 refresh：

- `.zshrc` / `.bashrc` 修改；
- PATH manager切换；
- 新安装工具；
- login credential刷新；
- proxy/CA变化（关键字段在执行期覆盖，但其他env仍陈旧）；
- shell function/alias修改。

Snapshot generation 不绑定 rc 文件 mtimes、content hash、process env hash 或 shell binary identity。

“一个 Thread 环境稳定”是产品选择，但应让用户知道 reset/refresh边界。理想 receipt 至少包含：

```text
captured_at
shell_path + binary identity
capture_cwd
startup_files + digests
environment_policy_generation
snapshot_digest
```

## 12. Cleanup 与冷恢复

### 12.1 Drop 清理

正常 Thread shutdown/Environment replacement 依赖 `ShellSnapshotFile::Drop` 删除当前 generation。

### 12.2 启动式 stale cleanup

每次 build 都会后台扫描 `shell_snapshots`：

- 非普通文件跳过；
- 无法解析 session ID 的普通文件删除；
- 当前正在 build 的 session ID全部豁免；
- 找不到对应 rollout 的 snapshot删除；
- rollout mtime 超过 3 天的 snapshot删除；
- rollout metadata读取失败则保留。

清理使用 rollout age，而不是 snapshot自身 age。这个策略把 Snapshot 生命周期绑定 Thread 活跃度，但有几个边界：

- 没有后续 build，就不会触发 cleanup，crash文件可长期残留；
- 只豁免当前 build session，不知道其他进程活跃的 Thread；
- 另一个进程可能删除仍被 Arc 持有的 snapshot；
- future-dated rollout mtime可能长期阻止清理；
- cleanup与Drop/命令source之间没有filesystem lock。

### 12.3 Cold resume

Rollout 不保存“恢复并继续使用旧 snapshot”的 durable pointer。新 Session 会按当前环境重新 build新 generation。旧文件只作为待清理垃圾，而不是可信 checkpoint。

这是正确方向：可执行环境快照很容易陈旧，不应跨进程盲目恢复。

## 13. 失败顺序表

| 阶段 | 失败后状态 | 当前行为 |
| --- | --- | --- |
| Environment remote/无shell/非native cwd | 无snapshot | 继续，不启用优化 |
| rc/capture失败 | 可能已有rc副作用，无文件 | telemetry + fallback |
| capture超时 | direct child被kill，descendant不确定 | 无snapshot |
| 输出缺marker | 内存已有原始输出 | build失败 |
| temp写失败 | 可能有部分temp | cleanup/remove best effort |
| validation失败 | temp可能已执行一次 | 删除temp，fallback |
| final rename失败 | temp删除best effort | fallback |
| command早于snapshot完成 | snapshot未来可能ready | 本次原始`-lc` |
| wrapper生成后文件消失 | rewritten命令已固定 | source静默失败，仍用`-c` |
| snapshot内容被替换 | 路径仍存在 | source新内容，无hash核对 |
| policy/proxy变化 | snapshot陈旧 | 列出的live变量执行期恢复 |
| Drop删除失败 | secret脚本残留 | warning，等后续cleanup |
| 进程crash | 不执行Drop | 下次snapshot build才扫描 |

## 14. 值得学习的设计

### 14.1 Snapshot 是可选优化

构建失败不阻止 Thread工作，shell命令仍有原始路径。用户环境复刻不应成为 Agent基本可用性的单点故障。

### 14.2 Temp + validate + rename

先生成、再实际source验证、最后publish，避免半写脚本进入命令链。

### 14.3 Generation path + Arc Drop

每次refresh独立路径，旧引用释放只删除旧generation，避免固定文件名下的ABA。

### 14.4 Exact cwd 与 remote拒绝

不把host-native snapshot套到remote environment，也不把cwd-sensitive状态随意跨目录复用。

### 14.5 Live security env二次覆盖

Permission profile、managed proxy、custom CA和runtime PATH以后续attempt为准。Snapshot不能冻结安全状态。

### 14.6 Override secret不进argv

wrapper从进程环境捕获当前值再恢复，而不是生成带secret literal的command argv，降低process listing与telemetry泄露。

## 15. 不应照搬的风险

### 15.1 自动执行rc绕过Tool治理

Capture是host-side主动执行，应有独立trust gate、network policy和可观察receipt，不能只当内部缓存构建。

### 15.2 Snapshot明文保存完整exports

只排除PWD/OLDPWD远远不够。至少需要secret分类、private mode、短TTL、content encryption或只捕获允许列表。

### 15.3 无bytes/file budget

10秒timeout无法防止大stdout/stderr和大snapshot。需要capture stdout、stderr、function count、export count、file bytes上限。

### 15.4 Source failure静默改变shell模式

source失败后用`-c`不是原始语义。应回退`-lc`或把failure显式返回。

### 15.5 缺content identity

`exists()`后按路径source会受unlink/replace竞态。generation文件名不能证明内容没变。

### 15.6 渐进启用无receipt

同一Turn前后命令可能分别不用/使用Snapshot。复现与审计需要记录actual applied generation。

### 15.7 Cleanup不跨进程安全

当前session豁免只针对一次cleanup调用。共享CODEX_HOME需要全局lease或active manifest。

## 16. 映射到 AI SEO Agent

云端 NestJS Agent不应直接执行用户shell rc，但Snapshot教会我们如何处理“昂贵、可执行、会陈旧的环境准备结果”。类似场景包括：

- 浏览器登录session；
- Search Console/OAuth connector能力快照；
- crawler worker镜像与依赖环境；
- tenant Tool Registry generation；
- 网站抓取的robots/policy快照。

### 16.1 推荐抽象

```ts
type ExecutionEnvironmentSnapshot = {
  id: string
  tenantId: string
  environmentId: string
  generation: number
  capturedAt: string
  expiresAt: string
  sourceRevision: string
  policyGeneration: number
  contentDigest: string
  state: 'building' | 'ready' | 'invalid' | 'expired'
}

type SnapshotUseReceipt = {
  snapshotId: string | null
  expectedGeneration: number | null
  applied: boolean
  fallback: 'none' | 'live-environment' | 'clean-environment'
  policyGeneration: number
}
```

关键不是把环境全序列化，而是让每次 Run知道自己实际用了哪个generation，以及当前policy如何覆盖它。

### 16.2 Prepare-new-then-swap

对于长期worker环境，应：

```text
build immutable generation
  -> validate with health probe
  -> calculate digest
  -> atomically publish active pointer
  -> new Runs pin generation
  -> old Runs release lease后GC
```

这比固定路径覆盖或“先删除旧环境再构建新环境”更可恢复。

### 16.3 Snapshot不是authority

任何credential、tenant scope、permission、network allowlist都必须在use-time重新求交。Snapshot只保存性能相关的派生状态，不能携带过期授权。

## 17. 最小验证矩阵

### 17.1 Capture

- rc超时能终止整process group。
- stdout/stderr/file bytes超限明确失败。
- stdin不可继承。
- marker使用本次随机correlation。
- capture执行时network/FS capability符合独立policy。
- captured secret遵守分类与redaction。

### 17.2 Publish

- temp写入使用private mode与nofollow/exclusive create。
- validation通过后才publish。
- file+directory fsync顺序可测试。
- digest覆盖实际published bytes。
- collision不会覆盖已有generation。

### 17.3 Use

- exact cwd mismatch不使用。
- remote environment不使用host snapshot。
- source失败回退原始login语义并产生receipt。
- 文件被替换/digest不符拒绝source。
- policy、permission、proxy、CA、PATH以后续attempt为准。
- Tool result记录actual snapshot generation。

### 17.4 并发与Refresh

- 同selection并发build singleflight。
- rc/source revision变化创建新generation。
- 新generation失败时旧generation是否继续可用有明确策略。
- 旧generation迟到完成不能覆盖新active pointer。
- 同一Turn是否允许渐进切换必须显式定义。

### 17.5 Cleanup

- 多进程active lease保护在用generation。
- crash后GC有周期触发，不依赖下次build。
- future mtime不让文件永久保留。
- cleanup只删无lease且超TTL的known generation。
- Drop/GC/source竞态不产生静默non-login降级。

## 18. 推荐源码阅读顺序

1. 从 `environment_selection.rs` 看Snapshot task何时创建、为何shared和peek。
2. 阅读 `TurnEnvironment::shell_snapshot`，确认exact cwd和非阻塞语义。
3. 阅读 `shell_snapshot.rs::try_create`，画出capture→temp→validate→rename→Arc。
4. 分别阅读zsh/bash/sh capture script，列出真实保存的functions/options/aliases/exports。
5. 阅读 `maybe_wrap_shell_lc_with_snapshot`，逐行推导source前后environment precedence。
6. 对照 Shell/UnifiedExec/UserShell三个入口，确认相同wrapper如何复用。
7. 阅读runtime tests中的policy/proxy/CA/PATH/secret argv案例。
8. 最后阅读cleanup，区分Drop、本进程session豁免、rollout mtime与cold resume。

## 19. 结论

Shell Snapshot 的本质是把“用户终端初始化”从每次命令的隐式副作用，提升为一个可生成、验证、发布和复用的环境制品。它成功建立了：

- local environment限定；
- exact cwd限定；
- generation路径；
- temp/validate/rename；
- Arc ownership；
- policy/proxy/PATH use-time覆盖；
- 构建失败可降级。

但它仍缺少完整制品应有的四类证据：

```text
source identity
  哪些rc/进程env生成了它

content identity
  实际source的bytes是否仍是validated bytes

authority receipt
  capture和replay各自在哪个sandbox/policy下执行

use receipt
  某条命令到底是否应用了哪个generation
```

对于云端 Agent，最值得迁移的不是“保存一份shell脚本”，而是 immutable generation、prepare-before-publish、use-time policy overlay和explicit fallback receipt。任何环境缓存只要会改变执行语义，就应按可执行制品而不是普通性能cache治理。
