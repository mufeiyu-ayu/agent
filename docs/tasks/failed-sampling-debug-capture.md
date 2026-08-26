# Task：失败 Sampling 部分响应可观测性（Issue #98）

- 实施状态：已实现
- 验收状态：已通过（GPT 技术验收通过，用户 2026-08-26 确认并授权合并）
- Issue：[#98](https://github.com/mufeiyu-ayu/agent/issues/98)（Closed）
- 分支：`codex/issue-98-partial-sampling-capture`（已合并删除）
- PR：[#100](https://github.com/mufeiyu-ayu/agent/pull/100)（Merged / `915315b`）

## 目标

补全 Issue #86 只捕获完整 Provider Response 的失败路径：开启 `AGENT_DEBUG_CAPTURE_MODEL_IO` 时，失败、提前关闭和中止的 action sampling 也保留有界、明确标记为不完整的聚合响应，并让 Admin 与安全日志区分 `complete`、`partial`、`empty`。

## 已锁定边界

- 捕获仍由 debug 开关控制并默认关闭；不扩大生产默认暴露面。
- 只聚合已收到的 SSE chunk，不逐 chunk 落库。
- 捕获是旁路观测，不覆盖原错误、Run / Message / Step 终态或 Tool 执行决策。
- 沿用 200K 字符上限、代理对安全截断、`reasoning_content` 剥离和 Admin 白名单投影。
- 复用 `AgentStep.output` JSON；无 Prisma migration、无新依赖。
- 不修改混合文本 / Tool Call 状态机；对应兼容问题由 Issue #99 独立处理。

## 实现结果

- `teeRawResponseCapture()` 在正常 EOF、上游异常、下游 `return()` 和首 chunk 前失败时分别提交一次 `complete`、`partial` 或 `empty` 捕获；捕获回调失败不改变模型流。
- `OpenAICompatibleClient` 在请求已发起但 SDK 未返回首 chunk 时补充 `empty` 事实，并保持原 LLM 错误转换。
- `AgentRuntimeService` 在异常、用户 Abort、deadline 和消费者提前结束时先关闭活动 sampling iterator，再把已成立 capture 写入原 `model_sampling` Step。
- 安全结构化日志只记录 `runId`、`samplingAttemptId`、终止分类、capture state、最后事件、文本字符数和 Tool Call 数。
- Admin contract / projector / Request Inspector 支持三态 Response；legacy 捕获映射为 `complete`，损坏信封 fail closed；复制 JSON 携带 capture state。

## 验收结果

- [x] 正常文本与 Tool Call 流各提交一次 `complete` capture。
- [x] 上游文本或 Tool Call 分片后断流提交 `partial`，原错误继续传播。
- [x] `text_delta -> tool_call_started -> consumer rejects` 保留 partial capture，Run / Step 仍 FAILED，Tool invocation 为 0。
- [x] 首 chunk 前失败提交 `empty`，不伪造 choices、finish reason 或 usage。
- [x] Abort、deadline 和外层消费者 `return()` 保持原终态语义。
- [x] debug 关闭、legacy、截断、循环引用与 malformed 信封确定性降级。
- [x] Admin 分别展示 partial / empty 提示，复制结果保留状态。
- [x] 无 Prisma、依赖、lockfile、自动重试或 Tool 协议变更。

## 验证记录（2026-08-26，本地）

| 验证 | 结果 |
| --- | --- |
| `pnpm --filter @agent/api test:model-stream` | 91 / 91 通过 |
| `pnpm --filter @agent/api test:tool-loop` | 65 / 65 通过 |
| `pnpm --filter @agent/api test:admin-runs` | 146 / 146 通过 |
| `pnpm --filter @agent/api test:llm-config` | 23 / 23 通过 |
| `pnpm --filter @agent/admin test` | 通过 |
| API / Admin lint、API / Admin / workspace typecheck | 通过 |
| Admin production build | 通过；保留既有大 chunk warning |
| Chromium route fixture | partial / empty 提示与 partial 复制状态通过 |
| `git diff --check` | 通过 |

未执行真实 Provider 故障注入；相同事件顺序已由确定性 fixture 覆盖，不消耗真实模型额度或改写本地业务数据。

## 收口结论

Issue #98 的 AC-01～09 已通过技术验收，用户明确确认后，PR #100 已合并为 `915315b`，Issue 已关闭，远程与本地任务分支已删除。本任务作为独立横向可观测性修复 Completed，不启动 Phase 9。
