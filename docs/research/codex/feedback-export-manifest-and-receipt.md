# Feedback Export Manifest、SQLite Scope 与 Upload Receipt

[Feedback、诊断与隐私边界](./feedback-and-diagnostics.md) 已经说明反馈链路是一条高权限数据出口。本文继续沿真实源码下钻一个更具体的问题：

> 用户在TUI看到的附件清单、App Server实际发现的本地制品、Sentry最终收到的Envelope，是否属于同一个可证明的export transaction？

结论是：当前实现有清晰的UI同意步骤、Thread结果归属、日志预算和best-effort enrich，但没有稳定的operation ID、冻结manifest、artifact identity和可验证receipt。系统中实际存在三份不同时间生成的“附件清单”，它们可能合法漂移，也可能扩大本地文件读取范围。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/tui/src/bottom_pane/feedback_view.rs`
- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui/src/app/background_requests.rs`
- `codex-rs/tui/src/app/thread_events.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/feedback.rs`
- `codex-rs/app-server/src/request_processors/feedback_processor.rs`
- `codex-rs/app-server/src/request_processors/feedback_doctor_report.rs`
- `codex-rs/feedback/src/lib.rs`
- `codex-rs/feedback/src/feedback_diagnostics.rs`
- `codex-rs/state/src/log_db.rs`
- `codex-rs/state/src/runtime/logs.rs`

## 2. Feedback不是一个动作，而是六阶段Export

当前调用链可以拆成：

```text
1. Preview
   TUI根据当前ChatWidget推测会上传哪些文件

2. Consent
   用户选择includeLogs=true/false

3. Request Capture
   提交note时捕获originThreadId、rolloutPath、turnId

4. Discovery
   App Server重新查Thread subtree、rollout、Guardian、sandbox log、SQLite logs

5. Assembly
   CodexFeedback读取paths、clone buffers、生成Sentry Envelope

6. Delivery
   send_envelope + 最多10秒flush，返回threadId
```

这六步没有共享operation identity。请求只携带：

- classification；
- reason；
- optional threadId；
- includeLogs；
- optional extraLogFiles；
- optional tags。

没有携带：

- consent ID；
- preview manifest hash；
- artifact IDs；
- expected file size/hash；
- account generation；
- request idempotency key；
- upload receipt expectation。

## 3. 三份Manifest

### 3.1 UI Preview Manifest

TUI同意页按当前ChatWidget状态列出文件名：

- 固定显示 `codex-logs.log`；
- 固定显示 `codex-doctor-report.json`；
- Windows当前sandbox log存在时显示 `windows-sandbox.log`；
- 当前rollout path有basename时显示它；
- 只要当前有threadId，就预测一个 `auto-review-rollout-<threadId>.jsonl`；
- 当前environment diagnostics非空时显示connectivity diagnostics文件名。

这份清单只用于渲染，用户点击Yes后只产生一个bool：

```text
includeLogs = true
```

文件名、顺序、bytes、source path和hash都不会随consent进入请求。

### 3.2 App Server Discovery Manifest

服务器收到请求后重新发现：

- root Thread及最多7个最新descendants；
- 每个Thread的live或State DB rollout path；
- live root Thread的Guardian trunk rollout；
- 当前Windows sandbox log；
- client传入的全部extraLogFiles；
- SQLite feedback logs或ring fallback；
- 新运行的doctor report；
- snapshot时收集的proxy diagnostics。

这份清单比UI preview更宽，也更晚。

### 3.3 Envelope Manifest

真正上传前，FeedbackSnapshot再次处理：

1. includeLogs时加入codex-logs；
2. clone in-memory doctor attachments；
3. includeLogs时生成connectivity attachment；
4. 逐个 `fs::read` path-backed attachments；
5. 路径读取失败则跳过；
6. 根据filename推断MIME；
7. 加入Sentry Envelope。

因此最终清单可能比Discovery少，也可能因文件内容在等待期间变化而与Preview不同。

## 4. Preview与Actual的具体漂移

### 4.1 UI不展示descendant rollouts

TUI只知道当前rollout和预测的auto-review filename。

App Server会调用 `list_agent_subtree_thread_ids`，root固定保留，再附加最多7个最新descendants的rollout。

用户同意页没有列出这些descendant filenames，也没有说明会上传Agent subtree。

### 4.2 UI总是预测Doctor，但Doctor是best-effort

