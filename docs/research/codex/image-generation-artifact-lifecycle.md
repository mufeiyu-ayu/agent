# Image Generation Artifact、模型History与本地制品生命周期

Codex中存在一个名为 `Feature::Artifact` 的Under Development开关，但当前配置schema刻意跳过它，源码也没有实际consumer。当前真正落地的“本地生成制品”案例，是standalone image-generation extension把API返回的base64图片同时投影为：

- 模型可见的function output image；
- App Server/TUI可见的ImageGeneration item；
- `$CODEX_HOME/generated_images/...`下的PNG文件；
- rollout与后续history中的可恢复内容。

因此本文不把一个尚未实现的“native artifact tool”当作事实，而是研究已有Image Generation怎样处理**生成、保存、引用、权限、投影、重放与清理**。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/ext/image-generation/src/extension.rs`
- `codex-rs/ext/image-generation/src/tool.rs`
- `codex-rs/ext/image-generation/src/backend.rs`
- `codex-rs/ext/image-generation/src/tests.rs`
- `codex-rs/ext/items/src/image_generation.rs`
- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/src/stream_events_utils.rs`
- `codex-rs/core/src/context/image_generation_instructions.rs`
- `codex-rs/core/src/context_manager/history.rs`
- `codex-rs/core/src/context_manager/normalize.rs`
- `codex-rs/core/src/tools/handlers/extension_tools.rs`
- `codex-rs/app-server/src/extensions.rs`
- `codex-rs/app-server/src/request_processors/thread_resume_redaction.rs`
- `codex-rs/app-server/tests/suite/v2/imagegen_extension.rs`
- `codex-rs/core/tests/suite/extension_sandbox.rs`
- `codex-rs/features/src/lib.rs`
- `codex-rs/config/src/schema.rs`

## 2. 先澄清：Artifact Feature目前不是已实现Tool

Feature registry包含：

```text
Feature::Artifact
key = "artifact"
stage = UnderDevelopment
default = false
```

但当前快照中：

- 除Feature声明外没有runtime consumer；
- Config schema生成时显式跳过Artifact；
- 正常用户配置不能靠schema发现这个key；
- 没有create/read/list/delete等native artifact tool实现。

所以不能根据注释“Enable native artifact tools”推断当前已存在完整Artifact系统。

实际稳定的图片能力由另一个开关控制：

```text
Feature::ImageGeneration
stage = Stable
default = true
```

## 3. Image Generation的五份状态

一次成功调用至少产生五份相关状态：

| 状态 | 内容 | 主要消费者 |
| --- | --- | --- |
| Backend response | base64 image data | Extension tool |
| FunctionCallOutput | data:image/png;base64 + optional path hint | 下一轮模型 |
| ImageGenerationItem | status、prompt、result、savedPath | App Server/TUI/rollout |
| Host artifact file | decoded bytes at generated_images path | shell/copy/project integration |
| Conversation history | prior images与tool call/output关系 | 后续image edit fallback |

这五份状态的保留策略并不相同。

## 4. Extension安装与Thread配置Snapshot

App Server启动extension registry时总是安装ImageGenerationExtension。

Extension不是每次tool call直接读取全局Config，而是在Thread生命周期中保存：

- provider info；
- available bool；
- save root。

Thread start时写入Thread Store；Config changed contributor会替换这份Thread配置。

Tool contributor每次从Thread Store构造ImageGenerationTool，并用Thread Store level ID作为artifact session目录名。

这延续了Typed Extension的边界：

```text
Config contributor负责配置投影
Tool contributor负责可用runtime
Tool executor只执行本次call
```

## 5. “已安装”与“模型可见”有多层Gate

Extension工具存在不等于模型能看到。

### 5.1 Extension Available

Thread配置只有在provider满足以下任一条件时才生成tool：

- OpenAI provider；
- requires OpenAI auth；
- uses OpenAI actor authorization。

### 5.2 Runtime/Model Visibility

Spec Planner进一步要求：

- provider使用actor auth，或requires OpenAI auth且当前auth走Codex backend；
- provider capability声明image generation；
- 当前model input modalities包含Image；
- namespace tools启用；
- Feature::ImageGeneration启用。

工具名固定为：

```text
image_gen.imagegen
```

