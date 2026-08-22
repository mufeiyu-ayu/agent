# Task：DeepSeek 思考强度控制与 Usage 可观测闭环（Issue #94）

- 实施状态：已实现
- 验收状态：已通过（用户 2026-08-23 确认 UI 验收；独立技术复核通过）
- Issue：[#94](https://github.com/mufeiyu-ayu/agent/issues/94)（Closed）
- 分支：`codex/issue-94-deepseek-reasoning-usage`（已合并删除）
- PR：[#95](https://github.com/mufeiyu-ayu/agent/pull/95)（Merged / `2266fad`）

## 目标

让 Web Composer 按单次请求选择 Low / High / Max，并由同一份 resolved Run 配置贯穿 action sampling、Tool continuation 与 grounded finalization；同时把 DeepSeek reasoning / cache Usage 安全持久化到 AgentStep，并在 Admin Run Detail 中可信展示。

## 已锁定边界

- Thinking Mode 始终 enabled，默认 High，不提供 Off。
- Thinking 请求不发送 `temperature`。
- `reasoning_content` 只用于当前 Run 的 Tool continuation，不进入外部事件、安全 Admin 投影、日志或 DOM。
- 新 Usage 字段是 optional provider fact；缺失或损坏时按指标独立显示不可用，不补 0。
- 复用 AgentStep JSON metadata；无 Prisma migration、无预算调整、无 Overview / Run List 新列。

## 实现结果

- Shared contract / DTO：共享 `low | high | max` allowlist；非法字符串、空白、非字符串和 `null` 在创建 AgentRun 前返回 400，legacy 省略由后端解析为 High。
- Web：Composer 新增可访问的思考强度选择器；状态生命周期与模型选择一致；当前选项随每次 stream request 发送；桌面与 320px 均通过浏览器验收。
- Provider：`ResolvedChatRequestConfig` 携带 `reasoningEffort`；DeepSeek wire body 显式发送 `thinking: { type: 'enabled' }` 与 `reasoning_effort`，删除无效 `temperature`。
- Runtime：同一 Run 的 direct final、一次 Tool、两次 Tool 与 grounded finalization 共用同一 resolved effort；成功、失败和 Abort 路径保留已收到 Usage。
- Usage / Admin：新增 `reasoningTokens`、`promptCacheHitTokens`、`promptCacheMissTokens`；Sampling / Finalization 与 Run Detail Header 展示明细；Run 汇总按指标独立 all-or-nothing；legacy / partial / malformed 数据 fail closed。
- 安全：debug 捕获在落库前递归移除 `reasoning_content`，保留可核验的实际请求体且不把思维链投影给 Admin。

## Red 用例结果

- [x] Web 默认 High、三档选择、320px 无横向溢出，选项进入本次请求。
- [x] DTO 只放行 low / high / max；非法值不进入下游。
- [x] Provider wire body 显式 thinking / reasoning_effort，且没有 temperature。
- [x] direct final、一次 Tool、两次 Tool、grounded finalization 强度不漂移。
- [x] reasoning / cache Usage 支持完整与逐项缺失，不补假 0。
- [x] Sampling / Finalization 成功、失败和 Abort 保留已成立 Usage。
- [x] Admin 对完整、部分缺失、legacy、malformed Usage 做确定性安全投影。
- [x] `reasoning_content` 不进入安全 Admin projection 或 DOM。

## 验证记录（2026-08-22，本地）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/contracts build` | 通过 |
| `pnpm --filter @agent/api test:llm-config` | 21 / 21 通过；含真实 OpenAI SDK wire body 序列化边界 |
| `pnpm --filter @agent/api test:seo-service` | 32 / 32 通过 |
| `pnpm --filter @agent/api test:tool-loop` | 62 / 62 通过 |
| `pnpm --filter @agent/api test:model-stream` | 80 / 80 通过 |
| `pnpm --filter @agent/api test:agent-recorder` | 14 / 14 通过 |
| `pnpm --filter @agent/api test:grounding` | 171 / 171 通过 |
| `pnpm --filter @agent/api test:admin-runs` | 144 / 144 通过 |
| `pnpm --filter @agent/web test` | 44 / 44 通过 |
| `pnpm --filter @agent/admin test` | 通过 |
| API / Web / Admin lint | 通过 |
| Web Chromium：桌面 + 320px reasoning selector | 1 / 1 通过；本机 5174 已有 Admin dev server，临时使用空闲 5175 |
| Admin Chromium：Header / Sampling / Finalization Usage | 1 / 1 通过 |
| `pnpm typecheck` | 通过 |
| `git diff --check` | 通过 |

合并后独立复核发现 reasoning E2E 的 `High` 定位同时匹配父菜单和子项；修正为精确匹配后，使用 `E2E_PORT=5185 pnpm --filter @agent/web test:e2e` 完整复跑 Web Chromium 10 / 10。该问题仅影响测试定位，不影响已通过用户验收的 UI 行为。

数据库与真实 Provider smoke 未运行：本任务无 schema 变更，wire body、Usage 解析与完整 Runtime 路径已由确定性测试覆盖；不消耗真实模型额度。

## 最终收口事实

Issue #94 已关闭，PR #95 已合并；用户确认 UI 验收通过，确定性测试、完整 Web Chromium 与 Admin Chromium 均通过。Task 状态为 Completed；本任务不启动 Phase 9。
