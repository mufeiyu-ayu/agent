# Agent Runtime 模块组织与 Cancellation 生命周期边界

状态：**已实现、待验收 / Issue #101 / Gate READY**。

## 目标

按 Codex 式“根入口 + 领域子目录”的混合结构重组 `apps/api/src/agent-runtime/`，并把 Run Cancellation 从主编排 Service 提取为独立、可测试的 Lifecycle 状态机；所有运行行为保持不变。

## 背景

Phase 4-8 持续增加 Configuration、Context、Sampling、Grounding 与终态可靠性后，Agent Runtime 已有 5000 余行生产代码，但除 `grounding/` 外仍大多平铺。`agent-runtime.service.ts` 同时承担主编排和 Cancellation 状态机，阅读时难以识别不同抽象层级。

本任务是后端目录治理系列第 1 项；后续 #102 Admin Runs、#103 Article Chunking、#104 Retrieval 均独立实施，不进入本任务。

## 学习重点

- 区分领域状态机与普通工具函数。
- 理解模块入口、内部领域和跨模块依赖方向。
- 理解纯结构重构也必须锁定 Abort、deadline 与 COMMIT 竞争语义。

## 范围

- 根目录保留 Module、Service、Types、Errors。
- 新建 `configuration/`、`lifecycle/`、`context/`、`sampling/`，保留 `grounding/`。
- 移动源码与测试并更新全部 import、脚本和当前源码导航。
- 提取 `run-cancellation.ts`，新增独立状态机测试。

## 不做什么

- 不处理 #102、#103、#104 或其它后端目录。
- 不修改公开协议、数据库、依赖、环境变量、默认值、Tool / Context / Grounding 算法。
- 不新增兼容转发文件、barrel 或万能 `utils/`。
- 不启动 Phase 9。

## Red：锁定失败与回归用例

- [x] user / deadline / failure 只保留第一个终止原因。
- [x] completing 期间的 user / deadline 等待 COMMIT 结果再决定。
- [x] completed 不被迟到取消覆盖。
- [x] dispose 清理 timer 与 userSignal listener。
- [x] 旧目录 import、脚本和手工 smoke 入口全部失效时能被检查发现。

## Green：最小实现

- [x] 按 Issue #101 目标结构移动源码与测试。
- [x] 提取 Run Cancellation Lifecycle 边界。
- [x] 更新 Nest Module、跨模块 import 和 package scripts。
- [x] 增加模块导航与独立 Cancellation 测试。

## Refactor：整理边界

- [x] 删除旧路径，不保留转发文件。
- [x] 复核根目录只剩公共入口与公共语言。
- [x] 复核测试与被测实现同目录、依赖方向无循环。

## 验证命令

```bash
pnpm --filter @agent/api test:agent-recorder
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:grounding
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

## 验收标准

- [x] AC-01：目录结构符合 Issue #101，根目录只保留公共入口与公共语言。
- [x] AC-02：Cancellation 拥有独立 Lifecycle 文件和测试。
- [x] AC-03：first-cause 与 completion COMMIT 竞争语义不变。
- [x] AC-04：Context、Sampling、Grounding、Tool Loop 和外部流协议无回归。
- [x] AC-05：无旧 import、兼容转发文件或无意义 barrel。
- [x] AC-06：无新依赖、数据库、契约或范围外改动。

## 验证结果

- Lifecycle / Recorder：21 / 21 通过。
- Tool Loop / Configuration：65 / 65 通过。
- Model Stream：91 / 91 通过。
- Context：24 / 24 通过。
- Grounding：171 / 171 通过。
- Admin Runs：146 / 146 通过。
- SEO Service：32 / 32 通过。
- API build、API typecheck、API lint、workspace typecheck、`git diff --check`：通过。
- 旧 TypeScript import 与 package script 路径检查：无残留。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 文件移动遗漏脚本、测试或 smoke import | typecheck、定向测试与旧路径 `rg` 双重检查 |
| Cancellation 提取改变 COMMIT 竞争语义 | 独立状态机测试 + 现有 Runtime 回归 |
| 目录重组扩大成算法重构 | Issue non-goals 与 diff 审查限制范围 |

## GitHub 交付记录

- Issue：[Issue #101](https://github.com/mufeiyu-ayu/agent/issues/101)
- 分支：`codex/issue-101-agent-runtime-layout`
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认

## 任务状态

- 实施状态：已实现
- 验收状态：待验收