同意页固定显示doctor report。实际上传时：

- 当前executable不可解析；
- spawn失败；
- 25秒timeout；
- stdout没有JSON object；
- JSON解析失败；

都会跳过doctor附件。

这是一种“预告可能包含”的清单，不是精确manifest。

### 4.3 UI预测Auto Review，但运行时可能没有Guardian path

ChatWidget只要有threadId，就把预测filename传给同意页。

App Server只有在：

- live Thread仍可取得；
- `guardian_trunk_rollout_path()`返回Some；
- path未被原始PathBuf去重；

时才加入附件。

所以UI可能展示一个最终不存在的文件。

### 4.4 Preview diagnostics与Upload diagnostics不是同一Snapshot

打开同意页时，TUI自己的CodexFeedback snapshot读取环境变量。

App Server收到请求后又从它自己的Feedback对象重新snapshot并读取环境变量。

如果两个进程环境不同，或代理环境在两步之间变化，用户看到的connectivity details不一定等于真正上传内容。

### 4.5 Good Result隐藏details但仍可上传原值

Good Result类别不会把proxy details逐条显示在popup中，但只要用户选择Yes：

- diagnostics filename仍显示；
- raw proxy values仍进入attachment。

这不是字段级consent，只是类别相关的UI展示差异。

### 4.6 提交时重新捕获Origin

用户点击Yes后先进入note输入页；真正按Enter提交时，App层才从当前ChatWidget捕获：

- originThreadId；
- rolloutPath。

同意页本身没有冻结Thread identity。正常单界面交互通常仍是同一Thread，但协议没有consent-time Thread generation可供校验。

## 5. includeLogs不是完整的数据出口Gate

`includeLogs=false`只关闭部分server-discovered内容：

- 不查Thread subtree；
- 不查SQLite feedback logs；
- 不加rollout/Guardian/sandbox；
- 不运行doctor；
- 不加ring codex-logs；
- 不加connectivity diagnostics。

但 `extraLogFiles` 在这个if之外无条件追加。

所以以下RPC在协议上有效：

```json
{
  "classification": "other",
  "includeLogs": false,
  "extraLogFiles": ["/path/to/readable-secret"]
}
```

Feedback crate的测试也明确证明：path-backed attachments在includeLogs=false时仍会加入。

官方TUI只在includeLogs=true时发送rollout path，但App Server协议不是TUI私有实现，不能把client自律当服务端授权。

## 6. extraLogFiles是一项Host Filesystem Egress Capability

App Server对extraLogFiles当前只做raw PathBuf去重。它不会：

- 要求path位于Codex home；
- 要求path属于目标Thread rollout；
- canonicalize后检查allowlist root；
- 拒绝symlink escape；
- 拒绝FIFO、device或其他特殊文件；
- 限制数量；
- 限制单文件大小；
- 限制总附件大小；
- 比较preview时的inode/size/hash；
- 要求includeLogs=true；
- 绑定调用client的consent证明。

上传线程在 `spawn_blocking` 中执行同步 `fs::read`，因此：

- 普通大文件会一次性进入内存；
- FIFO可能长期阻塞blocking worker；
- 文件可在discovery与read之间被替换；
- symlink target可在同意后变化；
- 相同实际文件通过不同path表达可绕过raw PathBuf去重。

它不是“多传一个日志文件”的普通字段，而是让RPC调用方指定本地读取并外发的host capability。

## 7. 日志事实有Ring与SQLite两条路径

### 7.1 Process-global Ring

CodexFeedback logger layer独立于调用者RUST_LOG，默认捕获TRACE，只排除一个高敏时序target。

Ring：

- 固定4 MiB；
- 以bytes从头淘汰；
- snapshot时clone全部bytes；
- 不按Thread过滤；
- 不保证从完整UTF-8字符或完整log line开始。

snapshot传入threadId只改变metadata，不改变ring内容选择。

### 7.2 SQLite Log DB

LogDbLayer：

- on_event使用 `try_send` 写入容量512的queue；
- queue满时entry被静默丢弃；
- background task最多128条一批；
- 默认2秒flush interval；
- feedback开始时显式flush已被queue接受的早期entries。

flush只能证明排在Flush command之前且成功进入queue的日志已处理，不能找回queue满时已经drop的entries。

### 7.3 logs_override的fallback语义

App Server查询SQLite后：

