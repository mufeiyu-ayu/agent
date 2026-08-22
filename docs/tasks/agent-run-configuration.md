# Task：单次 Run 配置解析边界与配置导航（Issue #92）

- 实施状态：已实现
- 验收状态：已通过（AC-01～09 逐项核对通过，用户 2026-08-22 确认并授权合并）
- Issue：[#92](https://github.com/mufeiyu-ayu/agent/issues/92)（Closed）
- 分支：`codex/issue-92-run-config-boundary`（已合并删除）

## 目标

建立单次 Agent Run 的统一配置解析入口 `AgentRunConfigurationService`，把散落在 `runTurnStream()` 内的 Policy 读取、Tool allowlist 筛选、模型请求解析和 Model Profile 补查收敛为一份 `ResolvedAgentRunConfiguration`；补一份当前源码配置地图。

## 改动摘要

- `apps/api/src/llm/llm-runtime-config.ts`：`ChatRequestConfig` 重命名为 `ResolvedChatRequestConfig`，补全 `contextWindowTokens` 与 `temperature`；`DEFAULT_CHAT_TEMPERATURE` 并入本文件，删除单行 `llm.constants.ts`。
- `apps/api/src/llm/model-profiles.ts`：`SUPPORTED_DEEPSEEK_MODELS` 与 `SupportedDeepSeekModel` 从 `llm.types.ts` 移入，模型名单与 Profile 单文件维护。
- 新增 `apps/api/src/agent-runtime/agent-run-configuration.service.ts`：组合 resolved 请求配置 + Tool allowlist；`policy` 经 getter 单独暴露（Run deadline 需在可能抛错的请求解析之前生效）；Registry 缺失 allowlisted Tool 时记录 warn 并按既有语义跳过。
- `apps/api/src/agent-runtime/agent-runtime.service.ts`：移除 `getModelProfile` 穿透依赖与 `!` 断言、`AGENT_RUN_TOOL_NAMES`、Tool 筛选与 Policy 直读；配置解析时机保持在 AgentRun / receiveUserMessageStep 落库之后，终态化语义不变；Initial Context、Sampling、Grounded finalization 共用同一份 resolved 请求配置。
- Provider Client 改用 `requestConfig.temperature`（同默认值，行为不变）。
- 测试：新增 `agent-run-configuration.service.test.ts`（allowlist 顺序 / 排除、`maxToolCalls=0`、Registry 缺失跳过、覆盖透传、空 model 回落）；`agent-runtime.service.test.ts` 新增 AC-04 用例（请求级覆盖时 Context 与 Provider 请求同源）；4 处构造点（harness、grounding runtime/db 测试、smoke CLI）同步更新。
- 文档：新增 [`docs/research/configuration-map.md`](../research/configuration-map.md) 配置地图。

## Red 用例结果

- [x] `ResolvedChatRequestConfig` 直接提供 `contextWindowTokens`（llm-runtime-config 单测）。
- [x] `AgentRuntimeService` 不再导入 `getModelProfile`，无 `!` 断言（rg + typecheck）。
- [x] resolved model / max output 同时用于 Initial Context 与模型请求（AC-04 新用例）。
- [x] 覆盖 model / maxTokens 时 Context 与 Provider 请求严格一致（AC-04 新用例）。
- [x] 不支持模型 / 越界 maxTokens 在 Provider 请求前失败（既有 llm-config 用例保持通过）。
- [x] 默认 `maxToolCalls=2` allowlist 不变；`maxToolCalls=0` 时 model tools 为空（新单测 + 既有零预算用例）。
- [x] Tool Registry 缺定义时保持当前行为（新单测）。
- [x] LLM / Policy 默认配置与 fail-fast 测试保持通过。
- [x] `runTurnStream()` 内不再散落配置组合逻辑（代码审查）。

## 验证记录（2026-08-22，本地）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/api test:llm-config` | 19/19 通过 |
| `pnpm --filter @agent/api test:tool-loop` | 61/61 通过 |
| `pnpm --filter @agent/api test:context` | 24/24 通过 |
| `pnpm --filter @agent/api test:model-stream` | 77/77 通过 |
| `pnpm --filter @agent/api test:seo-service` | 31/31 通过 |
| `pnpm --filter @agent/api test:grounding` | 171/171 通过 |
| `pnpm --filter @agent/api lint` | 通过 |
| `pnpm typecheck`（root，web/admin/api） | 通过 |
| `git diff --check` | 通过 |

`test:grounding-db` / smoke 未运行（需数据库与真实模型凭据）；构造链影响已由 `test:grounding` 内的 runtime 测试与 typecheck 覆盖。

## GitHub 交付

- PR：[#93](https://github.com/mufeiyu-ayu/agent/pull/93)，用户授权后转 Ready 并合并，merge `f32cd48`。
- Gate READY 记录：[Issue #92 评论](https://github.com/mufeiyu-ayu/agent/issues/92#issuecomment-5380675918)。
- Issue #92 Closed，远程与本地任务分支已删除。
