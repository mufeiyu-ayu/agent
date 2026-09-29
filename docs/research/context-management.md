# 上下文管理：历史里的工具记录与压缩

状态：技术讨论（2026-09-28 起，2026-09-29 更新），不是产品需求。这里只定大体要做什么与参照谁，每个 Issue 立项前再单独讨论细节，讨论时以本文为起点、补社区讨论。顺序只在 [workbench-direction.md](./workbench-direction.md) 第 7 节。原则：核心机制照抄成熟开源项目（优先 Pi，opencode 交叉核对），我们自己加的项单独标明理由；Claude Code 不开源，引用只能算官方文档。

## 1. 起因与现状

用户在同一对话里连续问同一个问题，模型每次都重新搜索，像「没有记忆」（2026-09-28 实测）。这是 E 的起点。讨论中曾延伸出前台显示上下文用量、前台手动压缩两个功能，2026-09-29 按产品定位取消（见第 5 节）。

当前代码事实：

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 历史 | 只带之前各轮已完成的「用户问题 + 最终回答」，工具调用与结果都不带（#119 / #152 的设计，当时只有站内文章工具） | `apps/api/src/agent-runtime/agent-runtime.service.ts` 读历史处 |
| 输入预算 | 模型行的单次输入上限 `LlmModel.maxInputTokens`（#216，存量行迁移为 262,144），保存时校验不超过 窗口 − 最大输出 − 16,384 | `apps/api/src/admin-llm/admin-llm.service.ts`（校验）、`agent-runtime/context/initial-context.ts`（使用） |
| 超预算 | 只在当前 Run 内：本地 DeepSeek V4 估算器算 token，从最旧的历史删起，再截短本 Run 的工具结果；超了记进 `contextPlan` | `context/sampling-context-planner.ts` |
| 单条工具结果 | 硬上限 128,000 字符 | `apps/api/src/tools/core/tool-observation.ts` |
| 真实用量 | 每次采样的 provider usage（输入、总量、缓存命中）存在 AgentStep 的 `output.usage`，目前只有管理台概览在用 | `apps/api/src/admin-overview/admin-overview.service.ts` |
| 窗口大小 | 模型表 `LlmModel.contextWindowTokens` / `maxOutputTokens`，管理台人工维护 | `prisma/schema.prisma` |
| 压缩、前台用量 | 都没有 | —— |

工具参数与 observation 已在 tool Step 落库，历史带上工具记录不破坏「模型可见 ⟺ 落库」。

## 2. 主要参照

主参照是 opencode、Claude（Claude Code 与 Claude API 的 context management）、Codex、Pi；网页对话产品补 Open WebUI、LobeHub、LibreChat；原则来自下面的文章。源码结论按下表版本核对，引用前先对版本。

| 参照 | 版本 | 历史里的工具结果 | 旧结果怎么办 | 压缩 | 手动入口 | 用量显示 |
| --- | --- | --- | --- | --- | --- | --- |
| opencode | `03e6717` | 原生 tool 消息；单条 2000 行 / 50KB 截断、全文落盘 | 可选剪枝（默认关）：跳过最近 2 轮，超 4 万 token 的旧结果换成 `[Old tool result content cleared]` | 窗口 − min(20K, 最大输出) 触发；保留最近原文（≤15K），更早的按模板摘要并滚动合并 | `/compact` | 最后一次 provider usage ÷ 窗口，「N tokens / N% used」 |
| Claude（API / Claude Code） | 官方文档 2025-09 起 | 原生 | 先清旧结果：保留最近 3 组，其余换占位，调用参数留着（`clear_tool_uses`）；清完不够再摘要 | API 默认 150K 触发；Claude Code 接近上限时自动 | `/compact <重点>` | 只算输入（含缓存读写），取最近一次响应；压缩后到下次请求前为空 |
| Codex | `44fe510c` | 原样带，写入时截到约 1 万 token（头尾各半）；web search 在历史里只留 query / url | 不清 | 窗口 90% 触发；最近用户原话（≤2 万 token）+ 交接摘要，作为检查点落 rollout | `/compact`，与自动同一套 | 剩余 %，先扣系统提示与工具定义的底座（12K） |
| Pi | `890f920` | 原样带；工具内部截断 2000 行 / 50KB | 不清，等压缩统一处理（扩展可用 `context` hook 改写） | `contextTokens > 窗口 − 16K` 触发；最近 20K 原文 + 结构化摘要，作为 `CompactionEntry` 追加，可叠加合并；切点不拆 toolCall / toolResult | `/compact [重点]`，可取消 | 「12.3%/200k」，70% 黄、90% 红；压缩后无 usage 时显示「?」 |
| Open WebUI（153k star） | `8bd8b4f` | 全量回放 | 不清 | 默认关，估算超 8 万 token 触发，保留最近约 40% 消息，摘要滚动合并 | `/compact` | usage + 估算，分母是压缩阈值，进度条 |
| LobeHub（82.8k star） | `dc64d769` | 带 | 默认开：旧的搜索 / 抓取结果只留前 1000 字符，最近 20 条不动；裁剪结果确定，不破坏缓存 | 窗口 50% 触发，已有摘要后 65% | `/compact` | 前端估算，超过 50% 才显示 |
| LibreChat（45k star） | `c8c5478` | 带 | 占用超 80% 时把已消费的结果换成约 300 字头尾截断；可选按位置清除 | 可配，压完只剩摘要 | 用量圆环里的按钮 | 圆环 + 按系统 / 摘要 / 各工具拆开的明细 |

文章与官方文档：

