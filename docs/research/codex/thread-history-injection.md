# Thread History Injection：把外部事实写进模型历史前，先定义信任与提交语义

本文研究 Codex App Server 的 `thread/inject_items`。它允许客户端把原始 Responses API item 写入 Thread 的模型可见历史，却不创建新的用户 Turn。重点不是 JSON 反序列化，而是这类“历史修改接口”如何处理角色信任、并发归属、持久化、幂等和可观察来源。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. 这是历史写接口，不是普通消息接口

协议直接接收 provider-native JSON：

```ts
type ThreadInjectItemsParams = {
  threadId: string;
  items: unknown[];
};

type ThreadInjectItemsResponse = {};
```

注释明确说这些 item 会 append 到 model-visible history。当前入口会把每个 JSON 反序列化为 `ResponseItem`，错误能精确到 `items[index]`，然后调用 Core 的 `inject_response_items()`。

它与 `turn/start`、`turn/steer` 有三个本质差异：

| 接口 | 输入语义 | 是否新建用户 Turn | 并发目标 |
| --- | --- | --- | --- |
| `turn/start` | 用户输入 | 是 | 创建新 Turn |
| `turn/steer` | 用户追加输入 | 否 | 带可选 expected Turn ID 的 active Regular Turn |
| `thread/inject_items` | 原始 Responses API 历史项 | 否 | active task pending queue 或 idle history |

所以它更接近 privileged history mutation，而不是“再发一条聊天消息”。

## 2. Idle 路径先建立标准上下文

对一个尚无 reference context 的新 Thread，Core 不会直接把 injected item 放到历史最前面。它会：

1. 创建默认 `TurnContext`。
2. capture 当前 step context。
3. 记录 environment / instructions 等初始上下文。
4. 设置 reference context baseline。
5. 再写 injected items。
6. 调用 rollout flush durability barrier。

集成测试验证下一次模型请求中的相对顺序：

```text
environment context
  < injected assistant item
  < next user prompt
```

这是优质设计。历史旁路接口仍遵守 runtime 的上下文基线，避免外部注入内容意外获得“早于系统环境”的位置权力。

## 3. 不制造假的用户 Turn boundary

`inject_no_new_turn()` 会直接记录 ResponseItem，或者把它加入正在执行任务的 pending input；它不会发起 `turn/started`，也不会伪造一条用户消息。

这对恢复语义有价值：

- application context 不应被误计为用户指令 Turn。
- rollback 的 instruction-turn 计数不应被背景资料污染。
- UI transcript 可以选择不把机器注入内容渲染成用户发言。

但当前 idle 注入仍使用新建的默认 `TurnContext` 给缺失 metadata 的 item 盖 `turn_id`，却没有对应的完整 Turn lifecycle。消费者不能仅凭 passthrough `turn_id` 推断一定存在一条 canonical `TurnStarted -> TurnCompleted` 记录。

## 4. Durable history boundary 会做规范化

`record_conversation_items()` 是统一写入边界：

1. 处理 message / tool output 中的图片。
2. 仅在缺失时写入当前 `turn_id`。
3. 模型支持 item ID 时，仅给缺失 ID 的 item 分配新 ID。
4. 写入 `ContextManager`。
5. 排队持久化 rollout ResponseItems。
6. 向客户端发送 raw response item 事件。

这比在 RPC handler 中复制一套持久化流程更可靠。但“仅补缺失字段”也意味着调用者自带的非空 `id` 和 `turn_id` 会被保留：当前入口没有校验重复 ID、跨 Thread 来源或伪造的 Turn 归属。

## 5. Provider JSON 的结构有效，不等于业务语义安全

`ResponseItem::Message.role` 是普通字符串，不是受限 enum。入口还接受：

- user / assistant / developer 风格 message。
- reasoning、compaction 和 context compaction。
- function/custom tool call 与 output。
- local shell、web search、image generation 等 provider item。
- additional tools 和 agent message。

因此 serde 成功只证明形状能映射为 Rust enum，不能证明：

- 调用者有权声明某个角色。
- tool call/output 成对且顺序正确。
- item ID 与 Turn ID 属于当前 Thread。
- reasoning / compaction 内容来自可信 provider。
- 这些 item 适合作为业务上下文，而不是模型指令。

尤其是 arbitrary `role: String`，会把调用者提供的普通应用数据提升为模型历史中的角色化内容。没有 origin/trust 标签时，后续 runtime 无法区分它来自模型、工具、用户还是宿主应用。

