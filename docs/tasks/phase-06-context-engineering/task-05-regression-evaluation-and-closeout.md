# Task 5：Context 回归、评估与阶段收口

## 任务状态

- 看板状态：Planned
- 实施状态：未开始
- 验收状态：未验收
- 前置任务：Task 4 Completed
- Issue：未创建
- PR：未创建

## 目标

用固定测试集和真实调用链验证阶段 6 的 Context 规则在长会话、异常消息、Tool Loop、超长 Observation、同步 / 流式和安全边界下均可预测，并完成源码复盘与阶段收口资料。

Task 5 不是“补几个测试就宣布完成”，而是证明阶段 6 的核心不变量已经在完整链路中成立。

## 学习重点

- 单元测试、集成测试、评估 fixture 和人工验收分别证明什么。
- Context 质量为什么不能只看“接口 200”或“模型有回答”。
- 如何区分 deterministic contract regression 与模型输出波动。
- 如何用可解释 plan 调试“模型为什么没看到某段历史”。
- 阶段验收、用户确认、docs 收口和 PR 合并是不同动作。

## 范围

- 建立固定 Context evaluation matrix，至少覆盖：
  - 空 history；
  - 单轮与多轮普通对话；
  - 超长旧 history；
  - `PENDING / STREAMING / FAILED / ABORTED` 消息；
  - 当前输入重复候选；
  - 普通 Tool success；
  - Tool zero result；
  - Tool business failure；
  - Tool timeout / user abort；
  - 超长 Observation；
  - Observation 含 prompt injection 文本；
  - system + current input 接近或超过预算；
  - 同步 JSON 与 streaming NDJSON。
- 对每个 fixture 断言：
  - model item 顺序；
  - included / truncated / excluded sources；
  - estimated tokens 与 input limit 关系；
  - current input exactly once；
  - Tool pair integrity；
  - safe Step summary；
  - Message / Run / Step 终态。
- 对普通短会话和阶段 5 Tool Loop 做回归，确保没有因 Context 重构改变已有产品协议。
- 进行一次真实浏览器或 API 手工验证，记录可复现步骤；模型文本不做逐字断言，只验证来源与运行语义。
- 更新阶段 6 源码阅读顺序、关键调用链、测试命令和已知限制。
- 只有 GPT 技术验收通过且用户明确确认后，才把 Task 5 和阶段 6 标记 Completed，并更新 roadmap / tasks / work-log 归档。

## 不做什么

- 不在收口 Task 中顺手实现摘要、RAG、Memory、Recovery 或 HITL。
- 不因为评估发现潜在增强点就扩大当前 Issue；超出范围记录后续 Task。
- 不把随机模型文本当作唯一自动化验收依据。
- 不在 Codex 自评完成后自动标记阶段 Completed。
- 不自动授权合并或开始阶段 7。

## Red：先定义失败用例

- [ ] 长 history 测试只断言“请求成功”，不检查实际 model items。
- [ ] Tool pair、current input 去重和 message status 只在单元测试通过，完整 Runtime 未覆盖。
- [ ] 同步与 streaming 可能生成不同 ContextPlan，但测试未对比。
- [ ] Step summary 可能泄漏完整 prompt / Observation，缺少禁止字段测试。
- [ ] 模型输出变化导致脆弱逐字测试，掩盖真正的 Context contract。
- [ ] 阶段文档在用户确认前被标记 Completed。

## Green：最小实现

- [ ] 建立 deterministic evaluation fixtures 与断言 helper。
- [ ] 补齐 unit、integration 和至少一条真实手工验证路径。
- [ ] 对同步 / streaming 的 Context 关键语义做一致性断言。
- [ ] 对安全 Step summary 做 allowlist / forbidden fields 测试。
- [ ] 运行阶段 5 关键回归与全范围 typecheck / lint / build。
- [ ] 形成阶段复盘和待后续处理清单，不在本任务扩项。

## Refactor：整理边界

- [ ] fixture 命名按行为而不是实现细节，避免重构后全部失效。
- [ ] 将模型随机输出断言缩减为协议、来源和终态断言。
- [ ] 测试报告能映射到阶段级验收标准和 Issue AC 编号。

## 验证命令

最终命令以实际 package scripts 为准，至少包括：

```bash
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:seo-service
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api test:agent-recorder
pnpm --filter @agent/api test:tools
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm --filter @agent/web typecheck
pnpm --filter @agent/web lint
pnpm --filter @agent/web build
pnpm typecheck
git diff --check
```

如全仓 `pnpm lint` 仍受既有 `docs/research/**` baseline 阻断，必须记录真实输出并证明不是本阶段回归，不能笼统写“全部通过”。

## 验收标准

- [ ] 阶段 6 README 中的全部强制不变量均有自动化证据。
- [ ] 固定 12 条消息不再是唯一预算策略，长会话会生成可解释 ContextPlan。
- [ ] 所有 MessageStatus、current input 去重和 Tool pair 边界均在 Runtime 集成测试覆盖。
- [ ] 普通回答、Tool success、零结果、失败、timeout、abort 无阶段 5 回归。
- [ ] 同步与 streaming 对同一输入生成相同 Context 语义。
- [ ] 安全摘要不包含完整 prompt、raw arguments、raw result、完整 Observation、secret、stack 或 chain-of-thought。
- [ ] 至少一条真实 API / 浏览器验证有可复现步骤与结果。
- [ ] 用户能够解释 ContextPlan、normalizer、budget policy、Observation policy 和 Runtime integration 的职责。
- [ ] GPT 基于最新 Issue、PR diff、Review 和真实验证给出验收结论。
- [ ] 用户明确确认后才更新 Completed、归档和后续路线；未确认前保持“已实现、待验收”。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 测试只覆盖纯函数，真实 Runtime 仍错误 | 每个核心不变量至少有一条集成路径 |
| 逐字模型断言不稳定 | 自动化只断言 deterministic contract，真实模型用于补充手工验收 |
| 收口时顺手推进阶段 7 | 后续项只记录，不创建代码或状态变更 |
| 已知基线被误报为本阶段失败 | 保存真实命令、错误位置和与本次 diff 的关系 |

## GitHub 交付记录

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
