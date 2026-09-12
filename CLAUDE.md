# CLAUDE.md

@AGENTS.md

本文件只写 Claude Code 的专属差异。工具无关基线（项目定位、沟通、状态入口、目录、架构原则、NestJS / 前端 / 安全 / 验证 / docs 规则，以及各流程共用的硬约束）由上面的 `@AGENTS.md` 引入，不在此重复；多角色分工流程见 `docs/development-workflow.md`，不适用本文件。

## 工作方式：单角色流程

单角色搭档：陪读源码、当架构讨论对手、建 Issue、实现、review、验收、收口，全部在同一会话完成，不存在另一个模型做规划或验收。

### 默认模式

没有命中下面的触发语时，只做源码阅读、讨论、方案草稿、本地实验和小改动：不建 Issue、不切分支、不 commit、不 push、不改任务状态。用户可以在本次指令中扩大或缩小范围。

### 正式改动流程

```text
聊清楚（本会话讨论到用户拍板）
  -> 建 Issue（gh；写目标、当前代码事实、范围、边界、验收标准、决策记录）
  -> 独立分支 claude/issue-N-<slug> 实现 + 最小必要验证
  -> 暂存后、commit 前 /code-review 自审并修复
  -> commit、push、创建 PR
  -> 验收：基于 PR 最新 head 逐条核对验收标准，给出 PASS / FAIL
  -> PASS：合并、删除远程与本地分支、同步 docs 状态、在会话汇报
  -> FAIL：停在 PR，说明原因，不合并
```

### 触发语与授权默认范围

| 触发语 | 执行方式 |
| --- | --- |
| 「完成 Issue #N」「读取 Issue #N 并实现」 | `.claude/skills/github-issue-workflow`，默认一路执行到合并与收口 |
| 「处理 PR #N 的 Review」 | `.claude/skills/github-pr-review-fix`；仅在用户明确要求处理 PR 上的外部 Review 评论时使用，不是默认步骤 |
| 「建 Issue」「把刚才聊的立项」 | 本会话用 `gh` 建 Issue，内容取自本会话结论 |
| 「更新 docs」「收口」「写入 master」 | docs-only 变更直接提交 `master` |

用户随时可以要求停在 PR、先看 diff 或改用 Draft，本次指令高于默认。

### 本流程专属约束

- 自审步骤在本流程的具体形式是：暂存后、commit 前必须用 `/code-review` 审暂存区 diff。
- 验收 FAIL 不合并，停在 PR 并说明原因。
- Review 与验收都由本会话完成：commit 前 `/code-review` 是唯一必需的 review，不等待也不依赖任何远程自动 Review；仓库里第三方 Review bot 的评论不阻塞流程。
- 用户明确要求把规划 / 验收交给另一侧会话（多角色分工流程）时，转到 `docs/development-workflow.md`。
