# Tasks

本目录是正式任务状态的事实来源。规格、验收标准与决策记录在 GitHub Issue，验证与验收证据在 PR；已完成任务的看板行只留一句话加 PR 号，阶段归档在 [`completed/`](./completed/)。

## 当前状态

```text
阶段 1-8：Completed
当前阶段：工作台第 1 档（第一期上线）
Active Agent Task：无
Next：E1 历史带回工具记录 → E2 前台上下文用量 → E3 上下文压缩（均未建，技术讨论见 docs/research/context-management.md）→ 第 0.5 档真实对话验证 → 统一上线（C2 起的 Issue 只在本地验收合并，#212、#214 已合并待上线；#208、#209 已于 2026-09-28 按用户要求提前上线，504b4f26）
Gated：#117 Responses API adapter（2026-09-18），触发条件见看板
产品方向：给 topuplist 运营用的 AI 工作台，分两期、上云、gsc 延后（2026-09-20 定案、2026-09-27 改为两期，docs/research/workbench-direction.md）；档、顺序与触发只在其第 7 节
候选子系统：session 事件流与 replay、审批门、定时任务（未立 Issue，各自的档见 workbench 第 7 节；compaction 已作为 E3 进入第 1 档）
Admin Task 4：Closed（2026-09-27：Auth 由 #195 完成；RBAC 不做（两种角色已定）；敏感字段治理由 #156 覆盖，其余按需立项）
```

