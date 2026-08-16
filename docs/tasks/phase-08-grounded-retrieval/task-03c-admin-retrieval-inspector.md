# Phase 8 Task 3C：Admin Retrieval Inspector

状态：**Active / Issue #62 / Clarification Gate READY / 实施状态：已实现 / 验收状态：待验收**。

## 1. 目标

在现有 Run Trace Workspace 中增加 typed、bounded、fail-closed 的 Retrieval / Grounding Inspector，使管理员能够回答：

```text
本 Run 调用了哪些 Retrieval
返回多少候选、哪些候选具有 chunk evidence
最终回答选择了哪些真实 source / chunk
finalization outcome 与校验结果是什么
在哪个阶段发生 truncation、失败或兼容降级
```

本 Task 不展示完整 Prompt、reasoning、raw embedding 或完整文章正文。

## 2. 启动条件

以下技术前置已经满足：

- Task 3A 已完成 GPT 技术验收与用户确认，Grounding backend contract 已稳定；
- Task 3B 已完成 GPT 技术验收与用户确认，Issue #60 Closed、PR #61 Merged、merge `572ad206`；
- AgentStep finalization metadata、Tool summary 和 MessageGrounding contract 已稳定；
- Admin API 已能读取真实 Run / Step，Task 3C 可在此基础上增加 typed safe projector；
- malformed / legacy / partial 数据的 fail-closed 语义已经定义。

当前状态：

- Issue：#62；
- 分支：`codex/issue-62-admin-retrieval-inspector`；
- Clarification Gate：已执行，结论 `READY`；
- 实施状态：已实现；
- 验收状态：待验收。

## 3. Inspector Read Model

已实现于 `packages/contracts/src/admin-run.ts`（availability 按 Issue #62 D-02 定案为四值）：

```ts
type AdminRetrievalInspectorAvailability
  = 'available'
    | 'partial'
    | 'unavailable'
    | 'not_applicable'

interface AdminRetrievalInspector {
  availability: AdminRetrievalInspectorAvailability
  retrievalCalls: AdminRetrievalCallSummary[]
  callsTruncated: boolean
  candidateCount: number | null
  evidenceRefCount: number | null
  finalization: AdminGroundedFinalizationSummary | null
  citations: AdminGroundedCitationSummary[] | null
}
```

`registryRefCount / registryTruncated` 按 Issue #62 归入 finalization 层，不再放在单个 call 上。

### 3.1 Retrieval call summary

最多展示：

- callId；
- tool name / version；
- samplingAttemptId；
- strategy name / version；
- status；
- source count；
- Registry ref count / registryTruncated；
- chunk evidence count；
- original / observation chars；
- truncated；
- duration；
- bounded sourceId / chunkId refs。

### 3.2 Finalization summary

最多展示：

- schema version；
- evidence availability；
- outcome；
- attempt count 与独立 finalization budget；
- validation result；
- citation count；
- citation integrity；
- faithfulness status；
- duration / token usage（仅现有安全聚合可用时）。

### 3.3 Citation correlation

- 将最终 Citation 关联回本 Run evidence-eligible Tool Result；
- 展示 sourceId、nullable chunkId、granularity、title bounded preview；
- 明确区分 retrieval candidate、article detail evidence 与 cited count；
- 不能把未被最终引用的 candidate 伪装为 answer source。

## 4. 安全定案

Task 3C 继续沿用现有 typed projector 和 Generic fallback：

- 不将 AgentStep input/output 原样返回给前端；
- malformed typed metadata 降级为 partial / unavailable；
- safeRawData 只保留既有 bounded summary；
- query 仅在有明确 bounded safe projection 时展示，否则省略；
- excerpt 默认不在 Admin 主面板展示；如验收确需 preview，必须独立 bounded 并通过注入文本负向测试；
- 不展示 full Prompt、system/developer instructions、reasoning；
- 不展示 raw embedding、distance、SQL、Provider payload、secret、stack；
- Admin Auth / RBAC 尚未完成，不能以“内部后台”为理由放宽数据边界。

## 5. 页面结构建议

```text
Run Detail
  ├─ Existing Execution Timeline
  ├─ Retrieval Overview
  │    ├─ strategy / status / counts
  │    └─ candidate -> cited summary
  ├─ Grounded Finalization
  │    ├─ outcome / attempts / validation
  │    └─ integrity / faithfulness status
  └─ Citation Ledger
       ├─ source / chunk identity
       └─ granularity / selected state
```

Retrieval Inspector 是现有 Workspace 的一个 typed Inspector，不新建第二套 Run Detail 页面。

## 6. 状态行为

