# Rollout Write Durability：排队、可读、Flush、Fsync 与投影提交是不同承诺

本文研究 Codex 的 `LiveThread -> ThreadStore -> RolloutRecorder -> JSONL` 写入链，重点是一次 append从内存进入文件、SQLite投影和客户端事件时，各层到底承诺了什么。它不是 Rollout数据模型总览，而是专门分析写入顺序、故障恢复和durability gap。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. 一次持久化经过五个边界

本地 Thread的典型路径是：

```text
Session.persist_rollout_items
  -> LiveThread.append_items(raw items)
  -> LocalThreadStore.append_items
  -> RolloutRecorder.record_canonical_items
  -> bounded mpsc queue
  -> single rollout_writer
  -> JSONL write + flush
  -> ThreadMetadataSync.observe_appended_items
  -> SQLite metadata patch
```

这里至少有五种不同状态：

1. 调用者构造了事实。
2. writer queue接受了事实。
3. JSONL对当前进程可读。
4. SQLite查询投影追上了JSONL。
5. 数据经历断电后仍存在。

Codex在前四层做了大量保护，但第5层并不等价于当前 `flush()` 的名字。

## 2. ThreadStore 把存储实现从 Session 隔离

`ThreadStore` 规定：

- `append_items`：向live thread追加raw rollout items。
- `persist_thread`：若是lazy storage则物化，再保存排队内容。
- `flush_thread`：等待排队内容 durable/readable。
- `shutdown_thread`：flush并关闭writer。
- `discard_thread`：放弃live writer，不强制未提交内存内容落盘。

Core只依赖 `LiveThread`，本地实现可用JSONL，远程实现可用服务端存储。这是正确的端口设计：生命周期语义留在Core，介质细节留在Store。

但接口中的“durable”是逻辑契约；具体实现是否真的调用fsync，仍需单独审计，不能从方法名推断。

## 3. Raw item、durable item 与 metadata fact 分开

`LiveThread.append_items()` 同时拿到raw items和按 `ThreadHistoryMode`过滤后的persisted items：

- raw items交给store；store必须再次应用共享policy。
- filtered items用于persistence telemetry和metadata观察。
- transient delta、approval request、stream error等不会进入durable replay。
- Legacy与Paginated对 `ItemCompleted`、legacy events的保留规则不同。

这说明“客户端收到过事件”不等于“Resume能重放该事件”。持久化policy是显式事实筛选，而不是把event bus原样dump进数据库。

本地store再次调用 `persisted_rollout_items()`，形成防御性双层过滤。虽然有重复计算，但能保证自定义调用者不能绕过canonical policy。

## 4. 新 Thread 延迟物化，避免空文件冒充会话

Create模式预先计算路径和 `SessionMeta`，但不立即创建文件：

- `writer = None`。
- `deferred_log_file_info = Some(...)`。
- `meta = Some(...)`。
- items先进入 `pending_items`。

第一次 `persist()` 或有pending items的 `flush()` 才创建目录/文件，先写SessionMeta，再写items。`LiveThreadInitGuard` 在session初始化失败时调用discard，避免仅仅尝试启动一次就留下空 rollout。

这是良好的materialization boundary：

```text
allocated identity/path != durable thread existence
```

当前云端 Agent也应区分“生成Run ID”和“已经创建可查询Run记录”；若产品需要立即可见，则显式提交一条Created fact，不要依赖对象构造副作用。

## 5. 单 writer + 有界队列提供顺序和背压

`RolloutRecorder` 使用容量256的Tokio mpsc，后台单task独占文件句柄。好处是：

- 调用线程不执行blocking file I/O。
- 一个recorder内的命令按队列顺序处理。
- queue满时sender await，形成背压而不是无限内存增长。
- `Persist`、`Flush`、`Shutdown` 带oneshot ack，可作为前序命令barrier。

但256是“命令数”而非bytes/item weight。一个 `AddItems(Vec<RolloutItem>)` 可以非常大，因此内存上限并非 `256 × 小消息`。更完整的资源控制还需batch bytes和单item bytes cap。

## 6. Queue admission 不等于磁盘提交

