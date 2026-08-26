# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看对应 Task 文档、Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-8 Completed；#101 / PR #105、#102 / PR #106 已验收合并 | #103 Article Chunking 模块组织 Gate；不启动 Phase 9 |
| Phase 8 | Task 0、1、2A、2B、3A、3B、3C 全部 Completed | [阶段归档](./tasks/completed/phase-08-grounded-retrieval.md) |
| Minimal Compaction | Gated | 只有真实 Context 压力证据满足触发条件后才讨论 |
| Admin Console | Task 0-3、Enhancement 1-3、Phase 8 Task 3C Completed；Task 4 Planned | 不自动启动 Auth / RBAC |
| Phase 9 | 未定案 | 学习闭环后基于真实需求讨论 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-27 | Backend 模块组织 #102 验收收口 | Issue #102 / PR #106；Admin Runs 按 facade / context / retrieval / sampling usage / safe readers 分域并消除循环 import；Admin Runs 146、Grounding 171 与 Admin Overview / checks 全绿，API build / typecheck / lint、Admin 与 workspace typecheck 通过；提交前 Review `No findings.`，GitHub Codex Review 未发现 major issues；GPT 技术验收和用户确认通过；merge `638c70e`，Issue Closed，远程与本地任务分支已删除；#103 推进为 Next / Gate PENDING |
| 2026-08-27 | Backend 模块组织 #101 验收收口 | Issue #101 / PR #105；Agent Runtime 按 configuration / lifecycle / context / sampling / grounding 分域，根目录保留公共入口；Run Cancellation 提取为独立 Lifecycle 状态机并新增 7 条测试；提交前 xhigh Review `No findings.`，GitHub Codex Review 未发现 major issues；Lifecycle 21、Tool Loop 65、Model Stream 91、Context 24、Grounding 171、Admin Runs 146、SEO Service 32 全绿，build / typecheck / lint / diff check 通过；GPT 技术验收和用户确认通过；merge `2f1ae27`，Issue Closed，远程与本地任务分支已删除；#102 推进为 Next / Gate PENDING |
| 2026-08-26 | 失败 Sampling 部分响应可观测性 #98 验收收口 | Issue #98 / PR #100；失败、Abort、deadline 与消费者 return 路径保存 complete / partial / empty 聚合事实；Admin 区分未捕获、部分响应和空响应，复制 JSON 保留状态；安全日志只记录关联 ID 与计数；确定性测试 91 + 65 + 146 + 23 全绿，Admin checks、lint、typecheck、build 与 Chromium route fixture 通过；GPT 技术验收和用户确认通过；PR #100 merge `915315b`，Issue Closed，远程与本地任务分支已删除 |
| 2026-08-23 | DeepSeek 思考强度与 Usage #94 收口 | Issue #94 / PR #95；Web Low / High / Max 单次选择贯穿 resolved Run 配置与全部 sampling；Provider 显式 thinking / reasoning_effort 并移除 temperature；reasoning / cache Usage 持久化到 AgentStep，Admin Run Detail 按指标独立 all-or-nothing 展示；debug safe projection 剥离 reasoning_content；用户确认 UI 验收通过，独立技术复核后修正 reasoning E2E 精确定位，完整 Web Chromium 10 / 10；PR #95 merge `2266fad`，Issue #94 Closed / Completed |
| 2026-08-22 | Run 配置解析边界 #92 收口 | Issue #92 / PR #93；源码阅读阶段发现的横向 refactor：新增 `AgentRunConfigurationService` 收敛单次 Run 配置解析（policy getter 保 deadline 时序），`ResolvedChatRequestConfig` 补全 contextWindowTokens / temperature，Runtime 消除 `getModelProfile` 穿透与 `!` 断言，模型名单与 Profile 收敛进 `model-profiles.ts`，删除单行 `llm.constants.ts`；新增 `docs/research/configuration-map.md` 配置地图；commit 前 /code-review 15 项 findings（12 类修复并入提交，不修项在 PR 记录理由，含 model:'' 既有语义按规格保留）；验证 6 套件 383 项全绿 + lint + root typecheck；AC-01～09 逐项核对通过，用户确认验收并授权合并与清理；merge `f32cd48`，Issue #92 Closed，分支已删 |
| 2026-08-22 | Admin Enhancement 3 Overview 仪表盘 #90 收口 | Issue #90 / PR #91；stats + balance API（应用层扫 30 天窗口聚合 step JSON usage；DeepSeek 余额服务端代理复用 LLM_API_KEY）+ ECharts 按需注册前端（stat bar、双趋势图、比例条分布列表，亮暗主题联动）；/code-review 一轮 5 项全处理（含 resolvedModel 落库路径确认级 bug，实调接口验证）；视觉验收反馈一轮重构后用户确认并授权合并；实测确认 DeepSeek 官方 API 仅开放 user/balance，平台用量页无公开 API；merge `3108a5f`，Issue #90 Closed，分支已删 |
| 2026-08-22 | Admin Enhancement 2 会话记录入口 #88 收口 | Issue #88 / PR #89；会话列表 + 完整 transcript（会话级投影，run 级 500 字截断不变）+ runs conversationId 过滤 + 聊天气泡懒加载 UI + 路由滑动过渡；commit 前 /code-review 两轮 13 项（12 修 1 记录：runs 表格组件化留后续）；typecheck / lint / admin 检查 / api 144 测试全绿；用户确认验收并授权合并与分支清理；merge `e059cebb`，Issue #88 Closed，分支已删；同日创建 Enhancement 3 Overview 仪表盘 Issue #90（ECharts 选型与聚合方案已记录） |
| 2026-08-20 | Phase 8 任务目录归档 | `docs/tasks/phase-08-grounded-retrieval/` 全部文档核心内容合并归档到 `docs/tasks/completed/phase-08-grounded-retrieval.md`，原目录与阶段截图删除（浏览器证据以测试与 PR 记录为准）；docs 状态同步为 Phase 8 源码阅读阶段，下一阶段学习内容暂不定义 |
| 2026-08-19 | 开发环境自举缺陷 #84 收口 | 编写实机启动手册时实测发现：compose 主库镜像 `postgres:16-alpine` 不含 pgvector，`prisma:migrate` 必然在 Embedding Index migration 中断，本开发机主库长期仅应用 6/8 migration（缺 `ArticleChunk` / `ArticleIndexState` / `MessageGrounding`），web 前台 RAG 主链与 grounded 落库在 dev 主库上从未真正可用（Phase 8 验证均在 integration 库）；PR #85 将主库镜像对齐 `pgvector/pgvector:0.8.6-pg16-bookworm` 并补全 README quickstart（起库、seed、index 步骤与 collation 迁移注意）；本机主库重建实测：8/8 migration、seed 68 篇、index chunksWritten=2044 / failed=0、`smoke:retrieval-tool` 真实检索通过；用户确认合并，PR #85 merged，Issue #84 Closed |
| 2026-08-19 | 全仓源码审计后置维护 #72-#77 批量收口 | 基于 2026-08-18 三路并行源码审计（Runtime 核心 / RAG 链路 / 前端契约）创建 Issue #72-#77 并全部修复：#72 Runtime 终态收口（消费者 return() 兜底 + 在途请求取消 + terminalization_unknown 流通知，PR #78）、#74 finalization 模型不服从纳入 correction（新 rejection code `submission_missing`，PR #79）、#73 Web 流边界（reader.cancel、消息版本守卫、abort 占位幂等、onUnmounted，PR #80）、#75 quality-v2 lexical 基线与 hybrid 同源（PR #81）、#76 向量通道静默排除告警 + auxiliaryQuery 独立池（PR #82）、#77 卫生批量（PR #83）；每 PR 均经暂存区 code-review 自审（累计 11 个 finding 再修复）、Claude 逐项验收（PR 留档）、冷启动独立复审放行（3 项跟进已收口）；集成态验证 workspace typecheck 0 错、api 508 项 + web 44 项测试全绿；用户授权合并，PR #78-#83 全部 merge（`5071b71`～`28d3ea5`），Issue #72-#77 Closed，远程分支已清理；明确不修事项（C5 先说话再调工具、C6 tokenizer 性能、abortRun reason 元数据等）记录于各 PR |
| 2026-08-16 | Phase 8 后置维护 #66 最终收口 | Issue #66 / PR #71；最终验收 head `e22873c6aa0375750d4c2aeb0fb2d0e7a831272c`；GPT 基于最新 diff、精确 `@google/genai@2.17.1` SDK 源码、真实 SDK Transport 边界、Undici MockAgent 隔离、network / SDK timeout / caller Abort 三分支和重试计数核查确认 AC-01～AC-10 PASS；真实证据证明现有分类器正确，未修改 `gemini-embedding.provider.ts`；Codex 验证 `test:article-indexing` 62 / 62、专用 SDK boundary 测试 6 / 6、typecheck、lint 与 build 通过；用户明确确认验收并授权转 Ready、合并与文档收口；PR #71 merge `687e165966e3bfb3eed730f238d19082eddc5812`；Issue #66 Closed / Completed |
| 2026-08-16 | Phase 8 后置维护 #65 最终收口 | Issue #65 / PR #70；最终验收 head `ded42dcfe1d8914c694bba18455a8c33d4b54576`；GPT 基于最新 diff、DTO / ValidationPipe 信任边界、class-validator 实际语义、测试有效性和独立 ECMAScript 空白核查确认 AC-01～AC-06 PASS；Codex 验证 `test:seo-service` 31 / 31、编译产物 DTO 测试 9 / 9、typecheck、lint 与 build 通过；用户明确确认验收并授权转 Ready、合并与文档收口；PR #70 merge `9b417537d64be62aadc942c23e0f9574bd042687`；Issue #65 Closed / Completed |
| 2026-08-16 | Phase 8 后置维护 #64 最终收口 | Issue #64 / PR #69；最终验收 head `05ba8be85a3d2ba5999d84267135f7abe86521c7`；GPT 基于最新 diff、查询—投影链路、Service 接缝测试和独立行为核查确认 AC-01～AC-06 PASS；Codex 验证 `test:admin-runs` 139 / 139、typecheck 与 lint 通过；用户明确确认验收并授权转 Ready、合并与文档收口；PR #69 merge `e7cdb841839f19eaf4ce62be70faabbfced8edca`；Issue #64 Closed / Completed |
| 2026-08-16 | Phase 8 后置维护 #67 最终收口 | Issue #67 / PR #68；最终验收 head `e4a889970513b6563391545558136c6c21f834a1`；GPT 基于最新 diff、所有权语义、确定性竞态测试和独立 Node harness 确认 AC-01～AC-07 PASS；用户明确确认验收并授权转 Ready、合并与文档收口；PR #68 merge `51793f03a409a9f313584a6ddc2fba450fc33b70`；Issue #67 Closed / Completed |
| 2026-08-16 | Phase 8 Task 3C 最终收口 | Issue #62 / PR #63；最终验收 head `aadcadf510b20ea3c958b99ad1a8bfcf363dedf7`；GPT 多轮技术验收最终确认 AC-01～AC-12 PASS；用户明确确认验收并授权关闭 Issue、转 Ready、合并与 docs 收口；PR #63 merge `20f838fb1fd5139d787f973a90f4906d7ab8ea14`；Issue #62 Closed / Completed |
| 2026-08-16 | Phase 8 Task 3C 最终验证 | frozen install、contracts、API / Admin typecheck、lint、build、workspace typecheck 与 diff checks 通过；`test:admin-runs` 136、`test:grounding` 168、`test:grounding-db` 17，均 0 fail / 0 skip；Admin Chromium 12 / 12，repeat-each=3 为 36 / 36；根 lint 保留 113 个既有 Markdown baseline 错误 |
| 2026-08-16 | Phase 8 完成 | deterministic Chunking、Gemini Embedding / pgvector、lexical + vector RRF、Retrieval Tool、Grounding Session、structured finalization、durable Citation、Web Source UI 和 Admin Retrieval Inspector 全部闭环；阶段完成条件全部满足，Phase 8 状态更新为 Completed |
| 2026-08-16 | Phase 8 Task 3B 最终收口 | Issue #60 / PR #61；final head `516dbd3f`；AC-01～AC-12 PASS；PR #61 merge `572ad206271c0089eccc83e2a307bdb7909beeb1`；Issue #60 Closed |
| 2026-08-16 | Phase 8 Task 3A 最终收口 | Issue #58 / PR #59；final head `1e7f4c71`；AC-01～AC-24 PASS；PR #59 merge `d6df7ac1f24137a304748d21f4bca42dcb0a6ddc`；Issue #58 Closed |
| 2026-08-15 | Phase 8 Task 2B 最终收口 | Issue #56 / PR #57；AC-01～AC-16 PASS；merge `4f3ba1c109e8b0ade2328abeed24a72c295acd6d` |
| 2026-08-15 | Phase 8 Task 2A 最终收口 | Issue #54 / PR #55；68 / 68 Articles、2044 Chunks；quality-v2 完成；merge `3abdcb8afd5626f0b8fda90c98095bf529d165fd` |
| 2026-08-14 | Phase 8 Task 1 最终收口 | Issue #50 / PR #52；deterministic Chunking、Gemini profile、pgvector index、幂等 CLI；merge `76d66abf7af426e2a26f9b5765d1eb7a72382007` |
| 2026-08-14 | Phase 8 Task 0 最终收口 | Issue #48 / PR #49；Retrieval boundary、lexical baseline、Evaluation contract；merge `4c2f795084e7bccac205509d8c31b56dbe7ccf0b` |
| 2026-08-14 | Admin Enhancement 1 最终收口 | Issue #51 / PR #53；Run Trace Workspace；merge `159e964cafa081df218284b53f246a0da9edd04e` |
| 2026-08-13 | Phase 7 最终收口 | Issue #46 / PR #47；Context Engineering Completed；merge `caf3d25b`；Minimal Compaction Gated |

