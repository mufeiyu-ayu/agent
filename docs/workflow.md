# 协作工作流

本文件是仓库的默认协作流程与硬约束，由 `AGENTS.md` 用 `@docs/workflow.md` 导入，每个会话自动进入上下文；不解析 `@` 的工具在会话开始先读本文件。流程形态由用户本轮明确指令决定：默认走第 1 节的单角色流程；用户明确要求把规划 / 验收交给另一侧会话时，转到 [`development-workflow.md`](./development-workflow.md) 的多角色分工流程。第 2 节的硬约束对两种流程、任何工具都成立。

下文的 `<review 命令>`、`<分支前缀>` 和 skill 取该工具适配文件里的值。

## 1. 单角色流程（默认）

单角色搭档：陪读源码、当架构讨论对手、建 Issue、实现、review、验收、收口、带读，全部在同一会话完成，不存在另一个模型做规划或验收。

### 默认模式

没有命中下面的触发语时，只做源码阅读、讨论、方案草稿、本地实验和小改动：不建 Issue、不切分支、不 commit、不 push、不改任务状态。用户可以在本次指令中扩大或缩小范围。

### 正式改动流程

```text
用户先预测：AI 出一道「现在的代码遇到 X 会怎样」，用户凭自己的理解作答，AI 指出对错
  -> 聊清楚（本会话讨论到用户拍板）
  -> 建 Issue（gh；写目标、当前代码事实、范围、边界、验收标准、决策记录）
  -> 独立分支 <分支前缀>/issue-N-<slug> 实现 + 最小必要验证
  -> 暂存后、commit 前用 <review 命令> 自审并修复
  -> commit、push、创建 PR
  -> 高风险 Issue：停在 PR，另开一个不带实现上下文的新会话只对 PR 跑 <review 命令>，findings 回本会话处理
  -> 验收：基于 PR 最新 head 逐条核对验收标准，给出 PASS / FAIL
  -> PASS：合并、删除远程与本地分支、同步 docs 状态、在会话汇报
  -> FAIL：停在 PR，说明原因，不合并
  -> 带读：AI 从入口带用户过一遍本次改动，结束时用户用自己的话讲回来，AI 指出偏差
  -> 用户在纯 TypeScript 层独立改一处小而关键的逻辑或测试，AI 只 review 不动手
```

### 触发语与授权默认范围

| 触发语 | 执行方式 |
| --- | --- |
| 「完成 Issue #N」「读取 Issue #N 并实现」 | 该工具的 `github-issue-workflow` skill，默认一路执行到合并与收口 |
| 「处理 PR #N 的 Review」 | 该工具的 `github-pr-review-fix` skill；仅在用户明确要求处理 PR 上的外部 Review 评论时使用，不是默认步骤 |
| 「建 Issue」「把刚才聊的立项」 | 本会话用 `gh` 建 Issue，内容取自本会话结论 |
| 「更新 docs」「收口」「写入 master」 | docs-only 变更直接提交 `master` |

用户随时可以要求停在 PR、先看 diff 或改用 Draft，本次指令高于默认。

### 本流程专属约束

- 验收 FAIL 不合并，停在 PR 并说明原因。
- Review 与验收都由本会话完成：commit 前的 `<review 命令>` 是唯一必需的本地 review，不等待也不依赖任何远程自动 Review；仓库里第三方 Review bot 的评论不阻塞流程。
- 高风险 Issue 指涉及持久化、恢复、owner fencing、审批、鉴权或数据库 migration 的改动。这类 Issue 在验收前多一道独立会话 review：新会话不带实现上下文，只读 Issue 规格与 PR diff；`github-issue-workflow` skill 在创建 PR 后停下并说明，用户说「继续 Issue #N」再验收。普通 Issue 不加这道。
- 学习环节是流程的一部分：开工前的预测题由 AI 主动出，不等用户要求；带读收尾与独立改一处在合并后进行，不阻塞合并。两项都过才把该步记为「学习已验证」，与「代码完成」分开记录，判定标准见 [`roadmap.md`](./roadmap.md) 的学习出口。独立改一处只落在纯 TypeScript 层（循环、状态、测试），NestJS 装配与 Prisma migration 仍由 AI 写，用户在带读时讲清即可。

## 2. 各流程共用的硬约束

以下约束对两种流程、任何工具都成立：

- `docs/tasks/**` 是任务与阶段状态的事实来源；Issue 保存实现规格、验收标准和澄清决策。
- 正式代码任务先建 Issue，再走独立任务分支和 PR，不直接在 `master` 上实现、提交或推送。
- 一个 Issue / PR 只完成一个任务单元，不顺手推进后续任务。
- 暂存之后、commit 之前必须用 `<review 命令>` 审暂存区 diff：确认为真问题的 finding 自行修复并入本次提交，不为技术判断等待用户确认；无法复现、超出范围或与已确认规格冲突的不修但要说明；复审最多 2 轮后停止并记录剩余问题。docs-only 改动跳过。
- review 在本地完成，通过后才创建 PR；PR 是验收载体，除高风险 Issue 的独立会话 review 外不用来收集 review。PR 创建即为 Ready，只有实现未完成、验证失败或受阻才用 Draft；云端自动 Review 是可选输入，不阻塞交付。
- 不因技术意见取舍打断用户；只在缺少密钥、权限、登录等授权类前提，或出现会改变实现方向的规格冲突时中断询问。
- 验收必须基于 PR 最新 head，逐条核对验收标准与真实验证输出；「测试命令成功」或「代码看起来合理」不单独构成验收。
- 验收确认、docs 状态收口、合并和分支清理是不同动作，各自需要用户明确授权，不得自行推导；用户可以在同一句指令中一并授权；单角色流程的默认授权范围见第 1 节，多角色分工流程见 `docs/development-workflow.md`。任何工具都不得自行把任务标成 Completed；Phase 是否 Completed 还必须满足该阶段自己的完成条件。
- Review finding 与最新 Issue 决策或项目规范冲突时，不为「通过 Review」反向违反已确认规格，应说明冲突并按事实来源解决。
- 正式 GitHub 交付前必须先用 `gh auth status --hostname github.com` 和 `git push --dry-run origin HEAD` 预检凭据，且不得输出 token。若认证失效、凭据缺失、权限不足或 dry-run 因凭据失败，必须立即停止当前任务并告知用户；不得自行改用 GitHub API、Connector 或手工上传 blob / tree / commit / ref 绕过失败。
- 当前不把 GitHub Actions 作为必需环节；commit 前的本地自审（本地验证 + review 结论）是唯一必需的检查，PR diff、云端 Review 和验收记录是补充证据。
- 用户明确授权「更新 docs 并写入 master」「直接改 docs」「收口任务状态」等 docs-only 操作时，可以绕过 Issue / PR；业务功能、API / contracts、数据库、Agent Runtime、Streaming、Tool Calling、依赖、环境、安全或权限变更仍禁止直接写 `master`。
- 讨论、源码阅读、inspection-only、本地实验和小改动默认自由进行，不自动切任务分支、commit、push、创建 PR 或更新任务状态。