- 有非空结果：作为 `logs_override`，替代ring；
- 空结果：传None，最终回退到ring；
- query error：传None，最终回退到ring；
- 没有State DB：回退到ring。

这意味着“Thread-scoped SQLite日志不可用”不会生成空附件或显式degraded status，而会静默扩大为process-global 4 MiB ring。

从可用性看这保留了诊断；从隐私和scope看，这是一次未向用户说明的fallback widening。

## 8. SQLite Feedback Log的Scope算法

### 8.1 Thread rows

查询直接选择请求Thread集合中的rows。

每个Thread在写入时有独立保留预算：

- 约10 MiB estimated bytes；
- 最多1000 rows；
- 新增与prune同一个SQLite transaction；
- 全局另有10天startup retention清理。

### 8.2 Threadless rows

许多启动、网络和全局日志没有threadId。为补充这些诊断，查询先找每个请求Thread最近一条带process_uuid日志，再加入：

```text
thread_id IS NULL
&& process_uuid IN selected threads' latest process UUIDs
```

这是一种有意的scope扩张：目标Thread的日志会携带其最近App进程的threadless日志。

优点是能看到启动/auth/connectivity故障；代价是同一process中其他Thread附近的全局事件也可能进入。

### 8.3 只选每个Thread最新Process

Thread跨App Server重启时，早期进程的threadless rows不会因该Thread被选中而自动加入，除非另一个选中Thread的latest process刚好指向它。

这减少历史process-global混入，但会让跨重启诊断不完整。

### 8.4 合并后的10 MiB是总窗口

`query_feedback_logs_for_threads`对所有请求Threads和匹配的threadless rows按时间倒序合并，再用一个10 MiB累计预算取最新suffix，最后反转为时间正序输出。

它不是“每个Thread各10 MiB”。一个高日志量descendant可以挤掉root的旧日志。

### 8.5 预算是保守estimated bytes

estimated_bytes包含：

- feedback body；
- level；
- target；
- module path；
- file path。

最终codex-logs格式只输出timestamp、level和feedback body。因此SQL累计预算可能比实际附件bytes更大，导致附件小于10 MiB。

单条row若自身估算超过预算，会被整体排除，不截断后保留尾部。

## 9. Thread Tree选择是另一个有界投影

当includeLogs=true且提供threadId时：

1. 尝试列出完整Agent subtree；
2. 失败时fallback到root；
3. root始终保留；
4. descendants按UUIDv7字符串排序；
5. 超过7个时只保留最新7个；
6. 写warning，但不把truncation写进response。

这个上限只限制Thread数量，不限制：

- 每个rollout大小；
- Guardian rollout大小；
- Windows log大小；
- extraLogFiles大小；
- doctor stdout大小；
- Sentry envelope总大小。

“最多8个Thread”不能等价为“上传已受总资源预算保护”。

## 10. Rollout Path的双来源与去重

对每个Thread，App Server优先：

1. 从live Thread对象取rollout path；
2. 取不到则从State DB `find_rollout_path_by_id`解析。

这让已卸载或归档Thread仍可附带rollout，是很好的live/durable fallback。

但最终dedupe只比较PathBuf值：

- 不解析realpath；
- 不比较inode/file ID；
- 不比较content hash；
- 不区分同名不同文件；
- 不阻止client extra path与server-discovered path指向同一target的不同别名。

## 11. Doctor Enrich的优点与资源缺口

Doctor report是明确的best-effort enrich：

- 复用当前Codex executable的 `doctor --json`；
- `kill_on_drop(true)`；
- 25秒timeout；
- 只接受可解析JSON；
- pretty-print为内存attachment；
- 从新旧checks shape提取低基数status tags；
- tag value按Unicode字符截断到256。

值得学习的是主反馈不依赖doctor成功。

但 `Command::output()` 会把stdout/stderr全部收进内存，只有时间预算，没有输出bytes预算。一个异常doctor进程仍可在25秒内制造大内存占用。

JSON解析从stdout第一个`{`开始，允许executable在JSON前打印启动文字；但JSON后任何额外非空文字都会使整体parse失败。

## 12. Tags有三层Authority，但身份字段不完整

上传tags合并顺序：

```text
canonical reserved tags
  > client-provided tags
  > process-global feedback tags
```

明确保留、不可覆盖的只有：

- thread_id；
- classification；
- cli_version；
- session_source；
- reason。

