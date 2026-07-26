# 横向工程任务：Agent / LLM 运行参数与模型配置治理

## 任务状态

- 看板状态：**Active（实现完成，待验收）**
- 实施状态：已实现
- 验收状态：待验收
- Issue：[#27](https://github.com/mufeiyu-ayu/agent/issues/27)
- 分支：`codex/issue-27-runtime-configuration-governance`
- PR：待创建 Draft PR
- 阶段关系：不占用 Phase 6 Task 编号；完成后再启动 Phase 6 Task 1

## 目标

把当前分散在 DTO、Vue、SEO Service、LLM Client、Agent Runtime 和 Tool 中的运行参数，整理为职责清晰、可验证、接近生产使用的配置体系。

本任务解决：

```text
公开产品限制重复定义
模型能力与应用默认值混在一起
运维参数缺少严格环境变量解析
历史消息、输出长度与超时存在 magic number
Search / Detail Tool 无法使用不同 Observation 预算
```

本任务不是有界 Agent Loop，也不创建万能 `common/constants.ts`。

## 实施前代码事实

- API 与 Web 分别硬编码用户输入上限 `16_000`；
- `SeoService` 硬编码历史 `12` 条和 `maxTokens: 32_768`；
- `llm.constants.ts` 维护另一份默认输出与超时；
- Tool Observation 统一限制为 `8_000` 字符；
- `search_articles` excerpt 为 `200` 字符；
- 当前没有 typed model profile，也没有环境变量上下界关系验证。

## 已确认生产基线

| 参数 | 目标值 | 归属 |
| --- | ---: | --- |
| 用户消息上限 | `64_000` 字符 | `@agent/contracts` |
| 合格历史消息 | 最近 `40` 条 `COMPLETED` | Agent Runtime policy |
| DeepSeek context window | `1_000_000` tokens | Provider model profile |
| DeepSeek provider max output | `384_000` tokens | Provider model profile |
| 应用默认最大输出 | `65_536` tokens | LLM runtime config |
| 应用输出硬上限 | `131_072` tokens | LLM runtime config |
| 普通 Chat timeout | `60_000ms` | LLM runtime config |
| 元数据请求 timeout | `10_000ms` | LLM runtime config |
| Stream timeout | `600_000ms` | LLM runtime config |
| Search excerpt | `500` 字符 | Article Tool policy |
| Search Observation | `16_000` 字符 | Tool policy |
| Detail Observation | `64_000` 字符 | Tool policy |
| Observation 全局硬上限 | `128_000` 字符 | Tool core policy |
| 搜索默认 / 最大条数 | 保持 `5 / 10` | Article Tool policy |
| 本地只读 DB Tool timeout | 保持 `5_000ms` | Tool Definition |

Provider 能力来自 DeepSeek 官方文档，但 Provider 极限不等于应用默认值。

## 架构边界

```text
packages/contracts
  -> 前后端共享的公开产品限制

apps/api/src/llm
  -> Provider model profile
  -> 应用默认值、硬上限、环境覆盖和校验

apps/api/src/agent-runtime
  -> 历史等非 Loop 运行策略

apps/api/src/tools/core
  -> Observation 全局硬上限和通用规范化

apps/api/src/tools/articles
  -> excerpt、结果数和工具级 Observation 预算
```

约束：

- 不创建万能 constants 文件；
- 不让 Vue、DTO 和 Service 复制同一数值；
- 不在 Runtime 中按工具名硬编码 Observation 预算；
- 非法环境配置必须 fail fast，不静默 clamp；
- 公开契约和业务规则不使用运行时环境覆盖；
- 运维型参数允许环境变量覆盖，并记录单位和默认值。

## 实现范围

- 在 contracts 中导出共享消息字符上限；
- API DTO、Vue maxlength 和字符计数使用同一来源；
- 建立 DeepSeek V4 Flash / Pro typed model profiles；
- 建立 LLM runtime config、严格整数解析和上下界验证；
- 分离普通 Chat、metadata 和 stream timeout；
- 移除 `SeoService` 中历史和输出 magic number；
- 历史默认调整为 40，并只加载 `COMPLETED` 消息；
- Search excerpt 调整为 500，结果数仍保持 5 / 10；
- Tool Definition 或等价工具策略声明模型可见 Observation 预算；
- Search / Detail 使用 16K / 64K，并受 128K 全局硬上限保护；
- 保留 Unicode code point 安全截断、Tool timeout、Abort 和错误语义；
- 更新 `.env.example`、测试和直接相关文档。

## 明确不在本次范围

- 不实现有界 Agent Loop；
- 不修改固定 `[1, 2]` sampling；
- 不向模型开放 `get_article_detail`；
- 不实现 `maxSamplingRounds`、`maxToolCalls` 或 Run deadline；
- 不实现 DeepSeek `reasoning_content` continuation；
- 不关闭 thinking mode 回避 continuation；
- 不实现 TokenEstimator、精确 input token budget、自动历史裁剪、摘要或 Compaction；
- 不修改 Prisma schema、Chat / NDJSON 协议；
- 不推进 Phase 6 Task 1 实现。

## 验收标准

| ID | 可观察行为 | 验证方式 |
| --- | --- | --- |
| AC-01 | API 与 Web 共享 `64_000` 消息上限，无重复 magic number | contracts / API / Web 测试 + `rg` |
| AC-02 | Model Profile 区分 1M / 384K Provider 能力与 65,536 / 131,072 应用策略 | Profile 单测 |
| AC-03 | 非法环境值及上下界关系错误 fail fast | Config 单测 |
| AC-04 | Chat / metadata / stream timeout 分别为 60s / 10s / 10min | Client 单测 |
| AC-05 | 最近 40 条 `COMPLETED` 消息进入模型历史，非终态消息被排除且顺序稳定 | Runtime 测试 |
| AC-06 | 当前输入在模型历史中恰好出现一次 | Runtime 测试 |
| AC-07 | Search excerpt 为 500，结果数保持 5 / 10 | Tool 回归测试 |
| AC-08 | Search / Detail Observation 分别执行 16K / 64K 预算，完整 data 与模型 Observation 继续分层 | Tool / Runtime 测试 |
| AC-09 | 所有 Observation 都受 128K 全局硬上限保护 | Tool core 测试 |
| AC-10 | Unicode 安全、截断提示和字符统计确定 | Tool core 测试 |
| AC-11 | 当前工具 allowlist、固定两轮 Runtime、Chat / NDJSON 协议不变 | Tool Loop / Model Stream 回归 |
| AC-12 | `.env.example`、Task 状态和 PR 证据真实一致 | docs diff |

## 实现结果

### 配置职责与文件结构

```text
packages/contracts/src/seo.ts
  -> SEO_CHAT_MESSAGE_MAX_CHARS（API / Web 共享运行时 export）

apps/api/src/llm/model-profiles.ts
  -> DeepSeek V4 Flash / Pro Provider Profile（1M context / 384K output）

apps/api/src/llm/llm-runtime-config.ts
  -> 代码默认值、环境覆盖、严格解析、关系校验与调用级输出校验

apps/api/src/agent-runtime/agent-runtime.policy.ts
  -> 最近 Completed 历史条数策略

apps/api/src/tools/core/tool-observation.ts
  -> Unicode code point 安全规范化与 128K 全局硬上限

apps/api/src/tools/articles/*.tool.ts
  -> excerpt、结果数、Tool timeout 与工具级 Observation 预算
```

- `@agent/contracts` 新增真实 ESM 编译产物与 package export；API 将它声明为运行时 `dependencies`，API / Web 的 dev、build 流程会先构建 contracts；
- `LLMRuntimeConfigService` 由 `LlmModule` 直接注册，Nest 创建应用上下文时立即解析配置；`main.ts` 只有在 `NestFactory.create(AppModule)` 成功后才会执行 `listen`；
- Provider Client 只读取已经验证的配置对象，不再在各方法中读取 `process.env`；
- 普通 Chat、metadata 和 Stream 分别使用 60s、10s、10min，Tool timeout 继续来自各 Tool Definition；
- Runtime 查询最近 40 条 `COMPLETED` 消息，以 `createdAt DESC, id DESC` 稳定排序；当前用户消息先持久化后纳入这 40 条且只出现一次；
- Tool Definition 声明 Observation 预算，Runtime 不按工具名分支；通用规范化始终以 128K 为不可绕过的上限；
- 固定 `[1, 2]` sampling、当前 `search_articles` allowlist、同步 / 流式协议和 `get_article_detail` 未开放状态保持不变。

### Fail-fast 与运行时依赖证据

- `LlmModule` 真实组装测试覆盖缺省配置、非法整数、默认输出大于应用硬上限、应用硬上限大于 Provider 上限，均在应用上下文初始化阶段完成或失败；
- Client 测试确认调用级非法模型 / 输出预算不会触发 Provider 请求，并确认初始化后的 `process.env` 变化不会改变请求；
- `pnpm --filter @agent/contracts build` 生成 `dist/index.js` / `dist/seo.js`，API 编译产物保留 `@agent/contracts` 运行时 import；
- `pnpm --filter @agent/api deploy --legacy --prod <临时目录>/api` 后，从隔离生产依赖目录加载 API DTO 与 `@agent/contracts` 成功，输出 `{"productionDeploy":true,"dtoLoaded":true,"contractLimit":64000}`；
- Web production build 把共享常量打包为 `64e3` 并绑定到输入 `maxlength` 与字符计数。

### Red / Green 记录

- Red：新增测试首次运行时 6 个测试文件失败；除待实现模块不存在外，DTO 测试真实暴露 `ERR_PACKAGE_PATH_NOT_EXPORTED`，证明原 contracts 只有 TypeScript 类型出口；
- Green：实现 package runtime export、配置、Runtime 和 Tool 策略后，新增与既有回归测试全部通过；
- 实施中 `test:tools` 曾因新增 excerpt 断言使用的测试正文不足 500 字符而 1 项失败；扩大测试 fixture 后 33 / 33 通过，生产实现未为该失败降级；
- 生产依赖隔离验证首次使用 pnpm v10 默认 deploy 模式时得到 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`；按提示改用 `--legacy` 后完成 prod-only 部署与运行时 import 验证。

### 验收追踪

| 验收项 | 实现位置 | 当前证据 |
| --- | --- | --- |
| AC-01 | contracts、DTO、Vue | DTO 64K 边界测试；API / Web build；`rg` 仅共享契约保留生产 64K 定义 |
| AC-02 | `model-profiles.ts`、`llm-runtime-config.ts` | Profile / Config 单测 |
| AC-03 | `llm-runtime-config.ts`、`llm.module.test.ts` | 严格整数、关系校验、Nest 初始化失败测试 |
| AC-04 | `openai-compatible.client.ts` | Client metadata / Chat / Stream timeout 测试 |
| AC-05 | `agent-runtime.policy.ts`、Runtime 查询 | 40 条 Completed、排除非终态、稳定排序测试 |
| AC-06 | `agent-runtime.service.test.ts` | 当前输入只出现一次测试 |
| AC-07 | `search-articles.tool.ts` | 500 字符 excerpt、5 / 10 条数回归 |
| AC-08 | Tool Definition、Runtime | Search 16K / Detail 64K；Step 不保存完整 data |
| AC-09 | `tool-observation.ts` | 工具声明 256K 时仍截断到 128K |
| AC-10 | `tool-observation.ts` | Emoji、确定性 envelope 与字符统计测试 |
| AC-11 | Agent Runtime / Model Stream | 24 个 Tool Loop 与 37 个 Model Stream 回归 |
| AC-12 | `.env.example`、本任务文档、看板、roadmap、work log | 文档 diff 与 `git diff --check` |

## 验证命令

Codex 必须先核对实际脚本，至少运行：

```bash
pnpm --filter @agent/api test:tools
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api test:seo-service
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm --filter @agent/web typecheck
pnpm --filter @agent/web lint
pnpm --filter @agent/web build
pnpm typecheck
git diff --check
```

实际结果：

| 命令 | 文件数 | suite 数 | test 数 | 结果 |
| --- | ---: | ---: | ---: | --- |
| `pnpm --filter @agent/api test:llm-config` | 4 | 5 | 17 | PASS |
| `pnpm --filter @agent/api test:tools` | 7 | 7 | 33 | PASS |
| `pnpm --filter @agent/api test:tool-loop` | 2 | 3 | 24 | PASS |
| `pnpm --filter @agent/api test:model-stream` | 3 | 5 | 37 | PASS |
| `pnpm --filter @agent/api test:seo-service` | 2 | 2 | 10 | PASS |
| `pnpm --filter @agent/api typecheck` | — | — | — | PASS |
| `pnpm --filter @agent/api lint` | — | — | — | PASS |
| `pnpm --filter @agent/web typecheck` | — | — | — | PASS |
| `pnpm --filter @agent/web lint` | — | — | — | PASS |
| `pnpm --filter @agent/web build` | — | — | — | PASS；仅有既有 `@vueuse/core` PURE annotation warning |
| `pnpm typecheck` | 4 个 workspace | — | — | PASS |
| `pnpm --filter @agent/contracts build` | — | — | — | PASS |
| `pnpm --filter @agent/api build` | — | — | — | PASS |
| prod-only deploy + API DTO / contracts runtime import | — | — | — | PASS |
| `git diff --check` | — | — | — | PASS |

补充运行的 `pnpm lint` 仍为既有非阻塞基线失败：101 个错误全部位于未修改的 `docs/research/**` Markdown 代码片段；本任务修改范围已分别通过 API lint、Web lint，并单独通过 contracts `tsconfig.json` lint。

## GitHub 交付记录

- Issue：[#27](https://github.com/mufeiyu-ayu/agent/issues/27)
- 分支：`codex/issue-27-runtime-configuration-governance`
- PR：待创建 Draft PR
- GPT 验收结论：未提供
- 用户确认：未确认
