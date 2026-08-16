# Phase 8 Task 3C：Admin Retrieval Inspector

状态：**Completed / Issue #62 Closed / PR #63 Merged / GPT 技术验收通过 / 用户已确认验收**。

## 1. 收口事实

| 项目 | 结果 |
| --- | --- |
| Issue | #62，Closed / Completed |
| PR | #63，Merged |
| 最终实现分支 | `codex/issue-62-admin-retrieval-inspector` |
| 最终 Head | `aadcadf510b20ea3c958b99ad1a8bfcf363dedf7` |
| Merge Commit | `20f838fb1fd5139d787f973a90f4906d7ab8ea14` |
| Clarification Gate | `READY` |
| GPT 技术验收 | AC-01～AC-12 PASS |
| 用户确认 | 2026-08-16 已确认验收并授权合并、关闭 Issue 与 docs 收口 |

## 2. 目标

在现有 Run Trace Workspace 中增加 typed、bounded、fail-closed 的 Retrieval / Grounding Inspector，使管理员能够回答：

```text
本 Run 调用了哪些 evidence-eligible Tool
返回多少候选、哪些候选具有可审计 evidence identity
最终 Citation 使用了哪些 source / chunk
finalization outcome、attempt、validation、usage 是什么
zero-hit、Tool failure、Abort、legacy 或 malformed 在哪一层发生
```

本 Task 只消费当前持久化事实，不修改 Retrieval ranking、Agent Runtime、Evidence Registry、Grounding contract 或数据库 schema。

## 3. 交付内容

### 3.1 公共 Contract

`packages/contracts/src/admin-run.ts` 新增：

- `AdminRetrievalInspector`；
- `AdminRetrievalCallSummary`；
- `AdminGroundedFinalizationSummary`；
- `AdminGroundedCitationSummary`；
- `AdminGroundedFinalizationStep` typed timeline item；
- `AdminRunDetail.retrievalInspector`。

```ts
type AdminRetrievalInspectorAvailability
  = 'available'
    | 'partial'
    | 'unavailable'
    | 'not_applicable'
```

Run 级 `candidateCount / evidenceRefCount` 明确区分“确定为 0”和“无法确认而为 null”。

### 3.2 Admin API 与 projector

新增 `admin-retrieval-inspector.projector.ts`，从以下持久化事实构建安全 Read Model：

```text
AgentRun
+ evidence-eligible Tool Steps
+ grounded_finalization Step
+ completed Assistant MessageGrounding
        ↓
typed / bounded / fail-closed projector
        ↓
AdminRunDetail.retrievalInspector
```

已建立：

- Tool Definition `name@version + evidencePolicy` 三态分类；
- Retrieval candidate、evidence ref 与 final Citation 分层；
- `sourceId + nullable chunkId` 精确 correlation；
- finalization input / output / attempt 状态机严格 reader；
- Run、Step、MessageGrounding 和 Tool count 跨字段一致性；
- malformed 单项回落 Generic，不拖垮整个 Run Detail；
- allowlist 输出，不返回原始 Step JSON。

### 3.3 Admin UI

现有 Run Trace Workspace 右侧 Inspector 增加：

```text
Event
Retrieval
  ├─ Retrieval Overview
  ├─ Retrieval Calls
  ├─ Grounded Finalization
  └─ Citation Ledger
```

没有新增第二套路由或 Run Detail。Event 默认行为、当前 Timeline 选中态、Context / Tool / Message / Generic Inspector、Ledger、搜索、折叠和 Safe Raw Data 均保持。

### 3.4 浏览器验证

新增 Admin Playwright 最小入口和确定性 API fixture，覆盖：

- COMPLETED answered；
- RUNNING partial；
- FAILED；
- zero-hit；
- Tool unavailable；
- `ok=null` 中性状态；
- ordinary `not_applicable`；
- unclassifiable Tool `unavailable`；
- malformed finalization / Tool summary；
- failed Tool summary 不参与 Citation correlation；
- 320px Inspector 内容边界与 1024px 单列断点。

## 4. 状态语义