## 6. Prompt normalization 会改变“已写入事实”的有效含义

历史写入时不会完整验证 tool pair。真正构建 prompt 时，`ContextManager` 才会：

- 给缺 output 的 function/custom/local shell call 插入稳定的 synthetic `aborted` output。
- 删除没有对应 call 的 orphan output。
- 对不支持图像输入的模型剥离图片。

这会形成三层不同事实：

| 层 | 可能看到的内容 |
| --- | --- |
| RPC accepted | 结构合法的原始 item |
| Rollout / raw event | 经图片准备、ID/Turn ID 补齐后的 item |
| Next model prompt | 再经 tool pair repair、orphan removal、modality stripping 的结果 |

例如，一个孤立的 `function_call_output` 可以被接受并持久化，却在下一次模型请求前被删除。反过来，一个没有 output 的 call 会在 prompt 中获得 synthetic `aborted` output，但该 synthetic item 不一定作为原始注入事实持久化。

所以 API 返回 `{}` 无法回答“哪些 item 最终进入了模型”。成熟接口至少要返回 accepted、normalized、dropped 的分类或可查询 receipt。

## 7. Active task 路径具有时间竞态

若 Thread 正在执行，`inject_if_running()` 会把 item 写入当前 `TurnState.pending_input`，而不是立即修改历史。

Regular Task 的 loop 在一次 sampling 后检查 pending input：

- 如果及时观察到，会触发 follow-up step，并在下一次构建 prompt 前记录 injected item。
- 如果到达得太晚，task finish 会 drain pending input 并记录它；此时它可能只影响未来 Turn。

与此同时，`inject_response_items()` 在排队后立刻调用 `flush_rollout()`。这个 flush 只能证明此前已排队的 rollout 写入完成，不能证明仍在 pending queue 中的注入已持久化。

当前 response 不返回：

- 实际命中的 active Turn ID。
- 是本 Turn next step 生效，还是只进入 future history。
- persisted ordinal / history revision。
- queued item 的最终 ID。

因此同一个成功 `{}` 可能对应两种不同可观察结果，取决于请求到达的微小时序。

## 8. 它绕过了普通 steer 的任务类型门

`turn/steer` 明确：

- 校验可选 `expectedTurnId`。
- 只允许 `TaskKind::Regular`。
- Review 和 Compact 返回 non-steerable error。

`thread/inject_items` 的 generic `inject_if_running()` 只检查有没有 active Turn，不检查 TaskKind，也不接受 expected Turn ID。

ReviewTask 本身会忽略初始 `TurnInput::ResponseItem`；任务结束时通用收尾逻辑又会把遗留 pending input 记录进该 review Turn 的 history。于是 active Review 期间注入的 item 未必影响 reviewer，却可能在结束后被归到 review Turn 下。

这里不宜简单说“成功 steer 了 Review”，更准确的是：公共历史注入 API 绕过 non-steerable admission，最终作用时点和归属依赖 task lifecycle，存在 history contamination 风险。

## 9. 图片防护只完成了一半

App Server 会拒绝 message 和 tool output 中的 HTTP(S) remote image URL，避免 runtime 隐式远程抓取。Core 对 data URL 会 decode、按 detail 限制 dimension/patch 数并重编码；无法处理时替换为占位文本。

优点是：

- remote fetch authority 没有被偷偷交给模型 history。
- 图片处理失败是逐项降级，不会把整个历史写入打断。
- High 与 Original 有明确图像尺寸/patch 上限。

但入口没有 method-specific 总预算：

- items 数量。
- JSON 总 bytes 和 nesting depth。
- 文本总字符/token。
- data URL 编码体积与多图总 decode 成本。

普通 `turn/start` / `turn/steer` 有 `MAX_USER_INPUT_TEXT_CHARS`，raw injection 没复用该限制。单图像素限制不能替代整请求资源预算。

## 10. Retry 会重复写入

请求只有 `threadId + items`，没有：

- `operationId` / idempotency key。
- `expectedHistoryVersion`。
- body hash。
- target Turn generation。
- 查询提交状态的 receipt ID。

Idle 路径先记录、再 flush、最后返回。如果 rollout 已提交但 response 在网络中丢失，客户端重试会再次 append 同样 item。即使调用者复用相同 item ID，当前入口也没有据此去重。

Active 路径更复杂：第一次可能排进即将完成的 Turn，第二次可能在 Thread idle 后直接写历史，造成同一业务操作跨两个归属路径重复提交。

