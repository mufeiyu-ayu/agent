# Agent Jobs Batch Runtime：CSV分片、Worker归属、CAS结果与Crash Recovery缺口

本文研究 Codex实验性`spawn_agents_on_csv`如何把CSV每一行变成独立Agent worker，限制并发、收集结构化结果并导出CSV。重点是批处理Agent系统最容易出错的边界：谁拥有一个item、worker何时算成功、取消后pending items怎么办、runner崩溃后谁接管。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/core/src/tools/handlers/agent_jobs*.rs`、`codex-rs/state/src/{model,runtime}/agent_job*.rs`、`codex-rs/state/migrations/001{4,5}_agent_jobs*.sql`

## 1. Agent Job 是 Parent Tool Call 内的持久批处理状态机

当前调用拓扑：

```text
parent model calls spawn_agents_on_csv
  -> read/parse CSV
  -> transaction creates Job + Items
  -> mark Job running
  -> blocking runner loop
      -> spawn child Thread per pending row
      -> assign Thread to Item
      -> worker calls report_agent_job_result
      -> reap/timeout/finalize
  -> export CSV snapshot
  -> mark Job completed/failed/cancelled
  -> return Tool output to parent model
```

Job/Item状态在SQLite中持久化，但调度loop仍绑定当前Parent Tool future；这决定了它只是“有持久记录的阻塞批处理”，尚不是独立后台Job service。

## 2. Job 与 Item 使用两层状态机

Job：

```text
Pending -> Running -> Completed | Failed | Cancelled
```

Item：

```text
Pending -> Running -> Completed | Failed
```

Item没有Cancelled状态。Job取消时，running workers继续到完成/timeout，pending items保持Pending；导出CSV用Job状态解释整个批次已取消。

两层状态分离是合理的，但Progress里`pending + running + completed + failed = total`，Cancelled Job仍可有大量Pending，不能把“Job terminal”理解成“所有Item terminal”。

## 3. Job + 所有 Items 在一个 SQLite Transaction 创建

`create_agent_job()`：

1. begin transaction。
2. insert Job Pending。
3. 循环insert每个Item Pending。
4. commit。
5. 回读Job。

因此不会出现Job row存在但只插入一半CSV items。Instruction、input headers/path、output path、output schema、max runtime与每行JSON都成为DB事实。

这是批处理最基本但关键的不变量：输入分片清单必须先完整提交，再启动任何worker。

## 4. CSV 解析先做结构一致性与稳定 Item ID

输入处理：

- 异步一次性`read_to_string`。
- 标准csv crate，支持quoted/newline等格式。
- 第一header移除UTF-8 BOM。
- 跳过全空row。
- header不能为空且必须唯一。
- 每行字段数必须与header一致。
- 可选id column；空值fallback为`row-N`。
- 重复ID追加`-2/-3...`直到唯一。
- row index以0存DB，以输入顺序排序。

稳定item identity让结果可追踪到源行；重复source ID仍保留在`source_id`，内部item ID负责唯一。

## 5. 输入/输出文件只支持一个 Local Environment

Tool要求Turn恰好一个environment，且不能remote；cwd必须能转换成host-native absolute path。源码TODO要求未来迁移PathUri。

这是能力诚实：当前调度/CSV I/O发生在App Server host，不能假装支持远端workspace。

但`cwd.join(user path)`对absolute path/`..`的限制没有在这层明确校验；读取与导出也不通过普通Exec Sandbox。应使用environment filesystem capability与root containment，而不是直接host Tokio FS。

## 6. CSV 和 Row 数量没有统一资源上限

当前先把整个文件读成String，再把所有rows、每行JSON、Job Items装入内存并写DB。没有明显：

- file bytes cap。
- row count cap。
- column count/cell bytes cap。
- total serialized row bytes cap。
- prompt expansion cap。

即使worker并发被限制为64，million-row CSV仍会在启动前造成内存/SQLite/导出压力。批处理系统必须分别限制“总任务规模”和“同时执行规模”。

## 7. Concurrency 受 Request、Feature 与 Agent Thread Limit 共同约束

请求可用`max_concurrency`或兼容`max_workers`；归一化：

- 默认16。
- 至少1。
- 代码hard max 64。
- 再与effective agent max threads取min。
- Multi-agent disabled或thread limit 0直接拒绝。

Runner每轮用`max - active`作为pending query limit，只拉当前可用slots，避免一次spawn全部items。

这是良好的两级背压：DB持有全量队列，内存active map只持当前并发窗口。

## 8. Worker Prompt 把 Job/Item Identity 与 Report Contract 写死

每个worker获得：

- Job ID / Item ID。
- 模板展开后的instruction。
- 当前row JSON。
- expected output schema文本。
- 必须恰好调用一次`report_agent_job_result`。
- 可选`stop=true`取消整Job。
- report成功后停止。

Worker Thread的SessionSource标记`agent_job:<jobId>`，Spec Planner只对这类child暴露report tool；普通Thread只有spawn tool。

Tool visibility减少误用，但真正授权仍由DB assigned-thread CAS保证，不能只信SessionSource label。

## 9. Instruction Template 是简单文本替换，不是安全模板语言

`{column}`替换为row value，`{{`/`}}`用sentinel转义。未知placeholder保持原样；非字符串JSON值序列化。

CSV内容直接进入worker prompt，可能包含提示注入文本；instruction owner需要明确row是untrusted data。当前没有XML/JSON隔离标记或每cell长度预算。

批处理业务应把system instruction与row data分通道，至少用typed context envelope而不是字符串拼接。

## 10. 当前 Output Schema 只是 Prompt，不做 Validator

Job model字段TODO明确：应转换为JSON Schema并enforce structured outputs。当前report handler只检查`result`是JSON object，不验证：

- required properties。
- field types。
- additionalProperties。
- enum/format。
- schema size/validity。

因此CSV输出的`result_json`可以不符合用户声明的schema。Prompt约束不是数据契约，尤其不能用于下游自动导入。

## 11. Spawn 发生在 Item Assignment CAS 之前

Runner对Pending Item：

1. 先spawn child agent并投递prompt。
2. 再执行`Pending -> Running + assigned_thread_id + attempt_count++`条件更新。
3. CAS失败则shutdown刚spawn的child。

这避免先claim后spawn失败留下无worker Running item，但引入反向窗口：child可能在DB assignment前已开始Tool/外部副作用。它此时report会因assigned ID不匹配被拒绝，但其他Tools仍可能执行。

更稳方案是先claim reservation，spawn携带claim token，最后activate；spawn失败可lease回收。

## 12. Item Claim 使用状态 CAS，防止双重归属

`mark_agent_job_item_running_with_thread()`条件为：

```text
WHERE job_id=? AND item_id=? AND status='pending'
```

成功时原子设置Running、assigned Thread、attempt+1、清last error。并发runner只有一个能从Pending推进；其他CAS返回false并关掉多余child。

这是正确的DB真相优先：内存active map不是owner，SQL row才是。

## 13. Result Commit 同时验证 Job、Item、状态和 Worker Identity

`report_agent_job_item_result()`单条UPDATE要求：

- job ID匹配。
- item ID匹配。
- status仍Running。
- `assigned_thread_id == reporting_thread_id`。

成功时一次性写Completed、result JSON、reported/completed/updated timestamps、清error和assignment。重复report或foreign worker返回`accepted=false`，不覆盖已提交结果。

这是本专题最值得学习的CAS：Prompt里的ID只用于导航，真正授权来自数据库当前owner。

## 14. Worker Finished 不等于 Item Success

Runner观察child status进入final后：

- Item仍Running且result存在：标Completed。
- Item仍Running且无result：标Failed，原因是未调用report tool。
- Item已由report CAS完成：保持Completed。
- 最后shutdown live child。

因此普通assistant final answer不算批处理结果；必须通过显式Report commit。这把“模型说完成了”和“结构化结果已提交”分开。

## 15. Result Report 与 Worker Finish 存在合理竞态收敛

Report CAS成功会清assigned Thread并把Item Completed；runner随后发现Thread final，再读取Item时不会走Running分支，只关Thread。

若Thread先final、report尚未提交，runner可能把Item Failed；迟到report因status不再Running返回false。Terminal CAS确保唯一结果，但没有grace period等待在途report。

Tool response一般在Thread final前完成，这个顺序依赖Agent lifecycle；异常网络/事件延迟仍值得测试。

## 16. `stop=true` 是“先提交本Item，再取消Job”

Report handler只有accepted=true时才处理stop：

1. 当前Item已原子Completed。
2. 尝试把Job Pending/Running改Cancelled。
3. cancel DB错误被忽略。

Runner下一轮检测Cancelled后停止spawn新Items，但等待active workers结束/timeout。已提交的当前结果保留。

“提交后请求停止”比先取消再写结果更好；但取消写失败不应静默，worker收到accepted=true却不知道Job仍Running。

## 17. Cancel 不立即终止 Active Workers

`cancel_requested=true`后：

- 不再spawn Pending。
- 继续reap stale与finalize finished。
- 只有DB running=0且内存active为空才退出。

它是graceful drain，不是hard cancel。没有向active worker广播interrupt；长worker可能持续到默认30分钟。

API需要区分`cancel-drain`与`cancel-now`，并返回remaining active count。

## 18. Timeout 基于 Item updated_at，没有 Heartbeat

Job max runtime默认30分钟，可由request/config覆盖。Active进程内用`Instant started_at`；recover时从Item `updated_at`推算age。

Item assignment后直到report/fail，没有worker heartbeat更新`updated_at`。合法长任务只要超过固定runtime就被Failed并shutdown，不管仍在持续工作。

这是deadline，不是lease。若要crash takeover和进度监控，需要heartbeat/lease_expires_at + owner generation。

## 19. Status Watch + 250ms Poll 提供有限降级

Active item尽量订阅Agent status watch channel；无订阅或无变化时调用`get_status`，没有finished则最多等待250ms：

- 有watchers：等待任一changed或timeout。
- 无watcher：sleep 250ms。

这避免busy loop，也在watch丢失时维持poll fallback。active item数量最多64，逐个status query仍可控。

## 20. `recover_running_items` 只恢复当前 Runner Loop

Runner启动时会读取Running items：

- stale则Failed并shutdown assigned child。
- 缺/坏thread ID则Failed。
- child final则finalize。
- child仍live则重建active map和watch subscription。

但这个helper只在`run_agent_job_loop(jobId)`入口调用。App Server startup没有通用scanner自动找到所有Running Jobs并重启loop，也没有“resume job”RPC/tool。

Parent Tool future崩溃/取消后，SQLite可能永久留Running Job；持久状态不等于自动恢复执行。

## 21. Parent Tool Cancellation 与 Workers 生命周期分叉

`spawn_agents_on_csv`阻塞等待loop。若Parent Turn取消、App Server重启或Tool future被drop：

- 已spawn child可能继续。
- DB Job/Items保留Running/Pending。
- 没有后台runner继续spawn/reap/export。
- Parent模型收不到Tool terminal output。

真正后台Job必须有独立scheduler owner/lease，不把调度loop寄生在请求future上。

## 22. Job 状态更新多数没有 Transition CAS

Item关键路径有status CAS；Job的`mark running/completed/failed`多为按ID无条件UPDATE。Runner通常先检查Cancelled再mark Completed，但Cancel可在check与UPDATE之间发生，Completed可能覆盖Cancelled。

`mark_cancelled`自身只允许Pending/Running→Cancelled，较安全；其他terminal更新也应要求expected Running和owner generation。

状态机不能只靠调用代码顺序，最终一致性必须下沉到SQL条件。

## 23. Attempt Count 已记录，但没有真正 Retry Policy

Item从Pending claim为Running时attempt+1；但worker spawn普通失败直接把Item Failed，timeout也Failed。只有AgentLimitReached分支放弃本轮并稍后再拉同一Pending item，未产生attempt。

当前没有：

- retryable error分类。
- max attempts。
- exponential backoff。
- attempt history。
- 新worker接管旧Failed/Expired item。

`attempt_count`主要是可观察字段，还不是完整retry subsystem。

## 24. 删除 Thread 时会修复 Job Assignment

State DB删除Thread subtree的事务会：

- 若Job runner parent和worker一起被删，取消对应Job，避免requeue后无人消费。
- 普通assigned worker被删时，Running Item回Pending并清assignment。
- 清残留assigned_thread_id。
- 同事务处理spawn edges/其他Thread rows。

这是优秀的跨表引用修复：Thread lifecycle不能只删Thread表，必须处理外部scheduler ownership。

## 25. CSV Export 是 Snapshot，但不是原子 Artifact Commit

Runner加载所有Items，渲染源columns + job metadata/result/error/timestamps，再：

- create parent directories。
- `tokio::fs::write(output_path, full_string)`。

直接write可能truncate旧文件后中途失败，留下partial CSV；没有temp + fsync + rename、checksum或manifest。Export失败把Job标Failed，但若partial path存在，外层`try_exists`可能不再重导。

DB是结果事实，CSV应视为可重建artifact，必须atomic publish并记录artifact generation/hash。

## 26. Output Path 与 CSV Formula Injection 需要额外治理

Exporter正确处理逗号、换行、CR和双引号，但不会对以`= + - @`开头的cell做spreadsheet formula neutralization。用户在Excel打开CSV时，untrusted row/result/error可能触发公式。

同时output path来自模型参数，缺明确workspace root policy。批处理artifact必须经过路径capability和CSV consumer安全策略。

## 27. 空 Job 可以自然完成

CSV有headers但无非空rows时，Job创建0 items。Runner看到pending/running/active都为0，导出只有header的CSV并标Completed。

这是确定且可用的语义；产品可以选择接受空批次或在输入验证时拒绝，但必须明确，不应卡住loop。

## 28. 当前最值得保留的设计

1. Job+Items同事务创建，先完整提交work list再执行。
2. DB Pending→Running CAS决定唯一worker owner。
3. Result commit绑定reporting Thread ID并原子terminal。
4. Worker final但未Report明确Failed，不把自然结束当成功。
5. 并发窗口只从DB拉slots数量的Pending items。
6. Agent limit、feature和hard max共同约束并发。
7. Status watch有poll fallback与有限等待。
8. Job取消停止新spawn但保留已完成结果。
9. Thread删除事务修复Job/Item ownership。
10. CSV artifact可由DB Items重新生成。

## 29. 当前需要改进或避免的边界

1. Runner寄生Parent Tool future，startup无Running Job自动接管。
2. Spawn-before-claim允许未激活worker短暂执行副作用。
3. Job terminal更新缺expected-state/owner CAS，存在Cancel→Completed竞态。
4. Timeout无heartbeat，只是固定deadline。
5. Attempt count无retry/backoff/history策略。
6. Output schema仅进Prompt，不做JSON Schema验证。
7. CSV file/rows/cells/prompt expansion无总budget。
8. Host path I/O未通过environment capability/root containment。
9. Cancel不interrupt active worker，stop写失败被忽略。
10. CSV direct write非原子，partial path可阻止重导。
11. CSV cells未防formula injection。
12. Item无Cancelled/Skipped状态，Cancelled Job progress仍含Pending。
13. Parent取消后缺worker cleanup/Job receipt。

## 30. 更适合云端 Agent 的 Job Lease

```ts
type JobItemLease = {
  jobId: string;
  itemId: string;
  attempt: number;
  workerRunId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  heartbeatAt: string;
};

