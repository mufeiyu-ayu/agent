# Environment Filesystem、Sandbox Helper与Remote File Stream生命周期

Codex的Filesystem不是`std::fs`的一层薄包装，而是和Exec、HTTP并列的Environment Capability。相同的`ExecutorFileSystem`接口可以落到：

- host直接文件系统；
- 每次操作启动的OS Sandbox Helper；
- remote Exec Server JSON-RPC；
- remote固定文件handle与分块读取协议。

这使Skill、Plugin、图片、MCP上传、AGENTS.md与Tool都可以在local/remote之间复用同一套文件抽象，同时把PathUri和Permission Profile带到真正执行syscall的主机。不过，不同操作的安全与资源语义并不均匀：buffered read有512MiB上限，walk有四重预算，streaming read有1MiB block和128 handle限制；write/copy/remove、readDirectory与Sandbox Helper stdout却缺少同等级预算。更关键的是，platform-sandboxed streaming read当前明确不支持，remote handle也不能跨连接恢复。

## 1. 证据范围

本文基于Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/file-system/src/lib.rs`
- `codex-rs/file-system/src/find_up.rs`
- `codex-rs/exec-server-protocol/src/protocol.rs`
- `codex-rs/exec-server/src/local_file_system.rs`
- `codex-rs/exec-server/src/remote_file_system.rs`
- `codex-rs/exec-server/src/remote_file_stream.rs`
- `codex-rs/exec-server/src/regular_file.rs`
- `codex-rs/exec-server/src/file_read.rs`
- `codex-rs/exec-server/src/server/file_system_handler.rs`
- `codex-rs/exec-server/src/sandboxed_file_system.rs`
- `codex-rs/exec-server/src/fs_sandbox.rs`
- `codex-rs/exec-server/src/fs_helper.rs`
- `codex-rs/exec-server/src/fs_helper_main.rs`
- `codex-rs/exec-server/src/server/handler.rs`
- `codex-rs/exec-server/tests/file_stream.rs`
- `codex-rs/exec-server/tests/file_system_unix.rs`
- `codex-rs/exec-server/src/local_file_system_path_uri_tests.rs`
- `codex-rs/exec-server/src/remote_file_system_path_uri_tests.rs`
- `codex-rs/exec-server/src/sandboxed_file_system_path_uri_tests.rs`
- `codex-rs/core/src/mcp_openai_file.rs`
- `codex-rs/app-server/src/request_processors/fs_processor.rs`

## 2. 四层Filesystem实现

```text
ExecutorFileSystem trait
        |
        +-- LocalFileSystem
        |      |
        |      +-- UnsandboxedFileSystem -> DirectFileSystem
        |      |
        |      +-- SandboxedFileSystem -> sandboxed child helper -> DirectFileSystem
        |
        +-- RemoteFileSystem -> ExecServerClient -> remote FileSystemHandler