下表是已实现的行为（以 §9.2 规则为准）：

| 场景 | Inspector 行为 |
| --- | --- |
| 完整新 Run | `available`，展示 Retrieval + finalization + citations |
| 只检索未完成 finalization（RUNNING） | `partial`，finalization 为 null，不伪造 outcome |
| 普通未检索 Run | `not_applicable`，中性文案，不显示错误或空骨架 |
| legacy Run（call 缺少 summary） | `partial`：投影出的 evidence 身份数与 `registryRefCount` 不一致，现有 timeline 仍可用 |
| malformed Step / Grounding | `partial` 或 `unavailable`，不返回原始 JSON |
| Tool failure | Inspector 仍可为 `available`；Grounding availability 为 `unavailable` / `partial`，显示安全 code / timing，不展示 stack |
| zero-hit / not found | Inspector `available`；Grounding 为 `none + insufficient_evidence + 0 citations` |
| insufficient evidence | 显示 availability、outcome 与 0..N citations |
| conflicting evidence | 显示至少两个 cited source |
| 合法 Citation 但无法关联 | Citation 安全展示、correlation=`unmatched`、Inspector 降为 `partial` |

## 7. 验收标准

| ID | 可观察行为 | 验证方式 |
| --- | --- | --- |
| AC-01 | 真实 Run Detail 返回 typed Retrieval Inspector | API integration |
| AC-02 | retrieval candidate、article detail evidence 与 cited count 分开且可关联 | Projector tests |
| AC-03 | finalization outcome、attempt、validation、schema version 可审计 | Projector + API |
| AC-04 | sourceId / chunkId / granularity 与 MessageGrounding 一致 | Integration |
| AC-05 | legacy / 普通 Run 不破坏现有 Timeline | Regression |
| AC-06 | partial / malformed 数据 fail closed，不泄漏 raw JSON | Negative tests |
| AC-07 | Prompt、reasoning、embedding、distance、SQL、secret、完整正文不进入 API | Security tests |
| AC-08 | zero-hit、not found、partial failure、unavailable、timeout、abort、insufficient、conflict 可区分 | Fixtures |
| AC-09 | Web Admin 只消费 typed contract，不解析 outputSummary 文本 | Frontend tests |
| AC-10 | 真实 Chromium 可切换并阅读 Retrieval Inspector | Browser |
| AC-11 | RUNNING / FAILED / COMPLETED 与窄屏布局可验证 | Browser screenshots |
| AC-12 | 现有 Context Inspector、Generic Inspector、Safe Raw Data 不退化 | Existing suites |

## 8. 明确不做

- Admin Auth / RBAC / 多租户权限；
- raw Prompt / reasoning viewer；
- embedding vector 可视化；
- SQL / Provider payload viewer；
- 全文文章浏览器；
- 在线 Ragas / LLM judge dashboard；
- 修改 Retrieval ranking 或 Grounding contract；
- 新建独立 Observability 平台或引入 telemetry framework。

## 9. 实现结果

### 9.1 关键改动

| 层 | 文件 | 内容 |
| --- | --- | --- |
| Contract | `packages/contracts/src/admin-run.ts` | Run 级 `AdminRetrievalInspector` 及子类型、`AdminGroundedFinalizationStep` typed timeline item、`AdminRunDetail.retrievalInspector` |
| API query | `apps/api/src/admin-runs/admin-runs.service.ts` | `ADMIN_RUN_DETAIL_SELECT` 增加 assistant Message 的 `grounding` 安全字段 |
| Projector | `apps/api/src/admin-runs/admin-retrieval-inspector.projector.ts` | 严格 reader、跨字段一致性、bounded 投影、Citation correlation、availability 规则 |
| Projector | `apps/api/src/admin-runs/admin-run.projector.ts` | `grounded_finalization` typed 投影 + Generic fallback；接入 Run 级 Inspector |
| Admin UI | `trace/RunTraceInspector.vue`、`inspectors/RetrievalInspector.vue`、`inspectors/GroundedFinalizationInspector.vue`、`trace/retrieval-inspector.presenter.ts` | 现有 Workspace 内 `Event / Retrieval` 切换与四个区块 |
| i18n | `apps/admin/src/i18n/messages.ts` | `retrieval.*` 与 `timeline.*.groundedFinalization`，zh-CN / en-US 同步 |
| 浏览器 | `apps/admin/playwright.config.ts`、`apps/admin/e2e/**` | 复用仓库既有 `@playwright/test@1.62.1`，确定性 Admin API fixture |

### 9.2 availability 判定规则

