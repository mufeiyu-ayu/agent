# Phase 8 Task 3B：Web Chat Source UI

状态：**Completed / Issue #60 Closed / PR #61 Merged / merge `572ad206`**。

## 1. 目标

在不解析模型任意 Markdown 引用的前提下，让 Web Chat 消费 Task 3A 的 durable `MessageGroundingV1`，展示可靠、可访问、可重载的来源状态。

本 Task 不修改 Agent finalization、Retrieval ranking、数据库 Grounding schema 或 Admin Inspector contract。

## 2. 启动与收口事实

Task 3B 的前置条件已经满足并已完成收口：

- Task 3A 已完成 GPT 技术验收与用户确认；
- Issue #58 已关闭，PR #59 已合并，merge `d6df7ac1`；
- `ConversationMessage.grounding` 与 `done.grounding` 已稳定；
- Grounding version、outcome、Citation identity 与 malformed fallback 已定案；
- Issue #60 已创建并完成 Clarification Gate，结论 `READY`；
- 实现分支：`codex/issue-60-web-source-ui`；
- 最终实现 head：`516dbd3ffd22a0d3adc83ce3166c4f5a8225b13d`；
- GPT 基于最新 head 完成两轮技术验收，AC-01～AC-12 全部 PASS；
- 用户于 2026-08-16 明确确认验收，并授权 Draft 转 Ready、合并与 docs 收口；
- PR #61 已转 Ready 并通过 merge commit `572ad206271c0089eccc83e2a307bdb7909beeb1` 合入 `master`；
- Issue #60 已由 `Closes #60` 自动关闭；
- 远程任务分支保留，本次未获得删除分支的明确授权。

## 3. 已确认交互决策

| ID | 决策 | 说明 |
| --- | --- | --- |
| D-01 | 来源由结构化 Grounding 渲染 | 不扫描 Markdown `[1]` |
| D-02 | 来源只在 completed answer 后出现 | 校验前不显示候选 |
| D-03 | 来源编号由 UI 按 contract 顺序生成 | 模型不控制编号 |
| D-04 | legacy / 普通回答保持当前 Message UI | 无 Grounding 不显示空壳 |
| D-05 | URL 由服务端安全投影提供 | 不把模型文本拼成 href；v1 `href` 当前为 null |
| D-06 | answered / insufficient / conflicting 使用不同语义状态 | 不把“有候选”渲染成“已验证答案” |
| D-07 | malformed Grounding 按「无 Grounding」处理 | 回答正文继续显示，Grounding 区域隐藏；不展示原始 JSON、解析错误、半份 Citation 或伪造降级状态 |
| D-08 | aborted / error 不展示 completed Grounding | 避免半完成来源 |

## 4. 最终 UI 结构

```text
Assistant Reply
  ├─ Markdown answer
  └─ Grounding Panel
       ├─ Grounding status / optional partial note
       └─ Sources disclosure
            ├─ Source 1 card
            ├─ Source 2 card
            └─ ...
```

每个来源卡片最多展示：

- UI 编号；
- title；
- language；
- sectionPath；
- nullable bounded excerpt；
- source-level / chunk-level granularity。

不展示：

- sourceId / chunkId / slug / rank / strategy 作为普通用户主视觉；
- retrieval score / cosine distance；
- raw Prompt、reasoning、embedding、完整正文；
- Provider / SQL / credential 信息。

v1 `href` 固定为 `null`，因此 Source Card 使用非交互元素，不自行拼接文章路由。

## 5. 状态行为

| 状态 | Web 行为 |
| --- | --- |
| streaming | 只显示正文生成状态，不显示来源候选 |
| answered | 显示来源状态与来源卡片；excerpt 缺失时卡片仍可读 |
| insufficient + availability `none` | 显示“没有找到可用资料，无法确认” |
| insufficient + availability `unavailable` | 显示“检索能力暂不可用”，不得伪装成无资料 |
| availability `partial` | 显示“部分证据链不可用”，只展示合法 Citation |
| insufficient + availability `available` | 显示“现有资料不足以支撑结论”；Citation 标为“已检查的资料” |
| conflicting_evidence | 显示冲突提示，并列出至少两个不同来源 |
| legacy / no grounding | 当前 Message UI 不变 |
| malformed | 正文保留；Grounding 区域隐藏 |
| error | 使用现有错误状态，无 completed Grounding |
| aborted | 保留允许的 partial content，但无 completed Grounding |

## 6. 实现落点