```text
not_applicable
  没有 evidence-eligible call、finalization、Grounding，且没有无法分类的 Tool Step

unavailable
  已进入或疑似进入链路，但没有足够可信事实

available
  Run COMPLETED
  + 所有 eligible call metadata 可信且未发生投影截断
  + 没有 unclassifiable Tool Step
  + finalization COMPLETED / validation=passed / failureReason=null
  + finalization call / failure count 与真实 Step 一致
  + durable Grounding 合法
  + Citation 全部 matched
  + evidence identity count 与 Registry 一致

partial
  已有部分可信事实，但链路不完整、未完成、无法关联、截断或发生兼容降级
```

Inspector availability 与 Grounding 的 `available / partial / none / unavailable` 分层。zero-hit 或 Tool unavailable 只要审计事实完整，Inspector 仍可为 `available`。

## 5. finalization 状态机

projector 按真实 Runtime / Recorder 不变量校验：

- 非最后 attempt 只能是 correction rejection；
- 成功 attempt 必须是最后一次；
- sampling failure 必须是最后一次；
- `validation_failed / sampling_incomplete / finalization_incomplete` 的顶层错误字段严格互斥；
- 普通 `validation_failed` 必须耗尽 correction budget；
- durable projector 拒绝允许唯一 `schema_invalid + 成功 attempt` 例外；
- `PENDING / RUNNING` Step 只能 `output=null`；
- `COMPLETED` Step 必须有合法 Grounding block 且无 `failureReason`；
- post-validation replay / commit / terminalization failure 可保留 `validation=passed`，但 Inspector 只能为 `partial`。

## 6. 安全边界

Admin API 和 DOM 不暴露：

- Prompt、system / developer instructions；
- reasoning、hidden draft；
- raw Tool arguments、raw Observation、modelContent；
- excerpt、完整文章正文；
- embedding、distance、SQL；
- Provider payload、API Key、authorization、stack；
- internal `citationKey` / `evk_`。

前端不得解析 `inputSummary`、`outputSummary`、`safeRawData` 或原始 JSON 重建 Inspector。

## 7. 最终验证

```text
corepack pnpm install --frozen-lockfile              PASS
contracts build                                      PASS
test:admin-runs       136 / 136 pass
test:grounding        168 / 168 pass
test:grounding-db      17 / 17 pass / 0 skip
Admin tests                                          PASS
Admin Chromium        12 / 12 pass
Chromium repeat-each=3 36 / 36 pass
Admin typecheck / lint / build                       PASS
API typecheck / lint / build                         PASS
workspace typecheck                                  PASS
git diff --check / --cached --check                  PASS
```

隔离 PostgreSQL 使用 `ARTICLE_INDEX_TEST_DATABASE_URL`、一次性 `grounding_test_<uuid>` schema、完整 migrations，并在结束时 `DROP SCHEMA ... CASCADE`；入口拒绝与 `DATABASE_URL` 相同且不允许 skip。

根 `pnpm lint` 仍有 113 个既有 Markdown baseline 错误；本 Task 源码与本文件 scoped lint 通过。

## 8. 已知边界

1. `get_article_detail@1` 是 evidence-eligible，但当前不提交 `stepSummary`；独占 Citation 会 `unmatched -> partial`。
2. query v1 没有 typed metadata 来源，因此保持 `null`，不得反解析 raw arguments。
3. 20 calls / 5 refs 上限在当前 `maxToolCalls=2` 下主要由 fixture 验证。
4. Admin 全局仍有既有 `min-width: 1024px`；本 Task 只保证 Inspector 内容不越界。
5. Admin Auth / RBAC 尚未实现，因此安全投影继续按最小披露处理。
6. Citation identity validation 不等于 semantic faithfulness；`faithfulnessStatus` 仍为 `not_evaluated`。

## 9. 最终状态

```text
实施状态：已实现
GPT 技术验收：通过
用户确认验收：已完成
任务状态：Completed
Issue #62：Closed
PR #63：Merged
Merge：20f838fb1fd5139d787f973a90f4906d7ab8ea14
```