### 5.3 为什么双层Gate有价值

Extension catalog可以稳定安装，但每Turn是否暴露取决于provider、auth、model capability和feature snapshot。

这避免：

- provider根本无法调用Images API时仍向模型承诺工具；
- text-only模型收到无法消费的image output；
- namespace tool模式关闭后出现无路由spec。

## 6. Generate与Edit只有一个互斥选择器

Tool参数：

```ts
interface ImagegenArgs {
  prompt: string
  referenced_image_paths?: AbsolutePath[] // max 5
  num_last_images_to_include?: number     // 1..5
}
```

分支：

| paths | recent count | 动作 |
| --- | --- | --- |
| empty | absent | Generate |
| non-empty | absent | Edit explicit files |
| empty | present | Edit recent history images |
| non-empty | present | Error |

Generate/Edit都固定：

- model：`gpt-image-2`；
- background：auto；
- quality：auto；
- size：auto；
- n：None。

对模型暴露的JSON schema有 `deny_unknown_fields`对应的additionalProperties约束，runtime仍重新执行完整serde解析与数量检查。

## 7. Explicit Image Path的Authority来自Turn Environment

模型提供absolute referenced image paths后，extension不会直接 `std::fs::read`。

它使用第一个ToolEnvironment：

```text
environment.file_system.read_file(
  path URI,
  environment.file_system_sandbox_context
)
```

读取成功后再走统一的 `load_for_prompt_bytes(..., Original)`，最后生成data URL。

### 7.1 值得学习：Extension复用Turn Permission

测试证明：

- sandbox显式Deny path时，image edit返回model-visible error；
- Turn内request_permissions获得临时读取权后，同一extension可读取；
- grant没有写入长期本地配置。

Extension没有绕过Core permission profile自建filesystem side channel。

### 7.2 第一个Environment假设

多个Environment selection存在时，explicit paths永远在 `environments.first()`中解析。

协议没有为每个path携带environment ID。若path实际属于第二个remote environment，模型无法明确表达，最终会在错误host读取或失败。

这说明Path identity应至少是：

```text
environmentId + PathUri
```

而不是裸AbsolutePath。

## 8. Recent Image Fallback是Best-effort History Query

当没有本地path时，模型可请求最近1到5张conversation images。

算法先扫描history，建立：

- 已出现FunctionCall的call IDs；
- 已出现CustomToolCall的call IDs。

再从后向前找：

- User/assistant Message中的InputImage；
- 有对应FunctionCall的FunctionCallOutput images；
- 有对应CustomToolCall的CustomToolCallOutput images；
- hosted ImageGenerationCall的result。

孤立tool output不会被选择，因为没有call证明其来源属于conversation执行。

### 8.1 顺序语义

扫描从最新到最旧，但最终reverse，返回被选中窗口内的时间正序。

同一Message内也先反向取，再在最终阶段恢复顺序。

### 8.2 必须精确满足Count

请求2张但history只有1张时直接返回tool error，不悄悄降为1张。

### 8.3 没有Stable Image Ref

源码明确承认：pathless images没有稳定reference。最近窗口可能包含较新的无关图片。

模型只能表达“最近N张”，不能表达：

- 某次generation的artifact ID；
- 某条Message中的第2张图；
- 某个tool result的特定image；
- 某张图的content hash。

这是当前Artifact identity最明显的缺口。

## 9. Backend Client在每次调用时解析Provider与Auth

CodexImagesBackend保存SharedModelProvider，但每次generate/edit都会重新await：

- api_provider；
- api_auth；
- reqwest client；
- ImagesClient。

所以Thread tool object可长期存在，而auth刷新能在具体request时生效。

这比把access token冻结进Thread Store更安全。

### 9.1 固定Model与Provider Capability的张力

Spec Planner检查provider capability，却在tool内部固定 `gpt-image-2`。

Provider只要声明image generation，就必须兼容这个model名称和Images endpoint。自定义provider capability与实际model catalog若漂移，会在runtime失败。

## 10. Started/Completed是明确的Item生命周期

调用开始先发布：

```text
ImageGenerationItem {
  id: callId,
  status: in_progress,
  revisedPrompt: None,
  result: "",
  savedPath: None
}
```

Backend失败仍发布唯一terminal item：