```

| 实现 | syscall在哪发生 | policy如何生效 |
| --- | --- | --- |
| Direct | 当前进程 | 不接受sandbox context |
| Local Unsandboxed | 当前进程 | restricted platform sandbox会被拒绝 |
| Local Sandboxed | 新helper进程 | OS sandbox wrapper约束helper syscall |
| Remote | remote Exec Server | context序列化到remote，再由remote选择direct/helper |

## 3. ExecutorFileSystem统一的能力面

接口包含：

- canonicalize；
- buffered read；
- streaming read；
- UTF-8 text read；
- write；
- create directory；
- metadata；
- read directory；
- bounded recursive walk；
- remove；
- copy。

`read_file_text`是默认组合：先完整`read_file`，再做严格UTF-8 decode，非法编码返回`InvalidData`，不会lossy替换正文。

## 4. PathUri是跨主机路径协议

所有FS协议路径都用`PathUri`，而不是host `PathBuf`字符串。

local Direct真正执行时调用`to_abs_path()`；remote则原样序列化PathUri，到Exec Server主机再转换。这避免orchestrator按自己的Windows/POSIX规则解释remote路径。

Sandbox Helper还会在进入子进程前验证PathUri能转换为当前exec-server host的native absolute path。foreign URI不会静默转成相似host path。

但Helper最终`Command::current_dir`仍要求`AbsolutePathBuf`，源码保留TODO：PathUri尚未贯穿进程launch最末端。

## 5. FileSystemSandboxContext不是简单cwd

Context包含：

```text
PermissionProfile<PathUri>
cwd?: PathUri
workspaceRoots: PathUri[]
windowsSandboxLevel
windowsSandboxPrivateDesktop
useLegacyLandlock
```

它是portable sandbox intent，接收主机负责把PathUri permission materialize为native policy。

`should_run_in_sandbox()`有一个重要fail-closed分支：如果portable Permission Profile无法转换为本机native path，返回true，而不是当作unrestricted。这会把请求送入Sandboxed路径，随后在native conversion处明确失败。

## 6. cwd只在Permission确实依赖时保留

Permission中以下内容依赖cwd：

- relative glob pattern；
- `ProjectRoots` special path。

Remote发送前调用`drop_cwd_if_unused()`：

- 若permissions与cwd无关，清空cwd和workspace roots；
- 若依赖cwd，则保留。

这既减少host path泄露，也防止remote无意义地尝试解释orchestrator cwd。是一个很好的“只传执行所需上下文”设计。

## 7. LocalFileSystem如何选择Direct还是Sandboxed

```text
sandbox.should_run_in_sandbox() == true
  -> 必须存在runtime paths
  -> SandboxedFileSystem

否则
  -> UnsandboxedFileSystem
