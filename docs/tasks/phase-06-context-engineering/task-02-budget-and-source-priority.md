# Task 2：Token 预算、来源优先级与安全裁剪

## 任务状态

- 看板状态：Planned
- 实施状态：未开始
- 验收状态：未验收
- 前置任务：Task 1 Completed
- Issue：未创建
- PR：未创建

## 目标

用确定性、provider-neutral 的近似 token 预算替代“固定最近 12 条消息是唯一控制手段”的现状，并建立来源优先级、completion reserve、safety margin、整 Turn / 整 Tool pair 裁剪和可解释决策报告。

## 背景

固定消息条数无法反映内容长度：12 条短消息可能很小，2 条超长 Tool Observation 也可能占满窗口。模型还需要为最终回答预留 output tokens，不能把整个 context window 都分给输入。

阶段 6 不追求完美 tokenizer，而是先建立可预测、可测试、失败时安全的预算接口。

## 学习重点

- context window、input tokens、output tokens、completion reserve 与 safety margin 的关系。
- 为什么 token estimator 应可注入、可替换，而不是散落 `length / 4`。
- source priority 与“越新越重要”不是同一个概念。
- 为什么超预算时要裁剪完整 Turn 或完整 Tool pair。
- 预算错误为什么应 fail closed，而不是偷偷丢掉 system instruction 或当前输入。

## 范围

- 定义预算公式：

```text
inputLimit = contextWindow - completionReserve - safetyMargin
```

- 引入确定性 `TokenEstimator` 接口；默认实现允许使用保守近似估算，但必须可替换、可单测。
- 预算配置至少表达：
  - model context window；
  - completion reserve；
  - safety margin；
  - per-source limit 或 allocation；
  - estimated input tokens。
- 建立最小来源优先级：

```text
system / developer instructions
  > current user input
  > current-turn Tool Call + Observation pair
  > recent completed conversation Turns
  > older completed conversation Turns
```

- 超预算时从低优先级、最旧的完整单元开始排除或截断。
- system / developer instructions 与当前用户输入为不可静默删除项；它们本身超出输入上限时返回明确、受控的 Context budget error。
- `sourceDecisions` 记录 include / truncate / exclude、reason code 和 estimated tokens。
- 保留一个读取 history 的候选上限作为数据库保护可以接受，但它不能再代表最终模型预算规则。

## 不做什么

- 不实现模型供应商官方 tokenizer 的全覆盖。
- 不实现自动摘要或 compaction。
- 不删除历史 Message。
- 不把预算报告持久化为完整 prompt 快照。
- 不实现 RAG、Memory、Recovery、HITL。
- 不调整 Tool Observation 的字段级内容；属于 Task 3。

## Red：先定义失败用例

- [ ] 两条超长消息仍因“少于 12 条”而全部进入模型。
- [ ] history 过长时 system instruction 或当前输入被低优先级历史挤掉。
- [ ] 只裁掉 Tool Result、保留 Tool Call，产生非法协议输入。
- [ ] 预算结果无法解释某个 Turn 为什么被排除。
- [ ] system + current input 已超过 inputLimit 时仍调用模型。
- [ ] estimator 结果不稳定，导致同一 fixture 每次产生不同 plan。

## Green：最小实现

- [ ] 实现可注入的 deterministic estimator 与预算配置。
- [ ] 为 Context units 计算 estimated tokens。
- [ ] 按来源优先级和时间顺序生成预算计划。
- [ ] 以完整 Turn / 完整 Tool pair 为最小裁剪单元。
- [ ] 对不可丢弃项超限返回稳定错误类型和安全用户错误投影。
- [ ] 在 `ContextPlan.budget` 与 `sourceDecisions` 中输出可测试报告。

## Refactor：整理边界

- [ ] estimator、budget policy、normalizer 职责分离。
- [ ] 模型配置来源统一，不在 SEO service、LLM adapter 和测试中重复硬编码不同窗口。
- [ ] reason code 与人类可读说明分离，便于日志和 Admin 后续使用。

## 验证命令

```bash
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:seo-service
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

## 验收标准

- [ ] 固定最近 12 条消息不再是唯一 model input 控制规则。
- [ ] `inputLimit` 明确扣除 completion reserve 与 safety margin。
- [ ] 同一 fixture 的 token estimate 与 ContextPlan 可重复。
- [ ] system / developer instructions 和当前输入不会被普通 history 挤掉。
- [ ] 超预算裁剪不会拆开 Turn 或 Tool pair。
- [ ] 每个被排除或截断的 source 都有稳定 reason code。
- [ ] 必选内容自身超限时不会继续调用模型，而是产生受控错误。
- [ ] 普通短会话的 model input 与阶段 5 行为兼容。
- [ ] 用户能够根据一个长会话 fixture 手算并解释预算分配和裁剪顺序。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 近似 token 低估导致 provider 拒绝 | 使用保守估算和 safety margin，并保留 provider token error 的受控映射 |
| 过度裁剪降低回答质量 | 固定评估 fixture，对比纳入项、排除项和最终回答；本任务不靠主观感觉调参 |
| 模型配置散落 | 建立单一预算配置入口，Task 0 contract 只消费配置结果 |
| 为摘要预留过多抽象 | 只保留 action/reason 扩展点，不实现 summary service |

## GitHub 交付记录

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