- Anthropic《Effective context engineering for AI agents》（2025-09-29）：tool result clearing 是最安全、最轻量的压缩；上下文里只留 URL 这类轻量标识，要用再取。
- Claude 官方博客 context management（2025-09-29）：100 轮网页搜索评测里，context editing 让任务跑完、token 降 84%。
- Manus《Context Engineering for AI Agents》（2025-07-18）：压缩要可恢复（网页正文可以丢，URL 要留）；上下文只追加，保证缓存前缀稳定；系统提示开头别放精确时间戳。
- JetBrains《Cutting Through the Noise》（2025-12，arXiv 2508.21433）：旧工具结果换占位，成本约减半，效果不输 LLM 摘要；推荐平时遮蔽、真太大再摘要。
- Chroma《Context Rot》（2025-07）与 Drew Breunig《How Long Contexts Fail》（2025-06）：输入越长越不稳，窗口大小不等于能放心用的预算。
- OpenAI Responses API compaction 与 Agents SDK sessions：服务端压缩产物不透明、不可审计；Cookbook 提醒错误事实进了摘要会一直污染后续。

社区讨论（每个 Issue 讨论时补）：已知 Open WebUI 0.11.0 修过「工具循环里多次调用的 usage 被累加、导致提前压缩」；openai/codex #45074 反映显示值与内部计数不一致。

## 3. 共识

1. 历史里带原生的工具调用与结果；只带最终回答的做法在带工具的项目里没见到。
2. 旧工具结果最先被削减：调用参数（搜索词、URL）保留，正文降级成预览或占位，需要时模型可以重新取。
3. 压缩 = 保留最近原文 + 摘要更早的部分；摘要作为新记录落库、原记录不删；再压缩时合并上一份摘要；切点不拆开工具调用与结果。
4. 用量 = 最后一次模型调用的真实用量 + 之后新增内容的估算；同一 Run 的多次调用不能累加。
5. 手动压缩与自动压缩同一条实现，入口是 `/compact` 或用量条旁的按钮，可带「重点保留」。

分歧：旧结果换占位还是保留预览；压缩触发线（50%～90%、窗口减预留、固定值）；用量分母用窗口还是压缩阈值；超出上下文时要不要压缩后自动重试（Codex 不重试，opencode / OpenHands / Pi 重试一次）。

## 4. 单次问答的步数上限（2026-09-29 补）

| 项目 | 每次问答的步数上限 | 到上限怎么办 | 时间限制 |
| --- | --- | --- | --- |
| Pi（`890f920`） | 没有：`packages/agent/src/agent-loop.ts:177` 是 `while (true)`，模型不再调工具就结束；底层留了可选的 `shouldStopAfterTurn`，coding-agent 没用 | —— | 只限单个命令，默认不限 |
| Codex（`44fe510c`） | 没有：`codex-rs/core/src/session/turn.rs:424` 是 `loop {}` | —— | 只限单个命令（默认 10 秒，到点先把输出交回模型） |
| opencode（`03e6717`） | 可配 `steps`，默认无限（`packages/opencode/src/session/prompt.ts:1178`） | 去掉工具、`toolChoice: "none"`，注入 `MAX_STEPS_PROMPT` 让模型只写总结，正常结束（`packages/core/src/session/runner/llm.ts:202-221`） | 只限单个命令（默认 2 分钟） |

Pi 撑住长任务靠的是压缩：coding-agent 在每次调用模型前检查上下文，到阈值就先压缩再接着跑（`packages/coding-agent/src/core/agent-session.ts:566-610`，挂在 `prepareNextTurnWithContext` 上）；超限报错时压缩后重试一次。

## 5. 任务

**E1 历史带回工具记录（#218）**：从 tool Step 按原生格式还原之前问答的工具调用与结果，原样带回，不缩短、不加读取时间、不回放思考；超预算时按整次问答删最旧的；同时删掉「单次最多调用模型」「单次最多调用工具」「历史最多读取条数」三项配置（代码与数据库列），一次问答不限步数，只保留「单次最长时间」兜底。规格以 Issue 为准。

**E2 前台上下文用量：取消（2026-09-29）**。我们是给运营用的云端产品，不是面向开发者的 Claude Code / Codex；用户在意的是能一直聊下去，Claude、ChatGPT 网页端也不显示用量、不给压缩按钮。真实用量已存在每次采样的 Step 里，管理台运行详情可查，排查够用。

**E3 后台静默压缩**：照抄 Pi 的自动压缩，用户无感，也不做手动按钮；要兼容以后的沙箱写代码（对标 Antigravity 这类云端产品，不开源，只能参考公开资料）。大体方向：

- 两个时机：问答结束后上下文偏大时在后台提前压缩（下次提问不用等）；问答进行中在两步之间压缩（长任务不断）。
- 保留最近原文 + 更早部分的结构化摘要；摘要作为新记录落库、原记录不删；再压缩时合并上一份摘要；切点不拆开工具调用与结果。
- 摘要模板照抄 Pi，保留「读过 / 改过的文件」两项给以后的沙箱，现阶段加「查过的网址」（自己加的，因为工具以联网为主）。
- 超限报错时先压缩再重试一次；只在管理台运行详情里能看到压缩记录。
- E1 暂不做的「旧结果缩短」「读取时间」到这里一起考虑；E1 的已知退化（单次问答自身超出预算时整组被删）由这里解决。

待讨论：触发线；保留多少最近原文；用哪个模型做摘要、花费记在哪；后台压缩与下一次提问并发时怎么办；摘要失败怎么办；和 R1 可重建的关系。