### 12.1 值得学习：业务identity先占位

reserved tags先写，后续层只填Vacant entry，避免扩展metadata覆盖canonical Thread identity和分类。

### 12.2 account identity不是reserved

App Server把当前auth中的：

- chatgpt_user_id；
- account_id；

通过 `target: feedback_tags` 的tracing event写入process-global metadata map。

但这两个key不在reserved集合。RPC client可以在params.tags中提供同名key，并因优先级更高而覆盖auth-derived值。

因此它们只能当诊断tag，不能当服务端证明的account identity。

### 12.3 Process-global tag可能陈旧

metadata map最多64个不同key，同key后写覆盖，但不会按feedback operation清空。

若：

1. Account A上传或产生auth tags；
2. 用户logout或切换到一个没有这些字段的auth状态；
3. 新feedback路径没有emit新值；

旧account tag仍可能留在process-global snapshot中。

Thread ID是本次snapshot参数，account tags却是长期process cache，二者寿命不一致。

### 12.4 feedback_tags事件也进入raw logs

metadata layer专门提取 `feedback_tags` target；logger layer只排除responses websocket timing，没有排除feedback_tags。

所以同一auth/request diagnostic可能同时：

- 作为Sentry tag；
- 出现在codex-logs原始文本。

即使未来从tag manifest删除敏感字段，也要同步检查raw logger投影。

### 12.5 Client tags没有资源预算

协议允许任意BTreeMap<String, String>。App Server没有限制：

- key数量；
- key长度；
- value长度；
-允许字段集合。

Doctor tags有256字符限制，通用client/process tags没有一致预算。

## 13. Reason同时进入Tag与Exception

reason会：

- 写入reserved `reason` tag；
- 写入Sentry exception value。

TUI只trim空字符串，没有显式字符/bytes上限。

将自由文本note作为高基数tag会带来：

- tag索引膨胀；
- 长值被transport或后端隐式截断；
- 相同敏感文本在两个字段重复；
- receipt无法说明实际保留了哪一份。

更稳的结构是：reason只作为message/context，分类和固定枚举作为tag。

## 14. Classification是String而不是Closed Enum

TUI只发送五种固定值，但协议允许任意String。

Feedback crate对severity的规则是：

- bug/bad_result/safety_check -> Error；
- 其他全部 -> Info。

显示title对未知值统一变为Other，但raw classification tag仍保留调用方字符串。

这会让统计维度出现任意高基数值。App Server应在边界反序列化成enum或执行allowlist验证。

## 15. Attachment Assembly的内存模型

一次includeLogs上传可能同时在内存持有：

- 4 MiB ring snapshot；
- 最多约10 MiB SQLite logs override；
- doctor stdout、parsed JSON、pretty JSON、attachment clone；
- connectivity text；
- 每个rollout的完整 `fs::read` bytes；
- sandbox log；
- client extra files；
- Sentry Envelope中的attachments。

即使最终选择SQLite override，早先clone的ring snapshot仍存在于FeedbackSnapshot，直到blocking upload结束。

path-backed附件逐个读入，但全部保存在attachments Vec后才send，并不是streaming upload。

当前没有：

- total bytes preflight；
- per-kind quota；
- streaming file body；
- disk-backed multipart；
- memory reservation；
- upload concurrency gate。

多个client并发feedback/upload会把内存峰值叠加。

## 16. 时间预算不是端到端Deadline

链路中有局部timeout：

- doctor：25秒；
- Sentry flush：10秒。

但没有覆盖整个operation的total deadline。

以下步骤可能额外等待：

- LogDb flush等待background writer；
- Thread subtree查询；
- State DB日志和rollout path查询；
- live Thread guardian path查询；
- blocking `fs::read`；
- Sentry attachment assembly；
- spawn_blocking排队。

`LogDbLayer::flush`没有timeout。若inserter仍存活但卡在SQLite I/O，feedback request可在doctor之前长期等待。

## 17. Path读取失败的Partial Outcome不可见

每个path读取失败时只记warning并跳过，主反馈继续。

这是正确的失败隔离，但response只有：

```json
{ "threadId": "..." }
```

调用方不知道：

- 哪些附件实际读取成功；
- 哪些文件不存在；
- 是否因permission被跳过；
- 是否用了SQLite还是ring fallback；
- subtree是否被截断；
- doctor是否生成；
- connectivity diagnostics是否包含；
-总bytes是多少。