这里需要的是 operation identity，不是拿 provider item ID 充当幂等键。

## 11. Ephemeral 与 loaded-only 的语义

handler 通过 ThreadManager 加载当前 Thread；它不是一个“给任意 cold rollout 追加记录”的离线编辑器。调用者必须先拥有 loaded Thread 生命周期。

`flush_rollout()` 在没有 `LiveThread` persistence 时直接成功。这使 ephemeral Thread 也可能得到相同空 response，但成功只代表内存历史已接受，不代表存在 durable rollout。

因此 response 应显式区分 durability：

```ts
type Durability = "memory" | "rollout-flushed";
```

不要让调用者从 RPC 成功自行推断可冷恢复。

## 12. 来源不可追溯

注入后使用普通 ResponseItem 持久化和 raw event 通道。没有独立的 `HistoryInjected` envelope 保存：

- actor / connection principal。
- origin subsystem。
- operation ID。
- trust classification。
- original body hash。
- validation / normalization 结果。

恢复或审计时，注入的 assistant/tool/reasoning item 与模型/runtime 原生输出很难区分。对于能改变未来模型决策的历史写入，这是比“少一条日志”更严重的 provenance loss。

## 13. 更适合云端 Agent 的安全 contract

当前 SEO Agent 不应暴露 provider-native `ResponseItem[]`。外部调用者提交业务上下文，由服务端决定模型角色和 provider 序列化：

```ts
type ContextInjectionRequest = {
  operationId: string;
  conversationId: string;
  expectedHistoryVersion: number;
  target:
    | { kind: "next-run" }
    | { kind: "active-run"; expectedRunId: string };
  origin: {
    kind: "seo-crawler" | "user-approved-source" | "system-job";
    actorId: string;
  };
  items: Array<{
    kind: "application-context";
    sourceId: string;
    text: string;
  }>;
};

type ContextInjectionReceipt = {
  injectionId: string;
  operationId: string;
  historyVersion: number;
  disposition: "applied-next-step" | "queued-next-run";
  durability: "committed";
  acceptedItems: Array<{ sourceId: string; historyItemId: string }>;
};
```

核心规则：

1. 角色由服务端固定，业务调用者不能传 `developer/assistant/tool`。
2. provider adapter 在最内层把 typed context 转为 Responses API item。
3. `operationId + canonical body hash` 去重；同 key 不同 body 返回 conflict。
4. `expectedHistoryVersion` 防止把旧上下文写到已经变化的会话。
5. active target 必须绑定 expected Run ID；不能静默降级为 next run。
6. 统一限制 item count、总 UTF-8 bytes、token estimate、图片数量和解码预算。
7. 持久化 origin、actor、trust、source ID 和 receipt，再发布成功。
8. prompt builder 可以对低信任上下文加明确数据边界，不把它提升为系统指令。

## 14. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| 结构 | empty、unknown item、错误 index、任意 role、深层 JSON |
| 预算 | 多小 item、单大文本、多 data URL、总 bytes/token 超限 |
| 身份 | duplicate operation、同 key 不同 body、stale history version |
| 并发 | sampling 前/中/后注入、task finish race、目标 Turn 已更换 |
| TaskKind | Regular、Review、Compact、reserved task=None |
| 语义 | orphan output、missing output、duplicate call ID、cross-turn metadata |
| 持久化 | flush 前失败、commit 后 response 丢失、ephemeral、cold resume |
| 投影 | raw event、rollout、next prompt、UI transcript 四层是否一致 |

Codex 当前测试覆盖了 idle 新 Thread 和已有 Turn 后注入 assistant message的 happy path，且验证标准环境上下文和 next model request 顺序；尚未覆盖上表大多数失败与竞态边界。

## 15. 对当前阶段的学习结论

当前项目还在最小 Tool Calling 阶段，不应现在实现通用历史注入框架。先记住四条约束：

1. application context 是低信任数据，不是可以自报 role 的 provider item。
2. “写入 history”必须说清命中当前 Run 还是下一 Run。
3. RPC success 需要对应可查询的 durable receipt，而不是空对象。
4. rollout fact、model-effective prompt、UI transcript 和 audit provenance 必须分层。

Codex 值得学习的是统一 durable history boundary、初始上下文顺序和 pending queue；不应照搬 raw provider JSON admission、空回执和时序依赖的 active injection 语义。