`record_canonical_items()` 只等待 `AddItems` 成功进入channel。它不等待writer写文件。

`RolloutRecorder` 层因此明确区分：

- `record_canonical_items()`：accepted by queue。
- `persist()/flush()`：等待writer处理前序命令并返回I/O结果。

本地 `LocalThreadStore.append_items()` 在queue admission后立刻再调用 `recorder.flush()`，所以 `LiveThread.append_items()` 对本地实现通常等到JSONL可读后才返回。这个额外barrier不能被误认为所有ThreadStore实现天然都有；远程store必须自己兑现接口契约。

## 7. Metadata 不允许跑在 canonical JSONL 前面

本地append顺序是：

1. shared policy过滤。
2. queue canonical items。
3. `recorder.flush()`。
4. `ThreadMetadataSync`从同批filtered items派生patch。
5. 更新SQLite metadata。

源码注释明确：等待local writer，是为了避免SQLite对“accepted live append”领先于JSONL。这样列表preview/title/token usage只会观察到已经进入canonical history的事实。

这比“先更新列表页，再异步写历史”更可靠，因为崩溃后不会出现查询投影宣称有一条消息，而canonical rollout完全没有它。

## 8. Metadata generation 防止旧 ack 清掉新 patch

`ThreadMetadataSync` 保存：

- `pending_update`。
- `pending_update_generation`。
- touch节流时间。

每次新观察merge patch并推进generation。SQLite写成功后，只有ack携带的generation仍等于当前generation，才清空pending update。若写入期间又观察到新事实，旧成功不能误删新pending patch。

这是典型的：

```text
snapshot -> async write -> compare generation -> acknowledge
```

它比一个boolean `metadataDirty`更安全，适合任何“canonical log后异步更新projection”的场景。

## 9. JSONL成功、Metadata失败仍是 partial commit

若JSONL flush成功但SQLite update失败：

- canonical item已经存在。
- pending metadata不会被mark applied，可在后续flush/update时重试。
- `LiveThread.append_items()` 返回错误。

这是一种可修复partial commit，但调用者必须知道“error不等于什么都没发生”。如果上层把整个append原样重试，本地JSONL没有通用append idempotency key，会重复写canonical item。

Session当前 `persist_rollout_items()` 只记录错误并继续，不会立即盲目重放整批；这是避免重复的一种保守选择。更成熟的store contract应返回分阶段结果：

```ts
type AppendReceipt = {
  canonicalCommitted: boolean;
  projectionCommitted: boolean;
  appendId: string;
};
```

## 10. Pending suffix 只在完整item写成功后移除

writer依次处理 `pending_items`：

1. 读取当前ordinal。
2. 序列化一整行。
3. `write_all(json + "\n")`。
4. `flush()`。
5. advance ordinal。
6. 增加 `written_count`。

循环结束后只drain已完整成功的prefix。发生错误时，未成功item及其后缀仍留在内存。writer进入recovery mode、丢弃文件句柄、重开文件并自动再试一次。

这比在开始写前就pop queue安全：失败不会直接丢掉所有未写事实。

## 11. 一次自动重开重试，失败后仍保留内存

`write_pending_with_recovery()`：

- 第一次失败：记录详细I/O kind/os error，`writer = None`。
- 重新open。
- 再执行一次完整pending write。
- 第二次失败：向 `persist/flush/shutdown` caller返回error，pending仍保留。

后续caller还可以再次flush。`shutdown()`失败时writer不会退出，允许调用者修复文件系统问题后重试shutdown。

这是“失败可重试”而非“失败即task死亡”。只有后台task真正terminal退出时，`terminal_failure`才为之后的API调用保留根因。

## 12. Torn tail 被隔离，不会被原地修复

若进程崩溃或 `write_all` 中途失败，JSONL最后可能只有半行。Resume/open时 `ensure_rollout_is_newline_terminated()` 只做：

- 文件非空且最后一byte不是换行时，追加换行并flush。

它不会验证最后一行JSON，也不会truncate回最后一个valid offset。因此半行会成为永久invalid record；后续新记录从下一行继续。