```text
done.grounding（api/seo.ts 已有边界）
Messages API（api/conversations.ts 新增边界）
  -> utils/message-grounding.ts        normalization / done 合并 / 终态清理
  -> hooks/useSeoWorkspace.ts          state merge
  -> utils/conversation-turns.ts       只投影 COMPLETED assistant 的 Grounding
  -> types/seo.ts                      SeoConversationTurn.grounding
  -> utils/grounding-presenter.ts      outcome × availability 状态表
  -> AgentConversation.vue -> AgentAssistantReply.vue
       -> AgentGroundingPanel.vue      状态说明 + disclosure
            -> AgentSourceCard.vue     非交互来源卡片
  -> i18n/messages.ts                  zh-CN / en-US
```

Web 侧不新增另一套 Grounding contract 或校验规则，全部复用 `@agent/contracts` 的 `MessageGroundingV1` 与 `parseMessageGroundingV1()`。

## 7. 验收结果

| ID | 可观察行为 | 最终结果 |
| --- | --- | --- |
| AC-01 | answered 完成后按 Grounding 顺序展示来源卡片，支持 article-level 无 excerpt | PASS |
| AC-02 | streaming 期间不提前显示候选来源 | PASS |
| AC-03 | 页面重载后来源与实时 done 一致 | PASS |
| AC-04 | legacy / 普通回答 UI 不退化 | PASS |
| AC-05 | none、unavailable、partial、insufficient 与 conflict 使用明确不同语义 | PASS |
| AC-06 | error、server aborted、本地 Abort 不保留 completed Grounding | PASS |
| AC-07 | malformed Grounding fail closed，正文仍可读 | PASS |
| AC-08 | 不解析任意 `[1]`、模型 URL 或 slug | PASS |
| AC-09 | 来源只使用安全投影，危险 href 不可点击 | PASS |
| AC-10 | 键盘、焦点、可访问名称与 disclosure 行为可验证 | PASS |
| AC-11 | 桌面、窄屏 answered 长内容与窄屏 conflict 均无布局溢出 | PASS |
| AC-12 | Chat scroll、copy、Markdown、conversation cache 与 i18n 不退化 | PASS |

## 8. 最终验证

| 命令 | exit code | 结果 |
| --- | --- | --- |
| `pnpm --filter @agent/contracts build` | 0 | 通过 |
| `pnpm typecheck` | 0 | contracts / web / admin / api 通过 |
| `pnpm --filter @agent/web lint` | 0 | 通过 |
| `pnpm --filter @agent/web build` | 0 | 通过 |
| `pnpm --filter @agent/web test:seo-stream` | 0 | 12 / 12 pass |
| `pnpm --filter @agent/web test` | 0 | 43 / 43 pass |
| `pnpm --filter @agent/web test:e2e` | 0 | 9 / 9 pass |
| `pnpm --filter @agent/web exec playwright test --repeat-each=3` | 0 | 27 pass / 0 fail / 0 flaky |
| `git diff --check` | 0 | 通过 |

仓库根 `pnpm lint` 的既有 Markdown 报错仍保留：实现方最终记录为 exit code 1、115 errors / 0 warnings，分布在 18 个 `docs/**` 文件；本 Task 的 Web lint 单独通过。该既有基线问题不属于 Issue #60。

浏览器证据：

| 场景 | 截图 / 等价证据 |
| --- | --- |
| desktop answered + citations | `assets/task-03b/desktop-answered-sources.png` |
| narrow answered + long source content | `assets/task-03b/narrow-answered-long-sources.png` |
| desktop insufficient + unavailable | `assets/task-03b/desktop-insufficient-unavailable.png` |
| narrow conflicting + partial | `assets/task-03b/narrow-conflicting-partial.png` |
| reload consistency | 实时与 reload 后 status、Citation 数量和来源文本逐字一致的 Chromium 断言 |

## 9. 明确未做

- 修改 Task 3A backend contract；
- claim-level inline marker；
- Admin Retrieval Inspector；
- Admin Auth / RBAC；
- 外部 URL 自动抓取或预览；
- citation feedback / voting / analytics；
- 并行 Tool Call 支持。

## 10. 最终 GitHub 状态

```text
Issue：#60 Closed / Completed
PR：#61 Merged
final head：516dbd3ffd22a0d3adc83ce3166c4f5a8225b13d
merge：572ad206271c0089eccc83e2a307bdb7909beeb1
GPT 技术验收：AC-01～AC-12 PASS
用户确认：已完成
实施状态：已实现
验收状态：已通过
Task 状态：Completed
远程任务分支：保留，未获删除授权
```

下一项正式任务为 Task 3C Admin Retrieval Inspector。Task 3C 仍未创建 Issue、未执行 Gate，`Next` 不等于 `Active`。
