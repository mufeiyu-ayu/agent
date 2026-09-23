# 仓库工程组织：构建边界、契约测试和维护工具

## 1. 阅读边界

基准：`/Users/ayu/Learn/pi`，HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`，2026-09-15。根级范围按 `git ls-files` 排除 `packages/` 后共 **91 个 tracked 文件**，完整索引在文末。本文按功能组读取配置、脚本入口和关键机制；统计脚本、lockfile 和 GitHub 自动化没有逐行安全审计，也没有执行安装、发布、CLI 或真实测试。

这些文件管理“怎样开发、检查、打包和维护 Pi”，通常不在一次产品 prompt 的请求热路径。`scripts/` 在构建或人工命令时才运行；`.github/` 在 GitHub 事件时运行；`.pi/` 是维护者在本仓库用 Pi 开发 Pi 的资源。不能把它们画进 Agent 每轮采样控制流。

## 2. 工程目录与实际机制

| 功能组 | 关键路径 | 实际机制 | 我们的云端项目借鉴 |
| --- | --- | --- | --- |
| Workspace 清单 | `package.json:1` | npm workspaces 包含一级 packages、session-backends 二级包和几个带依赖的 extension examples；根包 private，公开包由各自 manifest 决定 | 先按真实依赖拆包，不因文件夹多就需要更多服务 |
| 发布包发现 | `scripts/package-workspaces.mjs:1`、`scripts/release-packages.mjs:5` | 递归找到 manifest，再筛掉 private；包含嵌套目录，不只 `packages/*` | 交付包清单应由可检查的源决定，别在各脚本各写一份失同步 |
| TS 源码运行 | `tsconfig.base.json:1`、`tsconfig.json:1` | strict、erasableSyntaxOnly、相对 `.ts` import，emit 时 rewrite 成 `.js`；根 typecheck 用源码 aliases，包构建用各自 build config | 区分开发解析与部署解析；共享 contracts 的构建顺序要明确 |
| 格式与静态检查 | `biome.json:1`、`scripts/check-ts-relative-imports.mjs:1` | Biome 限定 TS 源/测/例并排除生成目录；AST 检查非声明 TS 的 relative `.js` 引用 | 把一致性约定做成检查；不要把 check 命令默认为只读 |
| Entry 依赖预算 | `scripts/check-entry-graphs.mjs:33` | 为选定 narrow export 遍历 value-import 图，限制文件数和禁入目录 | Web 可共享 reducer，但不应顺手导入服务端运行层和凭据 SDK |
| 发布运行依赖检查 | `scripts/check-runtime-deps.mjs:1` | 使用 TypeScript AST 和公开包 build config，检查 value import/export、动态 import/require 是否在 runtime deps 中 | monorepo hoist 能掩盖漏依赖；必须按部署边界检查 |
| 浏览器构建冒烟 | `scripts/check-browser-smoke.mjs:1`、两个 smoke entry | esbuild browser target；再检查 selective provider graph，只允许选中的 provider catalog/SDK 贡献 | 前后端共享包的 browser-safe 能力要可验证，不靠 `import type` 口头约定 |
| Node CLI bundle | `scripts/build-coding-agent-bundle.mjs:83` | 编译后的 dist 打包，不沿根 source aliases；CLI/index/RPC 拆 shared chunks，lazy provider/OAuth/worker 另产物；检查 external allowlist | 验证真实运行产物，不仅验证源码开发服务器 |
| 跨平台 binary | `scripts/build-binaries.sh:1` | 安装/构建后用 Bun compile 生成六平台产物，复制平台资源并压缩；`--offline-model-data` 只切换模型数据构建路径 | 云端通常只要容器镜像；不复制整套终端分发矩阵 |
| Source archive | `scripts/create-source-archive.sh:1` | 用临时 Git index 将 release commit 和 ignored model data 合成 tree，固定 mtime、gzip 无时间戳，验证必须文件并解包校验数据 | 发布输入快照明确；运行时 metadata 与代码版本一起留证 |
| 外部依赖 pin | `.npmrc:1`、`scripts/check-pinned-deps.mjs:1` | save-exact/min-release-age 配置；脚本验证直接外部 registry dependencies/dev/optional 使用精确版本，内部 workspace 和指定非 registry source 例外 | 依赖变更属于代码评审的一部分；不把内部 semver 范围误当外部漂移 |
| 分发锁文件 | `scripts/generate-coding-agent-shrinkwrap.mjs:306`、`scripts/generate-coding-agent-install-lock.mjs:247` | 从根 lock 的 runtime 图导出 shrinkwrap/installer lock；拒绝本地链接、缺失依赖、未审阅 lifecycle scripts；检查 allowlist 版本不残留 | 镜像依赖图需可重现；开发锁与用户安装锁是不同产物 |
| 提交检查 | `.husky/pre-commit:1`、`scripts/check-lockfile-commit.mjs:1` | 检查 staged root lockfile；允许明确 override 或仅 workspace metadata 变更；跑 check 后把原 staged 文件重新暂存 | 共享工作区不要照搬自动重暂存策略，应保留本项目 scoped commit 约束 |
| 版本同步 | `scripts/sync-versions.js:1` | 公开包必须 lockstep version，更新所有包的内部 dependencies/devDependencies，排除生成 installer 根 | 当前小型私有应用无需立刻采用多包 lockstep 发布 |
| 本地 release 验证 | `scripts/local-release.mjs:119`、`scripts/coding-agent-consumer.mjs:78` | 仓库外临时安装 tarballs，直接依赖只声明 coding-agent，真实验证可安装包的 SDK/CLI 与隔离依赖 | release 测试必须走构建产物；不能从源码 aliases 的成功推断生产可用 |
| Release 编排 | `scripts/release.mjs:1`、`scripts/publish.mjs:1`、`release-notes.mjs` | preflight → bump/artifacts/check/test → commit/tag/push；publish 先检查每包 pack 和现有 npm 版本，再跳过已发布版本 | 这是外部发布流程，不是研究阶段可以顺手执行的验证命令 |
| Catalog 与公告发布 | `diff-model-catalog.mjs`、`generate-thinking-capabilities.mjs`、`scripts/publish-model-catalog.mjs:1`、`publish-release-announcement.mjs` | catalog 内容哈希 revision、分 shard、最后切 index；公告先验证所有 npm 包/tarball 可得，再更新 latest marker | 对外可见指针最后切换，避免宣布一个用户还安装不到的版本 |
| 性能与使用研究 | `profile-coding-agent-node.mjs`、`cost.ts`、`stats.ts`、`tool-stats.ts`、`read-tool-stats.mjs`、`edit-tool-stats.mjs`、`session-context-stats.mjs` | 从真实 session 或受控启动提取成本/工具/上下文/延迟；CLI 可输出文本、JSON、HTML 或 CPU profile | 我们用真实使用提出重构，不先搭一个覆盖一切的观测平台 |
| Transcript 研究 | `scripts/session-transcripts.ts:1` | 从 session 提取 transcript，按 context 大小拆分；`--analyze` 会启动 Pi 子进程做分析 | “统计脚本”也可能调用模型；本研究未执行它 |
| 开发启动与复现 | `pi-test.sh`、`pi-test.ps1/.bat`、`mini-test.sh`、`scripts/auto-pi.sh`、`repro-5893-wsl-bash.mjs` | 不同入口、模式、受控复现与平台 wrapper；部分命令会停进程/删 socket | 按真实入口定位问题；不把名称带 test 当作无副作用 |
| 源迁移脚本 | `scripts/update-source-imports-to-ts.sh:1` | 一次性批量把 source relative `.js` 引用改 `.ts` | 维护脚本与请求热路径分离；研究不运行历史 migration |
| 仓库文本/生成物边界 | `.gitignore:1`、`.gitattributes:1` | dist/node_modules/model JSON/profiles/logs 等不入 Git；文本 LF，Windows scripts CRLF，媒体标 binary | 把生成数据和源码分开管理，同时说明怎样复现生成输入 |
| 项目规则/设计材料 | `AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、`LICENSE`、`README.md`、`tui-plan.md` | 工程约定、贡献者门禁、本地信任模型、MIT 许可、入口和设计 handoff | 提炼思想，不把他仓的贡献/安全/审批流程带成本项目规则 |

## 3. 最值得借鉴的三个检查

### 3.1 Entry point 是加载成本和依赖方向的约束

check-entry-graphs.mjs / BUDGETS（`scripts/check-entry-graphs.mjs:33`） 原文摘录：

```js
"./harness/runtime/reducer": { maxFiles: 1 },
"./harness/context": { maxFiles: 6, forbid: ["harness/runtime/", "harness/execution/", "packages/ai/"] },
"./harness/env/nodejs": { maxFiles: 5, forbid: ["packages/ai/", "harness/runtime/"] },
"./harness/session": { maxFiles: 25, forbid: ["harness/runtime/", "harness/execution/", "packages/ai/src/index.ts"] },
```

它检查的是选定 exports 的静态 value-import 图，忽略 type-only 导入；脚本只对预算表中的 AI/Agent 入口强制执行，external 依赖不计入文件图。不能把它描述为“所有包完整依赖图验证”或实际内存 benchmark。

问题很具体：前端只需要 `reduceLaneSnapshot`，从大 barrel 导入却会加载模型、运行时和 provider 整图。把 reducer 单独导出，再让检查防止未来一个 `export *` 把它拖回去。**我们的优先用途是 shared contracts / projection / reducer 与 NestJS/Prisma/provider 的边界。**

### 3.2 浏览器构建与实际安装消费者补充 typecheck

`scripts/check-browser-smoke.mjs:44` 不打开浏览器，而是用 esbuild 的 browser target 验证可打包；selective-provider 入口检查不能拖入 compat、全量 catalog/all providers，输出只能包含 Anthropic catalog 和对应 SDK。缺失 generated provider JSON 时提供空占位，故它验证依赖边界，不验证模型数据完整或真实请求。

`scripts/coding-agent-consumer.mjs:42` 的临时 manifest 只把 coding-agent 设为直接依赖，用 overrides 选择本地 tarballs，不替作者补漏掉的 runtime 依赖。smoke 随后检查：

- 包里没有 `dist/experimental`、`dist/client` 和实验 bundle。
- 没有安装 `pi-client`、`pi-protocol`、`pi-server` 开发依赖。
- SDK exports 可导入，实验 source-only subpaths 在普通消费环境不可解析。
- bundled/unbundled CLI 的 `--version` 与 manifest 一致。

这是明确的安装契约检查；它没有跑一次真实模型回复。本次也未运行此脚本。

### 3.3 build:offline 的准确含义

根 `package.json:17` 按显式依赖顺序构建：Chord → TUI → telemetry → AI → Agent → SQLite backend → protocol → client → server → coding-agent。普通 AI build 会先生成模型；AI build:offline（`packages/ai/package.json:63`） 先 `check:model-data`，再编译和复制已有 `src/providers/data`。

所以 offline 表示“使用已有模型数据快照，不刷新目录”，**不是脱网安装一切**。node_modules、工具链、已 hydrate 的 model data 仍是前提。`build-binaries.sh --offline-model-data` 默认仍执行 `npm ci`，除非另加 skip-install。

source archive 把 ignored provider JSON 和 manifest 带进去，按 release commit 的 mtime 构造归档，再解包执行模型数据校验。它追求相同 commit+模型快照得到稳定 source artifact；不应据此声称不同 OS 的所有 binary 字节完全一致。

## 4. 测试方法：约束语义，而不是每个函数各写一套

### 4.1 测试入口与环境隔离

根 `test.sh:1` 建临时 home/tmp/npm config/cache，从 `env -i` 开始只放平台/CI 必需变量，关闭交互 Git credential 提示、local LLM 和 AWS metadata。cleanup 只删除它自己创建且带所有权标记的临时目录。然后才执行 `npm test`。

这让本地全量离线测试不意外继承真实 provider keys、用户 settings/extensions、全局 Git 和 npm 配置。但它不是网络 sandbox；测试代码仍可能自己创建连接。`pi-test.sh --no-env` 只是 unset 一份列出的 key，与 test.sh 的全环境隔离不是一回事。

`vitest.base.ts:1` 集中 workspace source aliases，各包再扩展配置；TUI 另用 `node:test`。根 `test:scripts` 用 `node --test scripts/*.test.mjs` 检查 runtime-deps、consumer、version sync、announcement 等维护脚本。

### 4.2 Backend conformance 的形状

ConformanceCase（`packages/agent/src/harness/session/testing/types.ts:8`） 不是绑死某测试 runner 的类：

```ts
export interface ConformanceCase {
  readonly group: string;
  readonly name: string;
  run(): Promise<void>;
}
```

createStorageConformance（`packages/agent/src/harness/session/testing/conformance/storage.ts:134`） 接收创建 fresh `StorageFixture` 的 factory；每个 case 用 `await using` 确保清理。JSONL、memory、SQLite 分别注册同一语义套件；SQLite storage conformance（`packages/session-backends/sqlite-node/test/storage-conformance.test.ts:27`） 只负责提供真实 SQLite fixture，断言由公共套件复用。repo-conformance（`packages/session-backends/sqlite-node/test/repo-conformance.test.ts:1`） 又验证目录布局和 shared-container 两种 repo 配置。

**我们的用途**：将来若把 session storage 从当前数据库封装替换/扩充，不是为每种 backend 复制一套看似相似的测试。先确定 append/commit/ownership/fork/read 等行为契约，再用同一组语义 cases 驱动不同 fixture。只有确实出现多个后端时才抽这层，当前单一 PostgreSQL 无须预建完整插件框架。

### 4.3 可控故障比 sleep 更有说服力

GatingStorage（`packages/agent/src/harness/session/testing/gating-storage.ts:25`） 可以 arm、等待 commit 入队、逐个 next 放行、discard 模拟存储丢失。测试精确停在提交边界，验证“取消晚到”“重启恢复”等行为，不靠随机延迟碰运气。`InstrumentedStorage` 记录操作，`StorageDecorator` 提供插入点；benchmark fixtures/datasets 与正确性 suite 分开。

server conformance（`packages/server/test/conformance.test.ts:28`） 用内存 byte channel 和 `sendFragmented` 验证 framing/协议，不需要真实云服务。coding-agent suite 用 faux provider 模拟模型回复，TUI 用 virtual terminal 检查输出和列宽。fixtures 是受控输入，不是生产实现；测试名包含 regression 编号，方便从真实 bug 反查约束。

本研究只读了上述机制和代表用例，没有执行 conformance 或故障注入；运行证据需要后续实现任务单独产生。

## 5. GitHub 自动化：发布、维护与权限分开

| 工作流 | 代码中的触发/行为 | 学习点 |
| --- | --- | --- |
| `.github/workflows/ci.yml:1` | main push/PR，Node 22、系统依赖、`npm ci --ignore-scripts`、build/check/test | 当前 workflow 文件不是 CI 最近通过的证据；没有替本项目新增必需 Actions |
| `.github/workflows/build-binaries.yml:1` | tag/manual → source archive → binaries → 平台 smoke → draft release → npm OIDC publish → announcement → 最后公开 GitHub release；失败清理 draft | 产物准备与公开发布分开，减少半发布状态；不能撤销已发 npm 的现实副作用 |
| `.github/workflows/publish-model-catalog.yml:1` | CI 成功/main、schedule、manual；generate/validate/artifact 与 production upload 分 job，上传有 environment 和时间窗 | catalog 数据更新与软件发布可以独立，但仍需来源 commit/revision 与校验 |
| `.github/workflows/npm-audit.yml:1` | 定期/手动生产依赖 vulnerability 和 registry signatures 检查 | 不把一次安装通过当作长期依赖健康；本次未联网验证公告 |
| `.github/workflows/issue-gate.yml:1`、`.github/workflows/pr-gate.yml:1` | 根据 collaborator permission 和批准清单控制新贡献者 issue/PR，例外 trusted bots | 是开源维护负荷的策略，不是 Agent 工具审批门 |
| `.github/workflows/approve-contributor.yml:1` | 仅有写权限维护者评论的 lgtmi/lgtm 触发批准，分别 issue/pr capability，更新清单 | 明确信息输入与授权人的身份；不要靠文字含有 approval 就执行 |
| `.github/workflows/issue-analysis.yml:1` | label/指定评论 → 先验证 staff actor 与固定 runner aliases → 用专用凭据跑 Pi `/is` → 导出 session gist/issue 回执 | 真实 dogfooding，包含模型调用与外部写入；它不是普通单测，本次未触发 |
| `.github/workflows/issue-triage-labels.yml:1`、`.github/workflows/remove-inprogress-on-close.yml:1` | reopened/label/closed 周边的 triage 状态维护 | tracker 自动化和产品运行状态分开 |
| `.github/ISSUE_TEMPLATE/*` / `APPROVED_CONTRIBUTORS` | bug/contribution/package report 不同输入表单；bug 要求先排查 extensions；名单记录 issue/pr 能力 | 报告先有可复现事实和范围，模板保持简短 |

Actions 引用固定 commit SHA，job permissions 按职责给出。这里只描述本地 workflow 源码，没核查远端 environment、secret、最近执行或发布状态。

## 6. `.pi/`：把真实使用反馈变成可复用工作方式

| 资源 | 具体功能 | 对本项目的取舍 |
| --- | --- | --- |
| `extensions/import-repro.ts` | `/ir` 导入 issue-analysis 导出的 JSONL/HTML/gist，会改 cwd 并切 session | 研究可复现 session 的思路；不运行外部下载或导入用户会话 |
| `extensions/prompt-url-widget.ts` | 识别 issue/PR/advisory prompt，读 GitHub metadata，展示 widget 和更新 session name | 表明可选工作流放扩展，不硬编码进 Agent loop |
| `extensions/redraws.ts`、`tps.ts` | 显示 redraw 次数与一次 agent_start/end 区间的吞吐指标 | 属于开发观测；TPS 区间不等同于 provider 首 token 延迟或端到端任务耗时 |
| `prompts/is.md`、`pr.md`、`sa.md` | issue 分析、PR 阅读、security advisory 的任务模板 | 面向操作的提示模板；不是源码热路径，更不是本次外部操作授权 |
| `prompts/cl.md`、`wr.md` | changelog 审核和收口流程 | Pi 的 main/commit/push 约定与我们 Issue/PR 规范不同，不能直接替换 |
| `.pi/prompts/deslop.md:7` | 先理解 invariants/call sites/tests，再删多余抽象、重复状态和假设性配置；明确不能为最短 diff 牺牲结构 | 借研究→最小正确边界→有证据简化的思路；本项目当前授权优先 |
| `skills/add-llm-provider.md` | provider 接入的 types/exports/catalog/tests/product/docs 清单 | 横切变化用任务清单防漏，细节回源码核实 |
| `skills/interactive-testing.md` | 用固定大小 tmux terminal 操作 TUI；release smoke 从仓库外开始并等待真实 reply | 平台 UI 验证独立于单元测试；本研究未使用这个操作流程 |
| `skills/release.md` | 本地 release、人工 smoke、tag 后恢复与发布说明 | “发布脚本存在”不表示已经具备执行前提；约定与脚本支持范围还需分别读 |
| `.pi/git/.gitignore`、`.pi/npm/.gitignore` | 忽略维护者本地资源安装数据 | 保留源级配置，排除本机安装产物 |

### 不能沿脚本名或注释推断入口

- `test.sh` 才是隔离的全量测试 wrapper。
- `pi-test.sh` 运行 `src/experimental/cli.ts`，`PI_EXPERIMENTAL=1` 时才处理实验命令。
- Windows `pi-test.ps1` 当前仍运行 `src/cli.ts`；`.bat` 只转 PowerShell。因此同名 wrapper 的实际入口并不完全一致。
- `scripts/auto-pi.sh` 设置 `PI_EXPERIMENTAL` 并运行 `dist/bundle/cli.js`。当前默认 bundled CLI 不导入实验 commands，不能仅凭 wrapper 注释就认定 client/server 命令已接入。
- `mini-test.sh --fresh/--stop` 有 `pkill` 和 socket 删除；默认运行可创建 detached server，不能当无副作用检查。
- `profile-coding-agent-node.mjs` 默认使用通常配置的 agentDir，需要显式 `--isolated-agent-dir` 才隔离；本研究没有读真实 session 数据来做统计。

## 7. 工程风格与我们应保留的边界

1. **把架构边界变成可运行检查。** narrow exports、runtime dependencies、browser bundle、真实 consumer install 验证不同层次，避免“本仓 typecheck 成功”掩盖交付错误。
2. **状态/副作用用可控接口测试。** conformance 复用语义，fixture 控制资源所有权，gating 控制提交时序；测试关注不变量，不重复 getter/setter。
3. **生成数据有独立生命周期。** source、catalog snapshot、build output、release marker 各自有事实来源。我们也应区分 provider catalog 更新与 runtime release。
4. **维护能力留在工具层。** 统计、issue 分析、changelog、发布、本机自更新不进入 runtime 业务链；只有被产品需要的契约才放 public package。
5. **不照搬适用于本机的信任模型。** `SECURITY.md:1` 把本机用户账户及可写文件视为同一安全边界，并把很多本地/公网暴露场景列为范围外；我们的多租户云端必须建立服务端隔离、鉴权和资源限制，不能继承这项假设。

额外注意：`npm run check` 自带 Biome `--write`，hook 后还可能 restage；根 `tsconfig` 的旧 alias/历史 plan 只证明配置里存在，不能推出对应当前 public API。研究时先核对实际调用和 exports，正是这个仓库最需要坚持的阅读方式。

## 8. 根级 91 文件完整索引

下列是当前 tracked 清单；lockfile/模板/统计工具按功能归类，不冒充逐行审计或运行通过。

```text
.gitattributes
.github/APPROVED_CONTRIBUTORS
.github/ISSUE_TEMPLATE/bug.yml
.github/ISSUE_TEMPLATE/config.yml
.github/ISSUE_TEMPLATE/contribution.yml
.github/ISSUE_TEMPLATE/package-report.yml
.github/workflows/approve-contributor.yml
.github/workflows/build-binaries.yml
.github/workflows/ci.yml
.github/workflows/issue-analysis.yml
.github/workflows/issue-gate.yml
.github/workflows/issue-triage-labels.yml
.github/workflows/npm-audit.yml
.github/workflows/pr-gate.yml
.github/workflows/publish-model-catalog.yml
.github/workflows/remove-inprogress-on-close.yml
.gitignore
.husky/pre-commit
.npmrc
.pi/extensions/import-repro.ts
.pi/extensions/prompt-url-widget.ts
.pi/extensions/redraws.ts
.pi/extensions/tps.ts
.pi/git/.gitignore
.pi/npm/.gitignore
.pi/prompts/cl.md
.pi/prompts/deslop.md
.pi/prompts/is.md
.pi/prompts/pr.md
.pi/prompts/sa.md
.pi/prompts/wr.md
.pi/skills/add-llm-provider.md
.pi/skills/interactive-testing.md
.pi/skills/release.md
AGENTS.md
CONTRIBUTING.md
LICENSE
README.md
SECURITY.md
biome.json
mini-test.sh
package-lock.json
package.json
pi-test.bat
pi-test.ps1
pi-test.sh
scripts/agent-treeshake-smoke-entry.ts
scripts/auto-pi.sh
scripts/browser-smoke-entry.ts
scripts/build-binaries.sh
scripts/build-coding-agent-bundle.mjs
scripts/check-browser-smoke.mjs
scripts/check-entry-graphs.mjs
scripts/check-lockfile-commit.mjs
scripts/check-pinned-deps.mjs
scripts/check-runtime-deps.mjs
scripts/check-runtime-deps.test.mjs
scripts/check-ts-relative-imports.mjs
scripts/coding-agent-consumer.mjs
scripts/coding-agent-consumer.test.mjs
scripts/cost.ts
scripts/create-source-archive.sh
scripts/diff-model-catalog.mjs
scripts/edit-tool-stats.mjs
scripts/generate-coding-agent-install-lock.mjs
scripts/generate-coding-agent-shrinkwrap.mjs
scripts/generate-thinking-capabilities.mjs
scripts/local-release.mjs
scripts/package-workspaces.mjs
scripts/profile-coding-agent-node.mjs
scripts/publish-model-catalog.mjs
scripts/publish-release-announcement.mjs
scripts/publish-release-announcement.test.mjs
scripts/publish.mjs
scripts/read-tool-stats.mjs
scripts/release-notes.mjs
scripts/release-packages.mjs
scripts/release.mjs
scripts/repro-5893-wsl-bash.mjs
scripts/session-context-stats.mjs
scripts/session-transcripts.ts
scripts/stats.ts
scripts/sync-versions.js
scripts/sync-versions.test.mjs
scripts/tool-stats.ts
scripts/update-source-imports-to-ts.sh
test.sh
tsconfig.base.json
tsconfig.json
tui-plan.md
vitest.base.ts
```