```

Unrestricted、External或Disabled profile可以走unsandboxed；restricted且不具备full disk write则走platform sandbox。

若请求需要sandbox，但Environment没有configured runtime paths，操作明确失败，不会为了兼容偷偷降级到direct。

## 8. DirectFileSystem拒绝携带Sandbox Context

Direct层每个方法先`reject_sandbox_context`，要求context为None。

这看似重复，但防止内部调用误把“带sandbox参数”和“已执行sandbox”混为一谈：

```text
SandboxedFileSystem负责执行policy
DirectFileSystem只负责helper内部或明确unsandboxed syscall
```

Sandbox Helper request在进入子进程时会把内部params的`sandbox`字段设为None，避免递归再启动一层helper。

## 9. Sandbox操作是一请求一Helper进程

每次restricted FS操作都：

1. materialize portable permissions；
2. 补充helper runtime最小read roots；
3. 选择OS sandbox；
4. 启动当前Codex binary的`--codex-run-as-fs-helper`模式；
5. 从stdin读一份JSON request；
6. helper在sandbox内使用DirectFileSystem；
7. stdout返回一份JSON response；
8. 主进程等待退出并解析结果。

优点：

- 单次操作隔离清晰；
- helper没有长期可变状态；
- policy最终由OS在syscall层执行；
- child drop时`kill_on_drop(true)`。

代价：

- 每个metadata/read/write/walk都要spawn；
- 没有跨操作事务；
- 大body经JSON/base64和stdout多次复制；
- 无helper总deadline与stdout/stderr cap。

## 10. Helper Environment最小化

子进程先`env_clear()`，只保留allowlist：

- `PATH`；
- `TMPDIR`；
- `TMP`；
- `TEMP`；
- macOS `__CF_USER_TEXT_ENCODING`；
- debug/Bazel特定运行变量；
- Windows大小写不敏感PATH。

测试明确验证`HOME`、`OPENAI_API_KEY`、`HTTPS_PROXY`不会进入helper。

这是很好的secret boundary：文件操作helper不需要模型/API credential，也不应继承代理配置。

## 11. Helper自身需要最小额外Read权限

restricted profile可能连Codex executable和sandbox wrapper都不可读。Runner会：

- 加入platform minimal read special path；
- 必要时加入Codex executable / linux sandbox helper所在目录；
- 保留原有write权限；
- 规范化top-level path aliases。

这属于“让安全机制本身可启动”的受控权限扩展，不应扩展到用户数据目录。

## 12. Top-level Alias规范化

macOS等平台可能存在：

```text
/tmp -> /private/tmp
```

policy root若保留表面alias，OS sandbox实际路径可能不匹配。实现沿ancestor查找已存在节点，用`canonicalize_preserving_symlinks`规范化第一个发生alias变化的根，再拼回未解析suffix。

这是对Sandbox policy常见“路径字符串正确但内核实际路径不同”问题的专门处理。

## 13. Sandbox Helper强制Network Restricted

FS Helper构造Permission Profile时把Network Policy固定为Restricted，并声明不使用managed network。

文件操作不需要网络，禁止helper意外发起网络请求可以缩小攻击面。即使继承PATH中的某个wrapper行为异常，也不应因此获得网络访问。

## 14. Buffered Read的512MiB双检查

Direct read只接受regular disk file：

- Unix open附加`O_NONBLOCK`，避免FIFO等待writer；
- Windows检查handle为`FILE_TYPE_DISK`；
- open后再要求metadata `is_file()`。

读取前检查metadata size不超过512MiB；实际读取使用`take(limit+1)`，结束后再次检查bytes长度。

第二次检查防止文件在metadata读取后增长，是一个值得保留的TOCTOU资源防护。

## 15. 512MiB上限与Transport并不协调

remote buffered read返回base64字符串：

```text
512MiB decoded
-> 约683MiB base64
-> JSON response
-> WebSocket/Noise frame
-> orchestrator再decode
```

这远大于其他transport常见64MiB frame边界，也会在remote、serializer、transport与client产生多份内存。

所以512MiB是local Direct安全阀，不是可用的remote contract。remote buffered read应设置更小的协议级cap，较大文件必须走stream。

## 16. Sandboxed Buffered Read的额外放大

restricted read在Helper内：

1. 读完整bytes；
2. base64到Helper response；
3. stdout被`wait_with_output`完整收集；
4. 主进程解析JSON；
5. decode回bytes；
6. remote场景还可能再次base64进外层RPC。

Helper没有stdout bytes cap，理论上512MiB read会造成更高峰值。当前platform sandbox保护了访问权限，却没有同步收敛资源预算。

## 17. Streaming Read协议

Remote stream不是body notification，而是显式file handle RPC：

```text
fs/open(handleId, path, sandbox)
fs/readBlock(handleId, offset, len)
fs/close(handleId)
```

client生成32 hex字符UUID作为handle ID。server限制：

- handle ID不超过32 bytes；
- 每connection最多128个open read handles；
- duplicate ID拒绝；
- block len必须在1..=1MiB；
- offset加已读bytes做overflow检查。

## 18. 为什么用固定Handle而不是每块重新open Path

server open后保存`Arc<File>`，block read使用Unix `read_at`或Windows `seek_read`。

这保证：

- 支持非顺序offset和不同len；
- 多次read不共享mutable cursor；
- path被删除/替换后仍读取原open file；
- 不会每块重新做path resolution产生TOCTOU换文件。

测试明确验证：读完第一块后替换path，stream继续得到旧inode内容。

## 19. Stream Client状态机

```text
generate handle ID
-> fs/open
-> offset=0
-> readBlock(1MiB)
-> validate chunk <=1MiB
-> eof?
   no: offset += chunk.len
   yes: fs/close, return last chunk or EOF