TUI却根据includeLogs bool显示“Feedback uploaded”，不是“Feedback submitted with partial diagnostics”。

## 18. send_envelope与flush不能证明Remote Commit

上传函数：

```text
client.send_envelope(envelope)
client.flush(Some(10s))
return Ok(())
```

它忽略：

- send_envelope是否被transport接受的细节；
- flush的bool/完成结果；
- event ID；
- server response；
- attachment-level status。

所以当前Ok最多表达“本地构造未报错并调用了发送/flush”，不能证明远端已经保存反馈。

这是一种ambiguous delivery。若用户立即重试，系统也没有feedback operation ID做去重，可能生成重复Sentry events。

## 19. Thread-scoped UI回执路由值得学习

提交前TUI捕获originThreadId。后台RPC完成后，FeedbackSubmitted事件仍带该origin。

如果用户已切换到其他Thread：

- 结果写入原Thread的event store；
- inactive Thread不直接渲染；
- 切回时可以replay；
- feedback completion属于少数session refresh后仍保留的buffer event。

这是正确的异步ownership设计。

### 19.1 仍缺operation identity

FeedbackThreadEvent只保存：

- category；
- includeLogs；
- audience；
- Result<threadId, error>。

没有operationId。如果同一Thread同时提交两次相同分类，UI无法区分、取消或对账。

### 19.2 有界buffer可能淘汰结果

Feedback completion与其他ThreadBufferedEvent共用capacity。push后若超限，从头淘汰一项；只有被淘汰的interactive request有专门replay修复。

Feedback result本身没有durable store，长时间不访问且buffer高压时可能丢失UI回执。

## 20. 一个更强的Export Transaction

适合云端或多客户端App Server的协议应分为prepare和commit。

### 20.1 Prepare

```ts
interface FeedbackPrepareRequest {
  threadId?: string
  includeDiagnostics: boolean
}

interface FeedbackArtifactDescriptor {
  artifactId: string
  kind:
    | 'thread_logs'
    | 'rollout'
    | 'doctor_report'
    | 'connectivity'
    | 'sandbox_log'
  displayName: string
  bytes: number
  sha256: string
  sensitivity: 'standard' | 'may_contain_paths' | 'may_contain_secrets'
  ownerThreadId?: string
  sourceGeneration: string
}

interface FeedbackPrepareResponse {
  operationId: string
  expiresAt: string
  manifestVersion: string
  artifacts: FeedbackArtifactDescriptor[]
  omitted: Array<{ kind: string; reason: string }>
}
```

prepare应：

- 校验auth和Thread ownership；
- 只从server-owned artifact catalog选择；
- 不接受raw path；
- 规范化并脱敏diagnostics；
- 计算总预算；
- 冻结file handle、immutable copy或content hash；
- 把manifest显示给用户。

### 20.2 Commit

```ts
interface FeedbackCommitRequest {
  operationId: string
  manifestVersion: string
  classification: FeedbackClassification
  note?: string
  consent: {
    acceptedArtifactIds: string[]
    confirmedAt: string
  }
}
```

commit应拒绝：

- operation过期；
- manifestVersion不匹配；
- artifact owner变化；
- file identity/hash变化；
- auth/account generation变化；
- 总大小超预算；
- 重复commit但参数不同。

### 20.3 Receipt

```ts
interface FeedbackCommitReceipt {
  operationId: string
  localStatus: 'assembled' | 'partial' | 'failed'
  remoteStatus: 'accepted' | 'unknown' | 'rejected'
  remoteEventId?: string
  logSource: 'sqlite' | 'ring_fallback' | 'none'
  artifacts: Array<{
    artifactId: string
    displayName: string
    bytes: number
    sha256: string
    status: 'uploaded' | 'skipped' | 'failed'
    errorCode?: string
  }>
  truncations: Array<{
    scope: 'thread_tree' | 'logs' | 'artifact'
    reason: string
  }>
}
```

`remoteStatus=unknown`非常重要：timeout后不能谎称failed，也不能谎称accepted。

## 21. 当前 AI SEO Agent的迁移边界

AI SEO Agent是云端多租户系统，不应接受任何host PathBuf。反馈或支持包只能引用server-owned artifact ID。

建议分层：