Reader遇到malformed line会：

- 增加 `parse_errors`。
- warning或trace。
- 跳过该行并继续。

这是availability-first：一条坏记录不让整个Thread不可恢复。但它不是数据修复，也没有证明被跳过的item可从别处重建。

## 13. Flush失败后的重复窗口仍存在

`JsonlWriter.write_line()` 的顺序是 `write_all` 后 `flush`。若OS已经接受完整bytes，但 `flush()` 返回错误：

- 当前item不会从pending drain。
- ordinal不会advance。
- reopen后会再次写同一个item。
- 文件里可能已经存在一条完整旧行。

Paginated模式甚至可能出现相同ordinal的两条valid records，因为recovery只重开文件句柄，不会重新扫描ordinal state或按append ID去重。

这种窗口很难只靠文件API消除。常见方案是：

- 每条fact携带稳定event ID，replay按ID去重。
- framed record含length/checksum/commit marker。
- 数据库唯一约束 `(thread_id, event_id)`。
- append前后记录可判定的offset/sequence receipt。

## 14. `flush()` 不等于断电后的 durable commit

Rollout正常写路径调用的是 `tokio::fs::File.flush()`，没有调用 `sync_data()` 或 `sync_all()`。它能推进语言/运行时缓冲并让同进程/普通reader看见内容，但不保证突然断电后数据仍在存储介质。

有趣的是，压缩文件解压物化路径对temp output调用了 `flush()` + `sync_all()`，然后用hard link或persist_noclobber发布；这比普通append有更强的文件内容durability动作。

因此当前命名中的“durability barrier”更准确地说是：

```text
ordered writer barrier + OS-visible/readable barrier
```

如果云端Agent需要“向客户端发送completed后，机器掉电也能恢复completed”，数据库事务/WAL fsync配置才是关键证据。

## 15. Paginated ordinal 帮助恢复顺序，但不是幂等键

新Paginated rollout从ordinal 0开始。Resume时：

1. 从第一条SessionMeta读取history mode。
2. 反向扫描最后一条可解析record。
3. 取其ordinal + 1。

测试覆盖：

- ordinal gap后从最大tail继续。
- valid unterminated tail先补换行，再从其ordinal继续。
- invalid tail被跳过，从最后valid record继续。
- `u64::MAX` overflow时拒绝append。

Ordinal让分页和尾部定位更明确，但缺少全文件唯一性验证。gap被允许、重复ordinal未在这里拒绝；它是order hint/position，不是event identity。

## 16. Loader 容忍局部坏行，但对根元数据更严格

`load_rollout_items()`：

- 空文件报错。
- 逐行跳过空白。
- malformed JSON或未知RolloutLine累加parse error并继续。
- 第一个成功解析的SessionMeta提供canonical thread ID。
- 在尚未识别根SessionMeta前，未知 `history_mode` 会直接报错，避免新客户端把不理解的storage contract当Legacy读取。
- `get_rollout_history()` 最终忽略parse error计数，只把它写入debug log。

这里的兼容策略是合理的“根schema fail-closed、普通item fail-open”。缺口是调用resume的产品层不知道历史是否有损；UI和审计无法区分完整恢复与跳过3条坏行后的恢复。

建议在返回值加入：

```ts
type HistoryCompleteness = {
  parseErrors: number;
  skippedOrdinals: number[];
  tornTailDetected: boolean;
  repaired: boolean;
};
```

## 17. 外部append必须遵守“Thread不live”的互斥约定

`append_rollout_item_to_path()` 用于更新unloaded Thread metadata，注释明确live session应走Recorder以保持顺序。该函数会单独open文件、推导next ordinal并追加一行，但没有与live writer共享lock或compare-and-swap。

如果错误地和live writer并发：

- 两边可能读取同一个next ordinal。
- 两次append顺序不受统一queue控制。
- 元数据和普通history可能交错。

所以“仅用于unloaded”不是文档偏好，而是正确性前提。云端实现应把它编码为lease/fencing token，而不是只靠调用者自律。

## 18. Event发布接近 persist-before-publish，但失败时会降级

