# Phase 8 Task 3C：Admin Retrieval Inspector

状态：**Next / Task 3B Completed / Issue 未创建 / Gate 未执行**。

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

当前只表示 Task 3C 是下一项正式任务：

- Issue：未创建；
- 分支：未创建；
- PR：未创建；
- Clarification Gate：未执行；
- 实施状态：未开始；
- 验收状态：未验收。

必须先由 GPT 结合当前 Admin 代码与本文件创建独立 Issue，并提供 Task 专属 Codex 开工 Prompt。`Next` 不等于 `Active`。

## 3. Inspector Read Model

建议新增：

```ts
type AdminRetrievalInspectorAvailability
  = 'available'
  | 'partial'
  | 'unavailable'

interface AdminRetrievalInspector {
  availability: AdminRetrievalInspectorAvailability
  retrievalCalls: AdminRetrievalCallSummary[]
  finalization: AdminGroundedFinalizationSummary | null
  citations: AdminGroundedCitationSummary[] | null
}
```

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

| 场景 | Inspector 行为 |
| --- | --- |
| 完整新 Run | available，展示 Retrieval + finalization + citations |
| 只检索未完成 finalization | partial，说明 finalization 缺失 |
| 普通未检索 Run | unavailable / not_applicable 语义由 projector 明确区分 |
| legacy Run | unavailable，现有 timeline 仍可用 |
| malformed Step / Grounding | partial 或 unavailable，不返回原始 JSON |
| Tool failure | Grounding availability 为 unavailable 或 partial，并显示安全 code / timing，不展示 stack |
| zero-hit / not found | 显示 availability none、insufficient 与 0 citations |
| insufficient evidence | 显示 availability、outcome 与 0..N citations |
| conflicting evidence | 显示至少两个 cited source |

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

## 9. GitHub 交付状态

- Issue：未创建
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行
- 实施状态：未开始
- 验收状态：未验收

下一步：由 GPT 读取当前 Admin Run Detail、typed Inspector、Task 3A / 3B contract 和本文件，创建 Task 3C 独立 Issue及任务专属 Codex 开工 Prompt。