```text
status: failed
result: ""
savedPath: None
```

然后把错误以RespondToModel observation返回，让模型决定后续说明。

成功则发布completed item，并返回GeneratedImageOutput。

开始/结束同时提供：

- Typed ExtensionTurnItem；
- legacy ImageGenerationBegin/End events。

这让新App Server item协议和旧TUI事件可以并行迁移。

## 11. API Success与Artifact Save Success分开

Backend返回首张base64图片后，tool先认定generation成功，再尝试保存本地文件。

保存失败：

- warning记录callId与outputDir；
- savedPath=None；
- completed status不降为failed；
- 模型仍收到inline image；
- App Server item仍带result。

这是一种清晰的primary result/enrichment分层：

```text
primary = generated image bytes
optional enrich = host file artifact
```

如果用户只需要看到图片，磁盘只读不应否定API成功。

### 11.1 但缺少Partial Status

客户端只能从 `completed + savedPath=None`推断保存失败；没有：

- artifactStatus；
- saveError code；
- fallback location；
- retry save operation。

## 12. Host-owned Save Root故意绕过Turn Sandbox

App Server安装extension时把save root解析为 `config.codex_home`。

保存使用：

- `LOCAL_FS`；
- host save root；
- `sandbox=None`；
- recursive create directory；
- write file。

这与explicit edit input恰好相反：

| 操作 | Filesystem authority |
| --- | --- |
| 读取模型指定reference path | Turn Environment + sandbox |
| 写入系统默认generated image | Host-owned Codex home，无Turn sandbox |

默认制品目录是产品自己的storage，不是模型任意写权限。

### 12.1 Remote Environment边界

save_root属于App Server host。Remote executor里的path不会自动映射到这里。

测试也跳过remote explicit path edit，并写明remote executors需要不同storage approach。

因此生成结果文件不是“当前Environment artifact”，而是“App Server host artifact”。

## 13. Artifact Path算法

默认路径：

```text
$CODEX_HOME/generated_images/<sanitized-thread-id>/<sanitized-call-id>.png
```

sanitize规则：

- ASCII字母数字、`-`、`_`保留；
- 其他所有字符替换为`_`；
- 空结果使用`generated_image`。

优点：

- 不能通过callId注入slash逃逸目录；
- 每Thread分目录；
- filename可预测，便于model复制；
- extension声明的savedPath与Core默认算法一致。

### 13.1 Sanitization不是唯一编码

以下不同原值可能得到相同path：

```text
a/b -> a_b
a?b -> a_b
a b -> a_b
```

没有附加hash或collision check。若callId不保证只使用safe charset，后一次write可能覆盖前一张图。

Thread ID通常是UUID、callId通常由provider生成，降低了风险，但helper本身是public函数，未把该前提编码进类型。

## 14. Save不是原子Artifact Commit

保存步骤：

1. trim并base64 decode整个result；
2. create parent recursively；
3. 直接write target path；
4. 返回path。

没有：

- PNG magic/decode校验；
- expected content length；
- temp file + atomic rename；
- fsync；
- existing-file collision policy；
- sha256；
- MIME metadata；
- artifact manifest；
-数据库receipt。

进程在write中途崩溃可能留下partial target；同path重试会覆盖。

## 15. Base64 Valid不等于PNG Valid

Image API response只有 `b64_json: String`。tool：

- 取data数组第一项；
- 只验证base64能解码；
- 始终保存为`.png`；
- 始终返回`data:image/png;base64,...`。

没有检查PNG signature或实际image dimensions。

当前信任Images backend契约，但若自定义provider返回base64编码的其他内容：

- 本地文件扩展名错误；
- model content type错误；
- App Server客户端可能尝试按PNG渲染无效bytes。

## 16. 只取第一张Response Image

tool对response.data执行 `into_iter().next()`。

虽然request的n=None通常期望一张，但provider若返回多张，其余结果会被静默丢弃，没有warning或receipt。

Artifact模型目前是“一次call对应一个path”，没有variant index。

## 17. revisedPrompt字段实际保存Original Prompt

当前ImageResponse只包含created/data/background/quality/size，没有revised prompt。

completed和failed ImageGenerationItem都把 `args.prompt`放进 `revised_prompt`字段。

