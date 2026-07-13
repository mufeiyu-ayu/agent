# Exec Process启动、环境合成、TTY控制与Sandbox终态

Codex的Exec Process不是“远程执行一条command然后返回stdout”。它把一次进程运行拆成：

- client-chosen逻辑Process ID；
- target-host环境变量合成；
-portable Sandbox与Managed Network intent；
- Pipe或PTY启动；
-stdin写入、Interrupt与Terminate控制；
-stdout/stderr/PTY共享序号事件；
-retained read与live subscription双消费面；
-Exited与Closed分离；
-短期断线恢复和ambiguous start补偿。

前一篇Exec Server Session专题已经研究连接恢复和output replay，本文重点补足**进程如何被准备、启动、控制和判定终态**，以及这些能力如何从Unified Exec映射到remote executor。

## 1. 证据范围

本文基于Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/exec-server-protocol/src/process_id.rs`
- `codex-rs/exec-server-protocol/src/protocol.rs`
- `codex-rs/exec-server/src/process.rs`
- `codex-rs/exec-server/src/local_process.rs`
- `codex-rs/exec-server/src/remote_process.rs`
- `codex-rs/exec-server/src/process_sandbox.rs`
- `codex-rs/exec-server/src/client.rs`
- `codex-rs/exec-server/src/client_recovery.rs`
- `codex-rs/exec-server/src/server/process_handler.rs`
- `codex-rs/exec-server/src/server/handler.rs`
- `codex-rs/exec-server/src/rpc.rs`
- `codex-rs/exec-server/src/telemetry.rs`
- `codex-rs/utils/pty/src/pipe.rs`
- `codex-rs/utils/pty/src/pty.rs`
- `codex-rs/utils/pty/src/process.rs`
- `codex-rs/core/src/unified_exec/process_manager.rs`
- `codex-rs/core/src/tools/sandboxing.rs`
- `codex-rs/core/src/tools/orchestrator.rs`

## 2. ExecParams是一份Target-host Launch Intent

协议字段：

```text
processId
argv
cwd: PathUri
envPolicy?
env overlay
tty
pipeStdin
arg0?
sandbox?
enforceManagedNetwork
managedNetwork?
```

它不包含OS pid。`processId`只是connection/session scope内的逻辑protocol key。

## 3. Process ID与OS PID严格分离

`ProcessId`是一个无验证的String newtype：

-可clone/hash/order；
-协议透明序列化；
-不暴露OS pid；
-remote恢复和Tool控制都用它定位进程。

Core Unified Exec对普通process常用数字ID字符串；sandbox retry会生成：

```text
<unified-process-id>-<uuid>
```

原因是一次Tool逻辑process ID下的不同sandbox attempt必须是不同executor process，避免旧attempt的迟到事件污染新attempt。

## 4. Process ID当前缺少输入预算

`ProcessId::new`与server start没有检查：

-空字符串；
-最大bytes；
-字符集；
-日志控制字符；
-跨session全局唯一性。

重复ID只在当前Session process map内拒绝。

Core生成值是安全的，但原始Exec Server caller可传任意长字符串。File handle已经有32-byte cap，Process ID却没有同类限制，说明identity contract尚未统一。

## 5. Env Policy让Remote在目标主机重建环境

如果`envPolicy=None`：

```text
child env = params.env
```

不会默认继承Exec Server进程环境。

如果存在policy：

1. 在executor host按Shell Environment Policy创建base env；
2. 使用大小写不敏感pattern应用exclude/includeOnly；
3. 应用policy set；
4. 最后用`params.env`覆盖。

这比orchestrator把自己的完整env复制到remote更正确：remote的PATH、HOME、shell相关变量应来自remote host。

## 6. Env Policy刻意不加载Profile

`ExecEnvPolicy`转换成ShellEnvironmentPolicy时固定：

```text
use_profile = false
```

所以target env来自当前进程/策略，而不是每次启动shell profile。Shell Snapshot是另一条显式能力，不能与Exec Env Policy混为一谈。

## 7. Core只发送Policy差量

Unified Exec先在orchestrator用同一Shell Policy生成`local_policy_env`，再比较最终request env，只把差异overlay发送给Exec Server。

额外规则：

-总是排除`CODEX_PERMISSION_PROFILE`从继承policy中进入；
-policy set里同名变量也被删除；
-最终request若显式需要该变量，可作为overlay发送；
-Managed Network存在时，把受管理proxy env vars显式带到remote。

这减少跨连接环境体积，也避免把orchestrator runtime permission metadata当作普通继承变量泄漏。

## 8. Env Overlay最终拥有最高优先级

server执行：

```text
base = create_env(policy)
base.extend(params.env)
```

所以显式overlay覆盖policy生成值。这个优先级必须写入contract，否则调用方可能误以为policy的`set`不可覆盖。

## 9. Prepare阶段先于Process Map写入

`start_process`先：

1. 根据env policy合成child env；
2. materialize sandbox/managed network；
3. 得到最终command/cwd/env/arg0/sandbox type；
4. 再向process map插入Starting占位。

无效PathUri、缺runtime helper、不可执行sandbox等错误不会留下Starting entry。

## 10. Starting使用Arc Token做Generation Fencing

Process map值有两态：

```text
Starting(Arc<ProcessStart>)
Running(Box<RunningProcess>)
```

启动时创建唯一Arc token。spawn失败或成功提交时，只有map仍持有同一个token才允许remove/replace。

如果并发Terminate在spawn完成前删除Starting entry：

-spawn完成后发现token不存在；
-立即terminate刚启动的child；
-返回“process start was cancelled”；
-不会把迟到spawn发布为Running。

这是一个很标准的generation fencing实现。

## 11. Duplicate Process ID的语义

同一Session中：

-Starting与Running都占用ID；
-重复`process/exec`立即invalid request；
-Exited但尚在30秒retention窗口的closed process也继续占用ID；
-cleanup后才能复用。

ID复用有时间边界，而不是进程exit瞬间即可重用。这减少late notification ABA。

## 12. 三种Spawn模式

### 12.1 TTY

`tty=true`使用PTY：

-stdin可写；
-output标为PTY；
-Unix child成为新session/process group leader；
-适合交互式shell和长驻command。

### 12.2 Pipe with stdin

`tty=false, pipeStdin=true`：

-stdout/stderr分离；
-stdin保持pipe；
-可通过`process/write`发送bytes。

### 12.3 Pipe without stdin

`tty=false, pipeStdin=false`：

-stdin直接连接null；
-stdout/stderr分离；
-`process/write`返回StdinClosed。

Core Unified Exec默认把Exec Server params的`pipe_stdin`设为false；非TTY的write_stdin仅把Control-C映射为Interrupt，普通文字拒绝。

## 13. argv与arg0

`argv[0]`是program，其余是args。空argv在prepare/start阶段拒绝。

`arg0`允许进程看到不同的argv0，例如sandbox wrapper需要的command name。Unsandboxed spawn会保留它。

Sandbox prepare源码有明确TODO：inner command的custom arg0尚未跨wrapper完整保真。当前transform返回的arg0更多服务于wrapper启动，caller原始arg0可能丢失。

## 14. cwd只在Executor Host解释

`cwd`是PathUri，在`prepare_exec_request`最后转为executor host的AbsolutePathBuf。

非法或foreign URI返回：

```text
cwd URI ... is not valid on this exec-server host
```

orchestrator不会先把remote cwd转换成自己的native path。

## 15. Portable Process Sandbox

若`sandbox=None`，prepare直接返回：

-原argv；
-native cwd；
-合成env；
-原arg0；
-`SandboxType::None`。

若有sandbox context：

1. 必须配置runtime paths；
2. portable permissions转为executor-native；
3. materialize workspace roots；
4. 处理Managed MITM CA read root；
5. Linux补Codex/self sandbox helper read roots；
6. `SandboxablePreference::Require`选择sandbox；
7. 生成executor-local wrapper command。

## 16. Sandbox意图Fail Closed

存在sandbox context但最终选择`SandboxType::None`时，直接拒绝：

```text
sandbox intent cannot be enforced on this executor
```

不会为了“先把命令跑起来”静默unsandbox。

Windows remote generic command sandbox当前也明确拒绝，因为尚未实现保留argv/TTY和out-of-band env的Windows sandbox session launch。

## 17. Managed Network是Sandbox的一部分

ExecParams把两件事分开：

- `enforceManagedNetwork`：必须强制；
- `managedNetwork`：proxy/CA等执行细节。

协议注释要求：enforce=true但details缺失时继续fail closed，以兼容旧client而不绕过policy。

prepare还只在env中的CA路径符合已知managed MITM trust bundle规则时，给sandbox增加该文件read权限，避免任意env path借“CA”名义扩权。

## 18. Orchestrator传Native Command而非Host Wrapper

Core在为Exec Server准备sandbox attempt时，先把orchestrator侧sandbox type设为None，保留native command，再把portable Permission Context放进`exec_server_sandbox`。

真正wrapper由executor host选择。这避免macOS orchestrator把Seatbelt argv发给Linux remote，也避免host sandbox helper路径泄漏到executor。

## 19. Output Reader的实际Chunk大小

PTY和Pipe底层reader都用：

```text
8KiB buffer
```

stdout/stderr/PTY各通过bounded mpsc发送：

-PTY stdout channel 128；
-Pipe stdout/stderr各128；
-stdin writer channel 128。

因此正常Exec Server output chunk远小于client的1MiB pending-event bytes guard。

## 20. stdout/stderr共享一个Process Sequence

server为stdout和stderr分别启动task，但每个chunk进入同一个process mutex后分配：

```text
seq = nextSeq
nextSeq += 1
```

所以两个OS stream的真实纳秒级顺序不可重建，但Codex产生了一个稳定的arrival serialization order。消费者必须按seq，而不是按notification到达顺序拼接。

TTY模式两个receiver的事件都标为`Pty`，不会再承诺stdout/stderr分离。

## 21. Output同时进入四个投影

每个8KiB chunk会：

1. 进入server retained output deque；
2. 更新wake watch；
3. 发布process-local event log；
4. 尝试发Exec Output Delta notification。

Retained、wake、live event和wire notification是不同投影，不应互相当唯一事实。

## 22. 每Process只保留最近1MiB Output

server retained deque按chunk整体淘汰，直到总bytes不超过1MiB。

优点：长期高输出process不会无限占内存。

代价：

-请求`afterSeq`早于最早retained时没有显式gap/truncated字段；
-无法知道丢了多少bytes；
-sandbox denial heuristic只看到仍保留的尾部；
-30秒exit retention不等于30秒完整输出保留。

## 23. Read API的maxBytes是Soft Cap

`process/read`支持：

```text
afterSeq?
maxBytes?
waitMs?
```

为了保证进度，如果第一个eligible chunk本身超过maxBytes，仍会返回它。只有已经加入至少一个chunk后，下一chunk会让总量超cap时才停止。

因此：

```text
maxBytes = target page size
不是hard response bytes ceiling
```

甚至`maxBytes=0`也可能返回一个chunk。

## 24. Read Long Poll没有Server-side上限

`waitMs`默认0，但caller可传任意u64。Server用deadline和Notify实现long poll；普通RPC call本身默认无timeout。

这适合interactive polling，但恶意/错误caller可占用很多长期in-flight RPC。RPC层最多允许1024个regular calls，之后fail fast；cleanup另保留1个slot。

应再增加per-method waitMs cap和per-principal long-poll quota。

## 25. Read的Terminal判断

返回条件：

-有output chunks；
-process closed；
-出现调用者尚未观察的新terminal event；
-wait deadline到达。

Response分开报告：

-exited；
-exitCode；
-closed；
-failure；
-sandboxDenied。

Exited表示OS process已结束；Closed表示stdout/stderr两个reader也都结束、之后不会再有output。

## 26. Exited不保证Output已经结束

Exit watcher与两个output task并发。

非sandbox process exit后可立即发布Exited；尚在pipe buffer中的output随后仍可获得更高seq。Closed必须等：

```text
exitCode已知 && openStreams == 0
```

所以消费者不能看到Exited就停止读，必须等Closed或使用统一event sequence。

## 27. Sandbox Denial是Heuristic Receipt

只有sandboxed process会做denial检测：

1. exit后最多等20ms，给output task一次推进机会；
2. 聚合当前retained stdout/stderr/combined output；
3. lossy UTF-8转换；
4. 调用`is_likely_sandbox_denied`；
5. 把bool写入Exited/ReadResponse。

它不是内核提供的强证明：

-只看最多1MiB尾部；
-可能漏掉20ms后才drain的output；
-依赖exit code和文本特征；
-binary output被lossy decode。

字段名`sandbox_denied`容易让上层误当确定事实，最好同时返回classification source/confidence。

## 28. Stdin Write的四种结果

`process/write`返回：

-Accepted；
-UnknownProcess；
-StdinClosed；
-Starting。

这比把所有情况压成RPC error更适合交互式客户端：Starting可稍后重试，Unknown说明handle不在本Session，StdinClosed说明启动模式不支持。

## 29. writeId提供有限幂等

每个process保存最近4096个accepted write IDs。

server流程：

1. writeId不能为空；
2. 查process和stdin能力；
3. 第一次查dedupe；
4. reserve writer queue permit；
5. 再查一次dedupe；
6. 同步send chunk；
7. 在任何后续await前记录writeId。

第二次检查解决多个相同writeId并发等待queue permit的竞态；send后立即remember解决handler被cancel后client retry造成重复写。

## 30. 4096窗口意味着Late Retry仍可重复

dedupe不是永久账本。一个writeId被第4097个唯一写淘汰后，再次提交会把bytes重新送入stdin。

这对短连接恢复够实用，但不能承诺任意时间exactly-once。

## 31. Accepted只表示Queue Admission

底层PTY/Pipe writer task从128项mpsc取bytes，调用`write_all`/`flush`，但错误被忽略。

所以server在`permit.send`后返回Accepted，只能证明：

```text
bytes已进入本地writer queue
```

不能证明：

-OS pipe实际写成功；
-child读取了bytes；
-TTY driver接受了全部输入；
-命令处理了输入。

当前WriteStatus名称没有表达这个receipt层级。

## 32. Stdin Chunk与writeId没有Size Cap

协议只要求writeId非空，没有：

-writeId最大bytes；
-chunk最大bytes；
-每process queued stdin bytes；
-每write timeout；
-累计stdin quota。

channel只按128个message限量，一个message可以很大；remote retry还会clone整个chunk。

## 33. Interrupt与Terminate语义不同

### 33.1 Interrupt

唯一Protocol signal是Interrupt，映射PTY utility的Interrupt。

对unknown、starting或already exited process，server返回成功no-op。调用者无法知道signal是否实际投递。

### 33.2 Terminate

Terminate返回`running: bool`：

-Running且未exit：标记termination_requested，终止process tree；
-Starting：删除start token，返回true；
-Exited或unknown：false。

高层`ExecProcess::terminate()`丢弃这个bool，因此trait caller不能区分“已经不在运行”和“刚发出terminate”。

## 34. Process Tree终止

Unix PTY child是session/process group leader；Pipe backend也记录process group ID。Terminate尽量终止整组，减少只杀父进程留下grandchild的情况。

Windows使用平台handle/terminator实现。

但“terminate已请求”不等于“所有后代已确认退出”。协议只返回running bool，没有grace period、escalation阶段、survivor list或kill receipt。

## 35. LocalExecProcess Drop不等于Terminate

`LocalExecProcess`没有Drop kill；`RemoteExecProcess::drop`只unregister client-side session route，也不向server terminate。

裸ExecBackend caller若丢弃handle：

-child可继续运行；
-remote output route可能被移除；
-server process仍占资源直到自身exit、Session shutdown或显式terminate。

Core Unified Exec在其更高层process lifecycle里负责terminate/cleanup，但底层trait本身是“控制handle”，不是RAII process owner。

## 36. Start成功点与Recoverable切换

client start前先插入`SessionState(recoverable=false)`，然后发`process/exec`。

只有收到ExecResponse后才：

```text
recoverable = true
```

这防止连接恢复逻辑把一个尚未确认创建的process当成正常running session来read。

## 37. Start的Ambiguous Commit补偿

如果transport在`process/exec`请求后、response前断开：

-client不知道server是否已spawn；
-不会盲目重新发送exec；
-后台在恢复连接后循环调用Terminate(processId)；
-再移除本地Session route。

如果caller在response已到但接收结果的oneshot被drop，也把recoverable改回false并启动同样cleanup。

这是正确的补偿策略：进程创建不是安全可重放操作，未知提交状态应尝试收敛为“不再运行”。

## 38. Start本身没有Method Timeout

普通RPC `call()`使用`RpcCallTimeout::None`，包括process/exec、read/write/signal等。它们依赖transport关闭、上层task cancellation或更高层Tool deadline结束等待。

若server保持连接但某个handler永久不response，client call可无限等待并占用1024 regular slot之一。

## 39. Cleanup拥有保留RPC Slot

RPC层限制：

```text
regular in-flight calls = 1024
reserved cleanup calls = 1
```

Terminate/fs-close等使用`call_for_cleanup`：

-regular slot有空则用regular；
-否则使用唯一cleanup slot；
-连cleanup slot也占用时，主动close transport而不是永远无法清理。

这是很好的资源治理：正常请求饱和不应阻止终止和释放。

## 40. Output Notification Backpressure可反压Child

server output task先更新retained state，再await向bounded outbound notification channel发送。

若客户端/transport长期消费慢：

```text
notification send等待
-> output task不再drain pty/pipe receiver
-> 128项receiver填满
->底层reader停止drain OS pipe/PTY
-> child write阻塞
```

这是有界内存换取自然backpressure，但一个慢控制连接会影响child执行进度。Process并没有“只丢live notification、继续retained/polling”的独立降级策略。

## 41. Retained Output与Live Event双重有界

server process：1MiB retained output。

client process event log：

-256 events；
-1MiB bytes。

client还有out-of-order reorder buffer：

-256 events；
-1MiB bytes；
-单event也不超过1MiB。

当前底层8KiB chunk让单event限制很宽松。多层预算避免server和orchestrator任一侧无界增长。

## 42. Live Subscriber Lag有显式恢复路径

`ExecProcessEventReceiver`先replay本地bounded history，再接broadcast live stream。

若receiver lagged，文档要求：

1. 用最后已交付seq调用`ExecProcess::read`；
2.补齐retained output和terminal state；
3.再继续live receive。

这是Push+Pull组合，而不是强迫broadcast channel承担durability。

## 43. Process终态是Exited再Closed

```text
Running
-> Exited(exit code, sandbox classification)
-> stdout closed
-> stderr closed
-> Closed
-> retain 30s
-> remove from map
```

PTY虽然只有一个实际output源，结构仍维护两个receiver，其中stderr channel会关闭，最终openStreams降到0。

Closed被发布后才启动30秒cleanup timer。

## 44. Termination Telemetry与真实Exit分离

ProcessMetricGuard在exit watcher中按：

-termination_requested -> terminated；
-exit code 0 -> success；
-其他 -> error。

Session shutdown也把剩余process标为terminated并发terminate。

若terminate request发出但child恰好自然exit，telemetry仍归为terminated；这是“control intent”分类，不是OS cause证明。

## 45. Signal Success不是Delivery Receipt

Interrupt对unknown/starting/exited返回空成功，Terminate的bool又在trait层丢失。上层很难区分：

-已发送；
-无需发送；
-目标不存在；
-目标正在启动；
-child已退出。

一个更强的控制协议应返回目标generation与状态迁移receipt。

## 46. Sandbox Denial与Output Retention耦合

denial detection读取process retained deque，而deque只保最后1MiB。若关键“permission denied”文本在早期输出且随后产生大量日志，它可能已被淘汰。

因此runtime policy判断不应依赖面向UI的output retention。更理想的是sandbox wrapper产生结构化denial event/code，与stdout/stderr分离。

## 47. 值得保留的优质实现

### 47.1 Logical Process ID不暴露OS PID

协议identity稳定且可跨连接恢复。

### 47.2 Sandbox Retry使用新Executor Process ID

避免同一Tool ID下的attempt事件串线。

### 47.3 Env Policy在Target Host求值

remote PATH/HOME不会错误继承orchestrator。

### 47.4 Env差量传输

减少secret和无关变量跨边界。

### 47.5 Starting Arc Token

Terminate与spawn completion之间有generation fencing。

### 47.6 Sandbox Require/fail-closed

executor无法强制policy时拒绝启动。

### 47.7 Native Command到Remote、Wrapper在Remote生成

避免跨OS sandbox argv污染。

### 47.8 TTY/Pipe/Null Stdin三模式

交互能力和非交互最小权限明确。

### 47.9 stdout/stderr共享Seq

并发output被转换为一个可恢复有序事件域。

### 47.10 Exited与Closed分离

不会在OS exit时丢掉pipe尾部输出。

### 47.11 Push+Pull恢复

live subscriber lag后可用retained read追平。

### 47.12 1MiB/256多层输出预算

server retention、client replay、reorder都有限。

### 47.13 writeId Double-check

同时防并发相同写和RPC cancel后retry。

### 47.14 Start Ambiguity用Terminate补偿

不重放不可幂等的spawn。

### 47.15 Reserved Cleanup Slot

请求饱和时仍尽量保留终止能力。

### 47.16 Process Group终止

降低残留grandchild风险。

## 48. 当前实现的主要缺口

### 48.1 Process ID无length/charset/empty约束

raw client可制造过长key、日志污染或内存放大。

### 48.2 Process数量与总资源无cap

Session process map没有最大running/starting/retained process数。

### 48.3 Exec/Read/Write/Signal无method deadline

连接健康但handler卡死可长期占RPC slot。

### 48.4 read waitMs无上限

1024个超长poll可耗尽regular call admission。

### 48.5 read maxBytes不是hard cap

首chunk可超过目标，0也可能返回数据。

### 48.6 retained gap无显式truncated/earliestSeq

恢复者不知道漏了多少output。

### 48.7 stdin chunk/writeId/queued bytes无cap

128 message channel不能约束单message大小。

### 48.8 Accepted不是Child Delivery

底层write error被忽略，receipt只到queue。

### 48.9 write dedupe只有4096窗口

超晚retry仍可重复输入。

### 48.10 Interrupt结果无target状态

unknown、starting、exited都返回成功no-op。

### 48.11 Trait层丢弃Terminate running bool

上层无法获得控制结果。

### 48.12 Handle Drop不终止Process

底层API需要显式owner，否则可留下orphan运行。

### 48.13 Custom arg0在sandbox wrapper中不完整

源码已有TODO。

### 48.14 Windows remote sandboxed launch不支持

有intent时直接拒绝，功能仍有平台缺口。

### 48.15 Sandbox Denial是尾部文本heuristic

可能false positive/negative，且与retention/drain timing耦合。

### 48.16 Slow notification反压child

一个慢连接可能阻塞进程stdout，改变程序行为。

### 48.17 Output无独立drop-live模式

不能在保留poll事实同时牺牲非关键push事件。

### 48.18 Exit/Terminate缺强receipt

没有process generation、signal delivered、descendants drained等证据。

### 48.19 Env pattern统一case-insensitive

跨平台一致但在Unix可能与实际case-sensitive env key语义不完全一致。

### 48.20 Managed Network与Process receipt未合并

终态只给sandboxDenied bool，没有实际proxy generation、network policy revision或blocked request摘要。

## 49. 更稳健的Process Contract

```ts
type ProcessBinding = {
  environmentId: string
  environmentGeneration: number
  processId: string
  processGeneration: number
}