## 看板

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| #214 D 流式正文按批渐显 | Completed | 流式正文每次放出的新字作为一批 0.42s 淡入，淡入完才切回 v-html，放字节奏改为 280ms / 64ms。PR #215 |
| #212 C2 刷新后还原：摘要行与时间线随消息下发 | Completed | 刷新或切回会话后，摘要行与时间线（思考、来源、网页、用时）与刷新前一致，旧数据降级显示。PR #213 |
| #209 思考短句：状态行显示最新一句思考，时间线可展开完整思考 | Completed | 有思考原文的模型（DeepSeek）状态行换成最新一句写完的话，时间线每轮思考一行、可展开原文；新增 `reasoning_delta` 流事件，不落库。PR #211 |
| #208 对话等待过程：呼吸点、单行步骤状态与摘要（实时） | Completed | 发出即有呼吸点，超 1 秒或用工具时单行状态原地换字，正文开始时变成可展开的时间线摘要，全程零位移。PR #210 |
| #206 读网页 web_fetch：SSRF 防护与正文提取 | Completed | 模型可打开网页读正文：每一跳防 SSRF（含连接时防 DNS 换绑），正文在 worker 里用 Readability 提取。PR #207 |
| #204 联网搜索 web_search 与系统提示词重写 | Completed | 模型可经 Serper 查 Google 并附来源，提示词改为 Kuro 并注入北京时间日期，删 `search_articles`。PR #205 |
| #201 会话记录按用户查找 | Completed | 会话记录显示所属用户，可按用户与最近活跃时间筛选（条件在地址栏），用户列表「查看对话」直达。PR #203 |
| #198 使用 Google 登录，陌生账号进入待审核 | Completed | 重定向登录 + One Tap 上线，陌生账号待管理员审核，首页登录改弹窗，前台与管理台显示头像昵称。PR #200 |
| #197 pnpm ship 一键部署与版本回退 | Completed | 上线 `https://askkuro.com`（管理台 `/admin/`），`pnpm ship` 构建直传、迁移前备份、健康检查失败自动切回，`pnpm ship:rollback` 只回退代码。PR #199 |
| #195 邮箱密码登录、会话隔离与用户管理 | Completed | 全局 Guard + Session Cookie，会话按人隔离，管理台用户列表与 `pnpm create-admin`。PR #196 |
| #193 首页替换为设计稿 Agent for Teams（百分百还原） | Completed | 设计稿移植成 `/` 首页并删旧首页，对原稿像素比对 33 张全部达标。PR #194 |
| #191 全仓测试统一到 Vitest | Completed | 六个 Vitest 项目，入口收成 `test` / `test:db` / `test:e2e`，删 22 条低价值测试，新增 `docs/testing.md`。PR #192 |
| #189 tools 模板化（RAG 清理第 3 步） | Completed | 一次工具调用的判定收进 `invoke`，工具清单只在 `TOOLS`，文章摘录按低信任数据声明。PR #190 |
| #187 删除检索、索引与 embedding（RAG 清理第 2 步） | Completed | 删 `retrieval/`、`article-indexing/`、`embeddings/` 约 1 万行，`search_articles` 查询收回 tools。PR #188 |
| #185 删除 Grounding 与两个 eligible 工具（RAG 清理第 1 步） | Completed | 删 Grounding 全链路、`retrieve_article_context` 与 `get_article_detail`。PR #186 |
| #183 收口状态收成 RunTerminalSlots | Completed | 4 个收口槽位收成 `RunTerminalSlots`，Grounding finalization 抽成方法，行为不变。PR #184 |
| #181 工具执行循环抽成 executeToolBatch | Completed | 工具循环搬进 `executeToolBatch`，行为不变，`runTurnStream` 837 → 708 行。PR #182 |
| #179 服务商按勾选使用出站代理 | Completed | 代理地址只读 `OUTBOUND_PROXY_URL`，`LlmProvider.useProxy` 勾选才走代理。PR #180 |
| #175 模型 400 / 5xx 与工具失败保留真实原因 | Completed | 上游错误文案附脱敏摘要，中转站 `upstream_error` 归 `llm_server`。PR #177 |
| #176 回答 Markdown 列表标记 | Completed | 列表 `list-style` 恢复浏览器默认标记。PR #178 |
| #167 落库文本清洗 | Completed | U+0000 与孤立代理项落库前换成 U+FFFD，Run 不再停在 RUNNING。PR #171 |
| #168 模型调用边界补漏 | Completed | 报错文案里的 key 打码、SDK 日志关闭、上游坏数据块归 `LLMApiError`。PR #172 |
| #169 前台 Markdown 与会话小修 | Completed | 接入 `markdown-it-cjk-friendly`，流式补齐与会话细节修正。PR #173 |
| #170 模型配置校验小修 | Completed | 可见模型行按运行时公式校验输入预算，服务商关键字段变了清旧结论。PR #174 |
| #151 模型调用失败保留真实原因 | Completed | 新增 `AgentRun.errorCode` 与首 token 时间，失败类别与文案一处得出。PR #159 |
| #146 中转站各家族协议差异收口 | Completed | `LLM_FAMILY_CAPABILITIES` 扩成 compat 表承载家族差异。PR #147 |
| #149 删 #119 后无读者的观测字段 | Completed | contracts 到管理台四层删初始上下文遗留字段与 Context Inspector 来源分区。PR #150 |
| #144 前台模型对话 UI 优化 | Completed | 限高代码卡片、阅读定位、Tooltip 与一批渲染修复。PR #145 |
| #142 模型配置入库 | Completed | `LlmProvider` / `LlmModel` 入库，API Key 用主密钥加密，删 `LLM_*` 环境变量。PR #143 |
| #118 删除死代码、单实现抽象与自校验 | Completed | 零行为变化，删约 800 行。PR #121 |
| #119 历史裁剪合一 | Completed | 历史一次查出，由 planner 统一裁剪。PR #122 |
| #120 抽出 `packages/ai` | Completed | 新建零 Nest、零 Prisma 的 `@agent/ai`，模型客户端迁入。PR #123 |
| #124 `packages/ai` 目录按 Pi 分层整理 | Completed | 根目录收成 `types` / `errors` / `config` / `deepseek`，`clients/` 改 `api/`。PR #125 |
| #126 Admin Run 读模型去过度设计 | Completed | 契约收缩为运维要的事实，净减约 5,600 行。PR #128、补修 PR #130 |
| #127 收敛 `packages/ai` 运行时配置 | Completed | `LLMRuntimeConfig` 收为四个字段，timeout 改常量。PR #129 |
| #115 模型调用重试与 Loop 默认上限 | Completed | 交给 SDK 重试 2 次，默认上限改为 10 轮采样 / 8 次工具调用。PR #131 |
| #116 同轮文本 + 多 Tool Call | Completed | 采样判决只按 finishReason 分派，同轮多个 call 依次执行并回喂。PR #132、补修 PR #133 |
| #117 Responses API adapter | Gated | 2026-09-18 关闭（not planned）：DeepSeek 上 Responses 与 Chat 无能力差异且无状态，为证明边界写第二实现属过度设计；Pi 的 DeepSeek 也走 completions。映射规格保留在 Issue，满足任一条件 reopen：DeepSeek 弃用 Chat Completions / 需要仅 Responses 有的能力 / 接入只支持 Responses 的第二 provider |
| #134 去 SEO 产品命名 | Completed | `seo/` 改 `chat/`，删非流式 chat 链路。PR #138 |
| #135 删离线评估与 smoke 死链 | Completed | 删 v1 检索 baseline 闭环与无运行记录的 smoke。PR #139 |
| #136 零行为变化小修 | Completed | 删 tools 的 risk / 审批 / 幂等字段与准入门，三份工具清单合一。PR #140 |
| #137 embedding 重试收敛 | Completed | 手写重试环交给 SDK（embedding 已随 #187 删除）。PR #141 |
| #153 管理台概览与运行列表重构 | Completed | 概览改 SQL 聚合，按健康 / 延迟 / 用量 / 工具展示。PR #160 |
| #152 Run 轨迹补齐模型可见内容 | Completed | tool Step 落回喂参数与 observation、采样 Step 落回填文本，模型可见 ⟺ 落库成立。PR #161 |
| #155 前台流式渲染与模型自恢复 | Completed | 流式补齐按行 / 列表项 / 单元格为边界，所选模型失效时重拉列表并纠正选中项。PR #162 |
| #154 管理台模型接入页与小修 | Completed | 关键字段变了重载模型表，探活结果按代次丢弃、只在配置未变时写回。PR #163 |
| #156 低成本安全加固 | Completed | 库内密钥只发往库内地址，地址与密钥成对写入。PR #164 |
| #158 运行时小修 | Completed | 跨轮文本保证空行，planner 成对删历史，测试入口补漏。PR #166 |
| #157 真实 Tool Call 流 fixture | Completed | 四家真实 Tool Call SSE 录制后经 client 回放测试。PR #165 |
| AI 工作台两期 | Planned | 第一期：登录 + 联网搜索 + 部署香港云服务器；第二期：我的页面（查询工具、沙箱、打开即重新取数、对话改页）；gsc 迁移延后；档、触发、里程碑见 [workbench-direction](../research/workbench-direction.md) 第 7 节；一次只立一个 Issue |
| Grok Grounding 收尾不调用提交工具 | 已放弃 | 2026-09-26 记录；同日用户定案删除 Grounding（#185），问题随之消失，不再立 Issue。原记录见 git 历史 |
| Admin Console Task 4 | Closed | 2026-09-27 收口：Auth 由 #195 完成；RBAC 不做（两种角色已定）；敏感字段治理由 #156 覆盖，其余按需立项 |
| 已完成 | Completed | Phase 2–8、横向任务 #92 / #94 / #98 / #101–#104、Admin Console Task 0–3 与 Enhancement 1–3，归档在 [completed/](./completed/) |
| 翻译质检站 #109 / #111 | 已删除 | 2026-09-05 经 #113 / PR #114 删除全部代码与数据模型 |

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 已记录方向或已建 Issue，但前置任务或启动条件尚未满足 |
| Next | 已确认是下一项正式任务，Issue 已创建但未开工 |
| Active | Issue 已创建，正在实现或待验收；一次只有一个 |
| Gated | 只有客观触发条件满足后才重新讨论 |
| 已放弃 / 已删除 | 方向放弃；代码保留或删除按看板记录 |
| Completed | 已实现且验收通过：PR 逐条验收 PASS 并合并 |

## 规则

- 一个 Issue 只对应一个任务单元；Planned / Next 不能替代正式 Issue；
- Issue 建立前不得修改正式代码（`docs/workflow.md` 第 2 节的小改动例外除外）；Issue 实质性变化后先更新 Issue 再继续；
- 实现后先写「已实现、待验收」，验收 PASS 后才写「已通过」；
- 看板行只写一句话说明做成了什么，加 PR 号；改动清单、验证命令、测试数与逐条验收证据写在 PR 里，不抄进看板；
- 只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时建 Issue；并行 Tool Call、Memory、MCP、Multi-agent 不自动进入实现；
- 流程、Issue 模板与任务状态定义见 [`../workflow.md`](../workflow.md)。
