# Image Input 解码、规范化、缓存与 History 边界

Codex 的图片输入来自多个入口：用户可直接提交 data URL 或本地路径，Tool 可返回图片，模型可调用 `view_image` 读取选中 Environment 中的文件，Thread 还允许注入带 `InputImage` 的 ResponseItem。

这些入口最终都要解决同一组问题：

- 哪个组件有权读取文件或远程 URL？
- 原始图片何时冻结成不可变 bytes？
- EXIF orientation、色彩配置与格式如何保真？
- 图片按像素、patch、编码 bytes 还是上下文 token计费？
- 解码失败后 History 保存原始坏输入，还是保存稳定 placeholder？
- UI 看到的本地附件和模型真正看到的 data URL 如何关联？

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/protocol/src/user_input.rs`
- `codex-rs/protocol/src/models.rs`
- `codex-rs/protocol/src/items.rs`
- `codex-rs/protocol/src/protocol.rs`
- `codex-rs/utils/image/src/lib.rs`
- `codex-rs/utils/image/src/error.rs`
- `codex-rs/core/src/image_preparation.rs`
- `codex-rs/core/src/image_preparation_tests.rs`
- `codex-rs/core/src/session/mod.rs`
- `codex-rs/core/src/tools/handlers/view_image.rs`
- `codex-rs/core/src/context_manager/history.rs`
- `codex-rs/core/src/client_common.rs`
- `codex-rs/tools/src/image_detail.rs`
- `codex-rs/app-server/src/image_url.rs`
- `codex-rs/app-server/src/request_processors/turn_processor.rs`

本文研究的是“输入图片进入模型历史”的链路，不重复讨论 Image Generation Tool 的出图事务。

## 2. 四类入口，一个 Canonical 形态

### 2.1 用户 inline image

协议：

```ts
type ImageInput = {
  type: 'image'
  imageUrl: string
  detail?: 'auto' | 'low' | 'high' | 'original'
}
```

预期 `imageUrl` 是 pre-encoded data URI。App Server 拒绝 `http:`/`https:` URL。

### 2.2 用户 local image

协议：

```ts
type LocalImageInput = {
  type: 'localImage'
  path: string
  detail?: ImageDetail
}
```

Core 读取本地文件，把 bytes 转成 data URL，并为模型插入带图片编号和路径的文本标签。

### 2.3 Tool output image

`view_image`、MCP、Dynamic Tool 或 Code Mode 可以返回：

```text
FunctionCallOutputContentItem::InputImage {
  image_url,
  detail
}
```

Tool output image与用户 message image最终共享同一 `prepare_response_items` 规范化链。

### 2.4 Thread history injection

App Server `thread/injectItems` 接受任意合法 ResponseItem JSON，先拒绝其中的远程 HTTP(S) image URL，再交给 Core history insertion。

最终 canonical model item 都是：

```text
ContentItem::InputImage {
  image_url: data:<actual-mime>;base64,...
  detail
}
```

或者在失败时变成稳定的 `InputText` placeholder。

## 3. Authority：Image 与 LocalImage 不等价

### 3.1 Remote URL 默认拒绝

App Server 在 Turn Start、Turn Steer 与 injected ResponseItem admission 时拒绝 `http:`/`https:` image URL，提示调用方改用 inline data URL。

Core 的 history preparation也会再次检查远程 URL。其他入口绕过 App Server 时，不会发起网络抓取，而是把图片替换为：

```text
image content omitted because remote image URLs are not supported
```

这是防 SSRF 与远端内容漂移的好边界：canonical history不依赖未来再次访问一个 URL。

但 scheme判断只特别处理 HTTP(S)。非 data、非 HTTP(S) 的字符串会原样保留，例如 `file:`、`ftp:` 或自定义 scheme。最终 provider通常不会接受，但输入层没有采用严格的 `data:` allowlist。

### 3.2 LocalImage 直接读取 Codex host path

`ResponseInputItem::from_user_input` 对 LocalImage 使用同步 `std::fs::read(path)`：

- 不通过 Environment filesystem abstraction；
- 不通过 Turn filesystem sandbox；
- 不要求 path位于 workspace root；
- relative path相对 Codex process cwd，不是显式 Turn Environment cwd；
- 不携带 environment ID。

这适合本地可信 TUI 选择附件，但 App Server 是多客户端协议。一旦远程/非完全可信 client拥有该 RPC authority，LocalImage就是读取 Codex host任意可读文件并发送给模型的能力。

### 3.3 `view_image` 的 authority 更完整

模型主动调用 `view_image` 时，流程不同：

1. 检查 Turn model支持 image input；
2. 根据 Step Environment snapshot解析 environment ID；
3. 把 path相对该 Environment cwd解析成 PathUri；
4. 构建当前 Turn filesystem sandbox context；
5. 用 Environment filesystem `get_metadata/read_file`；
6. 验证是普通文件；
7. 生成 Tool output image。

因此 `view_image` 能支持 remote Environment，并服从当前文件权限。用户 LocalImage attachment 与模型 Tool read 是两个不同 trust path，不能复用一个含糊的 `path` 参数。

## 4. 何时冻结文件内容

LocalImage 被转换成 ResponseItem 时会立即把文件完整读入 `Vec<u8>`，再包装成 `data:application/octet-stream;base64,...`。

Core Session 使用 `LocalImagePreparation::Defer`：

```text
read local bytes now
  -> wrap octet-stream data URL
  -> later at history boundary decode/resize/canonicalize
