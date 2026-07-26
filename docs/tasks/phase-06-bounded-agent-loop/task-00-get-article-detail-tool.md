# Task 0：新增 `get_article_detail` 只读工具

## 任务状态

- 看板状态：**Active**
- 实施状态：已实现
- 验收状态：待验收
- Issue：[#25](https://github.com/mufeiyu-ayu/agent/issues/25)
- 分支：`codex/issue-25-get-article-detail`
- PR：待创建（Draft）

## 目标

在不修改当前 Agent Runtime Loop 的前提下，新增第二个低风险、只读、无外部网络的业务工具 `get_article_detail`。

该工具根据 `search_articles` 返回的 `sourceId` 查询一篇文章详情，为后续“搜索候选 -> 读取详情 -> 最终分析”的多步骤 Agent Loop 提供第二个真实动作。

Task 0 只建立工具能力和确定性测试，不让模型在生产 Runtime 中开始连续调用两个工具；Runtime 暴露与循环升级留给 Task 1。

## 当前代码事实

- `search_articles` 已返回 `sourceId`、`slug`、`languageCode`、标题、SEO 字段和精简 `excerpt`；
- `Article.sourceId` 在 Prisma 中唯一，适合作为搜索结果与详情查询之间的稳定业务标识；
- 统一工具边界已经存在：`ToolDefinition`、`ToolRegistryService`、`ToolInvocationService`、`ToolResult`；
- 当前 Runtime 只筛选并暴露 `search_articles`，因此仅注册新工具不会自动改变现有模型行为；
- `Article` 当前字段包括 `sourceId`、`slug`、`languageCode`、`title`、`content`、`seoTitle`、`seoDescription`、`createdAt`、`updatedAt`。

## Issue #25 确认的目录边界

```text
apps/api/src/tools/
├── core/
│   ├── tool.types.ts
│   ├── tool.errors.ts
│   ├── tool-registry.service.ts
│   ├── tool-invocation.service.ts
│   ├── tool-observation.ts
│   ├── model-tool-spec.mapper.ts
│   └── 对应职责测试
├── articles/
│   ├── search-articles.tool.ts
│   ├── search-articles.tool.test.ts
│   ├── get-article-detail.tool.ts
│   └── get-article-detail.tool.test.ts
├── tools.module.ts
└── tools.module.test.ts
```

- `core/` 只保存通用 Tool 基础设施，不依赖 Article 业务类型；
- `articles/` 保存 Article 领域的具体工具；
- 根目录只保留 Nest 模块组装及其测试；
- 不新增 BaseTool、Factory、Repository、复杂 Decorator、每工具一个 Module 或 barrel `index.ts`。

## 学习重点

- 搜索型工具与详情型工具为什么应拆成两个职责明确的动作；
- 模型如何使用前一个 Observation 中的业务 ID 构造下一次 Tool Call；
- Tool Definition、运行时参数解析、数据库查询和模型可见投影的边界；
- “资源不存在”为什么是可预期业务结果，而不是不可解释的 HTTP 500；
- 为什么 Task 0 不应顺手重构 Runtime Loop。

## 推荐契约方向

最终字段在 Issue Clarification Gate 中结合真实代码确认，最小方向为：

```ts
interface GetArticleDetailInput {
  sourceId: number
}

interface GetArticleDetailOutput {
  sourceId: number
  found: boolean
  article: null | {
    sourceId: number
    slug: string
    languageCode: string
    title: string
    content: string
    seoTitle: string | null
    seoDescription: string | null
    createdAt: string
    updatedAt: string
  }
}
```

设计约束：

- 模型输入只接受 `sourceId`，禁止额外字段；
- `sourceId` 必须是大于 0 的整数；
- 找不到文章时返回确定性的 `found: false` 业务结果，使模型后续可以解释或选择其他候选；
- 数据库或执行异常继续由统一 `ToolInvocationService` 转换为受控失败；
- `modelContent` 使用结构稳定、字段受控的投影，不暴露 Prisma 内部对象；
- 不把完整数据库错误、stack、secret 或任意内部字段返回模型。

## 范围

- 新增 `get_article_detail` Tool Definition、输入 parser 和 Executor；
- 使用 `Article.sourceId` 查询单篇文章；
- 返回受控文章字段和确定性 `modelContent`；
- 在 `ToolsModule` 中注册新工具；
- 补充工具级和统一 Invocation 级测试；
- 验证新工具定义的风险元数据：低风险、无副作用、不联网、无需审批、幂等；
- 保持当前 Runtime 仍只向模型暴露 `search_articles`；
- 更新与本 Task 直接相关的 docs 状态和交付记录。

## 不做什么

- 不修改 `AgentRuntimeService` 的固定两轮逻辑；
- 不向模型同时暴露两个工具；
- 不实现多步骤 Agent Loop；
- 不修改 Prisma schema 或创建 migration；
- 不修改 `search_articles` 的现有对外行为；
- 不实现写文章、更新 SEO 字段或发布文章；
- 不引入 RAG、Embedding 或向量数据库；
- 不新增 Permission / Approval；
- 不实现通用 Context Budget、摘要或 Compaction；
- 不推进 Task 1。

## Red：先定义失败用例

- [x] `sourceId` 缺失、非整数、非正数或包含额外字段时，输入验证必须失败；
- [x] 存在文章时，工具必须返回完整的受控详情字段；
- [x] 不存在文章时，工具必须返回确定性的业务零结果，而不是抛出未处理异常；
- [x] 数据库异常必须走统一受控失败路径；
- [x] 模型可见输出不得包含未允许字段、stack 或内部错误；
- [x] 工具注册后，Runtime 当前暴露的模型工具列表仍只包含 `search_articles`；
- [x] Abort / signal 已触发时，不应产生伪造成功结果。

## Green：最小实现

- [x] 定义 `getArticleDetailDefinition`、输入和输出类型；
- [x] 实现严格 parser；
- [x] 实现只读 Executor 与受控字段选择；
- [x] 返回 `found: true / false` 的确定性业务结果；
- [x] 注册到现有 Tool Registry；
- [x] 补充工具单测和统一 Invocation 回归；
- [x] 保持 Agent Runtime 行为和外部 Chat 协议不变。

## Refactor：整理边界

- [x] 搜索摘要类型和详情类型命名清楚，不复用 Prisma Model 作为模型契约；
- [x] 输入解析、数据库查询和模型投影职责可区分；
- [x] 不为了两个工具建立通用 Repository、BaseTool 或复杂框架；
- [x] 未提取没有两个真实用例支撑的共享 helper。

## 建议影响范围

Issue Clarification Gate 已确认并落地：

```text
apps/api/src/tools/core/**
apps/api/src/tools/articles/**
apps/api/src/tools/tools.module.ts
apps/api/src/tools/tools.module.test.ts
apps/api/src/agent-runtime/agent-runtime.service.test.ts
```

只做目录 import 迁移或只读确认：

```text
prisma/schema.prisma
apps/api/src/agent-runtime/agent-runtime.service.ts
apps/api/src/agent-runtime/model-sampling-decision.ts
apps/api/src/llm/model-tool-spec.types.ts
```

## 验证命令

至少运行与实际改动匹配的命令：

```bash
pnpm --filter @agent/api test:tools
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

如果新增独立测试脚本，PR 必须记录真实命令和测试数量；不得引用不存在的命令。

## 实现与验证结果

- Tool 核心设施已迁移到 `core/`，Article 工具已迁移到 `articles/`，旧平铺文件未重复保留；
- `search_articles` 生产实现除相对 import 外未改动；回归继续锁定 query、select、排序、默认 / 最大 limit、200 字符 excerpt、输出和风险元数据；
- `get_article_detail` 使用 `sourceId` 唯一查询和显式 Prisma `select`，日期转换为 ISO 字符串，`modelContent` 使用固定 JSON 投影；
- Runtime 测试中的 Registry 同时包含两个工具，模型两轮 sampling 仍只收到 `search_articles`；
- `test:tools` 真实发现 7 个测试文件对应的 7 个 suite，共执行 30 个测试并全部通过。

```text
pnpm --filter @agent/api test:tools       30 passed，7 suites / 7 files
pnpm --filter @agent/api test:tool-loop   20 passed
pnpm --filter @agent/api test:model-stream 35 passed
pnpm --filter @agent/api typecheck        passed
pnpm --filter @agent/api lint             passed
pnpm typecheck                            passed
git diff --check                          passed
```

## 验收标准

- [x] 存在 `get_article_detail` 的项目自有 Definition、输入 parser 和 Executor；
- [x] 工具只接受合法正整数 `sourceId`，拒绝额外字段；
- [x] 命中文章时返回受控详情字段，未命中时返回确定性 `found: false`；
- [x] 工具保持低风险、无副作用、不联网、无需审批和幂等；
- [x] 工具通过统一 Registry 与 Invocation 路径执行，不被 Controller 或 Runtime 特殊调用；
- [x] 不新增数据库表或 migration；
- [x] 当前 Runtime 模型工具列表和两轮 Tool Loop 行为不变；
- [x] 不持久化或暴露完整内部错误、stack、secret 或未允许字段；
- [x] Tools、Tool Loop、Model Stream 回归、API typecheck / lint、workspace typecheck 和 `git diff --check` 通过；
- [ ] 用户能够解释搜索工具与详情工具为何拆分，以及 `sourceId` 如何成为两次模型决策之间的业务关联。

## 风险点

| 风险 | 应对 |
| --- | --- |
| Task 0 顺手修改 Runtime Loop | 明确保持 Runtime 只暴露 `search_articles`，循环升级留到 Task 1 |
| 详情工具直接返回 Prisma Model | 使用显式 select 和项目自有输出类型 |
| 资源不存在被当作系统故障 | 返回确定性业务零结果，允许后续模型决策 |
| 正文过大触发现有 Observation 保护上限 | 详情工具保留完整受控正文；不修改既有 Observation 上限，也不在本 Task 建通用 Context 系统 |
| 为第二个工具过度抽象 | 只提取被现有搜索工具和详情工具共同证明的最小逻辑 |

## GitHub 交付记录

仅在本任务进入正式实现后填写。

- Issue：[#25](https://github.com/mufeiyu-ayu/agent/issues/25)
- 分支：`codex/issue-25-get-article-detail`
- PR：待创建（Draft）
- GPT 验收结论：未提供
- 用户确认：未确认