```

防御性校验包括：

- remote返回超过1MiB立即InvalidData；
- empty chunk但`eof=false`立即InvalidData，避免无限loop；
- offset checked add；
- read error自动close server handle；
-正常EOF主动close；
- Drop异步best-effort close。

## 20. Exact Block Boundary多一次Read

server以`bytes_read < requested_len`判断EOF。

如果文件大小恰好是1MiB整数倍，最后一个完整block返回`eof=false`；client必须再发一次read，收到empty+eof才结束。

这保持协议简单，但增加一次RPC。若metadata size在open时冻结或read response带known size，可以避免；不过文件可能增长/缩短，当前语义更接近真实open file的按需读取。

## 21. Streaming Read不支持Platform Sandbox

Local和Remote实现都明确拒绝：

```text
streaming file reads do not support platform sandboxing
```

原因是当前handle由长期存活的Exec Server进程打开；一请求一Sandbox Helper没有跨RPC保留文件descriptor的机制。

因此有权限约束的文件只能走buffered helper read，即使文件较大；而无sandbox或不需platform enforcement的内部路径才能stream。

这是当前最重要的能力缺口之一：安全读取与大文件流式读取不能同时满足。

## 22. File Handle与Connection绑定

FileSystemHandler和`FileReadHandleManager`属于Exec Server connection handler。shutdown会`close_all()`。

它没有像Process那样进入Logical Session retained state，也没有：

- resume handle token；
- file identity/size/mtime receipt；
- last offset replay；
-新connection reattach。

transport断线后，即使Exec Server Session恢复，新的`fs/readBlock`也无法继续旧handle。client的RemoteFileStream会失败，调用方只能重新open并决定是否从offset重读。

## 23. Stream Drop Cleanup是Best-effort

`FileReadRegistration`在创建时保存current Tokio runtime handle。Drop时：

- 优先使用已保存runtime；
-否则尝试当前runtime；
- spawn `fs/close`；
-忽略close错误。

比只在Drop时`try_current`更稳健，因为stream可能在不同task/context drop。但若runtime已经shutdown或transport断开，server handle只能等connection shutdown统一释放。

## 24. readFile与readFileStream的安全目标不同

| 属性 | buffered read | streamed read |
| --- | --- | --- |
| platform sandbox | 支持 | 不支持 |
| local total cap | 512MiB | 无total cap |
| chunk cap | N/A | 1MiB |
| remote memory | base64大响应 | 每块有界 |
| path replacement | open后同一file，但一次完成 | 明确保持原handle |
| reconnect | 整体request失败 | handle丢失 |

调用方不能只按文件大小选API，还必须考虑sandbox requirement。

## 25. Write不是原子发布

Direct write使用`tokio::fs::write`：

- 创建或truncate目标；
-写入contents；
-无temp file；
-无rename；
-无fsync；
-无expected digest/version；
-无mode控制；
-无写后receipt。

进程崩溃、磁盘满或transport断线可能留下partial/empty file，调用者也无法区分“remote已写成功但response丢失”的ambiguous commit。

## 26. Write Request没有bytes Cap

`FsWriteFileParams`携带base64 string；server先完整decode为Vec，再调用write。

没有filesystem-specific：

- decoded request bytes上限；
- encoded string前置上限；
- chunked upload；
- streaming checksum；
- temp storage quota。

大文件写入会重复占用caller bytes、base64、JSON、server decoded Vec。

## 27. Create/Remove的危险默认值

Raw FS协议把部分选项定义为Option以兼容旧caller：

- create directory `recursive`缺省true；
- remove `recursive`缺省true；
- remove `force`缺省true。

Trait层调用会传显式bool，但直接JSON-RPC caller若省略remove选项，默认就是递归且忽略NotFound。

对破坏性操作，这种默认过于宽松。更安全的协议应要求caller显式传recursive/force，或者默认false。

## 28. Remove的Symlink语义

remove先用`symlink_metadata`：

-真实目录按recursive选择`remove_dir_all/remove_dir`；
-symlink不是目录类型，走`remove_file`；
-不会递归进入symlink target；
-NotFound且force=true视为成功。

这避免“删除一个link却删掉target目录”的常见错误。

但recursive remove本身没有：

- entry count；
-bytes预算；
-deadline；
-trash/rollback；
-删除manifest/receipt。

## 29. Copy语义与边界

Copy支持：

- regular file；
- directory，必须`recursive=true`；
- symlink，复制link target字符串而不是跟随。

目录copy前检查destination不是source自身或descendant。实现会canonicalize source，并解析destination最长已存在ancestor后拼回suffix，专门处理symlink parent和`..`逃逸。

但copy是递归blocking任务：

-无entry/bytes/depth cap；
-无deadline/cancel检查；
-无staging/rollback；
-中途失败留下partial destination；
-安全检查和实际copy间仍有并发symlink TOCTOU。

restricted路径依靠OS sandbox对每次syscall兜底，unsandboxed内部调用则依赖调用者信任。

## 30. Metadata同时提供Followed Type与Symlink Flag

实现分别调用：

- `metadata()`：跟随symlink，得到target是file/dir及size/time；
- `symlink_metadata()`：判断path本身是不是symlink。

因此一个指向目录的symlink可同时：

```text
isDirectory = true
isSymlink = true
```

Walk正是利用这个组合决定是否跟随directory symlink。

created/modified时间转换失败或早于Unix epoch时返回0；0代表unknown，不应被误解为真实epoch时间。

## 31. ReadDirectory缺少完整性信号

Direct readDirectory遍历entry后再读取followed metadata；metadata失败的entry被静默skip。

结果只含：

- lossy UTF-8 file name；
- isDirectory；
- isFile。

缺少：

- isSymlink；
-单项error；
-truncated；
-entry count/response bytes cap；
-原始非UTF-8文件名表示。

因此单次readDirectory不是完整审计视图。大量目录还可能构造无界Vec和RPC response。

## 32. Bounded Walk是更成熟的目录接口

WalkOptions包含：

```text
maxDepth <= 64
maxDirectories <= 10,000 且 > 0
maxEntries <= 50,000 且 > 0
followDirectorySymlinks
pruneHiddenDirectories
```

另外结果估算上限：

```text
4MiB response content + 每项64B overhead
```

WalkOutcome明确返回：

- entries；
- recoverable errors；
- truncated。

这比readDirectory的“成功Vec或整体错误”更适合真实大仓库。

## 33. Walk的确定性与Cycle防护

算法使用BFS queue，每个目录的entries按file name排序。

follow symlink开启时：

- root和每个候选directory都canonicalize；
-用HashSet记录canonical identity；
-同一个目录通过不同symlink到达只遍历一次；
-避免cycle。

`pruneHiddenDirectories=true`时隐藏目录仍作为entry返回，只是不入queue。这让用户知道它存在，同时避免扫描`.git`等巨大目录。

## 34. Walk错误是局部事实

除root metadata/canonicalize等无法建立遍历前提的错误外，子目录read、path join、metadata或canonicalize失败都会进入`WalkError`并继续。

如果error本身使4MiB结果预算耗尽，outcome标记truncated并返回已有事实。

这延续了Codex常见模式：

```text
局部失败保留已观察事实
全局前提失败才整体Err
```

## 35. Walk的Protocol Compatibility Fallback

Remote优先调用`fs/walk`。若旧Exec Server返回Method Not Found，则客户端用primitive operations组合`walk_via_directory_reads`。

优点：新client能兼容旧server。

代价：

- 每个目录/entry产生多次RPC；
-遍历期间transport可能reconnect；
-每个primitive看到的filesystem时刻不同；
-旧server的readDirectory仍可能先返回无界大Vec；
-没有server-side单次snapshot。

## 36. Sandbox Walk仍是一整个Helper事务

SandboxedFileSystem不是在主进程逐项调用，而是把`fs/walk`整体交给一个sandbox helper。这样：

-所有子路径syscall受同一OS policy；
-中间目录结构不需要反复跨sandbox边界；
-结果仍受walk的四重预算。

但Helper stdout无独立cap，当前Walk自身4MiB cap恰好提供了间接保护；readDirectory没有这一保护。

## 37. Error Mapping会损失细粒度

Server将IO error映射为：

- NotFound -> `-32004`；
- InvalidInput/PermissionDenied -> invalid request；
-其他 -> internal error。

Remote再映回：

-NotFound；
-InvalidInput；
-BrokenPipe；
-其他`io::Error::other`。

PermissionDenied在跨RPC后变成InvalidInput，调用者不能再可靠区分policy拒绝、路径格式错误和option错误。

错误字符串还可能包含absolute path，随后进入logs/feedback。

## 38. File RPC只要求Session Attached

Exec Server Handler对FS方法只检查：

- initialize已调用；
- initialized已发送；
-logical session仍attached。

Sandbox Context由caller提供且可以是None。Server不会基于session principal另行求交一个最低permission policy。

因此plain remote client若被允许连接，就能发`sandbox=None`的任意FS请求。安全边界主要依赖：

-谁能建立Exec Server连接；
-Noise/registry identity；
-上层只传正确sandbox；
-remote host本身的OS用户权限。

## 39. App Server Host FS接口明确Unsandboxed

App Server的`fs/readFile/writeFile/...`先要求Manager存在local Environment，然后调用其Filesystem并传`sandbox=None`。

这属于受信控制客户端能力，不是模型Tool path。它不会跟随Thread primary remote，也不套Turn Permission Profile。

因此部署时必须把App Server connection authorization当作host filesystem authority，不能只依赖模型侧sandbox。

## 40. INTERNAL_FS与Tool_FS必须分开

源码还提供process-global `LOCAL_FS`，使用`LocalFileSystem::unsandboxed()`。生成图片等内部制品路径会使用它。

这是合理的host-internal能力，但必须明确：

```text
internal artifact filesystem
!=
model-selected environment filesystem
!=
user-approved tool filesystem
```

如果三者都只暴露`Arc<dyn ExecutorFileSystem>`而不附authority标签，调用方容易误用`sandbox=None`。

## 41. 值得保留的优质实现

### 41.1 PathUri延迟到执行主机解释

避免orchestrator误判remote Windows/POSIX路径。

### 41.2 Portable Permission Profile

policy随请求到remote，再由真正执行syscall的host materialize。

### 41.3 Foreign Permission fail-closed

不能转换的context不会降级unsandboxed。

### 41.4 cwd按需删除

减少host路径泄露并避免remote误解释。

### 41.5 一操作一Sandbox Helper

状态短、OS policy闭合、child env可最小化。

### 41.6 Helper env allowlist

明确排除API key、HOME和proxy secret。

### 41.7 Regular File Guard

FIFO/named pipe不会把读取请求挂死或访问非disk handle。

### 41.8 512MiB metadata+actual双检查

文件增长竞态不会绕过总read cap。

### 41.9 Handle-based stream

path replacement后继续固定file identity，支持随机offset。

### 41.10 32B ID、128 handles、1MiB block

File stream有明确per-connection和per-call预算。

### 41.11 Empty nonterminal与oversized block防御

恶意/错误remote不会制造无限loop或超大chunk。

### 41.12 Bounded deterministic Walk

depth、directories、entries、response bytes四重限制，BFS+sort可复现。

### 41.13 Symlink Cycle Detection

canonical identity避免follow模式无限遍历。

### 41.14 Walk partial errors与truncated

调用者能区分空结果、局部失败和预算截断。

### 41.15 Method-not-found compatibility fallback

新client仍能访问旧remote server。

### 41.16 Remove不跟随symlink target

破坏性操作的link语义清晰。

### 41.17 Copy descendant防护

考虑existing ancestor、symlink与`..`组合，不只做字符串prefix。

## 42. 当前实现的主要缺口

### 42.1 Platform-sandboxed streaming read不支持

安全大文件读取只能二选一：buffered sandbox或unsandboxed stream。

### 42.2 Buffered remote cap与transport不协调

512MiB decoded会产生约683MiB base64和多份内存。

### 42.3 Helper无timeout/stdout/stderr cap

`wait_with_output`可无限等待或聚合大输出。

### 42.4 Write无decoded/encoded bytes预算

大base64 request在RPC和server内存中多份放大。

### 42.5 Write非原子且无receipt

truncate后失败、fsync缺失和response丢失都难恢复。

### 42.6 Remove默认recursive+force

raw protocol omission会选择最宽松破坏性行为。

### 42.7 Recursive Copy/Remove无entry/bytes/depth/deadline

大目录操作不可预测且可能partial commit。

### 42.8 ReadDirectory无entry/response cap与truncated

大目录可生成无界Vec/RPC response。

### 42.9 ReadDirectory静默skip metadata错误

结果不能作为完整审计manifest。

### 42.10 文件名强制lossy UTF-8

非UTF-8名字不可精确round-trip。

### 42.11 File Handle不进入Session Recovery

transport重连无法继续旧stream。

### 42.12 Stream Drop close只是best-effort

runtime/transport失效时要等connection shutdown释放。

### 42.13 File handle没有open identity receipt

缺size、mtime、inode/file ID或content generation，恢复时无法验证同一文件。

### 42.14 Primitive Walk跨多个时刻

fallback过程中目录变化会产生非snapshot结果。

### 42.15 Error code压缩PermissionDenied

remote caller不能区分sandbox拒绝与参数错误。

### 42.16 Caller可传sandbox=None

Exec Server没有principal minimum policy；连接authority过强。

### 42.17 App Server Host FS是unsandboxed control plane

必须单独鉴权，不能依赖Thread Permission。

### 42.18 Capability Arc仍可能退化为ID回查

Environment replacement时filesystem generation可能与Step readiness证据不一致。

### 42.19 Copy/Write缺CAS与content digest

并发写者、重复请求和ambiguous response无法对账。

### 42.20 Helper PATH仍来自parent allowlist

虽排除secret，但若wrapper discovery依赖PATH，仍需保证PATH本身来自可信启动环境。

## 43. 更稳健的Filesystem Contract

```ts
type FileRuntimeBinding = {
  environmentId: string
  generation: number
  authority: 'internal' | 'control-client' | 'agent-tool'
}

