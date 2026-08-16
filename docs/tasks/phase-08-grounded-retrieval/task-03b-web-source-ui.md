# Phase 8 Task 3B：Web Chat Source UI

状态：**Issue #60 / Gate READY / 实施状态：已实现 / 验收状态：待验收**。

## 1. 目标

在不解析模型任意 Markdown 引用的前提下，让 Web Chat 消费 Task 3A 的 durable `MessageGroundingV1`，展示可靠、可访问、可重载的来源状态。

本 Task 不修改 Agent finalization、Retrieval ranking、数据库 Grounding schema 或 Admin Inspector contract。

## 2. 启动条件

Task 3B 的前置条件已经满足：

- Task 3A 已完成 GPT 技术验收与用户确认；
- Issue #58 已关闭，PR #59 已合并，merge `d6df7ac1`；
- `ConversationMessage.grounding` 与 `done.grounding` 已稳定；
- Grounding version、outcome、Citation identity 与 malformed fallback 已定案；
- 真实 API 已覆盖 answered 与 insufficient；conflicting、legacy、error 与 aborted 继续由确定性 fixture 和浏览器验收覆盖。

当前启动情况：

- Issue #60 已创建；
- Clarification Gate 已执行，结论 `READY`；
- 分支 `codex/issue-60-web-source-ui` 已创建；
- PR #61 已创建并保持 Draft；
- 实施状态：已实现；
- 验收状态：待验收。

本 Task 尚未 Completed，用户尚未确认最终验收，也尚未授权 Draft 转 Ready、合并或分支清理。

## 3. 已确认交互决策

| ID | 决策 | 说明 |
| --- | --- | --- |
| D-01 | 来源由结构化 Grounding 渲染 | 不扫描 Markdown `[1]` |
| D-02 | 来源只在 completed answer 后出现 | 校验前不显示候选 |
| D-03 | 来源编号由 UI 按 contract 顺序生成 | 模型不控制编号 |
| D-04 | legacy / 普通回答保持当前 Message UI | 无 Grounding 不显示空壳 |
| D-05 | URL 由服务端安全投影提供 | 不把模型文本拼成 href；v1 `href` 当前为 null |
| D-06 | answered / insufficient / conflicting 使用不同语义状态 | 不把“有候选”渲染成“已验证答案” |
| D-07 | malformed Grounding 按「无 Grounding」处理 | 回答正文继续显示，Grounding 区域隐藏；不展示原始 JSON、解析错误、半份 Citation 或伪造的降级状态（与 Issue #60 D-05 一致） |
| D-08 | aborted / error 不展示 completed Grounding | 避免半完成来源 |

## 4. 推荐 UI 结构