## 当前阶段边界

```text
阶段 1-8            Completed
Phase 8             Completed
Active Agent Task   无
Minimal Compaction  Gated
Admin Task 4        Planned
Phase 9             未定案
```

当前执行顺序：

```text
Phase 8 源码阅读（学习阶段）
  -> 再讨论 Phase 9
```

## 已稳定的 Phase 8 事实

- Citation 是服务端验证的结构化事实，不是任意 Markdown `[1]`。
- Evidence-backed answer 使用 Run-scoped opaque citationKey 和 structured finalization。
- `citationIntegrity=validated` 与 `faithfulnessStatus=not_evaluated` 分开。
- Message、Grounding、finalization Step、assistant Step 与 Run 正常完成时原子提交。
- finalization sampling、usage、Abort、deadline 与事务失败的 attempt 事实不丢失。
- Web 实时与历史 Grounding 使用同一严格 parser。
- Admin 使用 typed、bounded、fail-closed projector 审计 Retrieval、Finalization 和 Citation。
- ordinary、zero-hit、Tool failure、unclassifiable、legacy、malformed、FAILED、ABORTED 均有明确状态。

## 记录规则

- 只记录已经真实发生的事项。
- 研究定案、Issue 创建、实现、验收、Task 收口和合并是不同动作。
- Completed 必须有 GPT 技术验收和用户确认。
- 下一阶段未定案前，不创建正式 Issue、不修改正式状态。