因此在standalone extension路径中，它更接近“effective submitted prompt”，不是provider改写后的prompt。

字段名继承了hosted ImageGenerationCall协议，语义并不完全等价。

## 18. GeneratedImageOutput的四个投影

### 18.1 Model Observation

FunctionCallOutput content包含：

1. `InputImage(data:image/png;base64, result)`；
2. optional InputText path hint。

detail使用默认high。

### 18.2 Code Mode Result

返回对象：

```json
{
  "image_url": "data:image/png;base64,...",
  "output_hint": "..."
}
```

供`generatedImage()` helper输出conversation image。

### 18.3 Telemetry Preview

`log_preview()`固定为：

```text
[generated image]
```

避免把base64复制到tool-call telemetry。

### 18.4 App/Protocol Item

ImageGenerationItem包含完整result和savedPath，用于实时App Server item与TUI展示。

这体现“同一结果不同投影”的优秀设计，但各投影的bytes budget仍不对称。

## 19. Path Hint是模型可见的Storage Contract

只有保存成功才生成hint：

```text
Generated images are saved to <dir> as <path> by default.
If you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it.
```

其目的不是用户展示，而是告诉下一轮模型：

- 文件真实存在；
- 默认路径由host拥有；
- 项目使用时应copy/move到workspace；
- 不要随意删除原artifact。

### 19.1 Hint有1024-byte上限

完整hint超过1024 bytes时整体省略，不截断path。

这避免向模型发送残缺路径，但会产生代际差异：App item仍有savedPath，模型却只看到inline image，不知道文件位置。

### 19.2 Absolute Host Path进入Model History

hint包含Codex home absolute path，会进入function output和后续模型请求，也可能进入rollout。

它有操作价值，也暴露本机用户名/目录结构。更稳的Artifact协议应给模型opaque artifact URI，真正执行copy时再由host解析。

## 20. Artifact与Model History的重复

成功结果可能同时存在：

- base64 backend response；
- GeneratedImageOutput.result；
- FunctionCallOutput data URL；
- completed ImageGenerationItem.result；
- legacy ImageGenerationEnd.result；
- host PNG file；
- rollout/history serialization；
- App Server live notification。

这些表示服务不同兼容面，但会放大：

- 内存峰值；
- JSON序列化大小；
- rollout体积；
- thread/resume响应；
- 后续model request payload。

当前没有以content hash或artifact ID去重这些副本。

## 21. History按Model Modality投影

当下一轮模型支持Image input：

- ImageGenerationCall result保留；
- FunctionCallOutput中的InputImage保留。

当下一轮模型只支持Text：

-普通InputImage替换为`[image omitted]`文字；
- FunctionCallOutput InputImage也替换placeholder；
- hosted ImageGenerationCall保留metadata，但result清空。

这是正确的capability projection：durable history可有图片，具体model prompt按能力降级。

### 21.1 Extension与Hosted路径并存

History类型仍识别hosted Responses API `ImageGenerationCall`；standalone extension则主要通过FunctionCallOutput image进入下一轮。

二者共享UI item概念，但协议来源不同，不能假设所有ImageGenerationItem都对应同一种ResponseItem。

## 22. Thread Resume的Remote Redaction

App Server对特定ChatGPT Android/iOS remote client的 `thread/resume` 做response-only redaction：

- MCP payload替换为redacted；
- ImageGeneration ThreadItem直接从resume turns删除。

注释明确这是针对大payload的临时bandaid。

它不会改变：

- persisted rollout；
- model resume history；
- 其他client的thread/resume；
- live item/completed notification；
- host PNG file。

所以这是client-specific projection，不是artifact retention policy。

## 23. TUI只展示Prompt与Saved Path

TUI的legacy end event渲染：

- completed：Generated Image；
- failed：Image generation failed；
- detail：revisedPrompt或callId；
- savedPath存在时显示file URL/path。

TUI history cell不直接用result bytes渲染图片，但App Server和模型投影仍携带完整base64。

UI需要path可点击，模型需要inline bytes，这两个consumer的最佳表示不同。

## 24. 无Save Root模式

Extension允许resolve_save_root返回None。

此时：

- 仍生成/编辑图片；
- 仍返回inline image；
- savedPath=None；
- 不创建generated_images目录；
- 模型不收到path hint。