```text
not_applicable  没有 evidence-eligible call、没有 finalization Step、没有 Grounding 行，
                且没有任何无法确认 Tool identity 的 tool_execution Step
unavailable     进入过链路（含只有身份不完整的 Tool 调用），但没有任何可信事实
available       Run COMPLETED
                + 所有 evidence-eligible call 元数据可信且未截断
                + 没有无法确认 Tool identity 的 tool_execution Step
                + finalization COMPLETED 且 validation=passed 且 failureReason=null
                + finalization.eligibleToolCallCount == 真实 evidence-eligible Step 数量
                + finalization.eligibleToolFailureCount >= 已明确失败的调用数
                + 合法 durable Grounding 且全部 Citation matched
                + 投影出的 evidence 身份数 == finalization.registryRefCount
                + finalization 与 Grounding 跨字段一致
partial         其余情况
```

`registryTruncated` 是 Run 内真实发生的证据裁剪，属于业务事实，不降低 Inspector availability；
`callsTruncated / refsTruncated` 是投影侧不完整，降为 `partial`。

### 9.2.1 finalization attempt 状态机

校验规则直接来自 `runGroundedFinalization` 与 `toFinalizationStepOutput`：

```text
非末尾 attempt     必须恰好是一次 correction rejection：ok=false + 有 rejectionCode
                   + 无 samplingFailure。只有内容拒绝会继续下一次调用，成功、
                   采样故障与 Abort / deadline 都会立即 return 或 throw
成功 attempt      必然是最后一条（成功即 return），且全 Run 最多一条
sampling 故障      必然是最后一条（立即抛 GroundedFinalizationSamplingError）
未收口 Step        PENDING / RUNNING 必然 output = null（Recorder 的每次 output 写入
                   都与终态 status 同一条 update）；带 output 一律 malformed
COMPLETED Step     必然带 Grounding block 且没有 failureReason：只有 completeRun 的
                   成功提交路径才会把 Step 置为 COMPLETED
失败类别互斥        validation_failed 只带 rejectionCode；sampling_incomplete 只带
                   samplingFailure；finalization_incomplete 与「无 failureReason」
                   两者都不带。既检查必填，也检查其余类别必须为空
Grounding block    只在 durable 投影成功后写入 → 最后一条 attempt 必须成功
                   citationCount <= 该次 attempt 的 submittedCitationKeyCount
                   只允许与 finalization_incomplete 共存（校验后 replay / commit 失败）
validation_failed  无 Grounding block；必须真正用尽 correction 预算：
                   attempts.length == GROUNDED_FINALIZATION_MAX_ATTEMPTS，
                   每条都是带 rejectionCode 的拒绝，最后一条与顶层一致；
                   唯一例外是 durable 投影被拒的 schema_invalid 路径，此时最后一条
                   attempt 是成功的模型调用
sampling_incomplete 无 Grounding block；最后一条 attempt 的 samplingFailure 与顶层一致
finalization_incomplete 可以是 0 attempt（调用前中断）；有 attempt 时最后一条必须是
                   ok=false 且不带 samplingFailure；若最后一条是内容拒绝且预算已用尽
                   （attempts.length >= MAX_ATTEMPTS），finalizer 必然收口为
                   validation_failed，此时的 finalization_incomplete 是 malformed
无 failureReason 且无 Grounding block  只有尚未收口的 Step 才允许（pending）
```

### 9.2.2 finalization input 是必要事实

finalization Step 的 `input` 必须完整包含 `assistantMessageId`、`evidenceAvailability`、
`registryRefCount`、`registryTruncated`，且与 `output` 描述同一份 Registry、
`assistantMessageId` 必须等于本 Run 真实的 Assistant Message ID。
缺失、类型非法或归属不一致时 `metadataTrusted=false`、typed timeline 回落 Generic、
Inspector 不得为 `available`。

### 9.2.3 Tool identity 三态分类

Tool 归类只依据持久化的 typed `toolName` + `toolVersion` 与 Tool Definition 的
`evidencePolicy`，不从 summary、title、数组位置或 Observation 猜测：

```text
exact known identity + evidencePolicy=eligible   → eligible
exact known identity + evidencePolicy!=eligible  → not_eligible（如 search_articles@1）
toolName 缺失 / toolVersion 缺失 / 版本漂移 / 未注册工具名 → unclassifiable
```

`unclassifiable` 不是「已确认的 discovery-only」：它让「本 Run 发生了几次证据调用」
变成未知，因此既不能计入 `not_applicable`，也不能出现在 `available` 里。

### 9.2.4 失败或未知调用不采信 toolSummary

Runtime 只在 `toolResult.ok === true` 时才持久化 `toolSummary`。因此：

