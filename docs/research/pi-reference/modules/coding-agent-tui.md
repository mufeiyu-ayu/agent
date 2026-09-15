# Coding Agent 与 TUI：产品装配、会话语义和呈现边界

## 0. 本文怎样用

研究基准：`/Users/ayu/Learn/pi`，HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`，2026-09-15 本地源码。下列绝对路径链接和行号均针对这个快照。本文是源码研究及云端迁移取舍，不是运行验收；没有启动 Pi、调用模型、执行扩展、读写真实会话或系统剪贴板。测试仅作为已阅读的设计证据，未执行。

范围：默认 `packages/coding-agent` 产品链、旧 `AgentSession`/JSONL 会话、资源与扩展、工具、模型装配、终端 UI；同时核对实验入口与 mini 呈现。实验服务端拓扑另见 [Chord / Server / Client](chord-server-client.md)。所有子目录的覆盖边界和文件索引见 [product-coverage.md](product-coverage.md)。

给实现 AI：每次选一个下面的场景，先打开当前源码核对符号，再走完「输入 → 状态改变 → 模型/工具 → 事件 → 持久化 → UI」中的相关闭环。本文标记的“建议”不代表已经立项或已实现。不要一口气载入全文，不要把 Pi 的终端约束直接搬到 Vue/NestJS。

## 1. 先认清默认产品与实验产品

| 路径 | 此快照的职责和地位 |
| --- | --- |
| [src/cli.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/cli.ts:1) → [main.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/main.ts:562) | 默认 CLI 入口；package 的 `bin.pi` 指向 `dist/bundle/cli.js`。调用 `setupCli()` 后装配旧 `AgentSession` 产品。 |
| [rpc-entry.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/rpc-entry.ts:1) | 同一个 `main`，前置 `--mode rpc`，不是新的服务器实现。 |
| [bun/cli.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/bun/cli.ts:1) | 独立二进制的启动适配：先恢复 sandbox 下的环境，再注册 Bun OAuth / Bedrock 适配，最后进入默认 CLI。`sandbox-env-setup` 是兼容修复，不是权限沙箱。 |
| [experimental/cli.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/cli.ts:1) | 额外源码入口，先尝试实验 client/server 命令，其他参数退回 `main`。不能仅设环境变量就假设默认发布 CLI 已走这条链。 |
| [experimental/commands.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/commands.ts:93) | `PI_EXPERIMENTAL === "1"` 且首参数为 `server`/`client` 才分流；新 CLI command 层负责参数校验与执行上下文。 |
| [experimental/mini/main.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/main.ts:1) | 单独运行的最小 durable harness 验证产品；不是默认 interactive 的“瘦版本”。支持 `--continue`，没有完整 extensions / skills / slash commands / tree 产品面。 |

发布状态只据 [package.json](/Users/ayu/Learn/pi/packages/coding-agent/package.json:1) 判断：`dist/experimental`、`dist/client`、`dist/cli/experimental` 被 `files` 排除，部分实验 export 只有 `source` condition。代码存在不等于已进入默认 npm 运行链。

默认模式选择在 [resolveAppMode](/Users/ayu/Learn/pi/packages/coding-agent/src/main.ts:111)：RPC 优先，然后 JSON；`--print`、stdin 非 TTY 或 stdout 非 TTY 选 print；否则 interactive。`SettingsManager.getTuiMode()` 默认 `regular`，显式配置才选 `fullscreen`，见 [settings-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/settings-manager.ts:1248)。fullscreen renderer 已属于默认产品可选能力，不等同于实验 client。

## 2. 装配思想：先决定会话归属，再创建依赖

### 2.1 实际调用链

```text
cli.ts: setupCli → main(args)
  ├─ auth / package / config / version / export 等单次命令
  └─ parseArgs → resolveAppMode → createSessionManager
       → 取得最终 session cwd
       → project trust + createAgentSessionServices
       → buildSessionOptions
       → createAgentSessionFromServices → createAgentSession
       → AgentSessionRuntime
       → InteractiveMode / runPrintMode / runRpcMode
```

[main.ts 的 createRuntime](/Users/ayu/Learn/pi/packages/coding-agent/src/main.ts:713) 是 composition root（把依赖装成可运行对象的入口），不是采样循环。它把 CLI 的固定路径先绝对化；恢复其他项目的会话后，再按该会话的 cwd 重新解析 settings、resources、providers、models。这样 `/resume` 不会错误继承启动目录里的项目扩展。

[createAgentSessionServices](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session-services.ts:135) 只建立 cwd 绑定的 `ModelRuntime`、`SettingsManager`、`DefaultResourceLoader` 和 diagnostics；随后才创建 session。诊断返回给 app 层决定是否打印和退出。少量旧 helper 仍直接打印，不能把整个 core 说成纯 I/O 无关。

### 2.2 值得保留的源码切片：显式依赖装配

[sdk.ts / createAgentSession](/Users/ayu/Learn/pi/packages/coding-agent/src/core/sdk.ts:173)，核心原文：

```ts
const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));
```

注释：CLI 与未注入依赖的 SDK 都使用本机默认值。`createAgentSession({})` 会创建 ModelRuntime、磁盘 SettingsManager / SessionManager 和默认资源加载器；只有显式注入相应依赖才改变这些行为。`SessionManager.create()` 设置 `persist=true`，`inMemory()` 才关闭会话文件持久化，见 [session-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/session-manager.ts:1551)。支持注入不等于默认已经隔离，云端宿主必须明确提供凭据、会话存储与资源加载的作用域。

[sdk.ts / Agent 装配](/Users/ayu/Learn/pi/packages/coding-agent/src/core/sdk.ts:306) 把 `convertToLlm`、`ModelRuntime.streamSimple`、provider hooks、`transformContext`、steering/follow-up 策略注入低层 `Agent`。无 settings 覆盖时默认启用的内置工具是 `read/bash/edit/write`（[sdk.ts:256](/Users/ayu/Learn/pi/packages/coding-agent/src/core/sdk.ts:256)）；`settings.defaultTools` 可整体替换这个默认集，`options.tools` 显式指定、`noTools` 清空、`excludeTools` 再过滤。可注册的工具还有 `grep/find/ls/powershell`。allowlist/denylist 同样过滤 extension/custom tools，不能只过滤内置工具。

**云端建议**：保留这条顺序，但把 cwd 的身份替换为明确的 `tenant/user/workspace/session` 上下文。NestJS DI 负责稳定基础设施，单个 session/请求的依赖通过工厂参数明确传入；不要把租户状态写进全局 singleton。

### 2.3 System prompt 的装配顺序

[buildSystemPrompt](/Users/ayu/Learn/pi/packages/coding-agent/src/core/system-prompt.ts:28) 是纯函数，输入全部由调用方预先加载，顺序固定：

```text
customPrompt（有则整体替换默认正文）
  或 默认正文：角色一句话 → Available tools（只列有 snippet 的工具）→ Guidelines（按已启用工具推导 + promptGuidelines 去重）→ Pi 自身文档入口
