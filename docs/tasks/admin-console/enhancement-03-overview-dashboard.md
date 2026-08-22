# Admin Console Enhancement 3：Overview 数据仪表盘

## 状态

```text
实施状态：已实现
验收状态：已通过
任务状态：Completed
PR 状态：Merged
```

- Issue：[#90](https://github.com/mufeiyu-ayu/agent/issues/90) / Closed
- PR：[#91](https://github.com/mufeiyu-ayu/agent/pull/91) / Merged
- Merge commit：`3108a5f`
- 实现分支：`codex/issue-90-overview-dashboard`（远程与本地均已删除）
- Clarification Gate：`READY`（选型与聚合决策见 Issue 正文）
- Review：commit 前 /code-review 一轮 5 项全部处理（含模型分布字段路径确认级 bug）；视觉验收反馈一轮（stat bar + 比例条重构）后用户确认通过并授权合并（2026-08-22）

## 目标与交付

Overview 从静态占位卡改造为真实数据仪表盘：

- `GET /api/admin/overview/stats`：数字卡汇总、近 30 天每日 Run 与输入/输出 Token（Asia/Shanghai 归日补零）、状态/模型/工具分布（统一 30 天窗口）；
- `GET /api/admin/overview/balance`：服务端代理 DeepSeek `/user/balance`（复用 `LLM_API_KEY`，5s 超时，失败降级）；
- 前端：`echarts` + `vue-echarts` 按需注册；单卡四格 stat bar + 两张 ECharts 趋势图 + 三张纯 CSS 比例条分布列表；图表基础色跟随亮暗主题；
- `LlmModule` 导出 `LLMRuntimeConfigService` 复用单例。

聚合口径：应用层扫描窗口内 `model_sampling` / `tool_execution` step（usage 在 JSON 列，无统计表），`ponytail:` 注释标注物化统计升级路径；Token/模型分布只计 action sampling，grounded finalization 收尾采样暂不计入。

## 验证记录（2026-08-22）

- workspace typecheck、api/admin lint、admin state/i18n/run-data 检查
- `pnpm --filter @agent/api test:admin-overview`（4/4）、llm.module 测试（4/4）
- `pnpm --filter @agent/admin build`（按需注册构建通过）
- 真实接口实调：stats 返回模型分布与每日趋势；balance 返回 42.85 CNY

## 结论与边界

- DeepSeek 官方对 API key 仅开放 `user/balance`；平台后台的消费金额/请求次数/用量曲线是内部接口（登录态鉴权），已实测探测 404 并核对官方文档 sitemap 全部 10 个 API 端点确认。项目内花费视角只能基于自有落库 usage 聚合。
- 后续可选增量：自算金额趋势（落库 token × 官方牌价），未立项。
