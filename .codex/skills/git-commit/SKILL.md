---
name: git-commit
description: 执行项目 commit 前的固定流程。Use when the user asks to commit、提交代码、git commit、帮我提交、提交当前改动, or when a commit should synchronize concise project docs before creating the git commit.
---

# Git Commit 工作流

## 目标

让每次 commit 保持三件事一致：

1. 代码改动范围清楚。
2. 必要验证已运行或说明原因。
3. 与本次改动相关的 docs 已同步，但不写重复长文。

## 默认流程

1. 检查改动范围：
   - `git status --short`
   - `git diff --stat`
   - 必要时读取关键 diff。
2. 判断本次改动属于哪个任务：
   - 优先查看 `docs/tasks/README.md`。
   - 以 `docs/tasks/README.md` 标记的 Active 任务为准。
   - 具体任务文档放在对应阶段目录，例如 `docs/tasks/phase-04-agent-runtime/`。
   - 不再把 `docs/development-task-plan.md` 当主看板。
3. 按需同步 docs：

| 情况 | 更新位置 |
| --- | --- |
| 推进任务 checklist、状态、验收 | 对应 `docs/tasks/**` 任务文档 |
| 阶段状态变化 | `docs/roadmap.md`、`docs/tasks/README.md` |
| 阶段完成 | 精简归档到 `docs/tasks/completed/` |
| 重要架构决策、commit 上下文、验证结果 | `docs/work-log.md` |
| 小修、样式微调、纯 typo | 通常不需要更新 docs |

4. 更新 `docs/work-log.md` 的规则：
   - commit workflow 中如果本次改动有明确项目推进，可以直接追加简洁记录。
   - 如果记录范围不确定，先向用户确认。
   - 记录只写事实：目标、核心完成、关键文件、验证结果、下一步。
   - 不记录长篇解释，不复制任务文档内容。
5. 运行验证：
   - 常规默认：`pnpm lint`。
   - 涉及 TS / Vue / Nest：`pnpm typecheck`。
   - 涉及前端构建或 Vite：`pnpm --filter @agent/web build`。
   - 涉及 Prisma：`pnpm prisma:generate`、`pnpm exec prisma validate`。
   - 验证失败先修；无法运行则说明原因。
6. 暂存文件：
   - 只 `git add` 本次相关文件。
   - 不提交 `.env`、密钥、无关大文件。
   - 不还原用户已有改动。
7. 创建 commit：
   - 提交信息使用中文。
   - 格式：`type: 简短说明`。
   - 常用 type：`feat`、`fix`、`docs`、`refactor`、`chore`、`test`。
8. 最终回复：
   - commit hash。
   - commit message。
   - 执行过的验证。
   - 是否同步 docs。

## 安全规则

- 不自动 `git push`，除非用户明确要求。
- 不执行 `git reset --hard`、`git clean -fd`、`git checkout --` 等破坏性命令，除非用户明确要求。
- 如果工作区包含明显无关改动，先说明提交范围，再只提交本次相关文件。