→ appendSystemPrompt
→ <project_context>：每个 context file 一段 <project_instructions path=…>
→ skills 列表：仅当启用了 read 或 bash 之一才附加，只给 name/description/path，不给正文
→ Current working directory
```

- 工具描述不在 system prompt 里重复：工具 schema 走 provider 的 tools 字段，prompt 只放一行 snippet（`toolSnippets`）。
- skills 只暴露索引，正文由模型按需 `read`；没有可读文件的工具时干脆不列，避免模型看见却读不到。
- [AgentSession._baseSystemPrompt](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1094) 在资源 reload 后重建；`before_agent_start` 扩展可以整体覆盖本轮 system prompt，覆盖只对本次 run 生效（`_runAgentPrompt` 的 finally 清掉 `_systemPromptOverride`）。

**云端对应**：system prompt 的每一段都应有可追溯来源（租户配置、workspace 指令文件、技能索引、运行时状态），并把最终拼装结果作为本次请求的一部分记录，这是 `model-visible ⟺ logged` 的前提之一。

## 3. `AgentSession` 是产品运行门面，不是一个 AgentRun

[agent-session.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:314) 持有低层 `Agent`、会话树、模型选择、资源、扩展、重试、压缩、交互 bash 和队列。`AgentSessionRuntime` 再持有“当前 session + cwd services”，负责换会话和重新绑定呈现。

### 3.1 一次普通输入的完整闭环

入口 [AgentSession.prompt](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1175)：

1. 先尝试 extension slash command；即使正在 streaming，已注册命令也立即执行。
2. 手动 compaction 中拒绝普通 prompt；发 `input` hook，支持继续、改写或已处理。
3. 展开 `/skill:name` 与 prompt template。显式 skill 把正文放进用户消息；自动 skill 先只在系统提示中列名称、描述和路径。
4. 如果运行中，必须选择 `steer` 或 `followUp`，进入低层 Agent 队列；没有行为参数就报错。
5. 空闲时刷新待入历史的 bash/custom 信息，核对 model/auth，必要时做前置 compaction。
6. 构造用户 message 与 extension 的 `before_agent_start` 附加内容/系统提示。
7. `_runAgentPrompt` 调 `agent.prompt`；低层负责采样与工具循环；`_handleAgentEvent` 执行扩展 hook、通知 listener、落地已完成消息。
8. 低层 `agent_end` 后仍可能重试、压缩恢复或运行 hook 加入的 follow-up；最终才发 `agent_settled`。

### 3.2 最容易讲错的终态

[AgentSession._runAgentPrompt](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1101)，原文：

```ts
await this.agent.prompt(messages);
while (await this._handlePostAgentRun()) {
  await this.agent.continue();
}
```

注释：`agent_end` 表示一次低层循环结束；产品层此时还能继续。`agent_settled` 才表示门面完成后续处理并回到空闲。前端 loading、任务完成通知、RPC 等待条件应对齐自己承诺的层级。

[regression #6363](/Users/ayu/Learn/pi/packages/coding-agent/test/suite/regressions/6363-agent-settled-event.test.ts:20) 用 faux responses 制造一次失败、一次恢复，断言两个 `agent_end` 的 `willRetry` 为 `[true,false]`，只有一次 `agent_settled`；还验证 `agent_end` hook 加入 follow-up 后不能提前 settled。**测试未执行。**

队列不是中断线程：`steer` 在当前 assistant turn 的工具处理后、下一次采样前进入；`followUp` 等工具和 steering 都清空后进入。`_steeringMessages` / `_followUpMessages` 是产品显示用的镜像，实际交付队列在低层 Agent。不能把镜像数组当作持久化队列。

### 3.3 消息顺序是协议约束

[sendCustomMessage](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1502) 有三种投递方式：`deliverAs:"nextTurn"` 存入 `_pendingNextTurnMessages`，与下一条用户 prompt 一起进入 messages；运行中且 `triggerTurn:false` 时先排队，到 `turn_end` 才放入历史，避免插在 tool call 与 tool result 中间；运行中要触发轮次则按 `deliverAs` 走 followUp 或默认 steer。交互 bash 也做延迟写入。

[regression #8537](/Users/ayu/Learn/pi/packages/coding-agent/test/suite/regressions/8537-custom-message-tool-result-ordering.test.ts:13) 断言状态、session entries 和 message events 都是 `user → assistant → toolResult → custom → assistant`，并检查 tool result 有前置 call。**测试未执行。**

**云端建议**：任务通知、审批结果、后台检索结果都要通过运行层的消息插入规则。WebSocket 收到一个异步结果，不代表可以直接 push 到模型 messages 数组。

### 3.4 恢复会话与切换模型也是历史事实

- `--resume` 走 [selectSession](/Users/ayu/Learn/pi/packages/coding-agent/src/main.ts:410) 选文件，`--continue` 走 `SessionManager.continueRecent`（[main.ts:427](/Users/ayu/Learn/pi/packages/coding-agent/src/main.ts:427)）；两者都只是选定 `sessionManager`，随后 `createRuntime` 按该会话的 cwd 重新解析设置与资源（§2.1）。恢复后 [createAgentSession](/Users/ayu/Learn/pi/packages/coding-agent/src/core/sdk.ts:191) 从 session context 取回 model 与 thinkingLevel；模型不可用或无凭据时回退到 `findInitialModel` 并给出 `modelFallbackMessage`，不是静默换模型。
- 模型与思考级别的切换写入会话树：`setModel / cycleModel` 追加 `model_change`（[agent-session.ts:1679](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1679)），`setThinkingLevel` 追加 `thinking_level_change`（[:1829](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1829)）并按模型能力 clamp。`buildSessionContext` 沿当前分支回溯最近一次记录，所以换分支会带回那条分支当时的模型。
- 新会话在没有 assistant 消息前不落盘（§4.3），但一旦落盘，首批写入就包含这些 `model_change/thinking_level_change`。

**云端对应**：模型选择属于会话历史而非仅 UI 状态；重连或换分支后展示的模型必须来自持久化记录，而不是浏览器本地状态。

## 4. 会话树、模型上下文与磁盘事实

### 4.1 三层数据各有用途

| 数据 | 来源 | 模型是否看到 |
| --- | --- | --- |
| `SessionEntry` 完整树 | JSONL 中的 `id/parentId/type/timestamp` | 不是全部；只投影当前分支及压缩保留部分 |
| `AgentMessage` | session context + 当前运行状态 | 经 `convertToLlm` 转换；存在产品自定义 role |
| provider message/context | `transformContext`、`convertToLlm`、system prompt 和 provider adapter | 是本次请求输入；旧 JSONL 不完整记录所有动态变换 |
| `custom` entry 的 `data` | extension 的持久化私有状态 | 不自动进入模型 |
| `custom_message` | extension 注入的消息 | 会进入模型；`display:false` 只控制 TUI 隐藏 |
| `bashExecution.excludeFromContext` | `!!command` | 被 `convertToLlm` 排除 |
| `details`、label、session name | 展示和索引信息 | 不由默认转换器直接发送；extension 可主动读取并影响后续输入 |

`sourceInfo` 记录资源来源、scope、路径，主要用于诊断/展示；与它相关的排序决定资源冲突胜者，故不能一概称全部“纯观测”。`usage` 也不能一概当纯观测：合计用于统计，context usage/估算用于 compaction 判断。

### 4.2 关键切片：树到上下文是显式投影

[session-manager.ts / buildSessionContext](/Users/ayu/Learn/pi/packages/coding-agent/src/core/session-manager.ts:461)：

```ts
const path = buildSessionPath(entries, leafId, byId);
const { thinkingLevel, model } = getSessionContextSettings(path);
const messages = buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages);
return { messages, thinkingLevel, model };
```

注释：先沿 parentId 回溯当前 leaf，再把最新 compaction 投影为「摘要 + firstKeptEntryId 起的保留记录 + compaction 后记录」。`/tree` 换同一文件的 leaf；fork 创建另一会话。压缩不删除历史树。

[messages.ts / convertToLlm](/Users/ayu/Learn/pi/packages/coding-agent/src/core/messages.ts:147) 把 bash/custom/branchSummary/compactionSummary 转为 user role；普通 user/assistant/toolResult 透传。因此“自定义消息类型”不必要求 provider 支持新 role。

### 4.3 不能从 append-only 推出 durable execution

[SessionManager._persist](/Users/ayu/Learn/pi/packages/coding-agent/src/core/session-manager.ts:1029) 的新会话在没有 assistant entry 时暂不首次 flush；首条 assistant 到达后才以 `wx` 创建文件，再追加行。`_appendEntry` 先改内存索引，再调用磁盘写入；该实现没有数据库事务、多进程租约或逐工具幂等协议。

[AgentSession._handleAgentEvent](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:639) 的顺序是 `await _emitExtensionEvent(event)` → `_emit(event)` → `message_end` 持久化。delta 不是磁盘事实，listener 已收到事件也不证明磁盘提交完成。

[SDK transformContext](/Users/ayu/Learn/pi/packages/coding-agent/src/core/sdk.ts:362) 与 [ExtensionRunner.emitContext](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions/runner.ts:1034) 能在发送前改 messages，系统提示也根据当前资源重建。旧 JSONL 可以重建产品历史及默认 context 投影，**不能单独证明 exact request replay**。HTML 导出提供的是导出时的当前 systemPrompt/tools，并非每次请求的版本快照。

**云端取舍**：保留树形历史、投影函数、压缩边界；使用我们的数据库事务、运行身份和请求记录满足 `model-visible ⟺ logged`。恢复执行要学新 durable harness，不要把“打开 JSONL 再 prompt”命名为中断点恢复。

## 5. Compaction 与 branch summary：先准备，再生成，再提交

[compaction.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/compaction/compaction.ts:750) 的 `prepareCompaction` 先算确定的数据：上次摘要、待压缩历史、保留边界、跨 turn 的前缀、文件操作。随后 `compact` 才调用模型；成功后由 `AgentSession` 追加 compaction entry，再重建 context。

关键原文，[findValidCutPoints](/Users/ayu/Learn/pi/packages/coding-agent/src/core/compaction/compaction.ts:351)：

```ts
if (sessionEntryToContextMessages(entry).some(isCutPointMessage)) {
  cutPoints.push(i);
}
```

其中 `toolResult` 不是合法切点；assistant tool call 可以成为切点，随后的 results 一起保留。如果切在 turn 中间，对前缀再生成专门摘要，避免只保留一串失去用户任务来源的工具结果。

| 场景 | 产品行为 |
| --- | --- |
| 手动 `/compact` | 先 abort 当前操作；压缩后不自动继续被中断 turn |
| 超阈值 | `contextTokens > contextWindow - reserveTokens`；压缩完成的历史，通常不重新回答 |
| overflow / 可恢复 length | 失败 assistant 仍留历史，但从重试 context 移走；最多一次 compact-and-retry 恢复 |
| 普通可重试错误 | `_prepareRetry` 使用独立重试预算与可取消退避；不拿 overflow 走普通重试 |
| tree 分支摘要 | 找旧 leaf 和目标的最近共同祖先，摘要离开的分支，附在新目标位置 |

证据：[estimateContextTokens](/Users/ayu/Learn/pi/packages/coding-agent/src/core/compaction/compaction.ts:202)、[AgentSession.compact](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:1967)、[_checkCompaction](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session.ts:2154)、[collectEntriesForBranchSummary](/Users/ayu/Learn/pi/packages/coding-agent/src/core/compaction/branch-summarization.ts:108)。

估算优先采用最近有效 usage，再加后续消息估算；压缩后旧 usage 已过期，UI 的 context usage 可返回 `null`，不伪造精确数字。摘要本身的 usage 记录在 compaction/branch summary entry，总计统计不只算当前可见 context。

**云端建议**：把 preparation 做成可记录的确定性输入，summary 视为一次独立模型操作，提交摘要与新 context 边界必须原子化。估算、提供商 usage、最终计费分别标明含义。

## 6. Extensions、Skills、Packages、Settings 各解决不同问题

### 6.1 分层与加载顺序

| 模块 | 边界 |
| --- | --- |
| [package-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/package-manager.ts:912) | 从 npm/git/local 来源解析或安装资源；维护 user/project/temporary scope、过滤规则与来源元信息 |
| [resource-loader.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/resource-loader.ts:387) | 聚合 extensions/skills/prompts/themes/context files/system prompt；处理启用、优先级、去重、diagnostics |
| [extensions/loader.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions/loader.ts:493) | 用 jiti 导入 factory，给受控注册 API；factory 成功 commit 注册，失败 discard；缓存 factory 而非复用整套活会话状态 |
| [extensions/runner.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions/runner.ts:269) | 绑定当前 session/model/UI 上下文、执行 hooks、指令解析与 stale context 检查 |
| [extensions/types.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions/types.ts:1) | 同时包含运行钩子、工具定义、命令、UI 回调等产品扩展协议；不是无权限的纯声明格式 |
| [skills.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/skills.ts:1) | Markdown 元数据发现、校验、冲突和 prompt 索引；skill 本身不是可执行 JS 插件 |
| [prompt-templates.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/prompt-templates.ts:1) | 文本模板与参数替换；不拥有模型运行生命周期 |
| [settings-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/settings-manager.ts:184) | global/project 的深合并、临时 override、字段级保存与 reload；可注入内存 storage |

同名资源要看实际排序：[resourcePrecedenceRank](/Users/ayu/Learn/pi/packages/coding-agent/src/core/package-manager.ts:188) 先项目显式、项目自动、用户显式、用户自动、package 资源；`DefaultResourceLoader` 再把 CLI 指定路径放前面，skills 按 first-wins 去重并输出 collision。不要只看 `loadSkills(includeDefaults:true)` 的直接调用次序就推断默认产品总优先级。

上下文文件另一路：全局 agentDir + 根到 cwd 的祖先目录；每目录按 `AGENTS.override.md`、`AGENTS.md`、`AGENTS.MD`、`CLAUDE.md`、`CLAUDE.MD` 取首个，处理 nested worktree shadow，见 [loadProjectContextFiles](/Users/ayu/Learn/pi/packages/coding-agent/src/core/resource-loader.ts:119)（文件名候选表在 [loadContextFileFromDir:72](/Users/ayu/Learn/pi/packages/coding-agent/src/core/resource-loader.ts:72)）。

### 6.2 Trust 的真实范围

普通 CLI 的组合根用 project trust 控制 `.pi/settings.json`、项目 packages/extensions/skills/prompts/themes、SYSTEM/APPEND_SYSTEM 的加载。它的 bootstrap 先用不信任项目的设置，只加载 global/CLI 等扩展，让它们参与 `project_trust`；决定后再加载项目资源。该流程没有 UI 时，默认 ask 分支返回不信任。

证据：[loadProjectTrustExtensions](/Users/ayu/Learn/pi/packages/coding-agent/src/core/resource-loader.ts:380)、[resolveProjectTrusted](/Users/ayu/Learn/pi/packages/coding-agent/src/core/project-trust.ts:46)、[ProjectTrustStore](/Users/ayu/Learn/pi/packages/coding-agent/src/core/trust-manager.ts:209)。

原始 SDK 默认不装配这套确认流程：`SettingsManager` 的 `projectTrusted` 默认为 `true`，`DefaultResourceLoader.reload()` 只在传入 `resolveProjectTrust` 时执行预信任确认，而 `createAgentSession()` 默认调用无该参数的 reload。见 [settings-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/settings-manager.ts:374)、[resource-loader.ts reload](/Users/ayu/Learn/pi/packages/coding-agent/src/core/resource-loader.ts:388)。嵌入云服务时，必须由宿主显式配置资源信任与服务端授权，不能把 CLI 的确认行为当作 SDK 默认保护。

这不是每个工具动作的审批，也不是 OS 隔离。`AGENTS.md` 上下文仍由独立发现逻辑读取；显式 CLI、用户级 extension 是可执行本机代码。云端必须由服务端执行器和租户策略建立权限边界，不能把“用户信任了某目录”当作多租户安全模型。

### 6.3 拦截不是都同一种错误策略

[ExtensionRunner.emitToolCall](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions/runner.ts:982) 的核心原文：

```ts
const handlerResult = await handler(event, ctx);
if (handlerResult) {
  result = handlerResult as ToolCallEventResult;
  if (result.block) {
    return result;
  }
}
```

注释：此处没有 catch-and-continue；异常向上阻止执行。普通通知型 hook 在 `emit` 中捕获、报告并继续；context/message/result 则支持串联变换。安全性 hook 与展示 hook 必须分开理解。

[regression #5998](/Users/ayu/Learn/pi/packages/coding-agent/test/suite/regressions/5998-blocked-tool-terminate.test.ts:7) 验证 `{block:true, terminate:true}` 后工具不执行、不会再采样下一条回复，仍产生错误 tool result。**测试未执行。**

`reload` 先 `session_shutdown`，使旧 runner context 失效，重读 settings/resources，再构造 runner 和绑定。换 session 同样先 abort/settle、shutdown、dispose，再创建下一套 runtime；旧 UI 组件在 context 失效前拆除。见 [AgentSessionRuntime.teardownCurrent](/Users/ayu/Learn/pi/packages/coding-agent/src/core/agent-session-runtime.ts:167)。这是“生命周期与引用所有权”值得学的部分。

**取舍**：云端先保留少量内部 hook 与结构化工具注册；只有真实需求才开放用户插件。保留 skill 的渐进加载与来源诊断；把本机 package 下载、npm install 和 arbitrary JS factory 留在受控开发/执行环境，不进入 API 主进程。

### 6.4 扩展事件目录：产品层的完整扩展面

[ExtensionEvent](/Users/ayu/Learn/pi/packages/coding-agent/src/core/extensions/types.ts:1086) 联合类型是普通产品真正的扩展协议，比 §6.3 提到的几个 hook 宽得多。按职责分组（名称即源码 `type` 字面量）：

| 组 | 事件 | 能做什么 |
| --- | --- | --- |
| 信任与资源 | `project_trust`、`resources_discover` | 参与项目信任决定；向 loader 追加资源 |
| 会话生命周期 | `session_start`、`session_shutdown`、`session_before_switch`、`session_before_fork`、`session_before_tree`、`session_tree`、`session_before_compact`、`session_compact`、`session_compact_failed`、`session_info_changed` | 在换会话、fork、tree 导航、压缩前后介入或否决 |
| 模型请求 | `context`、`before_provider_request`、`before_provider_headers`、`after_provider_response` | 改发送前 messages、最终 payload、请求头；观察响应状态 |
| 运行边界 | `before_agent_start`、`agent_start`、`agent_end`、`agent_settled`、`turn_start`、`turn_end` | 注入 custom message / 改 system prompt；`agent_end` 可入队 follow-up |
| 消息与工具 | `message_start`、`message_update`、`message_end`、`tool_execution_start/update/end`、`tool_call`、`tool_result` | `tool_call` 可 block/terminate（异常向上抛）；`tool_result` 可改内容 |
| 用户与 UI | `input`、`user_bash`、`ui_prompt_start`、`ui_prompt_end`、`model_select`、`thinking_level_select` | 拦截/改写输入；替换 `!` 命令执行；感知模型切换 |

值得看的官方样例（[examples/extensions](/Users/ayu/Learn/pi/packages/coding-agent/examples/extensions)）：`confirm-destructive.ts` 与 `permission-gate.ts` 用 `tool_call` 实现审批，`sandbox/` 用扩展替换工具操作，`subagent/` 用扩展而非内核实现子代理，`plan-mode/` 用扩展限制工具集。它们是 README “No permission popups / no plan mode built in” 这一产品取舍的实证：这些能力存在，但以扩展形式存在。

**云端对应**：设计内部 hook 点时对照这张表取舍，而不是照抄；审批类 hook 必须像 `tool_call` 一样 fail-closed，展示类 hook 才允许吞错继续。

## 7. 工具：统一定义 + 可替换操作，但边界并不完全一致

[core/tools/index.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/index.ts:118) 有两种出口：产品用 `ToolDefinition`（schema、执行、prompt contributions、renderer）；SDK 可经 wrapper 变成低层 `AgentTool`。renderer 只处理展示，不应成为模型执行依赖。

| 工具 | 实际行为与重要边界 |
| --- | --- |
| [read](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/read.ts:1) | 文本支持 offset/limit，截断后给下一 offset；图片做 MIME/resize/处理。可注入文件读取操作 |
| [edit](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/edit.ts:143) | 每个 replacement 对原文件匹配；校验唯一、不重叠；处理 BOM/换行及有限 fuzzy normalization；返回简略模型结果和展示 diff/标准 patch |
| [write](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/write.ts:44) | 建父目录、完整写入；不是 patch 工具；与 edit 共享每文件写队列 |
| [bash](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/bash.ts:222) | `BashOperations.exec` 执行，stdout/stderr 合流，取消/timeout 清理进程树；默认无 timeout。非零退出通过错误工具结果表达 |
| [powershell](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/powershell.ts:32) | 复用 shell tool definition 与输出处理，替换 shell 配置/命令传递，避免复制整套工具 |
| [find](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/find.ts:73) | 默认调用 fd，可注入 glob 完全替换查找；结果按搜索根相对化，忽略/limit/truncation 明确 |
| [grep](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/grep.ts:70) | `GrepOperations` 只替换 isDirectory/readFile，搜索仍直接 ensureTool + spawn 本机 rg；这是远端抽象未覆盖的例外 |
| [ls](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/ls.ts:53) | 注入 exists/stat/readdir，按目录排序、限制条数和输出字节 |

### 7.1 关键切片：取消不能提前释放文件写所有权

[edit.execute](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/edit.ts:167) 原文：

```ts
return withFileMutationQueue(absolutePath, async () => {
  // Do not reject from an abort event listener here: that would release the
  // mutation queue while an in-flight filesystem operation may still finish.
```

注释：取消是观察到状态后在 await 边界处理，不是把尚未结束的 I/O 忘掉。否则下一次 edit 进入，同一文件前一次写入却晚到。`withFileMutationQueue` 用 realpath 合并同一文件别名；不存在路径退回 resolve；队列是进程内 Map，**不保证多个 worker、外部编辑器或另一进程之间互斥**。

### 7.2 输出截断是运行层语义

[OutputAccumulator](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/output-accumulator.ts:34) 用流式 UTF-8 decoder，保留有界尾部，需要截断时才写临时文件。默认限制见 [truncate.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/tools/truncate.ts:11)：2000 行或 50 KiB。只截断 UI 会让模型 context 仍然爆炸，因此给模型的 content 也包含截断说明和完整输出位置。

模型的 bash tool 与用户 `!` 命令不是同一条产品路径：后者走 [bash-executor.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/bash-executor.ts:45)，产出 `BashExecutionMessage`，`!!` 可排除模型上下文。`pi.exec` 又是另一种 command+args 的帮助函数，见 [core/exec.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/exec.ts:34)，不能假设三者有完全相同的缓冲、超时、进程树行为。

**云端建议**：保留工具 schema/结果和操作注入；实际 shell/file 进入 workspace executor。完整输出改为有访问控制的 artifact ID，不能把宿主临时绝对路径当作 Web 用户可读链接。每个 effect 要有执行身份、配额、取消后状态和幂等策略。

## 8. ModelRuntime：目录、认证与请求配置的汇合点

[ModelRuntime.create](/Users/ayu/Learn/pi/packages/coding-agent/src/core/model-runtime.ts:172) 装配 `RuntimeCredentials`、models.json、模型目录 cache、built-in provider、远程 catalog overlay；`provider-composer` 合并项目/扩展配置。旧 `ModelRegistry` 是兼容门面，当前 coding-agent 内部以 ModelRuntime 为准。

[prepareRequest](/Users/ayu/Learn/pi/packages/coding-agent/src/core/model-runtime.ts:573) 在每次请求前取得 provider/auth，合并大小写不敏感的 headers 和 env，应用认证给出的 baseUrl，才调 provider stream。模型目录“可见”、配置有凭据、凭据当前可用、请求成功是不同证据。

每个 provider 的 credential mutation 排队。`CredentialSynchronizationError` 明确表示“凭据已经修改，但本地模型/认证快照刷新失败”，避免把后续同步失败当成前面的写入没发生。目录刷新有序号防止晚结果覆盖新快照。

[management-http.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/utils/management-http.ts:27) 只重试幂等管理请求（catalog/version/download）；注释明确禁止拿它重试 Agent/model 操作。provider 请求重试、产品 run 重试、摘要重试各有语义入口，应分别观察，避免叠加后失控。

**云端建议**：凭据与模型 catalog 留服务端；Web 只拿可选模型及状态。沿用“已提交但同步失败”的精确结果语义，不把所有失败都映射为一个 `500` 后让客户端盲目重试。

## 9. 三种 I/O：共享门面，但功能不是完全相同

### 9.1 Interactive

[InteractiveMode](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:520) 持有 editor/chat/footer/selector、UI 侧 compaction queue、扩展 UI、资源展示、登录与模型选择。用户输入先被内置 slash command 拦截，再处理 `!`、compaction queue、streaming steer，普通消息经输入回调交给运行循环；见 [setupEditorSubmitHandler](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:2964)。

事件接入 [subscribeToAgent / handleEvent](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:3159)：消息开始创建组件，delta 更新组件，tool events 按 call ID 关联，完成时替换最终内容。selectors（session/tree/model/settings/trust/auth）是产品交互；components（assistant/user/tool/custom/diff/summary）是展示。

### 9.2 Print / JSON

[runPrintMode](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/print-mode.ts:34) 绑定无 TUI extension context，顺序运行输入，text 模式只写最后 assistant 的文本，JSON 模式发事件流；finally dispose/flush。`output-guard` 把普通 stdout 重定向 stderr，仅原始协议写函数保留 stdout，防止扩展日志破坏机器协议。

[toJsonEvent](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/json-event.ts:46) 原文：

```ts
return {
  type: "message_update",
  usage: event.message.usage,
  assistantMessageEvent: toJsonAssistantMessageEvent(event.assistantMessageEvent),
};
```

注释：去掉不断变大的累计 message/partial；以 start + delta + end 表达消息，保留固定大小 usage 和 tool 标识。否则每个 token 都重发全文，网络总量接近平方增长。这里传输优化不等于持久化协议。

### 9.3 RPC

[runRpcMode](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts:50) 是 stdin/stdout JSONL 双向协议；command 有 type 和可选 id，response 有 command/success/data/error，事件与 response 可交错。

`prompt` 在 preflight 成功时 ACK，不是等 run 完成才 ACK；排队和被 extension 处理也算接收成功。失败 preflight 返回失败 response；运行完成由事件表达。RPC 输入行异步分派，不能假设所有命令被串行执行。

extension 的 select/confirm/input/editor 可转成 `extension_ui_request` 并关联 response；终端组件工厂、raw input、自定义 footer/editor 不能跨 JSON 传输，部分 UI API 是 no-op。不要声称 RPC 等价于完整 interactive UI。

**云端建议**：把接受命令、运行进展、执行终态三种承诺分开；浏览器用结构化交互请求，别传可执行 TUI factory。继续保留服务端验证和运行所有权，不能把这个本机 RPC 的 `JSON.parse` + 类型断言当作公网协议校验。

## 10. TUI 包：我们学呈现边界，不重写终端

最小契约见 [tui.ts / Component](/Users/ayu/Learn/pi/packages/tui/src/tui.ts:113)（节选，接口还有 `handleMouse?` 与 `wantsKeyRelease?`）：

```ts
render(width: number): string[];
handleInput?(data: string): void;
invalidate(): void;
```

注释：组件输出终端行，renderer 决定怎样写终端。所有终端 escape、Unicode 宽度、光标定位不泄漏到 Agent 采样循环。

| 层 | 真实职责 |
| --- | --- |
| [ProcessTerminal](/Users/ayu/Learn/pi/packages/tui/src/terminal.ts:1) | raw stdin、resize、bracketed paste、Kitty/modifyOtherKeys 协商、进度/标题和 stop 恢复 |
| [StdinBuffer](/Users/ayu/Learn/pi/packages/tui/src/stdin-buffer.ts:1) | 把被流分块的 escape sequence 拼成完整输入，区分单独 Escape 与等待中的控制序列 |
| [keys.ts](/Users/ayu/Learn/pi/packages/tui/src/keys.ts:1) / [keybindings.ts](/Users/ayu/Learn/pi/packages/tui/src/keybindings.ts:1) | 终端编码解析与可配置动作映射；app 在自己的 keybindings 文件扩充动作 |
| [TuiBase](/Users/ayu/Learn/pi/packages/tui/src/tui.ts:465) | focus、overlay、输入分派、光标标记、render 合并与节流；按键可立即抢占等待中的帧 |
| [TuiMainScreen](/Users/ayu/Learn/pi/packages/tui/src/tui-main-screen.ts:124) | regular 模式保留终端 scrollback；比较新旧行差异、管理窗口变化与图片清理 |
| [TuiAltScreen](/Users/ayu/Learn/pi/packages/tui/src/tui-alt-screen.ts:195) | fullscreen 的 viewport、滚动、搜索、选区、鼠标和布局；不是简单 main-screen 加一个 ANSI 开关 |
| [layout.ts](/Users/ayu/Learn/pi/packages/tui/src/layout.ts:379)、stack / scroll-view | 构造 layout frame，分配 grow/shrink/basis，计算 scroll/hit bounds |
| [Editor](/Users/ayu/Learn/pi/packages/tui/src/components/editor.ts:284) | 多行编辑、grapheme/word 导航、history、undo/kill ring、paste markers、autocomplete |
| [Markdown](/Users/ayu/Learn/pi/packages/tui/src/components/markdown.ts:236) | marked token → 终端行、表格/列表/链接/代码样式；LaTeX 与 terminal-image 是显示适配 |
| [utils.ts](/Users/ayu/Learn/pi/packages/tui/src/utils.ts:1) | ANSI/OSC 与 Unicode 显示列宽、切片、换行；不是 JavaScript string.length |

[createInteractiveTui](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/tui-renderer.ts:18) 按 regular/fullscreen 选择 renderer；`createInteractiveTuiReference` 让旧组件持有稳定代理，实际方法调用落到当前 renderer。[createChatViewport](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/chat-viewport.ts:22) 把可滚动 transcript 与固定 editor dock 组合。

这些更新调度、光标、主题、截图/复制状态是呈现控制，默认不改变模型输入、工具选择或 run 终态。用户通过 UI 发出的 prompt/model/abort 命令才会跨回业务边界。

**我们的取舍**：Vue 接管 layout、键盘、焦点和浏览器无障碍；借用“按 ID 更新消息/工具组件”“最终消息校正 delta”“输入动作与渲染分开”。不要移植 ANSI 行 diff、Kitty 图片协议、native clipboard 或手写文本编辑器。

## 11. Native、图片、导出和附属产品面

- [native-platform.ts](/Users/ayu/Learn/pi/packages/tui/src/native-platform.ts:27) 按平台/架构尝试加载 `.node` helper；缓存模块加载结果，不把显示服务器当前不可用永久缓存。`undefined` 表示不可用，`null` 表示无剪贴板内容，传输失败 reject。Darwin 负责 AppKit clipboard/modifier；Windows 另启用 VT input；Linux X11 helper 负责读取，Wayland 和 Linux 写入由 coding-agent 的命令 fallback 处理。已核对 TS 入口和各平台导出/关键逻辑，未编译或验证二进制。
- [clipboard.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/utils/clipboard.ts:22)、clipboard-image/command、image-process/resize/worker/photon、mime/exif/image-convert 组成输入附件和平台适配；只有处理后的附件进入模型。OSC52 是终端远程复制 fallback，不能移植为浏览器权限方案。
- [export-html/index.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/export-html/index.ts:143) 内嵌模板/CSS/JS/vendor、base64 session data 和主题，支持完整树浏览；custom tools 可经 TUI→ANSI→HTML 预渲染。base64 只解决嵌入转义，不是 HTML 消毒。相关 XSS 测试是约束入口，未执行。
- [session-export.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/core/session-export.ts:7) JSONL export 只导出当前 branch，并重新串起 parentId；与 HTML 的全 entries 导出范围不同。
- [session-share.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/modes/interactive/session-share.ts:47) 是外部上传功能：优先 Radius artifact，未配置时用 GitHub secret gist。研究未调用。secret gist 不能称真正私有访问控制；我们的云端 artifact 应自建权限和生命周期。
- [extensions/llama](/Users/ayu/Learn/pi/packages/coding-agent/src/extensions/llama/index.ts:46) 是随产品注册的隐藏 built-in extension，管理 llama.cpp 服务目录、模型加载/卸载/下载及 Hugging Face 查询。它展示了“产品能力用同一扩展协议实现”，不表示我们要加入本地模型部署。
- [utils/tools-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/utils/tools-manager.ts:349)、version-check、package-manager-cli、migrations、Windows self-update 属于终端分发/维护面；云端用镜像和部署流程解决，不照搬运行时自动下载。

## 12. Mini 给云端呈现的直接启发

[mini/tui/session.ts / connect](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/tui/session.ts:53) 的 resubscribe 原文：

```ts
const previous = subscriptionId;
const opened = await lane.watch(presentationId);
snapshot = opened.snapshot;
subscriptionId = opened.subscriptionId;
publish();
await lane.start(opened.subscriptionId);
if (previous) void lane.unwatch(previous);
```

注释：worker 在 watch 时捕获 snapshot 并缓冲该订阅后续 events；presentation 先拿到 snapshot 和 id，再 start 放行，避免“请求快照时丢了一段事件”的竞态。客户端 fold 直接复用低层 `reduceLaneSnapshot`；返回 `"rebase"` 后重新订阅。它没有第二套业务推导逻辑。

[mini/tui/view.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/tui/view.ts:1) 只持 replicated snapshot 和显示组件，按 entry ID 追加；prefix 不再匹配时重建。**这比“WebSocket 收一个 delta 就拼字符串”更值得云端学习。**

注意 mini README 与代码有漂移：README 写 reducer 返回 `{ rebase:true }`，实际是 `"rebase"`；README 的 N² 广播说明也已过期，[server/run.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/server/run.ts:89) 对带 `to` 的事件只发给目标 presentation，不带地址的才广播。

mini 的生命周期又不同于主 experimental server：[最后 presentation 断开](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/server/run.ts:148) 会直接 `route.stop()` / `child.kill()`，未检查是否还有 active operation。它依靠 durable runtime 的下次恢复来承接；不能把主 experimental 的 demand/activity/holds 生命周期套在 mini 上。云端浏览器断开通常不应终止任务 worker，应另行决定任务寿命。

mini 尚缺默认产品许多能力；它证明了一条架构方向，不是可直接替换默认 CLI 的完整实现。

## 13. 建议查阅顺序与停点

| 次序 | 场景 | 打开哪些符号 | 本轮需要能回答 |
| --- | --- | --- | --- |
| 1 | 新会话输入一句话 | `main → createAgentSessionServices → createAgentSession → prompt` | 谁决定 workspace/cwd？谁创建 Agent？谁开始请求？ |
| 2 | assistant 调一个工具 | `AgentSession` hooks → `ToolDefinition` → Operations → message_end | 参数、执行、渲染、持久化在哪层？ |
| 3 | 运行中再输入一句话 | `prompt → _queueSteer/_queueFollowUp → agent_end/settled` | ACK、queue、运行完成分别意味着什么？ |
| 4 | 历史压缩与换分支 | `prepareCompaction → compact → appendCompaction → buildContextEntries` | 哪些事实保留？哪些内容给模型？ |
| 5 | 加载 skill/extension | `resource-loader → loader → runner → bindExtensions` | 文本资源、可执行代码、项目 trust 的边界在哪里？ |
| 6 | 前端重连 | `mini.connect → lane.watch/start → reduceLaneSnapshot` | 怎样保证 snapshot 与 events 无缝衔接？ |
| 7 | 换会话或 reload | `teardownCurrent / AgentSession.reload` | 旧执行、listener、UI factory 和 ctx 谁负责失效？ |

## 14. 总体心得与迁移边界

1. **先学边界和可替换依赖。** Pi 默认产品把多个 I/O mode 接到同一 session 门面，工具通过 Operations 隔离副作用，资源发现保留来源诊断。我们可以沿这个方向整理 NestJS service/contract，而不模仿文件名。
2. **把恢复作为显式协议。** 旧 JSONL 是历史树，新 harness/mini 才是 durable/replica 的研究入口；本项目更严格的模型输入记录、服务端校验引用与终态所有权必须保留。
3. **不要把整个大门面复制过来。** 此快照 `AgentSession` 3552 行、`InteractiveMode` 6620 行、`DefaultPackageManager` 所在文件 2699 行。小接口与清晰分层有价值，“Pi 到处都是小模块”不是事实。按实际变化原因拆分，比追求相同目录更重要。
4. **产品外壳做云端原生替换。** TUI、native clipboard、CLI 安装更新、宿主路径、global env/registry 和本机凭据不直接进入云端主进程；浏览器、数据库、workspace executor 与服务端 policy 承担各自职责。
5. **能力路线按真实使用展开。** 先跑通一个 session 的命令、事件与重连，再评估持久化恢复、审批、compaction、资源配置；不要一次搬齐插件市场、全终端编辑器、所有 provider 和分发维护系统。
