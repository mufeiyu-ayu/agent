# 横向工程任务：Agent / LLM 运行参数与模型配置治理

## 任务状态

- 看板状态：**Completed**
- 实施状态：已实现
- 验收状态：已通过
- 完成日期：2026-07-26
- Issue：[#27（Closed）](https://github.com/mufeiyu-ayu/agent/issues/27)
- PR：[#28（Merged）](https://github.com/mufeiyu-ayu/agent/pull/28)
- 实现分支：`codex/issue-27-runtime-configuration-governance`（已清理）
- 最终验收提交：`575983d741b951c9d3d75c23471bd67d828bcaa3`
- Merge commit：`4a50c18c175a345251b4d4512849a612145f3a2f`
- 阶段关系：本任务不占用 Phase 6 Task 编号；完成后 Phase 6 Task 1 成为下一项正式主线

## 目标

把原先分散在 DTO、Vue、SEO Service、LLM Client、Agent Runtime 和 Tool 中的运行参数，整理为职责清晰、可验证、接近生产使用的配置体系。

本任务解决：

```text
公开产品限制重复定义
模型能力与应用默认值混在一起
运维参数缺少严格环境变量解析
历史消息、输出长度与超时存在 magic number
Search / Detail Tool 无法使用不同 Observation 预算
```

本任务没有实现有界 Agent Loop，也没有创建万能 `common/constants.ts`。

## 最终生产基线

| 参数 | 最终值 | 归属 |
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
| Search Observation | `16_000` 字符 | Tool Definition |
| Detail Observation | `64_000` 字符 | Tool Definition |
| Observation 全局硬上限 | `128_000` 字符 | Tool core policy |
| 搜索默认 / 最大条数 | `5 / 10` | Article Tool policy |
| 本地只读 DB Tool timeout | `5_000ms` | Tool Definition |

Provider 能力与应用策略保持分层：Provider 的 384K 最大输出不是应用默认输出；本任务也没有建立精确 input token budget。

## 最终架构边界

```text
packages/contracts/src/seo.ts
  -> SEO_CHAT_MESSAGE_MAX_CHARS
  -> API / Web 共享公开产品限制

apps/api/src/llm/model-profiles.ts
  -> DeepSeek Provider 能力

apps/api/src/llm/llm-runtime-config.ts
  -> 应用默认值、硬上限、环境覆盖、严格解析和调用级校验

apps/api/src/agent-runtime/agent-runtime.policy.ts
  -> 合格历史消息条数策略

apps/api/src/tools/core/tool-observation.ts
  -> Unicode 安全规范化与 128K 全局硬上限

apps/api/src/tools/articles/*.tool.ts
  -> excerpt、结果数、Tool timeout 与工具级 Observation 预算
```

关键约束：

- 没有创建全局万能 constants 文件；
- Vue、DTO 和 Service 不再复制同一消息上限；
- Runtime 不按工具名硬编码 Observation 预算；
- 非法环境配置 fail fast，不静默 clamp；
- 公开契约和业务规则使用版本控制内的常量；
- 运维型参数可由环境变量覆盖，并严格验证单位、范围和上下界关系。

## 核心实现结果

### 共享运行时契约

- `@agent/contracts` 提供真实 ESM runtime export；
- API 将 `@agent/contracts` 声明为运行时 dependency；
- API DTO 与 Vue Composer 共同使用 `SEO_CHAT_MESSAGE_MAX_CHARS = 64_000`；
- API / Web dev、build 流程会在需要时先构建 contracts；
- prod-only deploy 验证 API DTO 可以在仅生产依赖环境中加载 contracts runtime export。

### Model Profile 与配置校验

- `deepseek-v4-flash` 和 `deepseek-v4-pro` 均记录 1M context、384K Provider 最大输出；
- 应用默认输出 65,536，应用硬上限 131,072；
- `LLMRuntimeConfigService` 在 Nest 初始化阶段解析配置；
- 空值、0、负数、浮点数、指数、NaN、Infinity、非安全整数和越界关系均被拒绝；
- Provider Client 只读取已验证配置对象，不在不同方法中分散读取 `process.env`；
- 调用级非法模型或输出预算不会发起 Provider 请求。

### 历史消息策略

- 默认读取最近 40 条 `MessageStatus.COMPLETED`；
- `PENDING / STREAMING / FAILED / ABORTED` 不进入模型历史；
- 查询使用 `createdAt DESC, id DESC` 保持稳定顺序，再恢复正序交给模型；
- 当前用户消息继续采用“先持久化、再查询”的既有语义，在模型输入中恰好出现一次。

### Tool Observation 预算

- `ToolDefinition` 声明服务端专用 `maxObservationChars`；
- `search_articles` 使用 16K，`get_article_detail` 使用 64K；
- 通用规范化层始终强制 128K 全局硬上限；
- Unicode code point、确定性截断提示、`originalChars / observationChars / truncated` 语义保持；
- `ToolResult.data` 与模型可见 Observation 继续分层，durable AgentStep 不保存完整正文数据。

### 回归边界

- 固定 `[1, 2]` sampling 结构未改变；
- 当前 Runtime 仍只向模型暴露并允许执行 `search_articles`；
- `get_article_detail` 已注册并声明 64K 预算，但仍未向模型开放；
- Chat / NDJSON 协议、Abort、Tool timeout 和现有错误语义保持不变；
- 未实现 DeepSeek `reasoning_content` continuation、TokenEstimator、自动历史裁剪、摘要或 Compaction。

## 验收结果

| ID | 可观察行为 | 结果 |
| --- | --- | --- |
| AC-01 | API 与 Web 共享 `64_000` 消息上限，无重复生产 magic number | PASS |
| AC-02 | Provider Profile 与应用默认值 / 硬上限分层 | PASS |
| AC-03 | 非法环境值及上下界关系错误 fail fast | PASS |
| AC-04 | Chat / metadata / stream timeout 分别为 60s / 10s / 10min | PASS |
| AC-05 | 最近 40 条 `COMPLETED` 进入模型历史，非终态消息被排除且顺序稳定 | PASS |
| AC-06 | 当前输入在模型历史中恰好出现一次 | PASS |
| AC-07 | Search excerpt 为 500，结果数保持 5 / 10 | PASS |
| AC-08 | Search / Detail 分别执行 16K / 64K Observation 预算 | PASS |
| AC-09 | 所有 Observation 受 128K 全局硬上限保护 | PASS |
| AC-10 | Unicode 安全、截断提示和字符统计确定 | PASS |
| AC-11 | 当前 allowlist、固定两轮 Runtime 和外部协议不变 | PASS |
| AC-12 | `.env.example`、任务状态和交付证据一致 | PASS |

## 最终验证证据

| 命令 | 文件数 | suite 数 | test 数 | 结果 |
| --- | ---: | ---: | ---: | --- |
| `pnpm --filter @agent/api test:llm-config` | 4 | 5 | 17 | PASS |
| `pnpm --filter @agent/api test:tools` | 7 | 7 | 33 | PASS |
| `pnpm --filter @agent/api test:tool-loop` | 2 | 3 | 24 | PASS |
| `pnpm --filter @agent/api test:model-stream` | 3 | 5 | 37 | PASS |
| `pnpm --filter @agent/api test:seo-service` | 2 | 2 | 10 | PASS；清洁环境自动先构建 contracts |
| `pnpm --filter @agent/api typecheck` | — | — | — | PASS |
| `pnpm --filter @agent/api lint` | — | — | — | PASS |
| `pnpm --filter @agent/web typecheck` | — | — | — | PASS |
| `pnpm --filter @agent/web lint` | — | — | — | PASS |
| `pnpm --filter @agent/web build` | — | — | — | PASS |
| `pnpm --filter @agent/contracts build` | — | — | — | PASS |
| `pnpm --filter @agent/api build` | — | — | — | PASS |
| `pnpm typecheck` | 4 workspaces | — | — | PASS |
| prod-only deploy + API DTO / contracts runtime import | — | — | — | PASS |
| `git diff --check` | — | — | — | PASS |

清洁环境复验确认：contracts `dist` 不存在时，LLM Config、Tools、Tool Loop 和 Model Stream 可独立运行且不会生成 `dist`；`test:seo-service` 会显式构建 contracts，然后完成 2 个文件、2 个 suite、10 个测试。

全仓 `pnpm lint` 仍受既有 `docs/research/**` Markdown 代码片段基线影响；本任务修改范围的 API / Web lint、contracts 配置检查均通过。

## Review 与验收记录

- Codex Review 初次发现 1 个 P2：清洁 checkout 下 `test:seo-service` 依赖未声明的 contracts 预构建；
- 修复提交 `575983d741b951c9d3d75c23471bd67d828bcaa3` 为测试命令增加显式 contracts build；
- 原 P2 thread 已解决并过时；
- Codex 对最新提交复审未发现 major issues；
- GPT 基于最新提交、Issue、PR diff、Review 和测试证据完成技术验收；
- 用户已明确授权验收、合并和 docs 收口。

## 明确未做

- 有界 Agent Loop 与多次 Tool Call；
- `maxSamplingRounds`、`maxToolCalls` 和 Run deadline；
- DeepSeek `reasoning_content` continuation 或 thinking mode 切换；
- TokenEstimator、精确 input token budget、自动历史裁剪、摘要或 Compaction；
- RAG、Memory、Permission、Approval、HITL；
- 向模型开放 `get_article_detail`。

## GitHub 交付记录

- Issue：[#27（Closed）](https://github.com/mufeiyu-ayu/agent/issues/27)
- PR：[#28（Merged）](https://github.com/mufeiyu-ayu/agent/pull/28)
- 实现分支：`codex/issue-27-runtime-configuration-governance`（已清理）
- 最终验收提交：`575983d741b951c9d3d75c23471bd67d828bcaa3`
- Merge commit：`4a50c18c175a345251b4d4512849a612145f3a2f`
- GPT 验收结论：技术验收通过
- Codex Review：最新提交未发现 major issues，原 P2 已解决
- 用户确认：已于 2026-07-26 明确授权验收、合并和文档收口

## 下一步

读取最新 `master`，为 Phase 6 Task 1「有界顺序 Agent Loop」编写正式规格并创建独立 Issue。Task 1 尚未进入实现。