测试用它证明Turn临时读取权限不会导致本地artifact持久化。

这使“能生成”与“必须落盘”解耦，适合remote或ephemeral client。

## 25. 当前没有Cleanup/Retention Owner

全仓库对`generated_images`的生产路径集中在image generation，未发现配套：

- TTL；
- quota；
- LRU；
- Thread删除时级联；
- account logout清理；
- artifact list/delete API；
- startup orphan scan；
- reference count；
- disk usage telemetry。

Skill说明甚至要求默认保留原图，除非用户明确要求删除。

因此 `$CODEX_HOME/generated_images` 会随调用长期增长，artifact owner是隐含Thread目录，但生命周期没有与Thread archive/delete绑定。

## 26. 值得学习的实现

### 26.1 不把未实现Feature当事实

Artifact flag被schema隐藏且无consumer，真实能力由ImageGeneration extension提供。研究与文档应基于调用链，不根据Feature名字脑补产品状态。

### 26.2 输入权限与系统输出权限分离

模型指定文件受Turn sandbox约束；系统默认artifact写入host-owned Codex storage。

### 26.3 API成功与保存成功分层

本地save失败不抹掉已生成的primary image。

### 26.4 Typed Item有唯一终态

Backend失败也发布failed completed item，不留下永远in_progress的UI状态。

### 26.5 多投影避免Telemetry泄漏

模型拿image，Code Mode拿data URL，UI拿typed item，telemetry只拿固定preview。

### 26.6 History Reference要求Call存在

Recent image扫描排除orphan function/custom outputs，降低错误历史注入。

### 26.7 Capability-aware Prompt

model不支持Image时清空/替换image payload，而不是让request在provider处失败。

### 26.8 Output Hint有完整性预算

路径hint过长则整体省略，不发送被截断而不可执行的半条路径。

## 27. 已确认的风险与限制

### 27.1 Artifact没有稳定ID

系统用Thread ID + call ID推导path，但跨host、remote client和history edit都没有opaque artifact ID。

### 27.2 Path与Environment未绑定

explicit reference只有AbsolutePath，第一个ToolEnvironment被隐式选中。

### 27.3 Sanitization Collision

多种callId可映射到同一个filename，write无collision check。

### 27.4 非原子写与无hash

partial file、覆盖、磁盘损坏和后续替换都没有manifest可检测。

### 27.5 PNG类型只靠约定

base64 valid即可保存为PNG，没有magic/decode验证。

### 27.6 无Bytes Budget

Image API result string、base64 decode、protocol item、rollout和resume没有统一单图/Thread总预算。

### 27.7 Duplicate Storage

同一image同时存base64 history与PNG file，缺少content-addressed dedupe。

### 27.8 无Retention/Cleanup

generated_images没有quota或Thread生命周期清理。

### 27.9 Absolute Path泄漏

output hint和savedPath把Codex home路径投影给模型与client。

### 27.10 Remote Projection不一致

特定mobile resume删除image items，其他client仍收到完整payload；live与resume也不同。

### 27.11 Recent N语义脆弱

新插入无关图片会改变“last N”，没有stable reference保证编辑的是用户预期对象。

### 27.12 First Environment隐式路由

多Environment场景无法明确选择path owner。

### 27.13 Save Failure无Receipt

completed+None只能表达结果，没有结构化保存失败原因与重试入口。

### 27.14 Provider返回多图只取First

没有variants manifest或warning。

### 27.15 revisedPrompt命名漂移

standalone extension填原prompt，hosted API字段可能代表真正revised prompt。

### 27.16 Artifact Feature是Dormant Contract

Feature注释可能让外部开发者误以为已有native artifact API；schema又隐藏它，导致配置、文档和runtime状态不一致。

## 28. 更强的Artifact模型

一个可扩展的类型可以是：

```ts
interface ArtifactRef {
  artifactId: string
  owner: {
    tenantId: string
    threadId: string
    turnId: string
    toolCallId: string
  }
  environmentId: string
  kind: 'image'
  mediaType: 'image/png'
  bytes: number
  sha256: string
  generation: number
  storage: 'host' | 'executor' | 'object-store'
  status: 'staging' | 'ready' | 'failed' | 'deleted'
  createdAt: string
  expiresAt?: string
}
```