type FileReadLease = {
  leaseId: string
  binding: FileRuntimeBinding
  path: string
  fileIdentity: string
  sizeAtOpen: number
  modifiedAtOpen: string
  expiresAt: string
  maxBytes: number
}

type FileMutationReceipt = {
  operationId: string
  binding: FileRuntimeBinding
  path: string
  previousDigest?: string
  committedDigest?: string
  terminal: 'committed' | 'rejected' | 'ambiguous' | 'partial'
  bytes: number
}
```

改进原则：

1. restricted stream由sandboxed long-lived helper或broker持有lease；
2. helper有总deadline、stdout/stderr和request bytes cap；
3. write采用temp+fsync+rename，并支持expected digest；
4. copy/remove先返回bounded manifest/plan，再按operation ID执行；
5. destructive options必填且默认false；
6. readDirectory也返回truncated/errors/cursor；
7. handle与Environment generation、Session、principal绑定；
8. retry必须依据commit receipt。

## 44. 对当前NestJS Agent项目的翻译

当前SEO Agent短期不需要remote filesystem，但文件导入、站点附件、报告artifact也应区分authority。

### 44.1 不把上传路径当可信文件路径

Web上传应转成opaque artifact ID：

```ts
type ArtifactRef = {
  artifactId: string
  ownerId: string
  sha256: string
  bytes: number
  contentType: string
}
```

Tool只能通过artifact service读取，不能接受任意server path。

### 44.2 Buffered与Stream分界要由预算决定

例如：

- 小于5MiB的文本可buffer并严格decode；
- 大文件按chunk stream；
-无论哪种都有total bytes cap；
-解析器也有行数、DOM节点或压缩展开预算。

### 44.3 写报告要原子发布

数据库记录和object storage artifact采用staging key + digest + commit receipt，不在最终key上直接truncate写。

### 44.4 AgentStep只记录引用与digest

不要把完整文件bytes/base64写进Step。记录artifact ID、size、digest、authority、读取范围与truncation。

### 44.5 删除默认应保守

删除artifact需要owner校验和显式ID；递归删除一个Conversation的所有artifact应先列manifest并提供幂等operation ID。

## 45. 建议验证矩阵

| 场景 | 应验证的事实 |
| --- | --- |
| foreign PathUri发给remote | 只在remote解释，不在host误转 |
| foreign permission发给错误host | fail closed，不走unsandboxed |
| permission不依赖cwd | remote payload删除host cwd |
| helper启动 | env只含allowlist，network restricted |
| FIFO/named pipe read | 快速拒绝，不等待writer |
| 文件metadata后增长超cap | actual read二次检查拒绝 |
| 512MiB remote buffered | 协议级更小cap先拒绝 |
| sandboxed large stream | 有安全stream方案或明确产品拒绝 |
| path在stream中被替换 | 继续原file identity |
| exact 1MiB倍数 | EOF额外read语义明确 |
| 第129个open handle | 明确拒绝且close后释放容量 |
| partial block后transport断线 | stream失败，不能伪装EOF |
| reconnect再read旧handle | 明确unknown/recovery策略 |
| write response丢失 | 可凭operation/digest查询commit |
| raw remove省略选项 | 不得默认recursive+force |
| copy到source symlink descendant | 拒绝且OS sandbox兜底 |
| walk symlink cycle | visited canonical identity终止 |
| walk超4MiB/50k entries | truncated=true且保留已有结果 |
| readDirectory metadata失败 | 返回单项error而非静默skip |
| 非UTF-8文件名 | 有opaque bytes/URI表示 |
| App Server FS client | 独立鉴权和审计，不继承Thread假象 |

## 46. Teach-back

### 46.1 为什么SandboxedFileSystem要启动子进程？

因为文件权限必须在实际syscall处由OS enforcement约束。主进程先检查path再直接读会有symlink/TOCTOU和绕过风险。

### 46.2 为什么remote stream必须先open handle？

如果每个block按path重新open，文件可能在块之间被替换，最终内容来自多个文件。固定descriptor提供一次读取内的file identity。

### 46.3 为什么有512MiB cap仍不能放心remote readFile？

decoded 512MiB经base64变约683MiB，还会在helper、RPC、serializer和client复制；它超过transport合理边界。资源预算必须逐层一致。

### 46.4 为什么Walk比ReadDirectory更适合Agent？

Walk有确定排序、深度/目录/entry/response bytes预算、局部errors和truncated；Agent能知道自己看见的是不完整视图，而不是把静默缺失当完整事实。

### 46.5 当前最值得保留和最该补齐的是什么？

最值得保留的是PathUri、portable sandbox、helper env最小化、fixed file handle和bounded walk；最该补齐的是sandboxed streaming、原子写/receipt、recursive mutation预算、readDirectory completeness和handle recovery/generation。

## 47. 结论

Codex的Environment Filesystem已经形成完整分层：

```text
portable PathUri + Permission
-> local/remote Environment binding
-> direct or OS-sandboxed execution
-> buffered operation or fixed-handle stream
-> bounded structured result
```

它证明了Filesystem能力的关键不是封装API数量，而是保证路径在正确主机解释、权限在syscall处执行、流式读取固定file identity、递归扫描有预算并能承认不完整。

当前缺口同样明确：platform sandbox与stream不能组合；buffered read cap和remote transport不匹配；Helper输出、write、readDirectory、copy/remove缺少统一预算与deadline；mutation不是事务且没有receipt；handle不进入Session recovery；App Server与internal FS还存在显式unsandboxed authority。

对云端Agent的迁移结论是：**文件必须是带owner、digest、budget和authority的artifact，不是任意path；读取要冻结identity，写入要原子提交，删除要显式计划，所有partial/truncated都必须进入可见结果。**
