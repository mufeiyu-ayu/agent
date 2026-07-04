# 阶段 3 归档：Streaming Chat 最终态一致性

状态：已完成。

## 完成目标

阶段 3 已从“基础链路可用”收口到“完成、失败、中断都能稳定落库和恢复”。

## 已完成能力

| 能力 | 结果 |
| --- | --- |
| 正常完成 | assistant message 最终状态为 `COMPLETED` |
| 模型失败 | assistant message 最终状态为 `FAILED` |
| 用户停止 | assistant message 最终状态为 `ABORTED` |
| 状态兜底 | 避免 assistant message 长期残留 `STREAMING` |
| partial content | aborted 时保留已经生成的部分内容 |
| 多会话防串 | 前端继续按 conversation 维度隔离 stream event |

## 关键改动

| 文件 | 说明 |
| --- | --- |
| `apps/api/src/seo/seo.controller.ts` | HTTP stream close 时显式触发 abort |
| `apps/api/src/seo/seo.service.ts` | 在 done / error / aborted / finally 路径写入最终状态 |
| `docs/roadmap.md` | 阶段 3 标记完成，阶段 4 成为下一阶段 |
| `docs/tasks/README.md` | 任务看板同步阶段状态 |
| `docs/work-log.md` | 记录阶段 3 收口提交 |

## 验证结果

- service-level smoke 覆盖 `COMPLETED`、`FAILED`、generator 提前关闭后的 `ABORTED`。
- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `git diff --check` 通过。

## 下一阶段

进入阶段 4：Agent Runtime 基础。

下一任务：`docs/tasks/phase-04-agent-runtime/task-01-agent-run-step-model.md`。
