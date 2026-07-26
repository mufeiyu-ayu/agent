# Task 0：新增 `get_article_detail` 只读工具

## 任务状态

- 看板状态：**Next**
- 实施状态：未开始
- 验收状态：未验收
- Issue：未创建
- PR：未创建

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

- [ ] `sourceId` 缺失、非整数、非正数或包含额外字段时，输入验证必须失败；
- [ ] 存在文章时，工具必须返回完整的受控详情字段；
- [ ] 不存在文章时，工具必须返回确定性的业务零结果，而不是抛出未处理异常；
- [ ] 数据库异常必须走统一受控失败路径；
- [ ] 模型可见输出不得包含未允许字段、stack 或内部错误；
- [ ] 工具注册后，Runtime 当前暴露的模型工具列表仍只包含 `search_articles`；
- [ ] Abort / signal 已触发时，不应产生伪造成功结果。

## Green：最小实现

- [ ] 定义 `getArticleDetailDefinition`、输入和输出类型；
- [ ] 实现严格 parser；
- [ ] 实现只读 Executor 与受控字段选择；
- [ ] 返回 `found: true / false` 的确定性业务结果；
- [ ] 注册到现有 Tool Registry；
- [ ] 补充工具单测和统一 Invocation 回归；
- [ ] 保持 Agent Runtime 行为和外部 Chat 协议不变。

## Refactor：整理边界

- [ ] 搜索摘要类型和详情类型命名清楚，不复用 Prisma Model 作为模型契约；
- [ ] 输入解析、数据库查询和模型投影职责可区分；
- [ ] 不为了两个工具建立通用 Repository、BaseTool 或复杂框架；
- [ ] 若提取共享 helper，只限于被两个真实用例证明的逻辑。

## 建议影响范围

最终路径由 Issue Clarification Gate 结合最新仓库确认，预计重点涉及：

```text
apps/api/src/tools/get-article-detail.tool.ts
apps/api/src/tools/get-article-detail.tool.test.ts
apps/api/src/tools/tools.module.ts
apps/api/src/tools/tools.test.ts
```

可能需要读取但原则上不修改：

```text
apps/api/src/tools/search-articles.tool.ts
apps/api/src/tools/tool.types.ts
apps/api/src/tools/tool-invocation.service.ts
prisma/schema.prisma
apps/api/src/agent-runtime/agent-runtime.service.ts
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

## 验收标准

- [ ] 存在 `get_article_detail` 的项目自有 Definition、输入 parser 和 Executor；
- [ ] 工具只接受合法正整数 `sourceId`，拒绝额外字段；
- [ ] 命中文章时返回受控详情字段，未命中时返回确定性 `found: false`；
- [ ] 工具保持低风险、无副作用、不联网、无需审批和幂等；
- [ ] 工具通过统一 Registry 与 Invocation 路径执行，不被 Controller 或 Runtime 特殊调用；
- [ ] 不新增数据库表或 migration；
- [ ] 当前 Runtime 模型工具列表和两轮 Tool Loop 行为不变；
- [ ] 不持久化或暴露完整内部错误、stack、secret 或未允许字段；
- [ ] Tools、Tool Loop、Model Stream 回归、API typecheck / lint、workspace typecheck 和 `git diff --check` 通过，或明确记录既有非阻塞基线；
- [ ] 用户能够解释搜索工具与详情工具为何拆分，以及 `sourceId` 如何成为两次模型决策之间的业务关联。

## 风险点

| 风险 | 应对 |
| --- | --- |
| Task 0 顺手修改 Runtime Loop | 明确保持 Runtime 只暴露 `search_articles`，循环升级留到 Task 1 |
| 详情工具直接返回 Prisma Model | 使用显式 select 和项目自有输出类型 |
| 资源不存在被当作系统故障 | 返回确定性业务零结果，允许后续模型决策 |
| 正文过大触发现有 Observation 保护上限 | 先核对当前 fixtures 与真实字段；保持结构化投影和明确截断标记，不在本 Task 建通用 Context 系统 |
| 为第二个工具过度抽象 | 只提取被现有搜索工具和详情工具共同证明的最小逻辑 |

## GitHub 交付记录

仅在本任务进入正式实现后填写。

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