```text
ok=true  + 合法 summary  → 可信投影
ok=true  + 无 summary    → 可信但计数未知（legacy / 无 summary 工具）
ok=true  + 非法 summary  → metadataTrusted=false
ok=false + 无 summary    → 正常已知失败，metadataTrusted=true，计数为 null，refs=[]
ok=false + 任意 summary  → metadataTrusted=false，summary 整体作废
ok=null  + 无 summary    → 结果未记录，不伪造候选数量
ok=null  + 任意 summary  → metadataTrusted=false
```

Citation correlation index 额外要求 `call.ok === true`：即便失败调用伪造了与
durable Citation 完全一致的 `sourceId + chunkId`，也只能是 `unmatched`。

### 9.2.5 计数的「未知」与「零」

Run 级 `candidateCount` / `evidenceRefCount` 在 `projectAdminRetrievalInspector()`
里只计算一次，availability 与公共 contract 使用同一个数字：

```text
存在无法分类的 Tool Step  两个 Run 级总数都为 null：本 Run 的 Tool 集合本身不完整，
                          已识别调用的局部数字不是全 Run 审计总数
candidateCount   任一调用的 sourceCount 无法从合法 typed summary 确认 → null
                 成功 zero-hit → 0
                 Tool timeout / 失败 / legacy 无 summary / malformed summary → null
evidenceRefCount 明确失败的调用确实没有贡献引用，计 0；
                 成功但没有提交可审计引用（legacy / 无 summary 工具）→ null
```

明确的 discovery-only 工具（`search_articles@1`）不影响任何计数，
仅 discovery-only 的 Run 仍是 `not_applicable`。

### 9.3 已知限制

`get_article_detail@1` 是 evidence-eligible 工具，但不提交 `stepSummary`，因此它的 call 没有可投影的
source / chunk 引用身份。只依赖该工具产生的 Citation 会按 D-12 标为 `unmatched`，Inspector 降为
`partial`。补齐它需要修改 Tool，属于本 Task 的明确非目标。DB integration 中有对应用例固化该行为。

### 9.4 验证结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | exit 0（pnpm 10.32.1 / Node v20.19.3 / Corepack 0.32.0） |
| `pnpm --filter @agent/contracts build` | PASS |
| `pnpm --filter @agent/api test:admin-runs` | 136 pass / 0 fail / 0 skip |
| `pnpm --filter @agent/api test:grounding` | 168 pass / 0 fail / 0 skip |
| `pnpm --filter @agent/api test:grounding-db` | 17 pass / 0 fail / 0 skip（隔离 PostgreSQL） |
| `pnpm --filter @agent/admin test` | PASS |
| `pnpm --filter @agent/admin test:e2e` | 12 passed（Chromium） |
| `pnpm --filter @agent/admin exec playwright test --repeat-each=3` | 36 passed |
| `pnpm --filter @agent/admin typecheck / lint / build` | PASS |
| `pnpm --filter @agent/api typecheck / lint / build` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint`（仓库根） | FAIL：113 个既有 `docs/**` Markdown baseline 错误，本次 scoped lint 全部通过 |
| `git diff --check` / `git diff --cached --check` | PASS |

DB integration 使用 `ARTICLE_INDEX_TEST_DATABASE_URL` 指向的隔离数据库，
每个 suite 建立一次性 schema `grounding_test_<uuid>` 并在结束后 `DROP SCHEMA ... CASCADE`；
入口显式拒绝与 `DATABASE_URL` 相同的连接串，也不允许 skip。

### 9.5 浏览器证据

截图位于 `assets/task-03c/`：

- `completed-answered-retrieval.png`
- `running-partial-retrieval.png`
- `failed-partial-retrieval.png`
- `ordinary-not-applicable.png`
- `malformed-fail-closed.png`
- `narrow-320-retrieval.png`
- `single-column-retrieval.png`
- `zero-hit-retrieval.png`
- `unknown-call-result.png`
- `unclassifiable-tool-unavailable.png`
- `failed-summary-fail-closed.png`

窄屏说明：Admin 控制台有既有全局 `min-width: 1024px`（本 Task 之前就存在，不在范围内），
因此 320px 视口下文档级仍会横向滚动。浏览器用例如实断言了这一既有约束，并单独验证
Retrieval 视图的内容不会冲出自己所在的 Inspector 列，同时在单列断点（1024px）下复验。

## 10. GitHub 交付状态

- Issue：#62
- 分支：`codex/issue-62-admin-retrieval-inspector`
- PR：Draft
- Clarification Gate：已执行，`READY`
- 实施状态：已实现
- 验收状态：待验收
