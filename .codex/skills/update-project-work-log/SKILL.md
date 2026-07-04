---
name: update-project-work-log
description: 更新 docs/work-log.md 的项目进展或 commit 上下文。Use only when the user asks to 更新项目工作记录、记录这次 commit、记录项目进度、写工作日志、保存 Codex 项目记忆, or during an explicit commit / git commit workflow.
---

# 更新项目工作记录

## 目标

维护 `docs/work-log.md`，让后续 Codex 能快速理解项目最近做了什么、验证了什么、下一步是什么。

`work-log` 只记录项目事实，不替代：

- `docs/roadmap.md`：阶段路线。
- `docs/tasks/README.md`：任务看板。
- `docs/tasks/**`：具体任务和验收。
- `docs/research/**`：研究资料。

## 使用时机

| 场景 | 是否更新 |
| --- | --- |
| 用户明确要求记录进度 | 更新 |
| commit / git commit workflow | 按需更新 |
| 重要架构决策 | 更新 |
| 阶段完成或任务状态明显变化 | 更新，并同步对应 task docs |
| 小修、typo、纯样式微调 | 通常不更新 |

## 默认流程

1. 读取：
   - `docs/work-log.md`
   - `docs/tasks/README.md`
   - 当前相关任务文档
   - `git status --short`
   - 必要时读取 `git diff --stat`
2. 判断本次记录类型：
   - 功能开发
   - 架构迁移
   - 错误修复
   - 文档整理
   - 技术决策
   - commit 总结
3. 写入内容保持简洁：
   - 日期：`YYYY-MM-DD`
   - 提交：commit 前写 `待提交`，commit 后可写短 hash
   - 类型
   - 核心完成
   - 关键文件
   - 验证结果
   - 下一步
4. 如果本次处于 commit workflow，记录范围明确时可以直接写入；不确定时先问用户。
5. 记录不得包含 API Key、token、数据库密码、完整敏感报错。

## 当前状态表规则

`docs/work-log.md` 顶部的当前状态只在项目阶段或下一步明显变化时更新。

不要每次 commit 都重写当前状态。

## 写作原则

- 简体中文。
- 只写真实发生的事实。
- 一次记录尽量短。
- 不复制任务文档的大段内容。
- 不把研究总结写进 work-log；研究资料放 `docs/research/`。
- 如果改动推进了任务 checklist，同时更新对应 `docs/tasks/**`。

## 输出方式

完成后只需简短说明：

- 是否更新 `docs/work-log.md`。
- 新增或修改了哪条记录。
- 是否同步了对应任务文档。