模型只看到：

```text
artifact://<artifactId>
```

Tool真正读取或copy时，由host做：

- ownership校验；
- environment resolution；
- generation/hash校验；
- permission求交；
- bytes budget；
- audit receipt。

## 29. Artifact Commit建议

```text
API bytes received
  -> validate media type/dimensions/bytes
  -> write staging temp
  -> fsync temp if durability required
  -> compute sha256
  -> insert Artifact(status=staging)
  -> atomic rename/object finalize
  -> Artifact(status=ready, storage receipt)
  -> emit completed Item with artifactRef
```

如果本地保存失败但inline image仍可交付：

```text
ImageGeneration status = completed
Artifact status = failed
```

不要把两个状态压成一个字符串。

## 30. 对当前 AI SEO Agent 的迁移建议

SEO Agent未来可能生成：

- SEO报告；
- CSV关键词表；
- sitemap diff；
- screenshot；
- HTML preview；
-批量任务结果。

这些都不应直接在Message中重复保存大base64或任意本地path。

建议：

```text
AgentStep / ToolResult
  -> artifactId +摘要+模型所需的小投影

Artifact Store
  -> bytes/object key/hash/media type/owner/retention

Web API
  -> 短期signed download URL

Model Adapter
  -> provider需要时才转data URL或file ID
```

### 30.1 UI Message不等于Artifact

Message只引用artifact并显示状态。删除Message不应自动删除仍被报告引用的artifact；删除Conversation时则按policy级联或延迟GC。

### 30.2 Run/Tool Identity写入Owner

artifact必须能回答“哪次Run的哪个Tool Call产生”，而不是只看文件名猜测。

### 30.3 Content-addressed Dedupe

大图片/报告用sha256去重storage bytes，但owner/reference仍是独立records。

### 30.4 Provider投影延迟生成

OpenAI需要data URL/file ID时临时构造；其他provider只拿文本摘要。不要把provider-specific base64作为canonical数据库事实。

## 31. 建议补充的测试

### Identity与Path

- [ ] 不同unsafe callIds不会碰撞或覆盖。
- [ ] artifactRef绑定environmentId，不能在错误executor读取。
- [ ] Thread/Turn/ToolCall owner可从artifact查询。
- [ ] absolute host path不进入model-visible输出。

### Commit与Integrity

- [ ] invalid PNG base64被拒绝。
- [ ] 超过单图bytes/dimensions上限在落盘前失败。
- [ ] crash after temp write不留下ready artifact。
- [ ] final hash与文件内容一致。
- [ ] existing target有明确dedupe/version策略。

### Projection

- [ ] telemetry永不含base64。
- [ ] text-only model只收到placeholder/summary。
- [ ] image-capable model按需读取artifact。
- [ ] mobile resume返回artifact metadata，不删除整个item。
- [ ] live与resume有一致的payload budget语义。

### Lifecycle

- [ ] Thread delete触发reference cleanup。
- [ ] archive不误删artifact。
- [ ] TTL与legal hold求交正确。
- [ ] startup扫描staging/orphan并repair。
- [ ] quota按tenant/thread/kind执行。
- [ ] model复制到workspace后记录新artifact/reference关系。

### History Selection

- [ ] edit可用稳定artifactId选择旧图。
- [ ] last N只作为fallback且UI可解释。
- [ ] orphan tool output不成为reference。
- [ ] 不同environment的图片不能无提示混用。

## 32. 结论

Image Generation extension已经体现了一些成熟边界：输入读取复用Turn permission、默认输出由host storage拥有、API成功与save失败分开、typed item有唯一终态、telemetry不携带base64、模型按capability读取history。

但它仍是一个“文件路径+大payload”实现，不是完整Artifact系统：

```text
callId-derived path
+ full base64 in multiple projections
+ no hash/generation/manifest
+ no atomic commit
+ no cleanup/quota
+ no stable cross-environment reference
```

最重要的学习结论是：Artifact不是“把Tool结果写成文件”。它需要独立identity、owner、environment、integrity、status、retention和consumer projection。Codex当前Image Generation给出了很好的起点，也清楚暴露了下一步native Artifact能力必须补齐的契约。
