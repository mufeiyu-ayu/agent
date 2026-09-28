# 上下文管理：历史里的工具记录、压缩与用量显示

状态：技术讨论（2026-09-28），不是产品需求。这里只定大体要做什么与参照谁；E1 / E2 / E3 每个 Issue 立项前再单独讨论细节，讨论时以本文为起点、补社区讨论。顺序只在 [workbench-direction.md](./workbench-direction.md) 第 7 节。

## 1. 起因与现状

用户在同一对话里连续问同一个问题，模型每次都重新搜索，像「没有记忆」（2026-09-28 实测）。这是 E 的起点，讨论中又延伸出两个配套功能：前台实时显示上下文用量，以及前台手动触发压缩。

当前代码事实：

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 历史 | 只带之前各轮已完成的「用户问题 + 最终回答」，工具调用与结果都不带（#119 / #152 的设计，当时只有站内文章工具） | `apps/api/src/agent-runtime/agent-runtime.service.ts` 读历史处 |
| 输入预算 | `min(262,144, 窗口 − 最大输出 − 16,384)`；DeepSeek 窗口 1M，实际按 262K 封顶 | `apps/api/src/agent-runtime/context/initial-context.ts` |
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

## 4. 后续三个任务（大体范围，细节立项前再议）

**E1 历史带回工具记录**：从 tool Step 重建之前各轮的工具调用与结果，按原生 tool 消息进入历史；最近几轮带全文，更早的按年龄降级（倾向：搜索留标题 / URL / 摘要，网页留 URL + 前约 1000 字）。降级规则确定、单调，参数记进 `contextPlan`，同一条记录每次重建一致。

待讨论：全文保留几轮；降级的具体长度；DeepSeek 思考模式下历史里的工具调用轮对 `reasoning_content` 的要求；降级提示语怎么写（告诉模型可以重新读）；与现有 planner 预算的关系；同一会话并发 Run 的偏差是否受影响。

**E2 前台上下文用量**：done 事件与会话消息接口带上「最近一次输入 token / 输入预算」，输入框旁显示进度，悬停看已用、上限、百分比。数据已有，不改 schema。

待讨论：分母用输入预算（262K）还是模型窗口；只算输入还是含输出；压缩后到下次请求前显示什么；变色阈值；要不要按系统提示 / 历史 / 工具拆开明细。

**E3 上下文压缩（自动 + 手动）**：摘要作为检查点落库（要 migration，按高风险走），重建时取「最新摘要 + 之后的原文」；摘要模板按运营场景（目标、查过什么、结论与关键数据、来源 URL、待办），URL 清单从工具参数确定性提取；前台手动按钮与自动触发同一实现，时间线插「上下文已压缩」；超出上下文时压缩后重试一次。

待讨论：触发线；保留多少最近原文；用哪个模型做摘要、花费记在哪；压缩期间能否发送、能否取消；摘要失败怎么办；原消息在前台怎么显示；和 R1 可重建的关系。