type ItemResultReceipt = {
  jobId: string;
  itemId: string;
  attempt: number;
  leaseTokenHash: string;
  resultArtifactId: string;
  schemaVersion: string;
  committedAt: string;
};
```

Scheduler独立于HTTP/Tool request，按DB lease claim；worker先获得lease再启动AgentRun，heartbeat续租；结果提交验证lease token + attempt + schema。Scheduler crash后其他实例接管expired lease。

## 31. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| CSV | BOM、quoted newline、重复header/ID、空row、0 rows、巨大file/row/cell |
| Path | relative/absolute/`..`、symlink、remote env、multiple env、权限拒绝 |
| Create | Job+Items事务中途失败、duplicate job/item、0 items |
| Concurrency | 1/16/64、agent max、两个runner同Job、AgentLimitReached |
| Ownership | spawn-before-CAS、CAS loser shutdown、foreign report、duplicate/late report |
| Schema | invalid schema、result非object、required/type/additional properties |
| Lifecycle | worker final无report、report后final、report/final竞态、shutdown失败 |
| Cancel | stop=true、active drain、hard cancel、cancel DB失败、Cancel/Complete竞态 |
| Timeout | 进程内Instant、restart age、future timestamp、heartbeat、lease takeover |
| Recovery | Parent cancel、process crash、startup scanner、orphan child、Running Job resume |
| Retry | spawn/network/provider retryable、max attempts、backoff、attempt history |
| Export | atomic temp/rename、磁盘满、partial existing file、formula injection、checksum |
| Delete | worker delete requeue、runner+worker subtree cancel、foreign references |

## 32. 对当前项目的学习结论

当前AI SEO Agent未来做批量关键词/页面分析时，应从独立Job service起步，而不是在一个HTTP/Tool调用里await全部：

1. Job与Items事务创建，返回Job ID后由scheduler异步执行。
2. 每个Item claim使用lease token + attempt CAS，AgentRun绑定该lease。
3. Worker结果必须通过Zod/JSON Schema和tenant/job ownership验证。
4. Scheduler有heartbeat、stale takeover、max attempts、backoff和dead-letter。
5. Cancel区分停止派发、优雅drain和立即interrupt。
6. Progress状态包含Pending/Running/Succeeded/Failed/Cancelled/Skipped。
7. Artifact从DB canonical results原子生成，可重建并带hash。
8. CSV/路径/Prompt都有容量与注入边界。

Codex最优质的部分是输入清单事务、Item owner CAS、reporting Thread绑定、显式Report成功、并发slot调度和Thread删除引用修复。需要避免的是Parent future承担scheduler、spawn-before-claim、无heartbeat/startup recovery、schema只靠Prompt、Job transition非CAS、CSV非原子写和取消/重试状态不完整。
