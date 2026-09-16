# Tasks

本目录是正式任务状态的事实来源。规格、验收标准与决策记录在 GitHub Issue；已完成任务与阶段的详细记录在 [`completed/`](./completed/)、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Active Agent Task：无
Next：#118 删除死代码与单实现抽象（零行为变化）
Planned：#119 历史裁剪合一 → #120 抽出 packages/ai → #115 模型调用重试 → #116 同轮文本 + 多 Tool Call → #117 Responses API adapter → web_fetch（R0 后、R2 前）
候选子系统：session 事件流与 replay、审批门、compaction、定时任务（未立 Issue）
Admin Task 4：Planned
```

## 看板

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| #118 删除死代码、单实现抽象与自校验 | **Next** | 纯删除约 800 行、零行为变化；`receive_user_message` Step、`abortStep`、`AgentRunConfigurationService`、`TokenEstimator` 抽象类、`tool-step-summary` 等；不删 Admin 读取的字段与 `tool-evidence` 校验 |
| #119 历史裁剪合一 | Planned | 删 `InitialContextSelectionService` 分页与批内二分，一次查询到硬上限，首轮由 planner 裁剪；Admin 元数据同名字段保留；前置 #118 |
| #120 抽出 `packages/ai` | Planned | 模型客户端、流适配、类型、错误、profile 搬入零 Nest 的包，apps/api 只留壳；`packages/agent` 仍在 R2；前置 #119 |
| #115 模型调用重试与 Loop 默认上限 | Planned | SDK 内置重试（首个响应头之前）、`LLM_REQUEST_MAX_RETRIES`、采样 / 工具默认上限 10 / 8；在 `packages/ai` 内实现；前置 #120 |
| #116 同轮文本 + 多 Tool Call | Planned | content 先于 tool_calls、多个 tool_calls 顺序执行、上限解耦、截断参数回喂；前置 #115 |
| #117 Responses API adapter | Planned | `LLM_WIRE_API` 切换 chat / responses，第二个 adapter 接同一契约；前置 #116 |
| `web_fetch` 第一个真实工具 | Planned | 只读、SSRF 防护、untrusted observation；前置 #115–117，范围见 [pi-reference roadmap](../research/pi-reference/roadmap.md) |
| Admin Console Task 4 | Planned | Auth / RBAC；触发条件见 [roadmap.md](../roadmap.md) 后置清单 |
| 已完成 | Completed | Phase 2–8、横向任务 #92 / #94 / #98 / #101–#104、Admin Console Task 0–3 与 Enhancement 1–3，归档在 [completed/](./completed/) |
| 翻译质检站 #109 / #111 | 已删除 | 2026-09-05 经 #113 / PR #114 删除全部代码与数据模型 |

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 已记录方向，依赖或规格尚未满足启动条件 |
| Next | 已确认是下一项正式任务，Issue 已创建但未开工 |
| Active | Issue 已创建，正在实现或待验收；一次只有一个 |
| Gated | 只有客观触发条件满足后才重新讨论 |
| 已放弃 / 已删除 | 方向放弃；代码保留或删除按看板记录 |
| Completed | 已实现且验收通过：PR 逐条验收 PASS 并合并 |

## 规则

- 一个 Issue 只对应一个任务单元；Planned / Next 不能替代正式 Issue；
- Issue 建立前不得修改正式代码；Issue 实质性变化后先更新 Issue 再继续；
- 实现后先写「已实现、待验收」，验收 PASS 后才写「已通过」；
- 只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时建 Issue；Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不自动进入实现；
- 流程、Issue 模板与任务状态定义见 [`../workflow.md`](../workflow.md)。