```

这有一个重要优点：文件路径在 admission 后即使被替换，模型与 Rollout 使用的仍是第一次读取到的 bytes，避免“UI选的是A、模型读取时已变B”的路径 TOCTOU。

但读取本身：

- 是同步调用，发生在 async Core路径上；
- 在分配前没有 metadata size gate；
- 会一次性读取完整文件；
- 随后 base64 再产生约 4/3 大小字符串。

大文件能同时占据原始 Vec、base64 String、ResponseItem clone与序列化缓冲。

## 5. History Boundary 是规范化提交点

`Session::prepare_conversation_items_for_history` 在：

- 写入内存 ContextManager；
- 写入 Rollout；
- 发送 raw ResponseItem notification；

之前调用 `prepare_response_items`。

它会遍历：

- Message content中的 InputImage；
- FunctionCallOutput/CustomToolCallOutput中的 InputImage。

Data URL 被解码、按 detail规范化并重新编码。失败则原地替换成文本 placeholder。

所以 canonical history保存的是：

```text
成功：规范化后的data URL
失败：稳定且模型可读的omission文本
```

而不是每次 sampling 都重新尝试同一个坏图片。这个“normalize before persist”原则非常值得学习。

## 6. Detail 语义

### 6.1 History preparation limits

`image_preparation.rs` 使用两组限制：

| detail | 最大边长 | 最大32×32 patch |
| --- | ---: | ---: |
| none / auto / high | 2048 | 2,500 |
| original | 6000 | 10,000 |
| low | 不支持，替换 placeholder | - |

Resize 同时满足边长和 patch面积预算，不是只看 width/height。

### 6.2 Local preprocessing 与最终 preparation 有差异

Protocol 层 `local_image_content_items_with_label_number` 的旧/通用路径把：

- original -> `PromptImageMode::Original`
- auto/low/high -> `ResizeToFit(2048)`

但 Session 的 Defer 路径最终仍会进入 history preparation。因此即使LocalImage早期按ResizeToFit处理，`detail=low` 最终仍会被 Core替换成“不支持low”的文本。

不同阶段对 detail的解释存在漂移，最终 canonical行为以 history preparation为准。

### 6.3 Model capability

Tool output会根据 `model_info.supports_image_detail_original` 把不支持的 original降为默认 detail；`view_image` Tool spec也只在模型支持时暴露 original选项。

用户输入协议本身仍可携带 original，history preparation只按尺寸处理，不读取 model capability。调用方如果绕过产品UI，可能把 original detail发送给不支持该hint的provider。

### 6.4 Responses Lite

发送到 Responses Lite 时，Prompt clone会移除所有 image detail hint。canonical history仍保留 detail，wire projection按provider能力缩水。

这再次说明 history fact 与一次 transport projection不应混为一谈。

## 7. Data URL 解析与格式判定

### 7.1 Metadata只要求base64 marker

Parser：

- `data:` prefix大小写不敏感；
- 要求逗号分隔metadata/payload；
- metadata参数中必须有`base64`；
- 不信任声明的MIME来决定decoder。

实际格式由 `image::guess_format(file_bytes)` 判断。`data:application/octet-stream` 也能被规范化为真实 image MIME。

这是优质的内容嗅探边界：用户声明不等于制品事实。

### 7.2 输入byte guard

Data URL 对：

- base64字符payload长度；
- decode后bytes长度；

都设了 1 GiB sanity guard。

1 GiB 只防极端病态输入，不是适合桌面交互的业务预算。更关键的是，这个guard只在 `load_data_url_for_prompt`；`load_for_prompt_bytes` 本身没有同样检查，所以 LocalImage和`view_image`可以在进入该函数前读入任意大文件。

### 7.3 解码像素预算

代码在 `DynamicImage::from_decoder` 后才计算目标resize dimensions。源码在这一层没有显式设置产品级decoder allocation/pixel limit。

因此小压缩文件、超大像素或解码炸弹可能先产生大像素buffer，再被缩到2048。输出patch预算不能替代解码前预算。

底层image库可能有自己的防护，但产品不应把资源上界隐式交给依赖默认值。

## 8. 格式、重编码与 Metadata

### 8.1 保留源bytes

当无需resize且格式为：

- PNG
- JPEG
- WebP

时，Codex直接保留源bytes。

优点是避免无谓损失和CPU开销。代价是源文件中的所有 ancillary metadata也会被原样发送。

### 8.2 GIF和其他格式

GIF可被识别，但不直接保留，解码为静态 DynamicImage后重新编码。其他image crate能解码的格式也会转PNG。

这符合“模型输入是静态图片”的产品边界，动画语义会丢失。

### 8.3 Resize编码

Resize后优先保留原类别：

- JPEG -> JPEG quality 85
- WebP -> lossless WebP
- 其他 -> PNG

滤镜使用 Triangle，在吞吐与质量之间取中间值。

### 8.4 ICC 与 EXIF

Decoder提取ICC和EXIF。只有profile header声明RGB的ICC会跨重编码保留，避免已经转成RGB的CMYK/JPEG继续携带错误profile。

EXIF也会保留，包括orientation，有助于正确显示。但EXIF可能包含GPS、设备型号、时间等隐私。Resize并不自动等于metadata scrub。

如果源bytes原样保留，代码不会只挑ICC/EXIF，而是所有源metadata都保留。

一个成熟上传管道应区分：

- rendering metadata；
- privacy-sensitive metadata；
- forensic provenance metadata；

并按产品目的做显式策略，而不是一律保留。

## 9. 图片 Cache

### 9.1 Key

Process-global cache key是：

```text
SHA-1(source file bytes) + PromptImageMode
```

相同bytes、相同mode跨路径复用；同一图片的high/original分别缓存。

这里SHA-1用于非安全内容寻址和LRU key，不用于防篡改或签名验证，风险语义应区分。

### 9.2 双预算

Cache同时限制：

- 最多32 entry；
- encoded bytes总计约64 MiB。

单个encoded image超过64 MiB不缓存。插入后按LRU逐项淘汰，直到总bytes回到预算内。

“entry count + byte capacity”比只限制数量更合理，因为图片大小差异巨大。

### 9.3 缓存不冻结完整处理成本

Cache保存最终 `EncodedImage` 的 Arc bytes，不保存decoded pixels。命中避免重新decode/resize/encode。

get miss后在cache锁外计算，再put；并发相同key可能重复做重CPU工作，没有显式singleflight。

## 10. 错误降级

History preparation把错误映射成有限placeholder：

- remote URL不支持；
- low detail不支持；
- image过大；
- 通用processing失败。

LocalImage早期处理的placeholder更详细，会包含：

- 本地path；
- invalid/unsupported分类；
- decoder/IO错误文本。

优点是模型知道附件缺失，不会假装看见。缺点是：

- absolute path进入模型prompt；
- filesystem/decoder错误细节可能外发；
- UI attachment仍可能显示，而模型只收到omission文本；
- analytics仍按submitted image计数，不代表prepared成功。

`prepare_response_items` 只warn，不发typed image-preparation event。用户未必能从UI明确知道模型没有看到图片。

## 11. Local Image 标签与 Prompt Framing

LocalImage会被包装：

```xml
<image name=[Image #2] path="/absolute/path.png">
  [InputImage]
</image>
```

编号在inline image与local image间共享：前面已有一张inline image时，第一张local image会是`Image #2`。这样模型输出可与UI序号对齐。

本地path通过`display()`直接插入XML-like attribute，没有转义quote、`<`、`>`或control字符。特殊文件名可以破坏framing，形成低层prompt injection面。

这里应使用结构化content metadata，或至少与Realtime Handoff一样做严格escaping。

## 12. `view_image` 的提交语义

`view_image`先读取完整file bytes并包装为`application/octet-stream` data URL，不在handler内decode。随后返回FunctionCallOutput InputImage，history insertion统一负责decode/resize。

优点：

- Tool handler与user attachment共享canonical preparation；
- Tool log preview只记录data URL长度，不记录base64正文；
- Turn Item只保存ImageView的path和call ID；
- Model不支持image input时Tool直接拒绝；
- original detail按model capability降级。

局限：

- read_file没有handler级size cap；
- 原始bytes到base64在decode前复制放大；
- Tool Completed在image decode/prepare之前发出；
- 后续prepare失败时Tool生命周期可能已经显示completed/success；
- Code Mode result能得到完整data URL对象，进一步复制大字符串。

“文件读取成功”和“模型成功看见图片”仍是两个阶段。

## 13. History、Rollout 与 UI 三种投影

### 13.1 Model history

保存规范化data URL或placeholder。这样冷resume不依赖原路径仍存在。

### 13.2 UserMessageEvent

UI事件分别保留：

- inline image URLs + parallel detail hints；
- local image paths + parallel detail hints；
- text elements。

Local path用于UI编辑历史时重新attach，不应被当作API-ready URL。

### 13.3 Rollout bytes

现代ResponseItem history会把base64图片写入JSONL。图片token成本可能较低，但磁盘bytes仍是真实的4/3编码大小。

UI path、canonical data URL和model wire projection是三种不同事实：

```text
UI source reference
  path / attachment identity

canonical frozen content
  normalized data URL in history

transport projection
  provider-compatible detail/MIME payload
```

## 14. Context 预算不是 Storage 预算

ContextManager估算序列化item bytes时，会识别`data:image/...;base64`并把巨大的base64 payload减掉，替换为图片固定/patch近似成本：

- 非original使用固定约7,373 bytes等价；
- original会decode图片，按32×32 patch计数，最多10,000 patch；
- original估算结果放入32-entry cache。

这让auto-compaction更接近模型视觉token，而不是把base64字符当文本token。

但它制造了两套预算：

```text
model context cost
  按视觉patch估算

memory/disk/wire cost
  按完整base64 bytes承担
```

大量图片可能尚未触发context compaction，却已经让Rollout、clone、JSON serialization和网络body很大。资源治理必须分别限制：

- image count；
- original bytes；
- decoded pixels；
- normalized bytes；
- total request bytes；
- visual patches/tokens；
- rollout bytes。

## 15. 同步CPU与内存峰值

图片准备是同步函数，并在history insertion路径直接执行：

- base64 decode；
- format sniff；
- image decode；
- resize；
- reencode；
- base64 encode。

没有显式`spawn_blocking`或per-image deadline。大图会占用Tokio worker线程，影响同进程其他Session延迟。

近似峰值可能同时包含：

```text
input data URL string
+ decoded compressed bytes
+ DynamicImage pixel buffer
+ resized pixel buffer
+ encoded output Vec
+ output base64 string
+ history/item clone
```

1 GiB input guard在这个内存模型下过于宽松。

## 16. 失败顺序表

| 阶段 | 已发生事实 | 当前结果 |
| --- | --- | --- |
| App Server收到HTTP(S) URL | 未入Core | InvalidRequest |
| LocalImage path读取失败 | UI仍有原path | 模型收到path+错误placeholder |
| LocalImage读取成功后文件变化 | bytes已冻结 | 模型使用旧bytes，UI重编辑可能读新文件 |
| base64超1GiB | 大字符串已进入请求内存 | too-large placeholder |
| format/decode失败 | canonical item尚未persist | processing placeholder |
| decode成功、resize失败 | 已分配像素buffer | placeholder |
| cache miss并发 | 多worker重复decode | 最终相同key覆盖/复用 |
| view_image read成功 | Tool Item可先completed | history prepare后才知道模型能否看见 |
| original发送到不支持model | history仍带original | Tool output会降级，用户input不一定 |
| Responses Lite发送 | history保留detail | wire clone移除detail |
| cold resume | 原本地文件可不存在 | canonical data URL仍可重放 |

## 17. 值得学习的设计

### 17.1 Remote URL不由Agent隐式抓取

拒绝HTTP(S)并要求调用方inline冻结内容，减少SSRF、认证泄漏和URL内容漂移。

### 17.2 Normalize before persist

坏图片一次失败后变成稳定placeholder，成功图片以规范化MIME/尺寸进入History。Replay不重新访问path或URL。

### 17.3 真实bytes决定格式

不信任data URL声明MIME，使用magic bytes guess format，octet-stream attachment也能正确canonicalize。

### 17.4 边长+patch双预算

超长窄图和中等边长大面积图都能被约束，比单一max width更贴近视觉模型成本。

### 17.5 Count+bytes LRU

process cache同时限制entry和encoded bytes，并按source bytes+mode复用。

### 17.6 Environment filesystem用于模型主动读取

`view_image`使用Step environment snapshot和sandbox context，不把remote file偷映射成host path。

### 17.7 History与wire projection分离

Responses Lite去detail、Tool output按model capability降original，但canonical history仍保存语义hint。

## 18. 不能照搬的缺口

### 18.1 LocalImage绕过Environment authority

App Server local path应绑定client/host capability，或要求先上传为artifact handle，而不是允许字符串PathBuf直读Core host。

### 18.2 缺总量预算

没有看到统一image count、message total bytes、decoded pixels、session rollout bytes上限。1GiB单图guard不等于合理资源治理。

### 18.3 解码发生太晚且同步

应在专用blocking pool/quarantine worker中做header probe、pixel budget、deadline和decode，不阻塞Session核心状态机。

### 18.4 Metadata隐私策略不明确

EXIF/GPS与源格式metadata可能外发。保留orientation不等于必须保留全部EXIF。

### 18.5 Path标签未escaping

文件名进入XML-like prompt前应结构化或严格escape。

### 18.6 Tool completed早于image prepared

需要把read、prepared、model-visible三个阶段分开，或让Tool result明确`prepared=false`。

### 18.7 Scheme应采用allowlist

只拒绝HTTP(S)仍让未知scheme流入provider。canonical image URL应只接受已验证data URL或opaque artifact handle。

## 19. 映射到 AI SEO Agent

AI SEO Agent未来会处理截图、网页预览、Search Console导出、Logo和内容素材。不要把这些都建模成base64 string。

### 19.1 Artifact-first模型

```ts
type MediaArtifact = {
  id: string
  tenantId: string
  source: 'upload' | 'browserScreenshot' | 'toolOutput' | 'connector'
  sourceName: string | null
  sourceSha256: string
  canonicalSha256: string | null
  mime: string
  originalBytes: number
  decodedWidth: number | null
  decodedHeight: number | null
  state: 'uploaded' | 'scanning' | 'ready' | 'rejected'
  storageKey: string
}

type ModelImageProjection = {
  artifactId: string
  projectionId: string
  detail: 'high' | 'original'
  width: number
  height: number
  patches: number
  bytes: number
  sha256: string
}
```

数据库与事件只传artifact handle和projection receipt，真正bytes放object storage，不在每个AgentStep JSON里复制base64。

### 19.2 推荐管道

```text
admission
  -> tenant ownership + source authority
  -> compressed byte/count budget
  -> immutable upload commit + SHA-256
  -> metadata probe + decoded pixel budget
  -> decode in isolated worker
  -> privacy metadata scrub
  -> canonical orientation/color
  -> high/original projection
  -> model request pins projection digest
  -> Run receipt recordsartifact/projection ID
```

### 19.3 URL抓取应独立成Tool

远程图片不能由model provider隐式fetch。若业务需要抓URL，应走：

- URL policy/SSRF guard；
- redirect与DNS pin；
- content-type和stream bytes cap；
- immutable artifact落盘；
- malware/image decode quarantine；
- tenant audit receipt。

抓取完成后模型只消费artifact projection。

## 20. 最小验证矩阵

### 20.1 Admission

- 只接受data URL、Local capability或artifact handle。
- HTTP(S)/file/unknown scheme各有明确策略。
- image count、单图bytes、总bytes在decode前限制。
- Local path绑定正确Environment/client authority。
- relative path基准明确，不依赖process cwd。

### 20.2 Decode

- MIME spoof由magic bytes纠正。
- malformed base64、truncated image稳定失败。
- 压缩小/像素巨大的图片在allocation前拒绝。
- decode/resize/encode有deadline与专用worker pool。
- GIF/animated input的静态化语义明确。

### 20.3 Fidelity与Privacy

- EXIF orientation正确应用。
- 非RGB ICC不会错误复用。
- GPS/device metadata按policy剥离。
- transparent PNG、CMYK JPEG、WebP视觉回归。
- reencode后的MIME与真实bytes一致。

### 20.4 Cache

- key包含source digest+projection mode+processor version。
- 并发相同key singleflight。
- entry count和bytes双预算。
- processor升级不会误命中旧结果。
- cache不是authority，miss可从immutable source重建。

### 20.5 History与恢复

- prepared后才写canonical history。
- 失败保存typed omission reason，不保存巨型坏payload。
- cold resume不依赖local path。
- UI source与model projection有稳定artifact ID关联。
- compaction分别考虑visual token与storage bytes。

### 20.6 Tool生命周期

- view/read started、bytes read、image prepared、model-visible分阶段。
- read成功但decode失败不能只显示success。
- original unsupported时明确降级receipt。
- Code Mode/Hook/日志不复制完整base64。
- cancellation能中断decode worker结果提交。

## 21. 推荐源码阅读顺序

1. 从`UserInput::Image/LocalImage`开始，区分inline bytes和host path authority。
2. 阅读`ResponseInputItem::from_user_input`，观察Defer如何冻结bytes并保留UI path标签。
3. 阅读Session history insertion，确认canonical preparation发生在内存/rollout写入之前。
4. 阅读`image_preparation.rs`，列出remote/low/size/processing placeholder和detail limits。
5. 阅读`utils/image`，画出data URL→bytes→decoder→resize→metadata→encoder→cache。
6. 阅读`view_image`，对比Environment filesystem+sandbox和LocalImage直读host path。
7. 阅读ContextManager image estimate，区分视觉token与base64 storage cost。
8. 最后阅读App Server UI event mapping，理解path、data URL和wire projection为何是三个事实。

## 22. 结论

Codex 图片输入链最成熟的部分，是它把canonicalization放在History提交边界，并让所有入口最终共享同一图片处理器：

```text
source reference
  path / data URL / Tool output

frozen bytes
  admission时固定内容

canonical model image
  真实MIME、尺寸、patch与detail

history fact
  normalized data URL或stable placeholder

wire projection
  provider/model兼容版本
```

它还做对了远程URL拒绝、magic-byte格式判定、边长+patch预算、EXIF orientation/ICC保真、count+bytes LRU和Environment-aware `view_image`。

下一步需要补的是制品级资源治理：LocalImage authority、decode前pixel budget、总图片/总请求bytes、专用worker与deadline、metadata privacy、escaped path framing、artifact handle和model-visible receipt。对于云端Agent，base64应该是最终wire encoding，而不应成为数据库、事件和业务状态的核心身份。