```text
Assistant Reply
  ├─ Markdown answer
  ├─ Grounding status badge / note
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
- nullable server-derived href；
- allowlisted internal source link；
- source-level / chunk-level granularity。

不展示：

- sourceId / chunkId 作为普通用户主视觉；
- retrieval score / cosine distance；
- raw Prompt、reasoning、embedding、完整正文；
- Provider / SQL / credential 信息。

## 5. 状态行为

| 状态 | Web 行为 |
| --- | --- |
| streaming | 只显示正文生成状态，不显示来源候选 |
| answered | 显示“来源 N”与来源卡片；excerpt 缺失时卡片仍可读 |
| insufficient + availability `none` | 显示“没有找到可用资料，无法确认” |
| insufficient + availability `unavailable` | 显示“检索能力暂不可用”，不得伪装无答案 |
| availability `partial` | 显示“部分证据链不可用”，只展示已验证来源 |
| insufficient + availability `available` | 显示“现有资料不足以支撑结论”；有 citation 时标为“检查过的资料” |
| conflicting_evidence | 显示冲突提示，并列出至少两个来源 |
| legacy / no grounding | 当前 UI 不变 |
| malformed / partial | 正文保留；来源 fail closed，不展示原始 JSON |
| error | 使用现有错误状态，无 completed 来源 |
| aborted | 包括 validated delta 重放期间中断；显示现有 partial content，但无 completed 来源 |

## 6. 实现范围

- 扩展 Web message state 保存 optional Grounding；
- `done` 事件将 Grounding 合并到当前 assistant Message；
- 历史消息加载后重建同一来源 UI；
- 新增 typed Source List / Source Card；
- 保持 Markdown renderer `html: false` 与 link safety；
- 来源链接使用服务端提供的安全路径；
- copy action 默认只复制回答正文，不把内部 source metadata 混入剪贴板；
- i18n 文案同时覆盖 outcome 与 `available / partial / none / unavailable`；
- keyboard、focus、screen reader label 与响应式布局；
- 真实 Chromium 覆盖桌面和窄屏关键路径。

## 7. 验收标准

| ID | 可观察行为 | 验证方式 |
| --- | --- | --- |
| AC-01 | answered 完成后展示与 Grounding 顺序一致的来源卡片，支持 source-level 无 excerpt | Component + Browser |
| AC-02 | streaming 期间不提前显示候选来源 | Browser |
| AC-03 | 页面重载后来源与实时 done 一致 | API fixture + Browser |
| AC-04 | legacy / 普通回答 UI 不退化 | Regression |
| AC-05 | none、unavailable、partial、insufficient 与 conflict 使用明确不同文案和视觉状态 | Component + Browser |
| AC-06 | aborted / error 不保留 completed Grounding | State tests |
| AC-07 | malformed Grounding fail closed，正文仍可读 | Negative tests |
| AC-08 | 不解析任意 `[1]` 或模型 URL | Unit tests |
| AC-09 | source link 只能使用安全投影，危险协议不可点击 | Security tests |
| AC-10 | 键盘、可访问名称、焦点与 disclosure 行为可验证 | Browser / accessibility |
| AC-11 | 桌面和窄屏来源卡片可阅读、无布局溢出 | Chromium screenshots |
| AC-12 | 现有 Chat scroll、copy、Markdown 和 conversation cache 不退化 | Existing suites + Browser |

## 8. 明确不做

- 修改 Task 3A backend contract；
- claim-level inline marker；
- Retrieval Inspector；
- Admin Auth / RBAC；
- 直接访问 Tool Result 或 AgentStep raw JSON；
- 外部 URL 自动抓取或预览；
- citation feedback / voting / analytics；
- 并行 Tool Call 支持。

## 9. 实现落点

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

Web 侧不新增任何 Grounding 类型或校验规则，全部复用 `@agent/contracts` 的
`MessageGroundingV1` 与 `parseMessageGroundingV1()`。

## 10. 验证结果

均在本地实际执行：

| 命令 | exit code | 结果 |
| --- | --- | --- |
| `pnpm --filter @agent/contracts build` | 0 | 通过 |
| `pnpm typecheck`（contracts / web / admin / api） | 0 | 通过 |
| `pnpm --filter @agent/web lint` | 0 | 通过 |
| `pnpm --filter @agent/web build` | 0 | 通过 |
| `pnpm --filter @agent/web test:seo-stream` | 0 | 12 tests / 12 pass / 0 fail / 0 skip |
| `pnpm --filter @agent/web test` | 0 | 43 tests / 43 pass / 0 fail / 0 skip |
| `pnpm --filter @agent/web test:e2e`（Chromium） | 0 | 9 tests / 9 pass / 0 fail |
| `pnpm --filter @agent/web exec playwright test --repeat-each=3` | 0 | 27 pass / 0 fail / 0 flaky |
| `git diff --check` | 0 | 无空白问题 |

仓库根 `pnpm lint` 仍然失败：exit code 1，115 errors / 0 warnings，分布在 18 个
`docs/**` Markdown 文件。本轮未做基线对比，因此不声称「没有新增错误」；可直接
验证的事实是：这 18 个报错文件与本 PR 改动的文件列表**没有交集**，且本 Task 的
`apps/web` lint 单独通过（exit code 0）。

浏览器证据（Chromium，`page.route()` + 受控 `fetch` 确定性 fixture，不依赖模型 Provider）：

| 场景 | 截图 |
| --- | --- |
| desktop answered + citations | `assets/task-03b/desktop-answered-sources.png` |
| narrow answered + long source content | `assets/task-03b/narrow-answered-long-sources.png` |
| desktop insufficient + unavailable | `assets/task-03b/desktop-insufficient-unavailable.png` |
| narrow conflicting + partial | `assets/task-03b/narrow-conflicting-partial.png` |

reload 一致性不单独出图，由「实时 `done` 与 reload 后 status 文案、Citation 数量、
来源区完整文本逐字相等」的 Chromium 断言提供等价证据。

## 11. GitHub 交付状态

- Issue：#60
- 分支：`codex/issue-60-web-source-ui`
- PR：Draft
- Clarification Gate：READY
- 实施状态：已实现
- 验收状态：待验收
