# Coding Agent / TUI 功能覆盖与代码目录索引

## 覆盖口径

本表基于 2026-09-15 的本地 Pi HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`；读取时 `git status --short` 为空。目录清单使用 `git ls-files`，包含 tracked 的测试、示例、vendor、二进制，不把这些文件都算作人工逐行审核。

研究结论见 [coding-agent-tui.md](coding-agent-tui.md)。等级含义：

- **链路**：读了入口、关键实现、状态/错误分支和相关调用，正文有可复查结论与源码切片。不是所有帮助方法的逐行正确性审计。
- **边界**：核对目录、公开接口、主要依赖/调用点或关键段落；足以定位职责和迁移取舍，不代表所有内部算法已深审。
- **转交**：实验 server / worker / service / plugin 的深入证据在 [chord-server-client.md](chord-server-client.md)，这里核对其产品入口及文件归属。
- **材料**：测试/示例/文档/构建资源，作为检索索引或选取证据；未把每个 fixture/vendor/prebuild 视作研究实现。

本次没有执行 Pi 测试、CLI、provider、真实 RPC/server、扩展 factory、安装或 clipboard 访问。所有“行为”均指源码可推导行为，不表示端到端运行已经通过。

## 1. Tracked 文件总量

| 包/目录 | 文件数 | 如何处理 |
| --- | ---: | --- |
| coding-agent `src/` | 269 | 全目录归类；默认主链深入，experimental 服务端转交，平台/展示辅助边界核对 |
| coding-agent `test/` | 308 | 含 fixtures/support/suite；选读关键回归，其余索引定位 |
| coding-agent `examples/` | 139 | 含 extension、SDK、experimental plugin 示例及资源；不算默认安装能力 |
| coding-agent `docs/` | 35 | 包含图片；只把当前源码作为主事实来源 |
| coding-agent `install-lock/` | 2 | 安装依赖锁输入，未安装或修改 |
| coding-agent `scripts/` | 1 | migrate-sessions.sh，历史维护脚本，不执行 |
| coding-agent 根级 | 8 | README/CHANGELOG、package/shrinkwrap、tsconfig/vitest、.gitignore |
| tui `src/` | 42 | 终端/呈现链深入，组件和算法按边界归类 |
| tui `test/` | 49 | 含 virtual terminal、fixture、bench、demo；未执行 |
| tui `native/` | 18 | 6 个 .node prebuild；原生源/公共头/build/README 按职责核对，未编译、反汇编或比较构建产物 |
| tui 根级 | 4 | README/CHANGELOG、package.json、tsconfig.build.json |

文件计数用于确认没有目录盲区，不能用来证明逐行阅读或测试覆盖率。

## 2. Coding Agent 全功能模块覆盖表

所有相对源码路径均以 [coding-agent/src](/Users/ayu/Learn/pi/packages/coding-agent/src) 为根。

| 模块 | 路径 / 核心符号 | 等级 | 已核对的功能与限制 |
| --- | --- | --- | --- |
| 入口与运行时适配 | `cli.ts`、`rpc-entry.ts`、`bun/*`、`cli/setup.ts` | 链路 | 默认 CLI、专用 RPC、Bun 环境恢复；不是三套业务运行层 |
| CLI 编排 | `main.ts` / `main`、`createSessionManager`、`createRuntime` | 链路 | 单次命令分流、mode 选择、会话 cwd、资源装配、错误输出 |
| CLI 参数与输入 | `cli/args.ts`、`file-processor.ts`、`initial-message.ts` | 链路/边界 | flags、end-of-options、文本/图片附件与 stdin 初始输入；未执行文件输入 |
| CLI 启动交互 | `cli/startup-ui.ts`、`session-picker.ts`、`config-selector.ts`、`project-trust.ts` | 边界 | 首次 setup、会话/资源选择、非交互 trust 的 UI adapter |
| CLI 认证 | `cli/auth-command.ts`、`auth-check.ts`、`credential-print.ts`、`list-models.ts` | 边界 | ready/not_ready/invalid，认证刷新与只读模式，显式凭据输出命令；研究未调用 |
| SDK | `core/sdk.ts` / `createAgentSession` | 链路 | 默认值、模型恢复、工具集合、低层 Agent 的 stream/context/hooks 注入 |
| 会话服务组 | `core/agent-session-services.ts` | 链路 | 先 cwd services，后 session；diagnostics 交 host 决策 |
| 会话替换 | `core/agent-session-runtime.ts` | 链路 | switch/new/fork/import、abort 后 teardown、旧 ctx 失效、重新绑定 UI；创建失败向调用者报告 |
| 产品运行门面 | `core/agent-session.ts` | 链路 | prompt、queue、custom messages、tool hooks、retry、compaction、tree、stats、reload；与低层 Agent 分工 |
| 历史存储 | `core/session-manager.ts` | 链路 | v1/v2/v3 migration、JSONL、id/parentId 树、leaf/labels、branch/fork、list、context projection；不宣称事务或多 writer 安全 |
| 会话工作目录 | `core/session-cwd.ts` | 边界 | 恢复时目录缺失的错误及 fallback 提示 |
| 自定义消息与导出 | `core/messages.ts`、`session-export.ts` | 链路 | domain role→LLM role；JSONL export 当前分支，HTML 全树 |
| 压缩与分支摘要 | `core/compaction/*` | 链路 | token 估算、合法切点、history/prefix 摘要、文件操作保留、summary usage 与重试 |
| 资源聚合 | `core/resource-loader.ts` | 链路 | extensions/skills/prompts/themes/context/system prompt 的发现、source、优先级、diagnostics、reload |
| Skills | `core/skills.ts` | 链路 | frontmatter 校验、递归发现、名称冲突、disable-model-invocation、渐进加载 |
| Prompt 组织 | `core/system-prompt.ts`、`prompt-templates.ts`、`slash-commands.ts` | 链路/边界 | 当前激活 tools 的 prompt contributions、context files、skills 列表、模板参数；不是检索数据库 |
| Extension 加载 | `core/extensions/loader.ts` | 链路 | jiti、virtual module/source/dist 差异、factory cache、成功提交注册/失败丢弃 |
| Extension 运行 | `core/extensions/runner.ts`、`wrapper.ts`、`types.ts`、`index.ts` | 链路 | hooks/commands/tool/UI/context，stale 引用检查，tool_call 异常阻止执行；不是 sandbox |
| Event bus | `core/event-bus.ts` | 边界 | 进程内 extension 通道，捕获 handler 错误；不是持久消息总线 |
| Project trust | `core/project-trust.ts`、`trust-manager.ts` | 链路 | 项目资源加载闸门、nearest ancestor trust、文件锁保存；不等于逐工具审批 |
| Settings | `core/settings-manager.ts`、`settings-diagnostics.ts`、`defaults.ts` | 链路/边界 | global/project 深合并、storage 注入、modified fields 防覆盖、错误诊断、默认 mode/retry/compaction |
| Package 管理 | `core/package-manager.ts`、`pi-manifest.ts`、`package-manager-cli.ts` | 链路/边界 | npm/git/local、user/project/temporary、resource filters/autoload、缺失安装、更新/删除、离线模式；非源码安全审计 |
| Model 配置 | `core/model-config.ts`、`model-resolver.ts`、`models-store.ts` | 边界 | models.json、CLI pattern/scope、选模 fallback、目录缓存持久化 |
| Provider 组合 | `core/provider-composer.ts`、`model-runtime.ts`、`model-registry.ts` | 链路 | built-in/config/extension composition、auth+headers/baseUrl、每 provider 凭据串行、快照刷新；Registry 是兼容出口 |
| 认证 storage | `core/auth-storage.ts`、`runtime-credentials.ts`、`resolve-config-value.ts`、`auth-guidance.ts` | 边界 | 文件/内存/只读 CredentialStore、runtime override、配置值解析、认证提示；真实凭据未读取 |
| 目录与归因 | `core/remote-catalog-provider.ts`、`provider-attribution.ts`、`radius.ts` | 边界 | catalog overlay、请求归因、Radius re-export；不证明网络可达或账号权限 |
| HTTP / 协议 stdout | `core/http-dispatcher.ts`、`output-guard.ts` | 链路 | 全局 undici dispatcher、代理/idle timeout；stdout 单写队列及 backpressure；云端避免全局租户配置 |
| 工具定义与 adapter | `core/tools/index.ts`、`tool-definition-wrapper.ts` | 链路 | 8 个内置候选、4 个默认 coding tools；tool metadata / execute / renderer 的组合 |
| 文件工具 | `core/tools/read.ts`、`edit.ts`、`edit-diff.ts`、`write.ts`、`path-utils.ts` | 链路 | 输入正规化、BOM/换行、唯一/不重叠替换、图片与截断、cwd 解析；无 workspace confinement 保证 |
| 文件并发 | `core/tools/file-mutation-queue.ts` | 链路 | 同进程每文件队列、realpath、await 完成后释放；不保护跨 worker |
| Shell 工具 | `core/tools/bash.ts`、`powershell.ts`、`output-accumulator.ts` | 链路 | shell operations 注入、cancel/timeout、迟到输出、UTF-8 增量、有界尾部与 temp artifact |
| 搜索/列目录工具 | `core/tools/find.ts`、`grep.ts`、`ls.ts` | 链路/边界 | fd/rg 与自定义操作差异、limit/truncation；grep 仍依赖本机 spawn |
| Tool 输出与展示 | `core/tools/truncate.ts`、`render-utils.ts`、`renderers/*` | 链路/边界 | 模型输出裁剪与 TUI 渲染分离、diff/path/image/expanded 视图；renderer 不负责审批 |
| 用户 shell / extension exec | `core/bash-executor.ts`、`exec.ts` | 链路 | `!`/`!!` 与工具 bash 的区别；command+args helper 另一条生命周期 |
| 会话/成本观测 | `core/cache-stats.ts`、`usage-totals.ts`、`footer-data-provider.ts`、`timings.ts`、`telemetry.ts` | 边界 | cache miss 估算、all-entry 用量、Git/footer、启动计时、安装遥测开关；观测计算不自动触发模型控制 |
| 诊断和来源 | `core/diagnostics.ts`、`source-info.ts` | 边界 | 结构化 error/warning/collision 与来源 scope；有些来源排序影响资源胜者 |
| Interactive host | `modes/interactive/interactive-mode.ts` | 链路 | 输入/命令分派、事件映射、扩展 UI、信号/退出、主题与模型选择、队列；没有逐行审计 6620 行所有分支 |
| Interactive layout | `modes/interactive/tui-renderer.ts`、`chat-viewport.ts` | 链路 | regular/fullscreen renderer、稳定代理引用、scroll transcript + dock |
| 选择器与编辑器 | `modes/interactive/components/*selector*.ts`、`custom-editor.ts`、`extension-editor.ts`、`extension-input.ts`、`login-dialog.ts` | 边界 | session/tree/model/settings/trust/theme/thinking/auth 的输入模式、焦点与 callback |
| 消息与工具组件 | `modes/interactive/components/*message*.ts`、`tool-execution.ts`、`bash-execution.ts`、`custom-entry.ts`、`diff.ts` | 边界 | messages/toolId 关联、thinking 展示、summary、custom renderer、diff；不会自行调用 provider |
| 状态和视觉辅助 | `status-indicator.ts`、`bordered-loader.ts`、`countdown-timer.ts`、`footer.ts`、`dynamic-border.ts`、`keybinding-hints.ts`、`visual-truncate.ts` | 边界 | loading/cancel/countdown、列宽与快捷键展示 |
| Markdown 增强 | `markdown-transform.ts`、`mermaid.ts` | 边界 | 在终端 Markdown 的流式/最终阶段转换 Mermaid；不是 archify 产物 |
| Theme | `modes/interactive/theme/*` | 边界 | JSON schema、theme token、light/dark、auto 检测、watch 与 runtime controller |
| Interactive 附属 | `external-editor.ts`、`model-catalog-refresh.ts`、`model-search.ts`、`session-share.ts` | 链路/边界 | 外部 editor 生命周期、catalog refresh、搜索、Radius/gist 上传 |
| 彩蛋与资源 | `armin.ts`、`daxnuts.ts`、`earendil-announcement.ts`、`assets/*.png` | 材料/边界 | 呈现彩蛋/公告/图片；不加入云端 roadmap |
| Print / JSON | `modes/print-mode.ts`、`json-event.ts`、`index.ts` | 链路 | 无终端执行、final text 或增量 wire events、原始 stdout 与 flush |
| RPC | `modes/rpc/*` | 链路 | command/response/events、prompt preflight ACK、extension UI request、JSONL framing、子进程 client；不是公网 API |
| Built-in llama | `extensions/index.ts`、`extensions/llama/*` | 边界 | 隐藏内置 extension、provider、HTTP client、Hugging Face 查找与模型管理 UI；不运行、不部署 |
| 实验命令入口 | `cli/experimental/*`、`experimental/cli.ts`、`commands.ts`、`core/experimental.ts` | 链路 | 独立入口、PI_EXPERIMENTAL gate、命令 parser、auth/transport 参数互斥与校验 |
| 实验分布式产品 | `experimental/client*`、`server.ts`、`coordinator*`、`session-worker*`、`services/*`、`plugin*`、`plugins/*`、`radius-*`、`process.ts`、`source-resolver.ts`、`client/index.ts` | 转交 | coordinator/worker/service/routing/plugin lifecycle 的证据在专篇；本篇只确认并存关系 |
| mini presentation | `experimental/mini/main.ts`、`tui/*` | 链路 | snapshot+watch/start、replica reducer、按 entry ID 渲染；不冒充全功能 interactive |
| mini server/runtime | `experimental/mini/server/*`、`worker/*`、`shared/*` | 转交 | durable harness 的服务与传输实验，见专篇 |
| 平台与子进程 utils | `utils/shell.ts`、`child-process.ts`、`paths.ts`、`fs-watch.ts`、`windows-self-update.ts` | 边界 | shell 选择、process cleanup、路径差异、watch 错误、Windows 更新隔离；终端维护逻辑 |
| 图片与剪贴板 utils | `utils/clipboard*.ts`、`image*.ts`、`exif-orientation.ts`、`mime.ts`、`photon.ts`、`tool-result-images.ts` | 边界 | 平台 fallback、worker resize、图片正规化与 bytes 所有权；渲染与模型附件区分 |
| 文本/网络/维护 utils | `utils/abort.ts`、`ansi.ts`、`changelog.ts`、`deprecation.ts`、`frontmatter.ts`、`git.ts`、`html.ts`、`json.ts`、`management-http.ts`、`open-browser.ts`、`pi-user-agent.ts`、`sleep.ts`、`syntax-highlight.ts`、`text.ts`、`tools-manager.ts`、`version-check.ts` | 边界 | 解析/显示/取消/管理网络重试/下载维护的支持层；不凭名字宣称无副作用 |
| HTML export | `core/export-html/*` | 链路/边界 | 全树数据、模板、主题、tool ANSI→HTML 与内嵌 viewer；vendor bundle 只索引 |

## 3. TUI 全功能模块覆盖表

相对路径以 [tui](/Users/ayu/Learn/pi/packages/tui) 为根。

| 模块 | 路径 | 等级 | 职责/云端取舍 |
| --- | --- | --- | --- |
| 导出契约 | `src/index.ts`、`editor-component.ts` | 链路 | Component/Terminal/Editor/renderer 边界；浏览器保留契约思想 |
| TUI 基类 | `src/tui.ts` | 链路 | focus、overlays、mouse target、render scheduler、cursor marker、terminal response consumption |
| 主屏 renderer | `src/tui-main-screen.ts` | 链路 | regular scrollback、差量行输出、resize/shrink/full redraw、image placement |
| 全屏 renderer | `src/tui-alt-screen.ts`、`alt-screen-search.ts`、`components/alt-screen-flash.ts` | 链路/边界 | viewport/scroll/search/selection/mouse；保留快照渲染思想，不移植 ANSI 算法 |
| 布局 | `src/layout.ts`、`layout-node.ts`、`components/stack.ts`、`h-stack.ts`、`v-stack.ts`、`scroll-view.ts` | 边界 | 布局分配与 scroll/hit bounds；Web 用 CSS/layout |
| 终端连接 | `src/terminal.ts` | 链路 | raw mode/resize/Kitty/modifyOtherKeys/bracketed paste、drain/stop 恢复 |
| 输入解析与快捷键 | `src/stdin-buffer.ts`、`keys.ts`、`keybindings.ts`、`native-modifiers.ts` | 链路/边界 | 字节分块恢复成键盘/鼠标事件；Web 用浏览器事件 |
| 文本编辑 | `src/components/editor.ts`、`input.ts`、`word-navigation.ts`、`kill-ring.ts`、`undo-stack.ts` | 边界 | Unicode 导航、换行/滚动、history/paste/undo；不为云端重造 editor |
| 自动补全 | `src/autocomplete.ts`、`fuzzy.ts` | 边界 | slash/file/custom suggestions 与模糊排序；有真实交互需求再复用算法 |
| Markdown / LaTeX | `src/components/markdown.ts`、`latex.ts` | 边界 | tokens 转 ANSI 行、表格/代码/公式；网页用已有 renderer，源码可用于研究流式稳定性 |
| 基本组件 | `src/components/box.ts`、`spacer.ts`、`text.ts`、`truncated-text.ts`、`mouse-region.ts` | 边界 | 组合、padding、列宽、鼠标转发；无模型语义 |
| 列表与状态 | `src/components/select-list.ts`、`settings-list.ts`、`loader.ts`、`cancellable-loader.ts` | 边界 | 选择、搜索、状态动画/取消输入；动作由 callback 交业务 host |
| 字符与终端图像 | `src/utils.ts`、`terminal-image.ts`、`terminal-colors.ts`、`components/image.ts` | 边界 | Unicode 列宽/ANSI/OSC8、Kitty/iTerm2/fallback、背景探测和图片尺寸 |
| 原生 helper 选择 | `src/native-platform.ts`、`native-module-path.ts` | 链路 | 按平台/arch/包布局加载；可用性与无内容区分 |
| Darwin | `native/darwin/*` | 边界/材料 | AppKit 剪贴板与 modifier；Objective-C/N-API、双架构 prebuild；不执行 |
| Windows | `native/win32/*` | 边界/材料 | VT input、modifier、clipboard/image、双架构 build/prebuild；不执行 |
| Linux | `native/linux/*` | 边界/材料 | X11 读取/有界等待/worker；Wayland fallback 在 coding-agent；不执行 |
| Native 公共层 | `native/clipboard.h`、`napi.h` | 边界 | N-API symbol 与异步 clipboard job；未做 C/内存安全审计 |

## 4. 测试如何当作学习证据

以下是读过关键用例/断言的入口，不是本次运行结果。

| 研究问题 | 证据文件 | 断言/测试形态 |
| --- | --- | --- |
| 低层 end 与产品 settled | [6363-agent-settled-event](/Users/ayu/Learn/pi/packages/coding-agent/test/suite/regressions/6363-agent-settled-event.test.ts:20) | retry / follow-up 有多个 agent_end，最终只有一次 settled，ctx.isIdle 为 true |
| 插入后台消息会不会破坏 tool pair | [8537-custom-message-tool-result-ordering](/Users/ayu/Learn/pi/packages/coding-agent/test/suite/regressions/8537-custom-message-tool-result-ordering.test.ts:13) | state/entries/events 都在 toolResult 后插 custom；检查 LLM toolCallId |
| 审批拒绝是否终止后续采样 | [5998-blocked-tool-terminate](/Users/ayu/Learn/pi/packages/coding-agent/test/suite/regressions/5998-blocked-tool-terminate.test.ts:7) | 工具故意抛错表示不可到达；block+terminate 后 faux reply 未消费 |
| RPC 接收与执行完成 | [rpc-prompt-response-semantics](/Users/ayu/Learn/pi/packages/coding-agent/test/rpc-prompt-response-semantics.test.ts:1) | mock JSONL I/O 和延迟 stream，独立收集同一 id 的 prompt response |
| UI 帧调度 | [tui-render](/Users/ayu/Learn/pi/packages/tui/test/tui-render.test.ts:111) | virtual terminal / logging terminal，按键不能等待节流帧，输出写入有界 |

后续按主题定位已有测试，不新增一个只重复实现的测试合集：

- Session：`test/session-manager/*`、`agent-session-{branching,compaction,concurrent,retry,tree-navigation}*`、`test/suite/agent-session-*`。
- Resource/extension：`extensions-{discovery,runner,input-event}`、`resource-loader`、`skills`、`prompt-templates`、`trust-manager`、`suite/regressions/*resource*/*extension*/*trust*`。
- Tools：`tools`、`file-mutation-queue`、`edit-tool-*`、`powershell-tool`、`suite/regressions/*bash*/*find*/*tool*`。
- Transport/product：`print-mode`、`stdout-cleanliness`、`rpc-*`、`experimental-*`；不要默认它们都纯单测或都无需构建。
- TUI：`tui-render`、`tui-alt-screen`、`layout`、`mouse-components`、`keys`、`stdin-buffer`、`editor`、`markdown`、`native-*`；native 测试可能需要系统工具/显示环境/明确 opt-in。

Pi 自身 `AGENTS.md` 禁止默认跑全量 `npm test`；本研究没有因“有测试”而执行。后续实现任务先选定无真实 provider 的最小测试，`coding-agent/test/suite/harness.ts` + faux provider 是推荐入口。

## 5. 示例、文档、生成物的归类

| 目录/文件 | 阅读价值 | 不应误读为 |
| --- | --- | --- |
| `examples/sdk/01..13` | 从 minimal 到 custom tools/resources/settings/session runtime 的最短嵌入例 | 默认主程序全部使用这些选项 |
| `examples/extensions/*.ts` | 单点 hook、命令、工具覆盖、UI、permission、input transform、compaction 的 API 用法 | 所有示例默认开启或已经安全审计 |
| `examples/extensions/{subagent,plan-mode,sandbox,ssh,gondolin,...}` | 独立应用策略/环境适配样例 | Pi 核心默认具有多 agent、审批、sandbox 产品能力 |
| `examples/extensions/custom-provider-*`、`with-deps` | 扩展自带依赖/provider 的示例边界 | 允许云端 API 进程任意安装依赖 |
| `examples/plugins/pi-example-plugin` | 新实验 plugin 的分 host 包结构 | 与旧 extension factory 完全相同的协议 |
| `test/fixtures`、suite harness/support | 可重复验证的输入和替身 | 生产实现 |
| TUI `test/*bench*`、`chat-simple`、`key-tester`、`image-test`、repro | 性能/人工交互和特定问题复现入口 | 所有 test 文件都是自动回归或本次已运行 |
| `core/export-html/vendor/*.min.js` | 内嵌第三方 viewer 依赖 | 项目原创算法、逐行审核证据 |
| `native/**/prebuilds/*.node` | 随包分发的二进制 | 本次从源码可复现构建或经过反汇编核对 |
| lockfiles/install-lock | 分发依赖事实 | 安装成功、供应链已审计 |
| README/CHANGELOG/docs/images/theme json | 使用/迁移/展示材料 | 当前运行链的唯一事实来源；发现文档漂移以源码为准 |

## 6. 后续引用规则

1. 提出设计结论时至少打开一个真实函数和其调用方；不要仅引用下方清单。
2. 说某功能“默认”时同时核对 CLI main、package exports/files 和配置默认值。
3. 说某字段“不影响模型”时沿 `buildContextEntries → sessionEntryToContextMessages → convertToLlm → extension context transforms` 核对；UI display 与 model visibility 是两回事。
4. 说“恢复”时明确是恢复聊天历史、重建模型 context、重连 replica，还是重启后继续未完成 effect；四种承诺分别找证据。
5. 本次没有逐行审核所有低优先级 helper、例子、vendor 或平台 C 分支，也没有跨平台运行验证。模块地图用于后续定向查阅，不制造不存在的验证结论。

## 7. 源码目录完整索引

以下索引逐个列出这两个包 tracked 的 `src/` 与 `tui/native/` 文件。它是防遗漏清单，深度按上表，不等于每个条目都完成逐行审计。

<!-- SOURCE_INDEX -->

### [packages/coding-agent/src](/Users/ayu/Learn/pi/packages/coding-agent/src)

```text
cli.ts
config.ts
index.ts
main.ts
migrations.ts
package-manager-cli.ts
rpc-entry.ts
```

### [packages/coding-agent/src/bun](/Users/ayu/Learn/pi/packages/coding-agent/src/bun)

```text
cli.ts
restore-sandbox-env.ts
runtime-setup.ts
sandbox-env-setup.ts
```

### [packages/coding-agent/src/cli](/Users/ayu/Learn/pi/packages/coding-agent/src/cli)

```text
args.ts
auth-check.ts
auth-command.ts
config-selector.ts
credential-print.ts
file-processor.ts
initial-message.ts
list-models.ts
project-trust.ts
session-picker.ts
setup.ts
startup-ui.ts
```

### [packages/coding-agent/src/cli/experimental](/Users/ayu/Learn/pi/packages/coding-agent/src/cli/experimental)

```text
cli.ts
command-options.ts
command.ts
```

### [packages/coding-agent/src/cli/experimental/commands](/Users/ayu/Learn/pi/packages/coding-agent/src/cli/experimental/commands)

```text
client.ts
server.ts
```

### [packages/coding-agent/src/client](/Users/ayu/Learn/pi/packages/coding-agent/src/client)

```text
index.ts
```

### [packages/coding-agent/src/core](/Users/ayu/Learn/pi/packages/coding-agent/src/core)

```text
agent-session-runtime.ts
agent-session-services.ts
agent-session.ts
auth-guidance.ts
auth-storage.ts
bash-executor.ts
cache-stats.ts
defaults.ts
diagnostics.ts
event-bus.ts
exec.ts
experimental.ts
footer-data-provider.ts
http-dispatcher.ts
index.ts
keybindings.ts
messages.ts
model-config.ts
model-registry.ts
model-resolver.ts
model-runtime.ts
models-store.ts
output-guard.ts
package-manager.ts
pi-manifest.ts
project-trust.ts
prompt-templates.ts
provider-attribution.ts
provider-composer.ts
radius.ts
remote-catalog-provider.ts
resolve-config-value.ts
resource-loader.ts
runtime-credentials.ts
sdk.ts
session-cwd.ts
session-export.ts
session-manager.ts
settings-diagnostics.ts
settings-manager.ts
skills.ts
slash-commands.ts
source-info.ts
system-prompt.ts
telemetry.ts
timings.ts
trust-manager.ts
usage-totals.ts
```

### [packages/coding-agent/src/core/compaction](/Users/ayu/Learn/pi/packages/coding-agent/src/core/compaction)

```text
branch-summarization.ts
compaction.ts
index.ts
utils.ts
```

### [packages/coding-agent/src/core/export-html](/Users/ayu/Learn/pi/packages/coding-agent/src/core/export-html)

```text
ansi-to-html.ts
index.ts
template.css
template.html
template.js
tool-renderer.ts
```

### [packages/coding-agent/src/core/export-html/vendor](/Users/ayu/Learn/pi/packages/coding-agent/src/core/export-html/vendor)

```text
highlight.min.js
marked.min.js
```

### [packages/coding-agent/src/core/extensions](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions)

```text
index.ts
loader.ts
runner.ts
types.ts
wrapper.ts
```

### [packages/coding-agent/src/core/tools](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools)

```text
bash.ts
edit-diff.ts
edit.ts
file-mutation-queue.ts
find.ts
grep.ts
index.ts
ls.ts
output-accumulator.ts
path-utils.ts
powershell.ts
read.ts
render-utils.ts
tool-definition-wrapper.ts
truncate.ts
write.ts
```

### [packages/coding-agent/src/core/tools/renderers](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/renderers)

```text
bash.ts
edit.ts
find.ts
grep.ts
index.ts
ls.ts
read.ts
write.ts
```

### [packages/coding-agent/src/experimental](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental)

```text
cli.ts
client-runtime.ts
client-tui-chat.ts
client-tui.ts
client.ts
commands.ts
coordinator-entry.ts
coordinator.ts
plugin.ts
process.ts
radius-auth.ts
radius-relay.ts
server.ts
session-worker-manager.ts
session-worker.ts
source-resolver.ts
```

### [packages/coding-agent/src/experimental/mini](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini)

```text
README.md
main.ts
```

### [packages/coding-agent/src/experimental/mini/server](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/server)

```text
entry.ts
run.ts
```

### [packages/coding-agent/src/experimental/mini/shared](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/shared)

```text
protocol.ts
rpc.ts
transport.ts
```

### [packages/coding-agent/src/experimental/mini/tui](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/tui)

```text
run.ts
session.ts
view.ts
```

### [packages/coding-agent/src/experimental/mini/worker](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/worker)

```text
entry.ts
lane-service.ts
models-service.ts
run.ts
```

### [packages/coding-agent/src/experimental/plugins](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/plugins)

```text
bundled.ts
package.ts
```

### [packages/coding-agent/src/experimental/services](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services)

```text
README.md
agent-controller-provider.ts
agent-controller.ts
connection.ts
models-provider.ts
models.ts
plugins.ts
presentation-ui.ts
server.ts
sessions.ts
slash-commands-provider.ts
slash-commands.ts
transcript-provider.ts
transcript.ts
worker.ts
```

### [packages/coding-agent/src/extensions](/Users/ayu/Learn/pi/packages/coding-agent/src/extensions)

```text
index.ts
```

### [packages/coding-agent/src/extensions/llama](/Users/ayu/Learn/pi/packages/coding-agent/src/extensions/llama)

```text
client.ts
huggingface.ts
index.ts
provider.ts
ui.ts
```

### [packages/coding-agent/src/modes](/Users/ayu/Learn/pi/packages/coding-agent/src/modes)

```text
index.ts
json-event.ts
print-mode.ts
```

### [packages/coding-agent/src/modes/interactive](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive)

```text
chat-viewport.ts
external-editor.ts
interactive-mode.ts
model-catalog-refresh.ts
model-search.ts
session-share.ts
tui-renderer.ts
```

### [packages/coding-agent/src/modes/interactive/assets](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/assets)

```text
clankolas.png
```

### [packages/coding-agent/src/modes/interactive/components](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/components)

```text
armin.ts
assistant-message.ts
bash-execution.ts
bordered-loader.ts
branch-summary-message.ts
compaction-summary-message.ts
config-selector.ts
countdown-timer.ts
custom-editor.ts
custom-entry.ts
custom-message.ts
daxnuts.ts
diff.ts
dynamic-border.ts
earendil-announcement.ts
extension-editor.ts
extension-input.ts
extension-selector.ts
first-time-setup.ts
footer.ts
index.ts
keybinding-hints.ts
login-dialog.ts
markdown-transform.ts
mermaid.ts
model-selector.ts
oauth-selector.ts
scoped-models-selector.ts
session-selector-search.ts
session-selector.ts
settings-selector.ts
settings-submenu.ts
show-images-selector.ts
skill-invocation-message.ts
status-indicator.ts
theme-selector.ts
thinking-selector.ts
tool-execution.ts
tree-selector.ts
trust-selector.ts
user-message-selector.ts
user-message.ts
visual-truncate.ts
```

### [packages/coding-agent/src/modes/interactive/theme](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/theme)

```text
dark.json
light.json
theme-controller.ts
theme-json.ts
theme-schema.json
theme.ts
```

### [packages/coding-agent/src/modes/rpc](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/rpc)

```text
jsonl.ts
rpc-client.ts
rpc-mode.ts
rpc-types.ts
```

### [packages/coding-agent/src/utils](/Users/ayu/Learn/pi/packages/coding-agent/src/utils)

```text
abort.ts
ansi.ts
changelog.ts
child-process.ts
clipboard-command.ts
clipboard-image.ts
clipboard.ts
deprecation.ts
exif-orientation.ts
frontmatter.ts
fs-watch.ts
git.ts
highlight-js.d.ts
html.ts
image-convert.ts
image-process.ts
image-resize-core.ts
image-resize-worker.ts
image-resize.ts
json.ts
management-http.ts
mime.ts
open-browser.ts
paths.ts
photon.ts
pi-user-agent.ts
shell.ts
sleep.ts
syntax-highlight.ts
text.ts
tool-result-images.ts
tools-manager.ts
version-check.ts
windows-self-update.ts
```

### [packages/tui/native](/Users/ayu/Learn/pi/packages/tui/native)

```text
clipboard.h
napi.h
```

### [packages/tui/native/darwin](/Users/ayu/Learn/pi/packages/tui/native/darwin)

```text
README.md
build.sh
```

### [packages/tui/native/darwin/prebuilds/darwin-arm64](/Users/ayu/Learn/pi/packages/tui/native/darwin/prebuilds/darwin-arm64)

```text
darwin-platform.node
```

### [packages/tui/native/darwin/prebuilds/darwin-x64](/Users/ayu/Learn/pi/packages/tui/native/darwin/prebuilds/darwin-x64)

```text
darwin-platform.node
```

### [packages/tui/native/darwin/src](/Users/ayu/Learn/pi/packages/tui/native/darwin/src)

```text
darwin-platform.m
```

### [packages/tui/native/linux](/Users/ayu/Learn/pi/packages/tui/native/linux)

```text
README.md
build.sh
```

### [packages/tui/native/linux/prebuilds/linux-arm64](/Users/ayu/Learn/pi/packages/tui/native/linux/prebuilds/linux-arm64)

```text
linux-platform-x11.node
```

### [packages/tui/native/linux/prebuilds/linux-x64](/Users/ayu/Learn/pi/packages/tui/native/linux/prebuilds/linux-x64)

```text
linux-platform-x11.node
```

### [packages/tui/native/linux/src](/Users/ayu/Learn/pi/packages/tui/native/linux/src)

```text
clipboard-worker.h
linux-platform-x11.c
```

### [packages/tui/native/win32](/Users/ayu/Learn/pi/packages/tui/native/win32)

```text
README.md
build.mjs
```

### [packages/tui/native/win32/prebuilds/win32-arm64](/Users/ayu/Learn/pi/packages/tui/native/win32/prebuilds/win32-arm64)

```text
win32-platform.node
```

### [packages/tui/native/win32/prebuilds/win32-x64](/Users/ayu/Learn/pi/packages/tui/native/win32/prebuilds/win32-x64)

```text
win32-platform.node
```

### [packages/tui/native/win32/src](/Users/ayu/Learn/pi/packages/tui/native/win32/src)

```text
win32-platform.c
```

### [packages/tui/src](/Users/ayu/Learn/pi/packages/tui/src)

```text
alt-screen-search.ts
autocomplete.ts
editor-component.ts
fuzzy.ts
index.ts
keybindings.ts
keys.ts
kill-ring.ts
latex.ts
layout-node.ts
layout.ts
native-modifiers.ts
native-module-path.ts
native-platform.ts
stdin-buffer.ts
terminal-colors.ts
terminal-image.ts
terminal.ts
tui-alt-screen.ts
tui-main-screen.ts
tui.ts
undo-stack.ts
utils.ts
word-navigation.ts
```

### [packages/tui/src/components](/Users/ayu/Learn/pi/packages/tui/src/components)

```text
alt-screen-flash.ts
box.ts
cancellable-loader.ts
editor.ts
h-stack.ts
image.ts
input.ts
loader.ts
markdown.ts
mouse-region.ts
scroll-view.ts
select-list.ts
settings-list.ts
spacer.ts
stack.ts
text.ts
truncated-text.ts
v-stack.ts
```