type ProcessStartReceipt = {
  operationId: string
  binding: ProcessBinding
  phase: 'starting' | 'running' | 'rejected' | 'ambiguous-cleanup'
  sandboxType: string
  permissionRevision: number
  networkPolicyRevision?: number
}

type ProcessControlReceipt = {
  binding: ProcessBinding
  control: 'stdin' | 'interrupt' | 'terminate'
  acceptedAt: 'rejected' | 'queue' | 'os' | 'child-ack'
  targetState: 'starting' | 'running' | 'exited' | 'missing'
}

type ProcessReadPage = {
  chunks: ProcessOutputChunk[]
  earliestAvailableSeq: number
  nextSeq: number
  truncatedBefore: boolean
  totalBytes: number
  exited: boolean
  closed: boolean
}
```

改进原则：

1. Process ID和write ID有bytes/charset限制；
2. 每Session有process数、stdin bytes、output rate和duration quota；
3. start/control RPC有deadline但保留ambiguous cleanup；
4. signal/terminate返回target generation和状态；
5. stdin delivery层级显式；
6. sandbox denial由wrapper结构化上报；
7. output page报告earliest retained与gap；
8. slow push可降级，retained pull保持事实；
9. owner lease到期自动terminate或进入明确detached模式。

## 50. 对当前NestJS Agent项目的翻译

当前SEO Agent的业务Tool未必启动OS process，但同一套operation原则适用于异步外部任务。

### 50.1 Job ID不是Worker PID

数据库保存稳定`AgentStep/ToolCall ID`，具体HTTP worker/container attempt另有generation，不要把进程或队列内部ID当业务身份。

### 50.2 Tool Start必须有Ambiguous Commit策略

调用第三方发布/写入API时：

-operation ID稳定；
-attempt ID每次不同；
-超时后先query receipt；
-不能直接重复副作用请求。

### 50.3 Output Stream与Durable Facts分开

Web SSE delta可丢/重连；AgentStep terminal、tool result digest、error code必须持久化。与Codex push event + retained read的思想一致。

### 50.4 Control结果不能只回200

cancel应返回：

-target run generation；
-之前状态；
-是否真正发出取消；
-最终是否已停止；
-若ambiguous如何查询。

### 50.5 Sandbox Denial不要靠文本猜

业务Tool policy拒绝应产生typed error code，不通过解析stderr或LLM文本识别。

## 51. 建议验证矩阵

| 场景 | 应验证的事实 |
| --- | --- |
| empty/超长Process ID | admission拒绝 |
| 同ID并发start | 只有一个generation进入Running |
| Starting期间terminate | late spawn被kill，不发布Running |
| remote env policy | PATH/HOME来自remote，overlay按优先级覆盖 |
| permission profile env | 不从普通policy继承 |
| sandbox不可用 | fail closed，不unsandbox |
| sandbox custom arg0 | 保真或显式拒绝 |
| non-TTY no stdin | 普通write返回StdinClosed |
| write queue满 | deadline/cancel和bytes cap生效 |
| child已关stdin | Accepted不能伪称delivery成功 |
| 同writeId并发/重连retry | 只queue一次 |
| 第4097后重放旧writeId | 产品明确窗口语义 |
| stdout/stderr并发 | seq唯一连续，Closed最后 |
| exit后pipe尾部output | Exited后仍接收，直到Closed |
| afterSeq早于retention | 返回truncatedBefore与earliestSeq |
| maxBytes=0/首chunk超cap | hard/soft contract明确 |
| 1024 long polls | admission不饿死cleanup |
| start response前断线 | 不重复spawn，terminate补偿 |
| partial output后reconnect | gap检测和replay可解释 |
| handle被drop | owner policy决定terminate或detach |
| sandbox denial早期后大量日志 | typed denial不被retention淘汰 |
| slow client notification | child不会无限被非关键push拖死 |

## 52. Teach-back

### 52.1 为什么remote不能直接继承orchestrator env？

因为PATH、HOME、shell和platform变量属于执行主机；复制host env会指向不存在路径并泄漏secret。应在target按policy重建，再叠加必要差量。

### 52.2 为什么Starting要有独立token？

spawn是异步的，Terminate可能先发生。token让late completion证明自己仍是当前generation，否则必须杀掉刚spawn的child。

### 52.3 为什么Exited之后还要Closed？

OS进程退出时pipe/PTY里仍可能有未drain bytes。Closed才保证不会再有output。

### 52.4 为什么writeId只能提供at-most-once窗口，不能证明exactly-once？

server只记最近4096个ID，而且Accepted只到queue，不能证明child消费；跨长时间或server重启没有durable ledger。

### 52.5 当前最值得保留和最该补齐的是什么？

最值得保留的是target-host env policy、Starting fencing、portable sandbox、共享seq、Exited/Closed和ambiguous start补偿；最该补齐的是process/stdin quota、method deadline、output gap receipt、真实control receipt、structured sandbox denial与owner lease。

## 53. 结论

Codex Exec Process的完整链路是：

```text
logical operation/process identity
-> target-host env synthesis
-> portable sandbox materialization
-> Starting generation fence
-> PTY/Pipe spawn
-> sequenced output + retained/live projections
-> stdin/signal/terminate control
-> Exited
-> output drained Closed
-> short retention/recovery cleanup
```

它比“运行命令并收集stdout”成熟得多，尤其值得学习target-host环境重建、remote生成sandbox wrapper、Start ambiguity补偿、ProcessStart token、统一seq与Exited/Closed分离。

当前缺口集中在资源和receipt：Process ID、process数量、stdin bytes、long poll与duration缺少统一cap；普通RPC无deadline；Accepted只证明queue admission；signal成功不证明delivery；denial仍依赖尾部文本heuristic；slow push能反压child；底层handle drop不会自动终止。

对云端Agent的迁移结论是：**把每个外部副作用当作有generation的operation；启动、输入、取消和终态都要有明确receipt；streaming只负责体验，durable状态与恢复边界必须另建。**
