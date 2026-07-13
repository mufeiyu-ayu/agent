# Exec Policy Decision Engine：规则合成、命令降级、批准与 Sandbox 分权

本文研究 Codex 如何把一条 shell / unified exec 请求转换为 `Allow / Prompt / Forbidden`，再与 Approval、Guardian、Permission Hook 和 Sandbox 组合。重点不是规则语法本身，而是四个容易混淆的问题：谁有权决定、决定作用在哪一层、批准能否跨请求复用、规则更新失败后当前命令会怎样。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/core/src/exec_policy.rs`、`codex-rs/execpolicy/src/{decision,policy,amend}.rs`、`codex-rs/core/src/tools/{approvals,sandboxing,orchestrator}.rs`、`codex-rs/core/src/session/{mod,handlers}.rs`

## 1. Exec Policy 只负责命令决策，不等于 Sandbox

Codex的执行安全不是单个boolean，而是顺序组合：

```text
command
  -> shell lowering / command segmentation
  -> exec-policy rules + unmatched heuristics
  -> Forbidden / NeedsApproval / Skip
  -> permission hook / Guardian / user approval
  -> first sandbox attempt
  -> sandbox-denial classification
  -> optional fresh approval + unsandboxed retry
```

因此：

- `Allow` 不必然代表无Sandbox执行。
- 用户批准不必然代表绕过Sandbox。
- Sandbox拒绝不必然代表命令永久Forbidden。
- 只有明确规则Allow覆盖每个解析出的command segment，首个attempt才可直接bypass Sandbox。

这种分权比“approved=true就执行”更适合Agent：Policy判断意图，Approval确认人类授权，Sandbox限制实际能力。

## 2. Policy 按配置层低到高合成，Requirements 最后覆盖

`load_exec_policy()` 按 `LowestPrecedenceFirst` 遍历启用的config layers；每层收集其`rules/*.rules`，同目录文件排序后解析。若配置要求忽略User/Project rules，这两层直接跳过。普通规则构建完成后，再把requirements exec policy作为overlay合并。

这表达两个不同权力来源：

- 普通layer允许高优先级偏好覆盖低优先级偏好。
- Requirements代表管理上界，最后合入，不能被个人规则绕过。

父子Thread只有在config folders、ignore flag和requirements policy等关键输入一致时才复用父级`ExecPolicyManager`，否则重新加载，避免子Thread拿到错误的规则代际。

## 3. 单个 Parse Error 会丢弃全部普通规则

文件读取/目录读取失败会让policy加载失败；但语法解析失败走特殊降级：

1. 返回warning。
2. 丢弃本轮已解析的所有User/Project/其他普通rules。
3. 只保留requirements policy；没有requirements则使用empty policy。

优点是Codex不会因用户规则的一处拼写错误完全无法启动，管理约束也仍保留。风险是一个低价值Allow规则的语法错误也会同时移除其他普通Forbidden规则，安全语义可能突然退化为heuristics + Sandbox。

更清晰的产品行为应将“忽略坏文件”“忽略坏rule”“整个普通policy失效”显式区分，并在执行回执中暴露当前policy健康状态。

## 4. Policy Snapshot 用 ArcSwap 发布，更新由单许可串行化

`ExecPolicyManager`内部：

- `ArcSwap<Policy>`让执行路径无锁读取当前不可变snapshot。
- `Semaphore(1)`串行化规则追加和内存policy更新。
- 每次检查先`load_full()`取得一个稳定`Arc<Policy>`。

因此同一次判断不会看到更新到一半的policy；并发命令可能分别使用旧/新snapshot，这是明确的generation边界。

当前没有显式`policyGeneration`、content hash或rule set revision。日志只能看到结果和匹配内容，难以证明某个批准究竟基于哪一代规则。

## 5. Shell Command 先降级成可判断的 Plain Commands

`commands_for_exec_policy()`依次尝试：

1. 解析 `bash -lc` 等shell wrapper中的plain commands。
2. Windows下解析PowerShell plain commands。
3. 对heredoc/复杂shell使用single-command-prefix fallback，并标记 `used_complex_parsing=true`。
4. 都不匹配时把原始argv视为一个命令。

一条复合命令可以被拆为多个segment分别匹配，然后汇总最严格结果。解析失败并不假装已理解完整shell语义；复杂fallback保留既有prefix rule匹配，但禁止自动建议持久化新规则。

这是重要的保守设计：不能因为从复杂脚本里猜到一个prefix，就把这个猜测升级成未来长期授权。

## 6. 多规则与多 Segment 都采用“最严格获胜”

`Decision`的排序是：

```text
Allow < Prompt < Forbidden
```

`Evaluation::from_matches()`对所有matched rules取`max()`。无论是同一command命中多个rules，还是复合command产生多个segments，只要其中一个Forbidden，总体就是Forbidden；没有Forbidden但存在Prompt，总体就是Prompt。

这避免“一个宽Allow覆盖一个窄Forbidden”的典型权限漏洞。实际reason再从匹配项中选择更具体的prompt/forbidden justification并渲染给用户。

## 7. Exact Program 与 Host Executable Resolution 是两阶段匹配

Policy先按command第一个token做exact program match；若无匹配且开启`resolve_host_executables`，绝对程序路径会提取basename，再确认它属于host上已知的同名可执行文件后尝试basename rules。

这让针对`git`的规则可以覆盖解析后的真实host executable路径，同时避免任意`/tmp/git`仅凭basename冒充系统Git。

不过决策会依赖当时的PATH/host executable inventory；若文件在批准后被替换，rule snapshot并未冻结binary digest。高风险执行回执应记录resolved executable identity，必要时在spawn前复核。

## 8. 无规则命中时由 Approval Policy、Permission Profile 和 Heuristics 合成

Unmatched command不是简单默认Prompt：

- `UnlessTrusted`下，known-safe且非复杂解析可Allow；其他未知命令Prompt。
- 危险命令或Windows受管限制却无真实sandbox backend时，通常Prompt；若approval policy是Never则Forbidden。
- 例外：用户显式选择`Disabled`或`External` permission profile，同时Never时，危险命令也Allow，因为用户已明确关闭本地Sandbox和交互。
- `Never`下普通非危险命令Allow，依赖Sandbox保护。
- `OnRequest / Granular`且环境Unrestricted/External时，普通非危险命令Allow。
- Restricted环境下，普通命令默认在Sandbox内Allow；只有请求sandbox override时才Prompt。

这套矩阵说明“Never”不是“任何命令无条件运行”，而是“不发交互请求，并由当前permission/sandbox形态决定Allow或Forbidden”。UI必须把显式无Sandbox + Never的高风险组合讲清楚。

## 9. Prompt 还要经过“是否允许发问”的二次门

Policy得出Prompt后，`prompt_is_rejected_by_policy()`会结合approval mode决定：

- 能发问：生成`NeedsApproval`。
- 禁止发问：转换为`Forbidden`，而不是悄悄Allow。

Granular模式还区分：

- 规则本身要求Prompt。
- 仅因sandbox escalation需要Prompt。

显式rule Prompt拥有更强语义；即使sandbox approval开关不同，也不能把policy owner要求的人类确认降级掉。

## 10. Explicit Allow 与 Heuristic Allow 的 Sandbox 权限不同

总体Decision为Allow时，Codex仍会计算`bypass_sandbox`：只有每个解析出的segment都至少命中一个真实policy `Allow` rule，才跳过首个Sandbox attempt。

以下情况即使Allow，也不会自动bypass：

- known-safe heuristic Allow。
- `Never`下依赖Sandbox的Allow。
- Restricted环境中的普通非危险命令。
- 多segment中只有部分segment被显式Allow。

这是优秀的双钥匙模型：heuristic只能减少批准打扰，不能授予更强文件系统能力。

## 11. 自动 Amendment 只在可证明的简单命令上生成

当命令需要批准时，Codex可以建议“允许此前缀，未来不再询问”。生成逻辑有多重限制：

- 复杂/heredoc解析完全禁用自动amendment。
- 若已有真实policy Prompt，不建议用Allow覆盖它。
- Heuristic Prompt只选择第一个需要批准的segment。
- 已有任意真实policy match时，通常不从heuristic Allow生成建议。
- 客户端提交的prefix必须非空。
- prefix不能与解释器、shell、`git`、`env`、`sudo`、`node`等高风险banned列表完全相等。
- 把候选Allow临时加入policy后，必须能让当前所有parsed commands都变成Allow。

最后一条“先模拟再建议”很值得学习：持久权限变更必须证明能解释当前请求，不能只信客户端提供的prefix。

## 12. Banned Prefix 是精确相等，不是能力范围证明

当前banned判断要求候选token长度和内容与名单完全一致。它能拒绝`["bash"]`、`["git"]`这类明显过宽建议，但更长prefix、alternate wrapper或等价路径可能通过。

模拟也只证明该rule能Allow当前命令，不证明它对未来命令足够窄。例如一个带可变参数的wrapper prefix可能授权比用户眼前看到的更多操作。

更强模型应计算capability diff：列出这条prefix可新增允许的命令族、workspace范围和外部副作用类别，再让用户批准。

## 13. Approval Resolution 的优先顺序是 Hook → Guardian/User

Tool Orchestrator先处理Policy requirement，再进入批准解析：

1. 若runtime提供PermissionRequest payload，先运行permission hook。
2. Hook明确Allow/Deny时直接结束，不再询问Guardian或用户。
3. Hook无决定时，根据Turn配置选择Guardian或User。
4. 统一把结果规范成Approved、Rejected、TimedOut或Abort，并记录来源telemetry。

来源被区分为Config、AutomatedReviewer和User。这样“谁批准了”不是丢失在一个boolean里。

需要注意Hook本身在host上执行且具有独立信任边界；它能短路用户交互，所以配置来源和脚本identity必须可审计。

## 14. Pending Approval 先登记再发事件，但 identity 仍偏弱

`request_command_approval()`先在active Turn state登记oneshot sender，再发布`ExecApprovalRequest`，避免客户端极速响应先于callback注册。

Event包含：

- call ID / optional subcommand approval ID。
- Turn ID、environment ID和时间。
- command、cwd、parsed command和reason。
- network context、additional permissions。
- proposed exec/network amendments与available decisions。

但pending map的effective key仍只是`approval_id ?? call_id`。重复key会覆盖旧sender并warning；没有独立deadline。旧response、新Turn复用ID或execve subcommand碰撞仍存在ABA风险。

批准identity应至少绑定`(threadId, turnId, callId, attempt, commandHash, environmentId, policyGeneration)`。

## 15. ApprovedForSession 是内存Cache，不是长期Policy

Shell/Unified Exec的approval key包括：

- environment ID。
- canonical command。
- cwd。
- sandbox permissions。
- additional permissions。
- Unified Exec额外包含TTY。

Apply Patch则按`environment ID + file path`生成多个keys，只有全部命中session cache才跳过询问；批准后每个path单独缓存，未来子集可复用。

`ApprovalStore`把key序列化成JSON字符串，只缓存`ApprovedForSession`。它没有持久化、TTL、撤销、usage count或policy generation；进程重启自然失效。它与写入`default.rules`的Exec Policy amendment是两种完全不同的授权寿命。

## 16. Rule Amendment 是 Disk-first，再更新内存 Snapshot

用户选择`ApprovedExecpolicyAmendment`后：

1. 取得manager单许可更新锁。
2. blocking task打开 `~/.codex/rules/default.rules`。
3. advisory file lock下读取全文件，精确line去重。
4. 必要时补换行，再append新Allow rule。
5. 检查当前snapshot是否已显式Allow。
6. clone policy、加入新rule、`ArcSwap::store()`发布。

优点：多线程更新串行，跨进程append通过文件锁减少交错写，同一行幂等。Disk-first也保证当前进程崩溃后，下次启动仍能读到已批准rule。

边界：append没有fsync/atomic replace；disk成功后内存add失败会让当前session继续使用旧snapshot，但下次启动看到新rule。当前没有amendment receipt记录file offset/hash/generation。

## 17. Amendment 持久化失败不撤销当前一次批准

Approval handler先尝试持久化amendment。失败时：

- 发Warning。
- 不记录“prefix已保存”的context message。
- 仍把原`ApprovedExecpolicyAmendment`通知给pending command。
- 当前命令继续执行。

语义是“用户已批准本次执行，但未来免询问规则保存失败”，不是整个批准失败。这是合理的partial-commit分类，但客户端必须把两个结果分别显示，不能让用户误以为长期授权已经生效。

## 18. Approval 之后仍由 Sandbox 决定实际第一 Attempt

Orchestrator顺序固定为：先批准，再选择Sandbox并执行。只有`bypass_sandbox=true`才首尝试不进Sandbox；否则根据file/network policy、tool preference和managed network选择平台Sandbox。

若Sandbox拒绝：

- 先区分filesystem denial与可解释的network policy denial。
- Tool不允许escalate时直接返回。
- 当前permission profile禁止unsandboxed execution时直接返回。
- Strict auto-review只覆盖sandboxed first attempt，unsandboxed retry必须重新Guardian review。
- 其他模式也按`Never / OnRequest / UnlessTrusted / Granular`决定能否再次请求批准。

因此一次Approval不是整个Tool Call所有attempt的永久通行证；能力升级需要新的决策边界。

## 19. Denied Read 不能被 Exec Allow 绕过

`unsandboxed_execution_allowed()`不仅看“用户是否同意”，还看filesystem policy是否包含必须执行的denied-read限制。若存在这类限制：

- 显式Exec Policy Allow也不能强行无Sandbox执行。
- requested escalated permission会被收敛回默认Sandbox路径。
- Sandbox failure后不能走普通unsandboxed retry。

这是另一条优秀不变量：用户可批准命令，但不能通过批准API突破管理员/环境强制约束。

## 20. Apply Patch 有独立 Safety Branch

Apply Patch不直接复用普通command heuristic，而先评估目标文件：

- 空patch拒绝。
- `UnlessTrusted`当前始终要求批准。
- 只有路径位于可写roots且存在可用平台Sandbox时才可自动批准。
- hard link风险使“路径看起来在root内”仍不能替代Sandbox。
- path越界且approval policy禁止发问时直接拒绝。
- foreign `PathUri`的本机转换仍有能力缺口。

这说明通用Policy Engine只能提供骨架；不同副作用类型仍需要domain-specific safety assessment。

## 21. 当前最值得保留的设计

1. Policy、Approval、Sandbox三层权力分离。
2. 多规则/多segment严格取最严Decision。
3. Heuristic Allow不能自动bypass Sandbox。
4. 复杂shell解析可以匹配既有规则，但不能衍生长期授权。
5. Pending callback先登记再发事件。
6. Session approval key包含环境、cwd、权限和TTY等影响语义的字段。
7. Amendment先模拟当前命令、disk-first持久化、内存snapshot原子发布。
8. Sandbox retry能力升级需要重新判断，而不是复用旧批准。
9. 强制denied-read约束不能被用户批准绕过。

## 22. 当前需要改进或避免的边界

1. 一个parse error会丢弃全部普通rules，应支持文件级隔离和明确degraded health。
2. Policy无generation/hash，批准与执行缺少可重放的决策证据。
3. Host executable判断不冻结binary identity，PATH/file replacement会改变事实。
4. Prefix banned名单只做exact match，未来授权范围仍可能过宽。
5. Pending approval只以call/approval ID索引，缺Turn/attempt/hash绑定和deadline。
6. Session cache无TTL、撤销、持久receipt或schema-versioned key。
7. Amendment append没有fsync/事务式receipt，disk与内存可能partial commit。
8. 保存规则失败但当前命令仍执行时，UI必须明确区分one-shot approval与durable grant。
9. Disabled/External + Never下危险命令Allow是显式信任语义，不能隐藏在默认设置里。
10. 决策日志应记录policy source、matched rule ID、resolved executable、sandbox attempt和最终capability，而不只记录Approved/Denied。

## 23. 更适合云端 Agent 的 Decision Receipt

当前AI SEO Agent不需要shell sandbox，但所有高风险业务Tool都需要同样的分层回执：

```ts
type ToolDecisionReceipt = {
  operationId: string;
  runId: string;
  stepId: string;
  toolName: string;
  argumentsHash: string;
  policyGeneration: string;
  policyDecision: "allow" | "prompt" | "forbidden";
  matchedRuleIds: string[];
  reviewer?: "hook" | "guardian" | "user";
  approvalScope?: "once" | "run" | "session" | "durable-policy";
  grantedCapability: unknown;
  executionAttempt: number;
  committed: boolean;
};
```

例如“发布SEO内容”可拆成：Policy判断站点/环境/操作类型，Approval确认本次或本Run授权，Runtime只拿到目标站点和动作范围内的短寿命capability；批准不能自动扩展到其他租户或未来Run。

## 24. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Layering | 低/高层冲突、requirements overlay、忽略User/Project、文件排序 |
| Degraded load | 单文件语法错、read error、requirements仍保留、warning可见 |
| Parsing | plain shell、复合segment、heredoc、PowerShell、空wrapper、复杂fallback |
| Decision lattice | Allow+Prompt、Prompt+Forbidden、多segment最严获胜 |
| Heuristics | safe/unknown/dangerous × Never/UnlessTrusted/OnRequest/Granular × profile |
| Sandbox bypass | 全segment显式Allow、部分Allow、heuristic Allow、denied-read上界 |
| Amendment | banned exact prefix、更长prefix、已有Prompt、复杂shell、模拟不覆盖全命令 |
| Update | 并发append、duplicate line、无尾换行、disk成功内存失败、crash/fsync |
| Approval identity | 重复call ID、跨Turn late response、subcommand ID、timeout、Abort |
| Cache | env/cwd/TTY/permission差异、patch多path全命中/子集复用、重启失效 |
| Retry | sandbox denial、network denial、strict Guardian再审、禁止unsandboxed |
| Receipt | policy generation、rule provenance、binary identity、one-shot/durable结果分离 |

## 25. 对当前项目的学习结论

当前项目最值得迁移的不是Codex的shell规则语法，而是Decision Engine的不变量：

1. Tool policy只决定是否允许/询问/拒绝，不直接替代runtime capability enforcement。
2. 多条约束冲突时取最严，并保留匹配来源。
3. Run内批准、Session批准和持久Policy是不同寿命，不能共用一个`approved`字段。
4. 批准前绑定operation identity、arguments hash、tenant/environment和policy generation。
5. 执行能力升级或retry必须重新评审，旧批准不能自动跨attempt扩张。
6. 长期授权要先模拟范围、再持久化，并返回独立durable receipt。
7. Policy degraded、批准成功、规则保存失败、执行失败是四个不同结果。

Codex最优质的部分是规则与Sandbox分权、最严格Decision lattice、explicit Allow全覆盖才bypass、复杂解析不生成amendment、approval key细粒度、disk-first snapshot更新和sandbox escalation重新审批。需要避免的是parse error导致普通rules整体丢失、prefix范围证明不足、approval identity与TTL偏弱、缺policy generation，以及规则保存partial commit没有耐久回执。
