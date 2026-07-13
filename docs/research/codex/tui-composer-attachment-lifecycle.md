# TUI Composer Attachment、占位符、队列与失败恢复

Codex TUI 的图片附件不是 TextArea 里的一段普通字符串。用户看到的 `[Image #1]` 只是一个可编辑投影，真正需要保持一致的是：

- 本地图片路径；
- 远程 image URL；
- TextElement 字节区间；
- placeholder label；
- 大段粘贴的隐藏 payload；
- mention binding；
- queued / pending steer / rejected steer；
- 当前 Thread 的临时输入状态；
- 本地会话 history 与跨会话 persistent history。

本文关注的核心问题是：一个包含图片、粘贴占位符和 mentions 的 Draft，从输入、排队、合并、提交失败、打断恢复到历史回看时，哪些状态必须一起移动，哪些只能作为 UI 临时投影。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/tui/src/bottom_pane/chat_composer.rs`
- `codex-rs/tui/src/bottom_pane/chat_composer/attachment_state.rs`
- `codex-rs/tui/src/bottom_pane/chat_composer_history.rs`
- `codex-rs/tui/src/bottom_pane/textarea.rs`
- `codex-rs/tui/src/bottom_pane/mod.rs`
- `codex-rs/tui/src/chatwidget/user_messages.rs`
- `codex-rs/tui/src/chatwidget/input_submission.rs`
- `codex-rs/tui/src/chatwidget/input_restore.rs`
- `codex-rs/tui/src/chatwidget/interaction.rs`
- `codex-rs/tui/src/chatwidget/settings.rs`
- `codex-rs/tui/src/chatwidget/slash_dispatch.rs`
- `codex-rs/tui/src/clipboard_paste.rs`
- `codex-rs/protocol/src/user_input.rs`
- `codex-rs/app-server/src/request_processors/turn_processor.rs`

图片最终进入 Core 后的读取、解码、resize、metadata与模型投影见 [Image Input Authority、解码规范化、Cache 与 History](./image-input-preparation-and-history.md)。本文只研究 TUI Draft到结构化 `UserInput` 之前的状态机。

## 2. Draft 不是一个 String

### 2.1 六元状态

`ThreadComposerState`保存：

```text
text
local_images
remote_image_urls
text_elements
mention_bindings
pending_pastes
```

它们共同构成一个可恢复 Draft。只保存 `text` 会产生多种“看起来正确、实际语义已丢”的状态：

- `[Image #1]`还在，但对应路径没了；
- `$skill`还在，但canonical Skill path没了；
- `[Pasted Content 5000 chars]`还在，但真实5000字符没了；
- TextElement byte range仍指向编辑前位置；
- remote rows与local placeholder重新编号不一致。

这和前端富文本编辑器很相似：DOM里显示的label不是业务entity，必须有独立的entity store和range mapping。

### 2.2 本地图片与远程图片是不同UI形态

`AttachmentState`分开保存：

```text
local_images: Vec<AttachedImage { placeholder, path }>
remote_image_urls: Vec<String>
selected_remote_image_index: Option<usize>
```

本地图片在TextArea正文里有atomic element placeholder；远程图片不插入正文，而是在Composer上方渲染为不可编辑row。

原因来自数据来源：

- TUI主动attach/paste得到本地路径，适合把插入位置显示在正文；
- App Server或历史回放可能只给远程/data URL，没有原始正文placeholder位置，只能恢复成独立row。

两者最终都成为结构化image input，但编辑模型不同。

## 3. Placeholder 只是UI引用，不是附件身份

本地图片的label通过：

```text
[Image #N]
```

生成。N由当前remote image数量和local image顺序决定：

```text
remote images: 1..M
local images: M+1..M+N
```

这说明label不是稳定ID。删除一个remote row后，所有local image label都可能变化。

`AttachmentState.relabel_local_images`会同时更新：

- `AttachedImage.placeholder`；
- TextArea中对应element payload。

这是一个很重要的双写点。若只更新图片数组，用户删除旧placeholder时找不到附件；若只更新TextArea，提交时path顺序与label不一致。

### 3.1 为什么不按正文出现顺序编号

合并多个消息时，代码按 `local_images`列表建立旧label→新label映射，而不是按placeholder在text中的视觉出现顺序编号。

即使用户把 `[Image #2]`移动到 `[Image #1]`前面，结构化图片顺序仍按附件数组保持。label只帮助人观察，不重新定义模型input顺序。

## 4. TextElement 是placeholder所有权边界

`TextElement`保存UTF-8 text中的byte range和可选placeholder。它不是character range。

删除local image或展开大粘贴时，代码不只搜索字符串，还检查TextArea element payload：

- atomic element被删除后，从before/after payload差集识别删除；
- 删除paste placeholder时清对应pending payload；
- 删除image placeholder时清对应AttachedImage；
- 提交前只保留仍有TextElement引用的local image。

这防止用户手工输入一段字面量 `[Image #1]`就意外绑定真实附件。

### 4.1 Submission pruning

`prune_local_images_for_submission`从TextElement集合取得实际placeholder，再retain图片：

```text
AttachedImage存在
  + 正文普通字符串同名
  + 没有atomic TextElement
  -> 不提交图片
```

这是比 `text.contains(label)`更强的语义检查。

### 4.2 External editor是受限重建

外部编辑器只返回plain text，没有TextElement metadata。TUI为兼容这个入口，会：

1. 清全部pending paste payload；
2. 统计旧local image placeholder在新text中的出现次数；
3. 按旧附件列表最多保留相同次数的附件；
4. 扫描出现位置；
5. 重新把这些文本片段建成atomic element；
6. 重新连续编号。

这里不得不退回字符串匹配。若用户在外部编辑器中复制同名label，TUI可能把它解释为旧附件引用；但保留数量最多不超过旧附件数，不能凭文本凭空增加新path。

## 5. 图片进入Composer的三条路径

### 5.1 显式本地path

粘贴一段短文本时，Composer尝试把它归一成单个path：

- 双引号或单引号包围；
- `file://` URL；
- POSIX shell-escaped path；
- Windows drive path；
- UNC path；
- WSL下把drive path转换成`/mnt/<drive>`。

随后同步调用 `image::image_dimensions(path)`。只有能读取并识别图片维度时才attach，否则按普通文本粘贴。

这让“粘贴路径”不依赖扩展名。扩展名只用于日志展示PNG/JPEG/Other，真实可读性由image decoder判断。

### 5.2 系统剪贴板图片

Ctrl/Alt+V路径调用 `paste_image_to_temp_png()`：

1. 创建系统clipboard handle；
2. 优先读取clipboard file list中第一个可被`image::open`的文件；
3. 否则读取RGBA image buffer；
4. 解码/构造DynamicImage；
5. 全量编码成PNG Vec；
6. 建唯一`codex-clipboard-*.png` tempfile；
7. 写入PNG；
8. 调用`keep()`让文件跨handle存活；
9. 把path attach到Composer。

整个流程发生在key event处理路径上，是同步I/O、解码和PNG编码。

### 5.3 Remote image恢复

remote URL不会由TUI普通attach产生，主要从App Server input/history/backtrack恢复。它被保存在独立Vec并渲染成row。

TUI不在Composer阶段重新fetch或验证URL，也不显示URL内容，只显示 `[Image #N]`。最终提交时转换成 `UserInput::Image { url, detail: None }`。

## 6. Model capability的两道UI门

`current_model_supports_images`从Model Catalog查当前model的input modalities。

### 6.1 Attach时门

`ChatWidget.attach_image`在model不支持image时：

- 不修改Composer；
- 插入warning；
- 请求重绘。

同时 `sync_image_paste_enabled`会禁用“短paste path自动识别为图片”，让同一个path退回普通文本。

### 6.2 Submit时再检查

即使图片来自history restore、remote row或attach后切换了model，提交时仍会检查当前model。

不支持时，代码把完整UserMessage恢复回Composer，包括：

- text；
- TextElements；
- local images；
- remote URLs；
- mention bindings。

并显示warning，让用户删附件或换model后重试。

这是一种优质的late validation：不能只相信attach瞬间的model capability。

### 6.3 Catalog读取失败是fail-open

若Model Catalog锁/读取失败，或找不到当前model，`current_model_supports_images`默认true，避免瞬时catalog问题阻断用户输入。

于是UI capability只是体验门，不是安全或协议authority。Core/Provider仍必须处理实际model不支持图片的错误。

## 7. Clipboard临时文件的生命周期缺口

### 7.1 `keep()`后没有owner

普通clipboard image编码后，tempfile调用`keep()`。Composer只保存`PathBuf`，没有RAII handle、temporary标记或cleanup callback。

源码中没有为 `codex-clipboard-*.png`建立：

- 提交成功删除；
- 删除附件时删除；
- Ctrl+C清空时删除；
- 切Thread时删除；
- TUI退出时扫描清理；
- 基于mtime的retention清理。

因此每次剪贴板图片都可能永久留在系统temp目录，直到OS自行清理。

### 7.2 Attach被拒绝也会泄漏

快捷键流程先创建并keep temp PNG，再调用 `attach_image`检查model capability。

如果当前model不支持image：

```text
temp PNG已落盘
  -> attach被拒绝
  -> path未进入Composer
  -> 没有任何owner可清理
```

这是最明确的orphan路径。

### 7.3 用户删除也不删除文件

atomic placeholder删除只从AttachmentState移除path，不判断path是否由Codex创建，也不unlink文件。

这是避免误删用户原始图片的安全默认，但缺少source ownership字段后，系统无法区分：

- 用户项目中的原图；
- Codex自己创建的clipboard temp制品。

### 7.4 WSL fallback的额外制品

WSL fallback同步执行PowerShell：

```powershell
GetTempFileName()
ChangeExtension(..., 'png')
Save(png)
```

`GetTempFileName()`先创建`.tmp`文件，`ChangeExtension`只改字符串，不rename原文件；因此原空`.tmp`和新PNG都可能残留。

fallback返回映射到WSL的Windows temp path，同样没有cleanup owner。

### 7.5 资源边界

Clipboard路径当前未看到统一的：

- 输入像素上限；
- RGBA byte上限；
- PNG输出byte上限；
- 编码deadline；
- PowerShell执行deadline；
- PowerShell stdout/stderr cap。

大图会在UI key handler中同步占用内存和CPU。PNG Vec与DynamicImage同时存在，随后又写一份磁盘文件。

## 8. Large Paste也使用placeholder，但语义不同

超过1000 characters的文本paste不会直接插入全文，而会生成atomic element：

```text
[Pasted Content N chars]
```

真实payload保存在：

```text
pending_pastes: Vec<(placeholder, actual)>
```

若相同长度重复粘贴，会用`#2`、`#3`避免label冲突。当前存量全部删除后，编号可复用base label。

### 8.1 为什么要隐藏payload

主要收益是避免超长文本让TUI每次render、cursor move和popup sync都处理完整内容。用户仍能看到规模提示，提交时再展开。

### 8.2 展开算法

提交前：

1. 以placeholder索引payload queue；
2. 按byte range排序TextElements；
3. 单次重建text；
4. 遇到paste element时写入真实payload并删除该element；
5. 其他element保留并重算byte range；
6. 拼接尾部普通文本。

同名placeholder使用VecDeque，允许多次出现时按登记顺序消耗payload。

### 8.3 文本上限在展开后检查

TUI与App Server共享 `MAX_USER_INPUT_TEXT_CHARS = 1 << 20`。

Composer先展开pending paste，再trim，再按Unicode character计数。超过1Mi characters会：

- 显示error；
- 恢复原始可见placeholder Draft；
- 恢复TextElements、paths、mention bindings与pending payload；
- 把cursor放回末尾。

这是非常重要的transaction-like UI回滚：验证不能破坏用户输入。

### 8.4 内存上限仍不完整

1Mi characters不是1Mi bytes。UTF-8文本可能接近4MiB；提交验证前Composer已经持有：

- 原始pending payload；
- 展开的新String；
- original/expanded clones；
- history或queued副本。

而单次paste进入pending_pastes时没有先限制总字符或总bytes。多个大paste可在提交前累积，直到最终展开才失败。

## 9. 提交准备是一次可回滚状态转换

`prepare_submission_text_with_options`先保存：

- original text；
- TextElements；
- mention bindings；
- local image paths；
- pending pastes。

随后马上清空TextArea、退出bash mode，再执行expand、trim、slash validation和size validation。

### 9.1 成功路径

成功时：

1. trim文本并重算element ranges；
2. prune没有atomic element引用的local image；
3. 若text和全部attachments都空则抑制；
4. 保存recent submission mention bindings；
5. 按需写local in-session history；
6. 清pending paste payload；
7. 返回prepared text与elements；
8. ChatWidget稍后drain local/remote attachments组装UserMessage。

### 9.2 Unknown slash/oversize回滚

这两类错误在helper内部恢复完整Draft，并返回None。外层通用suppressed路径又会用捕获的original state恢复一次。

虽然有重复工作，但结果保持用户输入。

### 9.3 Empty submission

纯空白文本trim后为空。如果仍有remote/local attachment，允许提交image-only message；只有text和attachments都为空才返回None。

## 10. Drain边界需要跨组件交接

Composer返回 `InputResult::Submitted { text, text_elements }`时不会立即清local attachments。

ChatWidget随后调用：

```text
take_recent_submission_images_with_placeholders()
take_remote_image_urls()
take_recent_submission_mention_bindings()
```

把三组状态与text组合成 `UserMessage`。

这是一种显式handoff，但不是一个Rust对象上的原子take。若中间路径漏掉任一take，可能出现：

- 上一次附件残留到下一次提交；
- text已清空但附件未消费；
- mention visible text与binding错配。

当前主要submission和slash-with-args路径都显式执行这些drain，并用大量测试锁定。

更收敛的API可以让Composer直接返回完整 `PreparedUserMessage`，避免调用方按约定拼装。

## 11. UserMessage到Core UserInput的顺序

ChatWidget提交时按固定顺序构造items：

1. 全部remote images；
2. 全部local images；
3. 非空text；
4. selected Skills；
5. Plugin/App mentions；
6. IDE context等额外输入。

图片placeholder在text中的位置不会决定结构化item顺序。UI label和模型输入是两个投影。

`UserInput::LocalImage`只保存path，真正读取文件发生在后续Core request preparation。于是从attach到模型发送之间存在TOCTOU：

- 文件可能被修改；
- 文件可能被删除；
- symlink target可能变化；
- temp目录可能被OS清理。

TUI通过`image_dimensions`验证的是attach时版本，不是发送时版本。

## 12. Queue 与 Steer扩大了Draft寿命

### 12.1 Task未运行时submit

正常提交创建new Turn。TUI可以立即在history显示UserMessage，并记录cancel-edit candidate。

### 12.2 Task运行时pending steer

若Agent Turn正在运行，提交内容先保存为 `PendingSteer`：

- 完整UserMessage；
- history record；
- compare key。

compare key只包含flattened text和image count，不包含path、URL、detail或内容digest，用于抑制App Server稍后提交回放造成的重复UI row。

因此两个不同图片但相同文本+相同image数量可能拥有相同compare key。它适合视觉去重hint，不是消息身份或幂等key。

### 12.3 Rejected steer

若active Turn不支持steer，TUI把对应PendingSteer移动到rejected queue，稍后优先恢复/重新提交。

映射依赖队首顺序：收到“not steerable”错误时pop_front匹配。协议没有显式client message ID时，并发/乱序错误只能靠队列顺序推断。

### 12.4 Session尚未configured

提交发生在SessionConfigured之前时，UserMessage被push_front到queued messages，history record同步push_front。等session ready后再drain。

这里保留的是path/URL引用，不冻结本地图片bytes。配置等待很久时，附件源可能已经变化。

## 13. Interrupt后的多消息合并

Turn被中断时，TUI可能需要把以下内容恢复进一个Composer：

- rejected steers；
- pending steers；
- queued follow-ups；
- 当前Composer Draft。

不同消息都可能从 `[Image #1]`开始编号，也可能包含相同large-paste placeholder。

### 13.1 图片重编号

合并前先统计所有remote image总数，让local label从：

```text
total_remote_images + 1
```

开始。随后逐消息按local attachment列表建立old→new映射，同时改：

- message text；
- TextElement placeholder；
- TextElement byte range；
- LocalImageAttachment placeholder；
- history override text与elements。

### 13.2 文本range rebase

消息之间插入换行。每追加一段text，所有TextElement range加当前combined text byte length。

这是富文本消息合并必须有的range rebase，不能只 `texts.join("\n")`。

### 13.3 Paste label碰撞

queued messages还保存pending paste payload。合并时维护used placeholder set；碰撞则根据payload char count重新生成base+suffix，并同步重写text和TextElement。

### 13.4 Mention binding

mention bindings直接extend，没有基于文本range的rebase，因为binding与TextArea element identity/path快照关联，最终恢复时再按snapshot绑定。

## 14. 三种History，三种保真度

### 14.1 Local in-session history

`HistoryEntry`可完整保存：

- text；
- TextElements；
- local paths；
- remote URLs；
- mention bindings；
- pending paste payload。

Up/Down回看时可以还原完整Draft。

相邻完全相同的HistoryEntry会折叠，空entry忽略。

### 14.2 Replay-seeded history

从resumed transcript回放的用户消息可seed到local history，从而在本次TUI session里继续Up/Down恢复attachments。

它仍是进程内状态，退出TUI后不会作为Composer Draft持久化。

### 14.3 Persistent cross-session history

持久history只保存text，并对mentions使用编码文本恢复canonical binding。它明确不保存：

- attachment payload/path；
- TextElement metadata；
- pending paste payload。

这减少长期保存本地敏感path和巨大paste内容，也避免跨机器恢复失效附件。

代价是跨会话Up历史无法恢复图片，用户只看到text版本。

这是合理的隐私与可用性取舍：Draft保真度按寿命分级，而不是所有状态永久化。

## 15. Thread切换保存的是内存Input State

TUI切换Thread时可捕获 `ThreadInputState`，包括：

- 当前Composer；
- pending/rejected steers；
- queued messages；
- history records；
- compare keys；
- pending-start标记；
- collaboration mode；
- task/turn running投影。

恢复时会补齐旧state缺失的history record和compare key默认值，体现向后兼容。

但这些值仍然是本地进程内snapshot，没有持久化附件bytes或文件lease。TUI崩溃后clipboard temp可能还在，ThreadInputState却消失，形成无引用磁盘制品。

## 16. Cancel-edit 与 blocked submission

### 16.1 Cancel-edit candidate

新Turn提交时，TUI保留完整UserMessage作为cancel-edit candidate。若用户在符合条件的窗口中interrupt，消息可恢复到Composer。

候选资格会在观察到可见Turn activity后失效，防止已经明显执行过的prompt又被误当成未发送Draft。

### 16.2 Blocked image submission

model不支持image时，`user_message_for_restore`先应用history override，再恢复完整附件和mention bindings。

源码注释特别指出：只恢复visible `$name`而不恢复binding，会让重试退化成name heuristic。这是“显示一致不等于语义一致”的典型案例。

## 17. Slash Command是另一个附件分叉

普通slash command可能本地执行，并不发送给模型。带inline args的命令复用submission preparation，但有些命令需要延后validation或保留pending paste。

例如queued `/goal`可能保留large-paste placeholder和payload，到dequeue/dispatch时再解释，而普通queued input会先展开。

因此prepare helper支持：

- `SlashValidation::Immediate/Deferred`；
- `PendingPasteHandling::Expand/Preserve`。

这避免为了slash command复制一套附件、range和paste处理逻辑。

但分支越多，越依赖完整 `PreparedSlashCommandArgs`携带local/remote images、mentions和pending payload。漏字段会造成silent loss。

## 18. 当前安全与可靠性风险

### 18.1 Clipboard读取在UI线程同步执行

系统clipboard、file decode、RGBA→PNG编码、temp写入以及WSL PowerShell fallback都发生在key handler同步路径。大图、网络映射文件或卡住的PowerShell会冻结TUI。

### 18.2 原图片path没有authority snapshot

粘贴path可以指向当前用户可读的任意文件，只要image decoder识别。TUI不会把它复制到受管immutable attachment store，也没有digest。

提交时Core重新读取的可能不是用户attach时看见的同一内容。

### 18.3 Remote URL在Composer阶段无cap

remote image URL数量、单URL长度和总字符串bytes在TUI UserMessage层没有统一上限。App Server会拒绝HTTP(S)，但data URL可能很大；历史回放和queued state会clone这些字符串。

### 18.4 Image count未统一限制

文本有1Mi character cap，但本地/远程图片数量没有对应Composer级cap。每个path/data URL都增加clone、display、serialization和后续decode成本。

### 18.5 Compare key过弱

pending steer去重只看text+image count。它不能作为delivery receipt，也不能区分两组不同附件。

### 18.6 Path日志

attach成功会用info记录完整local path。路径可能包含用户名、项目名或临时资源标识，应按本地日志隐私策略评估。

### 18.7 Temp PNG无cleanup

这是当前最直接的资源泄漏：正常提交、删除、拒绝、崩溃都没有明确retention收口。

## 19. 优质设计总结

### 19.1 Rich Draft显式建模

text、ranges、attachments、mentions和hidden paste payload没有揉成一个字符串，能支持可靠编辑与失败恢复。

### 19.2 Atomic element区分字面label和真实附件

submission pruning依赖TextElement ownership，而不是`contains`，避免placeholder文本注入附件语义。

### 19.3 验证失败恢复完整Draft

unknown slash、oversize和unsupported model都尽力恢复用户原始输入，而不是清空Composer后只显示error。

### 19.4 合并时同步重编号与range rebase

interrupt恢复不只是join文本，还更新附件label、history override、paste collision和UTF-8 byte range。

### 19.5 History按寿命分级

本地session保留完整Draft，persistent history只留text/mention encoding，避免长期保存附件和大payload。

### 19.6 Attach时与submit时双检查model

早期门改善体验，late validation处理切model与history restore，不把一次旧能力判断当永久事实。

## 20. 改进方向

### 20.1 为Attachment建立稳定ID和Source

建议：

```text
Attachment {
  id
  source: UserPath | ClipboardManaged | RemoteUrl
  displayLabel
  pathOrUrl
  contentDigest?
  createdAt
  cleanupPolicy
}
```

placeholder只引用attachment ID，重编号不再承担身份职责。

### 20.2 Clipboard制品使用受管store

Clipboard图片应写入：

- per-process/session temp目录；
- private permissions；
- 有大小和像素预算；
- 带owner ref count；
- submission/history/queue引用计数；
- TUI正常退出cleanup；
- startup清理过期orphan。

当Core把bytes冻结进History后，可以释放临时path；失败/取消则按Draft引用决定是否保留。

### 20.3 异步读取与编码

clipboard和image decode应放入bounded blocking pool：

- UI显示“处理中”；
- 支持cancel；
- 限制总并发；
- 设置deadline；
- attach前检查像素和输出bytes；
- 结果回到UI时检查Draft generation，避免迟到图片插入新Thread。

### 20.4 Prepared submission一次性take

让Composer返回：

```text
PreparedUserMessage {
  text
  textElements
  localImages
  remoteImages
  mentionBindings
}
```

验证失败不take；成功一次性移动所有字段。这样消除ChatWidget多次drain的协议约定。

### 20.5 Queue保存immutable attachment snapshot

至少ClipboardManaged附件可在排队时固定bytes/digest。用户path若仍采用live reference，应在UI明确显示“文件将在发送时读取”，并在发送前复核mtime/size/digest变化。

### 20.6 Pending steer使用client message ID

每次submission生成稳定ID，App Server committed UserMessage和错误都回传该ID。TUI据此确认/拒绝具体steer，不依赖text+image count和FIFO推断。

### 20.7 统一附件预算

预算至少包括：

- image count；
- local file bytes；
- remote/data URL bytes；
- decoded pixels；
- Draft总bytes；
- queued/pending steers累计bytes；
- history snapshot累计bytes。

## 21. 映射到当前Vue + NestJS Agent项目

当前项目将来支持文件或图片上传时，不应把浏览器`File`对象、临时URL或显示label直接塞进Conversation message。

### 21.1 推荐数据模型

```text
Upload
  上传事务、owner、bytes、mime、digest、扫描状态

Attachment
  可被Message/Draft引用的稳定制品

DraftAttachment
  前端Draft里的排序、显示和临时状态

MessageAttachment
  Message提交后的不可变关联

AgentRunInput
  Run开始时冻结的attachment generation/digest
```

### 21.2 Draft与Message分离

Vue composer可以自由重排、删除和重命名附件；提交成功后，后端以事务创建Message/Run关联。不能只把临时upload URL写进message text。

### 21.3 上传成功不等于可用于Agent

服务端还需确认：

- owner/Conversation authority；
- MIME magic bytes；
- size/pixel/page预算；
- malware/内容策略；
- immutable object key；
- retention；
- model modality支持。

### 21.4 提交幂等

前端生成`clientMessageId`，后端以Conversation+ID幂等提交。Attachment关联和AgentRun创建必须与Message事实同一事务，避免“消息成功但附件没绑”或重复Run。

### 21.5 失败恢复

validation失败时返回结构化字段错误，Vue保留Draft和Attachment ID。只有用户明确删除或Draft过期cleanup时才释放临时upload引用。

## 22. 可直接采用的验收问题

1. 删除显示label是否一定删除真实附件引用，而不是只删字符串？
2. 用户手工输入同名placeholder会不会意外绑定附件？
3. 多条queued消息合并时，range、label和附件顺序是否一致？
4. 大paste展开后超限，原Draft能否无损恢复？
5. model切换为不支持图片后，提交是否保留Draft？
6. 上传/clipboard任务迟到时，会不会插入已切换的Conversation？
7. 临时图片由谁清理，删除/拒绝/崩溃分别是什么策略？
8. 本地path在排队期间变化，发送时如何提示或拒绝？
9. remote/data URL数量与总bytes是否有上限？
10. pending steer确认是否使用稳定client message ID？
11. persistent history是否不必要地保存敏感附件或大payload？
12. Message、Attachment和AgentRun是否事务性关联？

## 23. 结论

Codex TUI Composer最值得学习的不是 `[Image #N]`视觉样式，而是它承认富输入Draft是多字段状态机：文本、TextElement、附件、mention binding和hidden paste payload必须一起保存、重编号、range rebase与失败恢复。

它做得好的地方包括：

- atomic element区分真实附件与字面placeholder；
- attach与submit双重model capability检查；
- oversize/unsupported时完整恢复Draft；
- queue/interrupt合并时重编号、重算UTF-8 byte range并处理paste collision；
- local history高保真、persistent history低敏感度的寿命分级。

最需要警惕的是clipboard temp生命周期：文件被`keep()`后失去owner，model拒绝、用户删除、提交成功和TUI崩溃都没有确定cleanup；同时同步clipboard/image处理可以冻结UI，path/data URL/image count也缺统一Draft资源预算。

映射到云端Agent时，应把附件提升为有稳定ID、owner、digest、retention和状态机的独立制品，再让Draft、Message和AgentRun按各自寿命引用它。显示label永远只能是投影，不能成为附件身份或权限边界。
