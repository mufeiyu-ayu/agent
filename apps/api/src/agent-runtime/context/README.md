# 模型上下文与重建契约

改历史读取、上下文组装、压缩、Step 落库或 replay 投影时读取本文件，并核对当前实现；这里只记录这些路径的约束，不要求其他任务加载。入口见[宿主导航](../README.md)与[内核导图](../../../../../packages/agent/AGENTS.md)。历史 SQL / 存储留在本目录，纯配对/还原、ModelContext 与压缩编排在 `packages/agent/src/context/`；字段契约不因分包改变。

## 消息与轨迹边界

- `Conversation` 是长期会话；`Message` 是用户可见消息；`AgentRun` 是一次用户输入触发的运行；`AgentStep` 是系统执行过程，不是模型真实 chain-of-thought；Tool Call 轮采样 Step 的 `reasoningContent` 是回填给模型、为重建而存的内容；最后一轮（final answer）与被停止 / 失败、没收完的那一轮的 `reasoningContent`、tool Step 的 `display` 与采样 Step 的 `answerStartedMs` 只为刷新后还原界面（#212），不属于模型可见内容；只有收完的 Tool Call 轮（finishReason 为 `tool_calls` / `length` 且有 call）的 `reasoningContent` 是回填内容，且只对本 Run 回填，以后的 Run 不再回放。

## 输入重建与已知偏差

MCP 显式选择：`Message.plugins` 与用户消息同事务保存当次 id/name，UI 正文不变。当前请求增加独立 user 使用指示，采样 `input.pluginSelection` 保存选择与指示原文；历史消息只追加该条消息的选择事实，不重新授予工具权限。无 Run / 首采样前失败仍能从 Message 回显选择。

MCP 插件：采样 Step 的 `input.mcp` 保存本轮实际工具名、原始服务工具名、插件身份、完整说明及参数 JSON Schema；只存无凭据快照。工具参数和模型实际收到的 observation 沿用 tool Step 原样记录。历史记录不重新授予权限，执行时还需复核当前用户连接及平台启停。没有 MCP 历史版本管理界面或旧连接保留。

工作区开发指南按需启用：首次工作区工具意图后，`workspace_development` Step 的 input 保存 version / activatedAfterSamplingAttemptId，output 保存完整 system instruction。启用 Step 确认后追加到 ModelContext 并清掉旧 token 用量锚点；同批旧工作区计划以 `ok:false / code:workspace_replan` 记录为未执行，Step 正常收口，流与历史统一显示“按指南重新规划”，不计执行失败也不伪造成功；下一轮重新采样。后续采样 input.workspaceDevelopment 指向版本与启用 Step；普通解释没有该 Step 或整段指南。新 Run 按需重新启用，不依赖历史压缩摘要里的隐式状态。重建时从被引用 Step 取当次原文，不能从当前部署常量推导已启用版本。

