# 模型上下文与重建契约

改历史读取、上下文组装、压缩、Step 落库或 replay 投影时读取本文件，并核对当前实现；这里只记录这些路径的约束，不要求其他任务加载。入口见[模块导航](../README.md)。

## 消息与轨迹边界

- `Conversation` 是长期会话；`Message` 是用户可见消息；`AgentRun` 是一次用户输入触发的运行；`AgentStep` 是系统执行过程，不是模型真实 chain-of-thought；Tool Call 轮采样 Step 的 `reasoningContent` 是回填给模型、为重建而存的内容；最后一轮（final answer）与被停止 / 失败、没收完的那一轮的 `reasoningContent`、tool Step 的 `display` 与采样 Step 的 `answerStartedMs` 只为刷新后还原界面（#212），不属于模型可见内容；只有收完的 Tool Call 轮（finishReason 为 `tool_calls` / `length` 且有 call）的 `reasoningContent` 是回填内容，且只对本 Run 回填，以后的 Run 不再回放。

## 输入重建与已知偏差

工作区开发指南按需启用：首次工作区工具意图后，`workspace_development` Step 的 input 保存 version / activatedAfterSamplingAttemptId，output 保存完整 system instruction。启用 Step 确认后追加到 ModelContext 并清掉旧 token 用量锚点；同批旧工作区计划以 `ok:false / code:workspace_replan` 记录为未执行，Step 正常收口，流与历史统一显示“按指南重新规划”，不计执行失败也不伪造成功；下一轮重新采样。后续采样 input.workspaceDevelopment 指向版本与启用 Step；普通解释没有该 Step 或整段指南。新 Run 按需重新启用，不依赖历史压缩摘要里的隐式状态。重建时从被引用 Step 取当次原文，不能从当前部署常量推导已启用版本。

- 历史读取在同一 REPEATABLE READ 内先读全部已完成消息的轻量元数据和 Run 配对，再仅读未覆盖组的正文与 Step；覆盖组仍计入历史加载 messageCount，不将空占位正文回喂模型，不改变摘要边界与并发问答排序。
- 模型看到的必须能从持久化记录重建（model-visible ⟺ logged），这是 resume / replay 的前提。#152 起成立（#185 删除 Grounding 后，模型调用只剩 action 循环）：历史由 `context/conversation-history.ts` 在一个 REPEATABLE READ 快照里读出、按问答分组（按 Run 配对，并发交错时顺序不同于时间顺序）；#218 起包含之前问答的工具调用与结果（参数与 observation 取那次的 tool Step 原样带回，中间文本取采样 Step，reasoning 给空串；记录不完整的问答只带一问一答，空的回答不带）。#220 起一次采样的输入 = `contextPlan.compactionId` 指向的历史压缩记录（`ConversationCompaction`）的摘要 + 不在它 `coveredGroupIds` 里的问答（`answerOnlyGroupId` 那组只带问题与回答全文；做过本轮压缩的问答按最后一条成功的本轮压缩 Step 还原为前缀摘要 + 保留起点起的工具轮 + 最终回答）+ 当前问题 +（`contextPlan.turnCompactionStepId` 指向的 `context_compaction` Step 的前缀摘要）+ 本 Run 从保留起点起的工具轮，未被覆盖部分的 Message 条数在 `contextPlan.historyIncludedCount`；Tool Call 轮回填的文本与 reasoning 在采样 Step；回喂的参数与 observation 在 tool Step；给模型的工具名单在采样 Step 的 `initialContext.modelToolNames`。范围外与已知偏差：系统提示词与工具定义取自当次部署的代码，提示词里的日期取 ChatService 收到请求时的北京时间，不落库，按 Run 创建时间重建（毫秒之差，只在跨零点时可能差一天）；请求参数（`max_tokens`、强度、thinking）不落库，只能经 modelId 反查事后可被改动的模型行；历史只落条数，同一会话并发 Run 时按条数重建会多算事后才完成的消息；PostgreSQL 存不了 U+0000（jsonb 还拒收孤立代理项）：可见文本与用户消息在进入 `content` 前、压缩摘要在落库与送给模型前把两者换成 U+FFFD（delta、done 与落库逐字一致，模型下一轮看到的也是替换后的文本）；Step 的 jsonb 副本（参数、observation、中间文本、reasoning、toolName / callId、debug 抓取）同样替换，而同一 Run 内回填给模型的是原文，这是模型可见内容与落库唯一不逐字相等的情况。replay 本身属 R1。
