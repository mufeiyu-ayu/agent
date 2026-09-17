# 模型边界、遥测与 Evals

> 研究快照：`/Users/ayu/Learn/pi`，HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`，包版本 `0.85.1`。本文描述该 checkout 的实现，不声明第三方服务今天仍接受其中所有协议或价格。研究覆盖及实际检查见 [coverage](../coverage.md) 与 [verification](../verification.md)。

## 给实现 AI 的入口

本页回答三个问题：一次模型请求怎样跨越 provider 边界；哪些内容能帮助观察但不能代替运行事实；怎样让行为改动有可比较的证据。先沿一个请求闭环，再按当前问题阅读 provider 差异。不要一次给用户展开所有兼容分支。

建议每次查阅顺序：

1. `types.ts` 的 `Context`、`AssistantMessage`、`AssistantMessageEvent`，确认输入、增量与终态。
2. `models.ts` 的 `stream()` → `applyAuth()` → `Provider.stream()`，确认控制权交接。
3. `api/openai-completions.ts` 的请求组装与流消费，对照我们当前 DeepSeek/OpenAI-compatible 路径。
4. `transform-messages.ts`、`assistant-message-frame.ts`，讨论发送上下文和可回放记录。
5. 只有需要第二种 provider 时，再看 `openai-responses-shared.ts`、Anthropic 或 Google。
6. 单独学习 telemetry 和 evals；它们不能作为 durability 已完成的证据。

## 1. 文件夹组织：按变动原因分开

```text
packages/ai/
  src/index.ts                  无副作用的核心公共入口
  src/types.ts                  消息、事件、选项、usage、model 契约
  src/models.ts                 Models 集合、鉴权应用、目录刷新、provider 构造
  src/auth/                     凭据存储契约、解析与 OAuth 交互
  src/providers/                具体 provider 的组合：目录 + auth + API
  src/providers/*.models.ts     生成的目录薄入口
  src/providers/data/           被忽略的 JSON 目录值，当前 checkout 未 hydrate
  src/api/                      wire protocol 适配器及 lazy 装载入口
  src/utils/                    事件队列、参数验证、JSON、retry、token 估计等
  src/images-models.ts           独立的图片生成入口
  src/compat.ts                 旧全局 registry/API 的临时兼容入口
  scripts/                      目录生成与验证，不属于每次推理热路径
  test/                         纯断言、mock transport 与真实服务测试混合存放
packages/telemetry/src/          观测契约、typed schema、Noop、内存记录与 conformance
packages/evals/src/              完整会话 harness、任务 eval、产物与配对比较
```

核心入口特意不导入所有 SDK、内建目录或 OAuth。见 [index.ts:4](/Users/ayu/Learn/pi/packages/ai/src/index.ts:4)。`providers/openai.ts` 只组合自己的目录、auth 和 API；`api/openai-responses.lazy.ts` 到第一次调用时才装载 SDK。`providers/all.ts` 是显式的“我要所有内建 provider”入口。

**处理风格：**统一容易统一的输入输出，保留 wire protocol 的差异；小 provider 文件负责组合，大 adapter 文件负责真实协议，不强行把几个 SDK 压进一个万能 mapper。新旧 API 正在迁移，`compat.ts` 是过渡代码，不能拿它的全局 registry 当目标架构。

## 2. 一个请求的完整闭环

### 2.1 `Models` 负责请求准备，provider 负责发出请求

原文，[models.ts:677](/Users/ayu/Learn/pi/packages/ai/src/models.ts:677)：

```ts
return lazyStream(model, async () => {
  const provider = this.requireProvider(model);
  const { requestModel, requestOptions } = await this.applyAuth(
    model,
    options as ModelsApiStreamOptions<Api> | undefined,
  );
  return provider.stream(requestModel as Model<TApi>, context, requestOptions as ApiStreamOptions<TApi>);
});
```

输入是一个具体 `Model`、model-visible `Context` 和本次 options。`applyAuth()` 查 provider，解析凭据，合并 headers/env；显式 options 逐字段覆盖 auth，`transformHeaders` 最后运行。输出仍是统一的 `AssistantMessageEventStream`。这里没有执行工具、保存会话、决定下一轮 prompt。

容易读错的时机：[lazy.ts:52](/Users/ayu/Learn/pi/packages/ai/src/api/lazy.ts:52) 是 `setup().then(...)`，**调用 `stream()` 时准备工作就开始**；不是等消费者首次 `next()` 才启动。`lazy` 指 SDK 的装载和异步准备封装。对照我们的两层 async generator 时必须重新确认执行时机。

`complete()` 只是 `this.stream(...).result()`；结果含 `stopReason: "error"` 时 Promise 仍可正常 resolve。直接 adapter 的 `streamSimple()` 在缺失 auth 时又可能同步 throw。上层不能只用 `try/catch` 判断模型成功；要检查终态。

### 2.2 以 OpenAI-compatible 为例

[openai-completions.ts:311](/Users/ayu/Learn/pi/packages/ai/src/api/openai-completions.ts:311) 的 `stream()`：

1. 新建 `output`，初始 `stopReason: "pending"`，usage 初始化为零。
2. `getCompat()` 合并 provider/URL 推断和 `model.compat`；`buildParams()` 把统一历史变成请求。
3. `onPayload()` 可以替换最终请求；随后 SDK 发出请求，SDK retry 被显式设为 `0`，由 `retryProviderRequest()` 包裹初次请求。
4. 收到 HTTP response 后调用 `onResponse()`，发 `start`，消费 SDK stream。
5. 聚合文本、thinking、工具 JSON；按 tool index/id 分开维护，允许交错 chunk。
6. 收到 provider finish reason 后形成统一 stop reason；正常流结束却没有 finish reason，默认报错，只有显式 `supportsFinishReason: false` 才允许推断。
7. 清理 `partialArgs` 等 scratch 字段，发 `done` 或 `error`；终态携带完整 `AssistantMessage`。

`onPayload` 是可改变模型输入的扩展点，`onResponse` 被 `await`，回调抛错也会进入请求失败路径。它们不是保证无影响的纯日志 hook。

### 2.3 事件不是快照，也不是广播

原文，[types.ts:539](/Users/ayu/Learn/pi/packages/ai/src/types.ts:539)：

```ts
 * `partial` is the shared live response-so-far helper, not an event-time
 * snapshot. Text and thinking blocks are empty when their `*_start` event is
```

这句话的含义是：消费者晚一点读到 `text_start` 时，`partial.content` 可能已经包含后续文本。需要当时内容就编码或复制，不能把多个事件的 `partial` 引用直接交给异步 DB writer。

[event-stream.ts:43](/Users/ayu/Learn/pi/packages/ai/src/utils/event-stream.ts:43) 的 `push()` 在第一条 terminal event 时设置 `done` 并解析 `result()`；晚到 push 被丢弃，队列中已有事件仍按序读出。多个 iterator 从同一 FIFO 分配事件，**不是每个订阅者都收到一份**。队列没有容量上限和 backpressure；它是本进程消费辅助器，不是多客户端云事件总线。

[assistant-message-frame.ts:139](/Users/ayu/Learn/pi/packages/ai/src/utils/assistant-message-frame.ts:139) 的 `AssistantMessageFrameEncoder` 解决共享 partial 提前增长的问题：text/thinking 用偏移去掉重复前缀；tool JSON 必要时生成 checkpoint；end 使用权威完整值并白名单复制签名。`reduceAssistantMessageFrames()` 纯重建，不修改输入 frames。

原文，[assistant-message-frame.ts:152](/Users/ayu/Learn/pi/packages/ai/src/utils/assistant-message-frame.ts:152)：

```ts
case "done":
  if (!this.started) throw new Error("Assistant message done event appears before start");
  this.terminal = true;
  return undefined;
case "error":
  this.terminal = true;
  return undefined;
```

frame **不承包终态 settlement**。恢复出进度不等于恢复出“已成功/失败的 run”；终态必须由上层单独持久化。这个分离比简单追加所有 UI delta 更值得学习。

## 3. 模型历史在发送前会被改写

[transform-messages.ts:64](/Users/ayu/Learn/pi/packages/ai/src/api/transform-messages.ts:64) 是跨 provider 的统一第一层：

| 输入情况 | 实际改写 | 对实现的意义 |
| --- | --- | --- |
| model 不接收图片 | user/tool 图片换文本占位，连续图片合并一个占位 | model input 与 UI 附件不能混为一谈 |
| 同 model 的 signed thinking | 保留，包含空文本但有签名的情况 | thinkingSignature 是 replay 数据，不等于用户可见思考文本 |
| 跨 model 的普通 thinking | 去签名并转成 text；redacted opaque thinking 丢弃 | 切模型会改变 model-visible 内容 |
| 工具 ID 不符合目标 provider | 仅当**跨 model**且 adapter 传入 `normalizeToolCallId` 时同步变换 call id 与 result id；同一 model 的历史 ID 从不改写 | id 是配对边界，不仅是展示字符串 |
| assistant 以 error/aborted 结束 | 不重放该 assistant | partial response 不能默认成为下一轮输入 |
| 工具 call 没有对应 result | 插入 `isError: true` 的 `No result provided` | 这是请求期合成结果，不代表工具真的执行过 |

原文，[transform-messages.ts:171](/Users/ayu/Learn/pi/packages/ai/src/api/transform-messages.ts:171)：

```ts
content: [{ type: "text", text: "No result provided" }],
isError: true,
timestamp: Date.now(),
```

第二层 adapter 还会做更多改写，例如 Chat Completions 把 tool-result images 放入额外 user turn；Anthropic 把连续 tool results 合为一个 user message；Responses 把 reasoning signature 还原为 provider-native item。

**云端取舍：**我们已有 `model-visible ⟺ logged` 约束。学 Pi 的兼容处理，但记录应能重建实际发送后的 payload/context，而不只是变换前的 UI/模型历史；合成 tool result 必须标记来源，不能假装真实执行结果。`onPayload` 可以作为观察最终请求的切入点，但持久化成功与发请求之间的规则仍需我们明确设计。

## 4. Provider 差异地图

以下都是本地实现事实，服务端行为未联网实测。完整 factory 名单见 coverage。

| API 家族 | 核心文件/符号 | 关键差异及不能泛化的点 |
| --- | --- | --- |
| OpenAI Chat Completions | [openai-completions.ts:792](/Users/ayu/Learn/pi/packages/ai/src/api/openai-completions.ts:792) `buildParams`、`convertMessages` | 单一 adapter 支持 DeepSeek/Z.AI/Qwen/Together/Baseten/Ant Ling 等 thinking 格式；model.compat 覆盖启发式。保存 reasoning_details 作为签名，不能重复显示成文本。usage 从多种缓存字段归一化 |
| OpenAI Responses | [openai-responses-shared.ts:432](/Users/ayu/Learn/pi/packages/ai/src/api/openai-responses-shared.ts:432) `processResponsesStream` | 按 output_index 分 slot；end item 可纠正 delta；必须见 terminal response event；response.completed 可补回 Azure 缺失的 encrypted reasoning；保留 rawStopReason |
| Azure Responses | [azure-openai-responses.ts:221](/Users/ayu/Learn/pi/packages/ai/src/api/azure-openai-responses.ts:221) `resolveAzureConfig` | resource/base URL、deployment map 与 api version 是 Azure 边界；共享 Responses parser，但 options 支持并不与 OpenAI 完全一致 |
| ChatGPT Codex Responses | [openai-codex-responses.ts:237](/Users/ayu/Learn/pi/packages/ai/src/api/openai-codex-responses.ts:237) `stream` | JWT 中取 account id、WS/SSE、自有 header、可选 zstd。WS 只在尚未发出模型事件时回退 SSE；已开始后失败交给上层。`store:false` 的 connection-scoped continuation 不是进程重启后的持久恢复 |
| Anthropic Messages | [anthropic-messages.ts:502](/Users/ayu/Learn/pi/packages/ai/src/api/anthropic-messages.ts:502) `stream` | 手写 SSE 解码及 JSON repair、block index、signature delta、cache 1h、adaptive/budget thinking；特定 model 支持 mid-conversation effort 和 server fallback。OAuth 分支添加 Claude Code identity/工具名 casing，是特定客户端适配，不属于云 runtime 的通用设计 |
| Google / Vertex | [google-shared.ts:133](/Users/ayu/Learn/pi/packages/ai/src/api/google-shared.ts:133) `convertMessages` | `thought:true` 才表示 thinking，thoughtSignature 可附在普通 text/functionCall；Gemini 3 multimodal function response 与旧版图片 user turn 不同。Vertex 另处理 ADC/project/location/API key；两者明确拒绝自定义 fetch |
| Bedrock Converse | [bedrock-converse-stream.ts:116](/Users/ayu/Learn/pi/packages/ai/src/api/bedrock-converse-stream.ts:116) `stream` | AWS credential chain、profile、region/ARN、SigV4/bearer、Smithy middleware、代理 HTTP1。contentBlockStart 不保证含文本，首 delta 可建文本 block；redacted bytes 编码后才可持久化。不能把统一 maxRetries 选项当每家一致执行 |
| Mistral | [mistral-conversations.ts:119](/Users/ayu/Learn/pi/packages/ai/src/api/mistral-conversations.ts:119) `stream` | 文件名叫 conversations，当前调用实际是 `/v1/chat/completions`；raw fetch+SSE；9 字符工具 ID、camelCase → wire snake_case；thinking chunk 不是 OpenAI reasoning 字段 |
| Pi/Radius | [pi-messages.ts:353](/Users/ayu/Learn/pi/packages/ai/src/api/pi-messages.ts:353) `stream` | POST `{ model, context, options }` 到 `/messages`；SSE 精简事件重建统一 assistant；缺 terminal 报错。parser 使用 JSON cast，无完整入站 schema/sequence 验证；这里是客户端，不是可直接部署的多租户服务 |
| 图片生成 | [images-models.ts:169](/Users/ayu/Learn/pi/packages/ai/src/images-models.ts:169)、[openrouter-images.ts:40](/Users/ayu/Learn/pi/packages/ai/src/api/openrouter-images.ts:40) | 单独 `ImagesContext`/`AssistantImages`，当前内建 OpenRouter，非流式 `generateImages`；没有工具循环。图片目录刷新也没有照搬文本目录的 generation/persistence 协议 |

### 4.1 DeepSeek 与 OpenAI-compatible 专项：我们当前唯一用到的路径

当前项目只接 DeepSeek 的 OpenAI-compatible 接口，下面五处是可直接对照的样本。

**兼容性检测**：[detectCompat](/Users/ayu/Learn/pi/packages/ai/src/api/openai-completions.ts:1581) 按 `provider === "deepseek"` 或 baseUrl 含 `deepseek.com` 判定，随后 `getCompat` 用 `model.compat` 逐字段覆盖。DeepSeek 命中的结果：`thinkingFormat: "deepseek"`（发送 `thinking: { type }`）、`requiresReasoningContentOnAssistantMessages: true`（重放历史 assistant 时必须带 `reasoning_content` 字段）、`maxTokensField: "max_tokens"`、`supportsStore: false`、`supportsDeveloperRole: false`。这与我们 `streamModelSampling` 要求 Tool Call 必带 `reasoningContent` 是同一个 provider 约束的两种表达。完整可配置字段见 [OpenAICompletionsCompat](/Users/ayu/Learn/pi/packages/ai/src/types.ts:568)，一个 adapter 覆盖多家兼容服务靠的就是这张表，不是分支复制。

**usage 归一化**：[parseChunkUsage](/Users/ayu/Learn/pi/packages/ai/src/api/openai-completions.ts:1507)。cache 读取按 `prompt_tokens_details.cached_tokens ?? prompt_cache_hit_tokens ?? cached_tokens` 三处取值（DeepSeek 用第二种）；`input = prompt_tokens − cacheRead − cacheWrite`；`reasoning_tokens` 视为 `completion_tokens` 的子集，不再相加；`totalTokens` 是四项之和。云端做成本对账时，"未报告"与"报告为 0"必须分开，Pi 这里把缺失字段一律置 0，我们的 `mergeModelUsage` 保留 unknown 是更严格的选择。

**取消与错误终态**：[openai-completions.ts:678-718](/Users/ayu/Learn/pi/packages/ai/src/api/openai-completions.ts:678) 在流结束后检查 `signal.aborted`，catch 分支把 `stopReason` 设为 `aborted` 而非 `error`，并清除 `partialArgs/customInput/streamIndex` 等流式暂存字段再发终态。配套 [retryAssistantCall](/Users/ayu/Learn/pi/packages/ai/src/utils/retry.ts:174) 对 `aborted` 永不重试；退避睡眠期间被中止也归一化为 `aborted` 消息。

**两层重试**：[retryProviderRequest](/Users/ayu/Learn/pi/packages/ai/src/utils/provider-retry.ts:105) 只包"首次收到响应前"的 HTTP 错误：先看 `x-should-retry` 头，再看 `408/409/429/≥500` 或无状态码；延迟先取 `retry-after-ms`/`retry-after`，超过 `maxRetryDelayMs`（默认 60s）直接失败，否则 `0.5·2^n` 秒封顶 8 秒并加抖动；默认 `maxRetries: 0`。`retryAssistantCall` 则对已产生的 `error` 终态按 `isRetryableAssistantError` 正则分类（排除 quota/billing）。两层分别计数，durable harness 再叠一层 `attempt`，三者含义不同。

**溢出判定**：[isContextOverflow](/Users/ayu/Learn/pi/packages/ai/src/utils/overflow.ts:134) 三种情况：错误文本命中 overflow 正则且不命中 rate-limit 排除；`stop` 但 `usage.input + cacheRead > contextWindow`（z.ai 式静默溢出）；`length` 且 `output === 0` 且输入填满 99% 窗口（MiMo 式截断）。[isRecoverableLength](/Users/ayu/Learn/pi/packages/ai/src/utils/overflow.ts:171) 判断 `length` 是否低于期望输出上限。durable `publishResponse` 用这两个判定决定是否进入一次 overflow 压缩重试（§runtime 4.5）。DeepSeek 没有专属正则，依赖通用 `context_length_exceeded`/`too many tokens` 回退项，接入时应实测其错误文本。

### WS continuation 的具体边界

[openai-codex-responses.ts:1408](/Users/ayu/Learn/pi/packages/ai/src/api/openai-codex-responses.ts:1408) 的 `getCachedWebSocketInputDelta()` 先比较不含 input 的请求参数，再比较“上次完整 input + 上次 response items”是否为本次 input 的前缀；匹配才发送 `previous_response_id + delta input`。不匹配即回完整输入，missing previous response 可有限重试。

cache 按 sessionId/accountId 保存 connection，idle 5 分钟、最大连接年龄 55 分钟；`cleanupSessionResources()` 触发清理。这些是进程内连接复用策略。我们的云端 stream resume 应建立在持久事件游标上，不能依赖这个 cache。

## 5. 工具定义、参数与 deferred 的两种含义

`Tool.parameters` 是 schema，adapter 负责发送模型支持的格式；[constrained-sampling.ts:122](/Users/ayu/Learn/pi/packages/ai/src/api/constrained-sampling.ts:122) 把部分 JSON Schema 转成 strict 子集：optional 属性变 required+nullable，不支持的构造按 `prefer` 回退，按 `require` 失败。grammar 模式要求一个必填 string 参数，增量编码保持单调前缀。

**模型端 strict 不能替代执行前验证。**[validation.ts:317](/Users/ayu/Learn/pi/packages/ai/src/utils/validation.ts:317) `validateToolArguments()` clone 参数，删除 optional/non-nullable null，然后走两条不同的转型路径：TypeBox 的 `Value.Convert` 对所有 schema 恒执行；只有 schema **不是** TypeBox 实例（plain JSON schema，例如扩展或 MCP 传入）时才再做 `coerceWithJsonSchema`；最终 `Check()`，失败给出字段路径与收到的参数。参数可能被转型，所以必须保存/执行同一份验证后参数。调用点在 [agent-loop.ts:625](/Users/ayu/Learn/pi/packages/agent/src/agent-loop.ts:625) 和 [harness/execution/tools.ts:93](/Users/ayu/Learn/pi/packages/agent/src/harness/execution/tools.ts:93)，模型层本身不执行工具。

两个 deferred 不应混淆：

- **deferred tools：**`ToolResultMessage.addedToolNames` 标记工具在历史中何时可用；Responses 发 additional_tools 或 tool_search，Anthropic 发 tool_reference，Kimi 发带 tools 的 system message。见 [deferred-tools.ts:8](/Users/ayu/Learn/pi/packages/ai/src/utils/deferred-tools.ts:8)。它是上下文和工具目录放置方式。
- **deferred model response：**`DeferredHandle` 是异步响应令牌，`Models.streamDeferred/fetchDeferred/cancelDeferred` 按 capability dispatch。本快照实际内建远程 adapter 未实现该能力，`faux.ts` 提供进程内模拟，供上层测试。不能从类型存在推断第三方 batch/durable execution 已打通。

## 6. Auth 和目录：显式依赖，防止晚到覆盖

### 6.1 凭据所有权

[auth/resolve.ts:50](/Users/ayu/Learn/pi/packages/ai/src/auth/resolve.ts:50)：显式 apiKey override 优先；否则已有 stored credential 拥有 provider，只有无 stored credential 才查 ambient env。OAuth refresh 失败保留旧 credential 并抛 `ModelsError("oauth")`，不偷偷换 env key。`kimi-coding.ts` 内“Models clears it”的注释与此当前实现不一致，带读以 resolve/store 为准。

原文节选（省略行尾注释），[auth/resolve.ts:143](/Users/ayu/Learn/pi/packages/ai/src/auth/resolve.ts:143)：

```ts
post = await credentials.modify(
  providerId,
  async (current) => {
    if (current?.type !== "oauth") return undefined;
    if (!expiresSoon(current)) return undefined;
```

先乐观检查，再在 `CredentialStore.modify()` 互斥区域二次检查，刷新并保存后释放。默认最少剩余 5 分钟，refresh 15 秒超时。`InMemoryCredentialStore` 的 promise chain 只保证本实例、每 provider 串行；持久 store 的跨进程锁由 app 实现。

**云端对应：**保留 store injection 和 read-modify-write 约束，key 应包含用户/租户和 provider；DB version/CAS 或等效互斥决定谁可以覆盖 rotated token。不要用全局 process.env 或每 provider 一条内存 credential 混用不同用户身份。无需先搭通用密钥平台，先把当前 server-owned key 与未来 user-owned credential 的边界写清。

### 6.2 静态目录不是网络能力确认

`*.models.ts` 引用 `providers/data/*.json`，通过 `flattenModelCatalog()` 产生类型化 model list。`generate-models.ts` 汇合 models.dev、OpenRouter、AI Gateway 等来源，做手工覆盖、能力 metadata、排序去重，先在临时目录生成+验证 hash manifest，再替换正式 data。生成与 runtime refresh 是两条链路。

[models.ts:391](/Users/ayu/Learn/pi/packages/ai/src/models.ts:391) 的 runtime refresh：先恢复缓存，再解析 auth，再有条件访问网络。provider `publish()` 由 generation guard 和 publication chain 限制，旧 refresh 即使不响应 abort 也不能发布晚到结果。Radius 是当前具体动态目录 provider；普通内建 provider 用生成目录。

本机 `check-model-data.ts` 实测因 `providers/data/amazon-bedrock.json` 不存在退出 1。目录值未 hydrate，不能给出“当前所有 model 数量/价格已核验”的结论。生成文件中的成本与能力属于快照元数据，不代表可用权限、实时账单或最终路由 model。

## 7. Token、成本、错误与取消

| 边界 | Pi 实际处理 | 云端采用方式 |
| --- | --- | --- |
| context 估计 | [estimate.ts:114](/Users/ayu/Learn/pi/packages/ai/src/utils/estimate.ts:114) 优先最近适用 assistant usage，再估后缀；缺 usage 时约 4 chars/token、图片按固定量；较新 prefix timestamp 会使旧 usage 不适用 | 这是启发式；我们已有专用 estimator，不为形式统一而降级 |
| output 上限 | `buildBaseOptions` 按 contextWindow、估计 context、4096 safety margin clamp；thinking budget 留答案空间 | 保存 resolved config，区分用户上限、model 上限和实际发送值 |
| usage | input/output/cacheRead/cacheWrite 分开；reasoning 是 output 子集；各 SDK 报数差异在 adapter 归一化 | 我们 [mergeModelUsage](/Users/ayu/Desktop/agent/packages/ai/src/model-stream.types.ts:55) 保留 unknown，不因 Pi 初始零值而把“未报告”变成零 |
| cost | [models.ts:891](/Users/ayu/Learn/pi/packages/ai/src/models.ts:891) 以 `input + cacheRead + cacheWrite` 之和匹配最高 tier，对整个请求用该档费率；Anthropic 1h cache write 按 2× input 计价 | 标记 estimated cost，并保留费率版本；不能宣称真实计费对账 |
| request retry | `retryProviderRequest` 默认0，尊重 408/409/429/5xx、Retry-After 与 abortable sleep；OpenAI/Anthropic 主动关 SDK retry | 上层与 transport retry 分开计数，避免相乘；不能引用 SDK 默认2覆盖真实配置 |
| assistant retry | [retry.ts:174](/Users/ayu/Learn/pi/packages/ai/src/utils/retry.ts:174) 对结果 error 分类，排除 billing/quota，指数退避，abort 不重试 | overflow 先单独处理；重试工具副作用需靠工具执行记录和幂等性解决 |
| error | `error-body.ts` 保留 SDK status/body，排除 stream 实例，截断长 body；adapter 保留 rawStopReason | `errorMessage` 仍参与 retry/overflow 分类，不是纯展示；新云协议可逐步增加稳定 error code |
| cancel | [abort.ts:17](/Users/ayu/Learn/pi/packages/ai/src/utils/abort.ts:17) 允许调用方停止等待，并继续观察被放弃 Promise 的 rejection | 停止等待不证明副作用停止；DB/工具/外部提交仍要各自 settlement 规则 |

## 8. Telemetry：显式父上下文，纯观测保持被动

[telemetry/index.ts:13](/Users/ayu/Learn/pi/packages/telemetry/src/index.ts:13) 只定义 callback span API：`startSpan(options, callback)` 返回 callback 结果；子 span 由传入 span 显式创建，不依赖全局 active span。

`defineTelemetrySchema()` 是 identity helper；`createTypedSpanStarter()` 用 schema **做类型推断，不做 runtime schema 验证**。`sensitive`/`cardinality` 是 metadata，不会自动脱敏或阻止高基数数据。

[memory.ts:122](/Users/ayu/Learn/pi/packages/telemetry/src/memory.ts:122) 的参考实现同步且只调用 callback 一次；记录失败退 Noop；callback 原错误原样传出；显式 status 不被自动错误覆盖；settled 后属性/事件无效，晚建 child 仍执行 callback 但不记录；`getSpans()` 返回脱离内部状态的快照。

这些**观测字段本身不影响模型输入、Token 判断、Tool Call、主控制流或最终回答**；真正的 callback 仍是业务执行。第三方 telemetry adapter 必须守这个被动契约。[testing/conformance.ts:54](/Users/ayu/Learn/pi/packages/telemetry/src/testing/conformance.ts:54) 提供与测试框架无关的一组契约检查。

当前 `pi-ai/src` 中 `telemetryContext` 仅定义与透传，没有内建 adapter 调用 `startSpan`。所以本页不声称“所有模型请求已有 trace”；`test/telemetry-options.test.ts` 验的是透传同一对象。我们可在 NestJS 组合根注入观测 adapter，继续把 Run/Step DB 事实与 trace 分开。

## 9. Evals：真实会话行为与可比较结果

### 9.1 Harness 复用生产入口

[pi-harness.ts:118](/Users/ayu/Learn/pi/packages/evals/src/pi-harness.ts:118) `runPiCodingAgent()`：选定 provider/model → 创建 ModelRuntime → 临时 workspace/home/agentDir → `createAgentSessionServices` → `createAgentSessionFromServices` → 执行 prompt/reload steps → 输出 transcript、usage、timings → 保存 session JSONL artifact → dispose 与删临时目录。

它隔离文件资源和扩展目录，但不是 OS sandbox；`ModelRuntime.create()` 用实际默认模型/凭据入口，eval 生成模型会发真实请求。`providers.eval.ts` 虽然用本地 Acme server 测生成的 provider，**让 agent 写 provider 的生成模型仍是真实模型**。本次未执行任何 `.eval.ts`。

artifact 在清理前读入内存，即便失败也尽量保留；业务与 cleanup 同时失败用 `AggregateError` 同时报告，不吞掉其中一个。`artifacts.ts` 把 session/source 写入 runId hash 子目录，校验 attachment basename，文件0600/目录0700；这不是云数据保留/脱敏策略。

### 9.2 Evals 实际问题

| eval 文件 | 被测能力 | Judge/证据 |
| --- | --- | --- |
| `smoke.eval.ts` | 无工具回答基本问题 | 最终文本、provider/model、usage |
| `docs.eval.ts` | 文档与源码是否一致 | 只读工具调查后 exactly-once structured submit tool，要求 verdict match |
| `extensions.eval.ts` | 生成扩展→reload→调用工具 | import、loader errors、hello 调用和最终文本；保留生成源码 |
| `models.eval.ts` | 加入 model 后保留既有 provider models | reload 后从 ModelRuntime 读出并严格比较 metadata |
| `providers.eval.ts` | 配置兼容 provider、自定义 streaming provider | 本地 Acme 服务检查真实请求 auth/body，probe 通过 Pi runtime 发起 |

扩展/model/provider authoring 使用“系统提示带 docs / 去 docs”的 baseline-candidate 对照，默认 `judgeThreshold: null` 用于比较，不把质量分自动当硬门禁。改提示文本的切点是 `before_agent_start`，没有专门改生产 prompt builder。

### 9.3 配对比较避免假提升

[harness-table.ts:104](/Users/ayu/Learn/pi/packages/evals/src/vitest-evals/harness-table.ts:104) 用输入 id 或 canonical JSON hash，再加 repetition 组成配对 key。`summary.ts` 加 file/testName 隔离同样输入；重复、缺失、harness error、unscored 分别报告。只有双方都有 score 才比较 correctness 和效率，成本缺失保留 null，绝不补零。

原文，[summary.ts:256](/Users/ayu/Learn/pi/packages/evals/src/vitest-evals/summary.ts:256)：

```ts
if (baseline.outcome !== "scored" || candidate.outcome !== "scored") continue;
eligiblePairs += 1;
const baselinePassed = baseline.score >= 1;
const candidatePassed = candidate.score >= 1;
```

这比一份“平均 token 下降”数字更适合指导重构：同一个任务、同一个输入、相同 repetitions，比 correctness 再看 tokens/latency/estimated cost；把未完成的运行明确列为 incomplete observations。

## 10. 对当前 NestJS 云端的建议

当前 [LLMService](/Users/ayu/Desktop/agent/apps/api/src/llm/llm.service.ts:16) 已经是业务门面，[ModelInputItem](/Users/ayu/Desktop/agent/packages/ai/src/model-input.types.ts:4) 与 [ModelStreamEvent](/Users/ayu/Desktop/agent/packages/ai/src/model-stream.types.ts:32) 已隔离 provider。先保留这些边界，不为模仿目录名重建一份 Pi。

1. **第一学习产物：**把当前一次 sampling 的 resolved options、最终请求输入、事件、终态对应起来。Pi 的 frame encoder 和 transform 是问题样本；以我们持久化不变量来定方案。
2. **第二学习产物：**用一个本地 scripted provider 跑 tool/error/abort 的完整场景。学 Faux 的可编排响应，不学它的字符估算当真实 usage；保留模型未知 usage 的语义。
3. **第二个 provider 真正需要时：**再引入 provider-owned auth/catalog/API 组合；保留 NestJS DI，auth store 多租户作用域与 wire adapter 单独定义。无需先复制40个 provider。
4. **成本/延迟改善需要证据时：**先做2—3个真实痛点的 paired eval，保存输入、输出、session trace、版本与估计费率。eval harness 和产品 runtime 共享入口，比较器与 provider 分开。
5. **云端不可直接照搬：**loopback OAuth、本地 auth.json、process-global websocket cache、无界 FIFO、直接浏览器带 provider key、客户端 identity 兼容头。Pi 的模块分层可以借鉴，这些部署假设需要重新设计。

完成这些研究不等于已批准实现。Roadmap 的立项和优先级由主入口文档统一管理；本页提供可回到源码的依据。
