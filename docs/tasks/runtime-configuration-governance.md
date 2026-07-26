# 横向工程任务：Agent / LLM 运行参数与模型配置治理

## 任务状态

- 看板状态：**Next（Issue 已创建，待 Clarification Gate）**
- 实施状态：未开始
- 验收状态：未验收
- Issue：[#27](https://github.com/mufeiyu-ayu/agent/issues/27)
- 分支：未创建
- PR：未创建
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

## 当前代码事实

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
| AC-05 | 最近 40 条 `COMPLETED` 消息进入模型历史，当前输入恰好一次 | Runtime 测试 |
| AC-06 | Search excerpt 为 500，结果数保持 5 / 10 | Tool 回归测试 |
| AC-07 | Search / Detail Observation 分别执行 16K / 64K 预算 | Tool / Runtime 测试 |
| AC-08 | 所有 Observation 都受 128K 全局硬上限保护 | Tool core 测试 |
| AC-09 | Unicode 安全、截断提示和字符统计确定 | Tool core 测试 |
| AC-10 | Tool Result 完整 data 与模型 Observation 仍分层 | Tool / Runtime 测试 |
| AC-11 | 当前工具 allowlist、固定两轮 Runtime、Chat / NDJSON 协议不变 | Tool Loop / Model Stream 回归 |
| AC-12 | `.env.example`、Task 状态和 PR 证据真实一致 | docs diff |

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

## GitHub 交付记录

- Issue：[#27](https://github.com/mufeiyu-ayu/agent/issues/27)
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