```text
FeedbackController
  -> FeedbackPolicyService
  -> FeedbackManifestService
  -> ArtifactStore
  -> RedactionPipeline
  -> FeedbackDeliveryAdapter
  -> FeedbackReceiptRepository
```

### 21.1 Policy

校验：

- tenantId；
- userId/role；
- Conversation/AgentRun ownership；
- 是否允许导出tool input/output；
- 数据保留与地域策略。

### 21.2 Artifact Store

只允许：

- runtime生成的日志artifact；
-已完成的AgentStep observation；
- 经过脱敏的tool receipt；
- server生成的diagnostic report。

不得允许client传对象存储底层key、绝对路径或任意URL。

### 21.3 Redaction Version

每个artifact receipt应记录：

- redaction policy version；
- source artifact version；
- output hash；
-字段级drop统计。

否则日后无法回答“当时按哪版规则脱敏”。

### 21.4 Delivery Adapter

Sentry、support backend或对象存储只是adapter。业务层应拥有operation和receipt，不能把第三方SDK的flush语义直接暴露为“已上传”。

## 22. 建议补充的测试矩阵

### Consent/Manifest

- [ ] Preview列出的每个artifact都有稳定ID、size和hash。
- [ ] Commit不能加入Preview之后新发现的descendant rollout。
- [ ] Doctor失败会在manifest标记omitted，而不是静默消失。
- [ ] Thread切换后旧consent不能提交到新Thread。
- [ ] Account generation变化使operation失效。

### Filesystem/Artifact

- [ ] includeLogs=false时拒绝所有raw extra paths。
- [ ] 绝对路径、`..`、symlink escape、FIFO、device全部拒绝。
- [ ] discovery后inode/hash变化使commit失败。
- [ ] 同一inode的path alias只出现一次。
- [ ] filename collision有稳定重命名或拒绝规则。
- [ ] 单文件、总bytes和并发memory budget生效。

### Log Scope

- [ ] SQLite空结果不会静默扩大到process-global ring。
- [ ] 若允许ring fallback，receipt明确写scope widening。
- [ ] Thread A导出不会混入Thread B owner-tagged日志。
- [ ] threadless rows按明确process generation进入manifest。
- [ ] subtree超过8个时receipt列出omitted Thread IDs。
- [ ] queue drop count进入diagnostic receipt。

### Tags/Identity

- [ ] client tags不能覆盖account_id/chatgpt_user_id。
- [ ] logout后不会复用前一account的process-global tags。
- [ ] feedback_tags原始日志投影经过同样的敏感字段策略。
- [ ] classification是closed enum。
- [ ] note不进入高基数tag。
- [ ] key/value有数量和bytes上限。

### Delivery

- [ ] send失败、flush timeout和remote reject区分状态。
- [ ] 同operationId重试返回同一receipt。
- [ ] attachment partial failure不会被显示为全量success。
- [ ] total deadline覆盖discovery、assembly和delivery。
- [ ] UI迟到结果仍回到origin Thread和operation。

## 23. 最值得学习与最需要修正的边界

### 值得学习

- 文本反馈与日志同意分开；
- optional doctor enrich不阻塞主反馈；
- Thread subtree和日志都有有界选择；
- live rollout到State DB path有fallback；
- canonical tags优先于扩展tags；
- blocking文件读取不占async executor worker；
- 后台结果回到origin Thread；
- inactive Thread可replay反馈完成事件。

### 需要修正

- consent只折叠成bool；
- Preview、Discovery和Envelope没有manifest identity；
- extraLogFiles是未约束host egress；
- SQLite失败静默扩大到process-global ring；
- account tags不是reserved且可能陈旧；
-raw proxy credential被原样展示/上传；
- path读取和doctor output无bytes预算；
-没有端到端deadline；
- flush结果被忽略；
-response没有partial manifest和remote receipt。

## 24. 结论

当前Feedback链路的局部工程质量并不差：UI有明确选择，日志和Thread树有预算，诊断是best-effort，异步结果有owner路由。

真正的问题是这些能力没有被一个不可变export operation串起来：

```text
Preview != Discovery != Envelope != Receipt
```

对云端Agent，反馈导出必须按高权限事务设计：先由服务端冻结manifest，再让用户确认精确artifact集合，最后以operationId幂等提交，并返回逐artifact与远端交付状态。

只有这样，“用户同意了什么”“系统实际读取了什么”“第三方最终接收了什么”才是可以对账的同一件事。
