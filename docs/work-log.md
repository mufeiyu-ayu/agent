# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看对应 Task 文档、Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-8 Completed；当前无 Active Agent Task | Phase 8 代码阅读、学习复盘与作品集整理 |
| Phase 8 | Task 0、1、2A、2B、3A、3B、3C 全部 Completed | [阶段归档](./tasks/phase-08-grounded-retrieval/README.md) |
| Minimal Compaction | Gated | 只有真实 Context 压力证据满足触发条件后才讨论 |
| Admin Console | Task 0-3、Enhancement 1、Phase 8 Task 3C Completed；Task 4 Planned | 不自动启动 Auth / RBAC |
| Phase 9 | 未定案 | 学习闭环后基于真实需求讨论 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
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
Phase 8 代码阅读
  -> 学习复盘
  -> 作品集 / 架构文档沉淀
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
