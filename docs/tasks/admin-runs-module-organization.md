# Admin Runs Projector 模块组织与循环依赖消除

状态：**Completed / Issue #102 / PR #106**。

## 目标

将 Admin Runs 的 Read Model 投影按 Facade、Context、Retrieval、Sampling Usage 与安全 Readers 分层，消除两个超大 Projector 的循环 import；所有 Admin Contract、fixture 与 fail-closed 行为保持不变。

## 背景

`admin-run.projector.ts` 与 `admin-retrieval-inspector.projector.ts` 合计超过 3000 行，并互相 import。主 Projector 调用 Retrieval，Retrieval 又从主文件读取通用 JSON helpers，导致目录和依赖方向都无法表达真实职责。

本任务是 Backend 模块组织系列第 2 项；#103、#104 等待本任务收口，不并行启动。

## 学习重点

- Read Model / Projector 与业务 Domain Model 的区别。
- 如何用稳定的 shared readers 消除 ES Module 循环。
- 如何拆分大文件且保持 malformed / legacy / partial 的安全降级结果。

## 范围

- 新建 `admin-runs/projection/`。
- 保留 `admin-run.projector.ts` 作为 Run List / Detail facade。
- 提取 Context Inspector、Retrieval Inspector、Sampling Usage 与 `safe-readers`。
- 移动相关测试并更新 AdminRunsService、AdminOverview 和 package script。
- 增加模块导航和旧路径 / 循环依赖检查。

## 不做什么

- 不修改 `@agent/contracts`、Prisma Query、Admin UI、分页或权限。
- 不放宽任何 fail-closed 规则，不增加 Inspector 或指标。
- 不处理 #103、#104 或其它后端目录，不启动 Admin Task 4 / Phase 9。

## Red：锁定失败与回归用例

- [x] 主 Projector 与 Retrieval Inspector 不再互相 import。
- [x] Admin Overview 从稳定 readers 边界读取 Usage。
- [x] Context sequence、Retrieval correlation 与 Usage 聚合 fixtures 保持一致。
- [x] malformed / legacy / partial / contradictory metadata 继续降级。

## Green：最小实现

- [x] 建立 projection 目录并移动 Projector / 测试。
- [x] 提取 `safe-readers.ts` 并消除循环依赖。
- [x] 提取 Context Inspector 与 Sampling Usage 函数簇。
- [x] 更新 Service、Overview、scripts 和模块导航。

## Refactor：整理边界

- [x] 删除旧路径，不保留转发文件或 barrel。
- [x] 复核 facade -> 子 Projector -> safe readers 单向依赖。
- [x] 复核测试与被测实现同目录。

## 验证命令

```bash
pnpm --filter @agent/api test:admin-runs
pnpm --filter @agent/api test:admin-overview
pnpm --filter @agent/api test:grounding
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm --filter @agent/admin test
pnpm --filter @agent/admin typecheck
pnpm typecheck
git diff --check
```

## 验收标准

- [x] AC-01：主 Projector 与 Retrieval Inspector 不再循环 import。
- [x] AC-02：Projection 目录按职责可导航，Facade 与 readers 入口明确。
- [x] AC-03：Run List / Detail、Context、Retrieval、Grounding、Usage 输出不变。
- [x] AC-04：malformed、legacy、partial 与矛盾 metadata 继续安全降级。
- [x] AC-05：Admin Overview 迁移到稳定 readers 边界。
- [x] AC-06：无 Contract、Prisma、UI、依赖或范围外变化。

## 验证结果

- Admin Runs：146 / 146 通过。
- Grounding：171 / 171 通过。
- Admin Overview：通过。
- Admin state / i18n / run-data checks：通过。
- API build、API typecheck、API lint、Admin typecheck、workspace typecheck、`git diff --check`：通过。
- 旧源码 / package script 路径：无残留。
- Projection 依赖方向：facade -> context / retrieval / usage -> safe readers，无反向 import。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 函数移动改变隐式共享状态 | 子模块只接收显式输入，保留 fixture 回归 |
| readers 变成万能 utils | 只承接已有纯 JSON / primitive readers |
| 拆分后产生新循环 | import graph 与旧路径检查 |

## GitHub 交付记录

- Issue：[Issue #102](https://github.com/mufeiyu-ayu/agent/issues/102)
- 分支：`codex/issue-102-admin-run-projections`
- PR：[PR #106](https://github.com/mufeiyu-ayu/agent/pull/106)（验收通过，已授权转 Ready、合并与分支清理）
- GPT 验收结论：通过（基于 head `a532c0839f`、完整 AC 映射、验证结果与两道 Codex Review）
- 用户确认：已确认验收并授权 Ready、合并、分支清理和启动 #103

## 任务状态

- 实施状态：已实现
- 验收状态：已通过