- 历史读取在同一 REPEATABLE READ 内先读全部已完成消息的轻量元数据和 Run 配对，再仅读未覆盖组的正文与 Step；覆盖组仍计入历史加载 messageCount，不将空占位正文回喂模型，不改变摘要边界与并发问答排序。
- 用户消息的附件：模型看到的用户消息 = `userMessageContent(Message.content, 附件)` 的正文 + 图片块。`Message.content` 仍只是用户打的字；附件在 `Attachment` 表里按 `messageId` + `position` 关联，文档给模型的文字是 `extractedText`，图片给模型的是 `modelObjectKey`（为空时是 `objectKey`）指向的对象与 `modelMimeType`，都在上传时定型、之后不改。发送时先由 `createUserMessage` 确认提交、创建 Run 与发布身份后，`loadUserMessage` 才读图片；存储失败按已持久化的 Run 收口，不退回未发送状态。当前输入还原与之后每次读历史（`loadConversationHistory`，附件行与消息在同一个 REPEATABLE READ 快照里读，图片在事务结束后从存储读）走同一个 `AttachmentsService.modelInput`，得到的内容相同。已知偏差：图片对象从存储里丢失时正文里写 `[Image omitted: could not be loaded.]`、不带这张图；模型行没勾「图片输入」时由 `@agent/ai` 在发请求那一刻把图片换成说明文字，记录不变；写摘要读历史时不读图片（摘要输入本来只有文字）；debug 抓取的请求体里图片数据换成长度说明。
- 模型看到的必须能从持久化记录重建（model-visible ⟺ logged），这是 resume / replay 的前提。#152 起成立（#185 删除 Grounding 后，模型调用只剩 action 循环）：历史由 API 的 `context/conversation-history.ts` 在一个 REPEATABLE READ 快照里读出、调用包内纯函数按问答分组（按 Run 配对，并发交错时顺序不同于时间顺序）；#218 起包含之前问答的工具调用与结果（参数与 observation 取那次的 tool Step 原样带回，中间文本取采样 Step，reasoning 给空串；记录不完整的问答只带一问一答，空的回答不带）。#220 起一次采样的输入 = `contextPlan.compactionId` 指向的历史压缩记录（`ConversationCompaction`）的摘要 + 不在它 `coveredGroupIds` 里的问答（`answerOnlyGroupId` 那组只带问题与回答全文；做过本轮压缩的问答按最后一条成功的本轮压缩 Step 还原为前缀摘要 + 保留起点起的工具轮 + 最终回答）+ 当前问题 +（`contextPlan.turnCompactionStepId` 指向的 `context_compaction` Step 的前缀摘要）+ 本 Run 从保留起点起的工具轮，未被覆盖部分的 Message 条数在 `contextPlan.historyIncludedCount`；Tool Call 轮回填的文本与 reasoning 在采样 Step；回喂的参数与 observation 在 tool Step；给模型的工具名单在采样 Step 的 `initialContext.modelToolNames`。范围外与已知偏差：系统提示词与工具定义取自当次部署的代码，提示词里的日期取 ChatService 收到请求时的北京时间，不落库，按 Run 创建时间重建（毫秒之差，只在跨零点时可能差一天）；请求参数（`max_tokens`、强度、thinking）不落库，只能经 modelId 反查事后可被改动的模型行；历史只落条数，同一会话并发 Run 时按条数重建会多算事后才完成的消息；PostgreSQL 存不了 U+0000（jsonb 还拒收孤立代理项）：可见文本与用户消息在进入 `content` 前、压缩摘要在落库与送给模型前把两者换成 U+FFFD（delta、done 与落库逐字一致，模型下一轮看到的也是替换后的文本）；Step 的 jsonb 副本（参数、observation、中间文本、reasoning、toolName / callId、debug 抓取）同样替换，而同一 Run 内回填给模型的是原文，这是模型可见内容与落库唯一不逐字相等的情况。replay 本身属 R1。

Skill（#249）：每个采样 Step 的 `input.skills` 保存本次目录/contentId/指纹与完整初始 instructions（包括通用规则和显式选择正文）。contentId 对应一次上传对象，仅用于安全提交当前内容，不提供历史版本。按 2026-10-12 用户确认的简化边界，更新/删除后直接清理旧对象，不保留运行引用；旧问答尚未读取的内容可能失效，已经加载的包仍由原有 Map 保持一致。自动读取的内容沿用 tool Step observation，路径、分页位置和指纹随结果原样持久化。重建使用这些原文，不查询当前发布内容。本轮/历史压缩不删除固定使用规则；若工具轮被摘要覆盖且当前上下文没有完整说明，模型按规则重新读取同一 Run 已加载的包，不用“已加载”标记省略正文。下一 Run 重新生成授权目录，旧摘要不扩大当前权限。

显式选择的 id/name 与用户 Message 在同一事务写入 `Message.skills`；采样仍记录 `input.skills.selectedIds` 供轨迹核对。当前及历史模型正文用 Message 的选择身份追加提示（UI content 不变），即使没有 Run 或首个采样也可还原。因此刷新、后续摘要与“继续刚才的技能”可辨认技能身份，但不重新授予已停用技能权限。

技能文件卡片：保存工具的 `display.skill`（id/name）随已提交 tool Step 和 tool_finished 返回，历史 activity 恢复到原助手回复；此前没有 display 的保存记录，仅解析 save_skill_draft 的成功 observation 恢复预览入口。display 仍不属于模型消息。

`read_skill` 成功结果同样持久化 `display.skill`，实时及历史步骤显示所用技能名称；读取操作不生成草稿文件卡片。

用户消息的 `skills` 展示字段只读同事务保存的 `Message.skills`，不依赖采样 Step，不修改 Message.content，不从当前技能列表反查历史名称。

系统技能（#252）沿用相同目录、contentId、显式选择与 tool observation 持久化格式。公共归属只改变可用目录来源，不扩大个人技能读写权限；管理员更新后的包由下一次问答读取，停用/删除后从新目录移除。默认 creator 的代码包只用于初始发布指针，管理员保存后使用持久内容，不能因重启或停用回退默认包。