`send_event_raw_with_persistence()` 先调用 `persist_rollout_items()`，再写rollout trace，最后发给客户端。对LocalThreadStore，append内部已经等待flush，因此正常路径接近：

```text
canonical readable -> projection update -> client delivery
```

但 `Session.persist_rollout_items()` 吞掉store error，只写error log，事件仍继续delivery。所以它不是硬性的persist-before-publish事务；磁盘错误时客户端可能看到无法Resume的事实。

Turn Complete/Aborted发送后还会显式 `flush_rollout()`，为buffering store收口terminal tail。Interrupted marker则在发TurnAborted前额外flush，因为客户端可能收到abort后同步重读rollout。所有flush失败目前都只warning，不撤回terminal event。

这种降级适合交互式本地客户端保持可用，但云端业务若对完成状态有强一致要求，应在commit失败时发布 `persistence_failed`，而不是仍宣称Run completed。

## 19. Shutdown 与 Drop 的语义不同

正常 `shutdown_thread()`：

1. recorder shutdown barrier。
2. 同步materialized rollout path到SQLite。
3. 记录文件size metric。
4. 从live recorder map移除。

`discard_thread()` 则直接移除writer，不强制lazy pending data落盘，用于session初始化失败。

`RolloutRecorder` 没有在Drop中同步drain；所有sender消失后receiver loop可正常结束。需要持久化的调用路径必须显式shutdown，不能把RAII Drop当durability guarantee。

## 20. 更适合云端 Agent 的提交协议

```ts
type RunEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  kind: string;
  payload: unknown;
  schemaVersion: number;
};

type CommitReceipt = {
  eventId: string;
  canonicalSequence: number;
  canonicalCommittedAt: string;
  projectionGeneration?: number;
  projectionCommittedAt?: string;
};
```

推荐顺序：

1. 数据库事务插入canonical event，唯一约束event ID/sequence。
2. 同事务更新Run terminal或outbox。
3. commit成功后发布stream event。
4. projection异步处理，带generation/checkpoint。
5. read model返回canonical checkpoint和projection lag。

这样retry根据event ID自然幂等，也能明确告诉调用者canonical成功但projection暂时落后的partial commit。

## 21. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Lazy materialization | 无事实不建文件、首事实Meta在前、init失败discard |
| Queue | 256命令背压、超大batch bytes、并发sender顺序 |
| Write failure | open失败、第一行失败、中间item失败、重开仍失败、后续手动retry |
| Torn write | 半条JSON、完整write+flush error、重复valid line、相同ordinal |
| Loader | 空文件、坏根Meta、坏中间行、坏tail、parse completeness回执 |
| Ordinal | gap、duplicate、missing、overflow、Legacy无ordinal |
| Projection | JSONL成功/SQLite失败、新generation到达、旧ack不清新patch |
| Publish | append失败后是否仍发客户端、terminal flush失败、abort marker可重读 |
| Durability | process crash、OS crash、fsync前后对比、目录entry持久化 |
| Mutual exclusion | offline append与live writer竞态、lease过期、fencing token |
| Shutdown | 正常drain、shutdown失败后重试、直接Drop、intentional discard |

## 22. 对当前项目的学习结论

当前项目使用PostgreSQL，不必复制本地JSONL writer，但应复制Codex已经做对的边界：

1. canonical AgentStep/RuntimeEvent与查询projection分离。
2. append成功后再更新preview/status投影。
3. projection update带generation/checkpoint，旧ack不能清新状态。
4. client publish发生在canonical transaction commit之后。
5. retry依赖稳定event ID和数据库唯一约束。
6. 返回partial commit receipt，而不是用一个exception掩盖“事实已写、投影失败”。

Codex 最值得学习的是lazy materialization、single writer、有界queue、显式flush barrier、pending suffix保留、失败重开、根schema fail-closed/坏item fail-open、ordinal恢复和canonical先于metadata projection。需要改进/避免的是flush未fsync却使用durability措辞、torn line只隔离不修复、write成功/flush失败可重复、parse error不向上暴露、offline append互斥只靠约定、store error后事件仍发布，以及append缺稳定幂等ID。
