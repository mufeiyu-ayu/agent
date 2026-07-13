# Request Permissions Lifecycle：请求、批准、实际Grant与后续执行是四个阶段

本文研究 Codex 的 `request_permissions` Tool如何请求临时network/file-system能力，以及UI/Guardian的批准如何被收缩、按Turn或Session保存，再注入后续命令。重点不是approval弹窗样式，而是“批准文本”为什么不能直接等于实际权限。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. Approval、Permission、Sandbox 不是同一个概念

`request_permissions` 涉及四层：

```text
模型提出 requested permission profile
  -> policy决定是否允许发起询问
  -> UI或Guardian返回 proposed grant
  -> Core计算 actual grant = requested ∩ proposed
  -> Turn/Session state保存grant
  -> 后续具体命令合并grant并构造sandbox
```

- Approval是“谁决定、决定了什么”。
- Permission grant是实际可复用的能力集合。
- Sandbox policy是执行时如何强制限制。
- Tool Observation是模型看到的批准结果。

把四者合并成 `approved: true` 会丢失路径、环境、作用域、期限和实际生效能力。

## 2. Permission Profile 是结构化能力，不是自然语言理由

请求结构包括：

```ts
type RequestPermissionsArgs = {
  environmentId?: string;
  reason?: string;
  permissions: {
    network?: { enabled?: boolean };
    fileSystem?: {
      entries: Array<{ path: Path | Glob | Special; access: Read | Write | Deny }>;
      globScanMaxDepth?: number;
    };
  };
};
```

`reason` 用于解释，不参与sandbox计算。真正授权边界来自typed profile。这样客户端不能因为“理由看起来合理”就推断能力，也不能让模型用prompt文本偷偷扩大scope。

## 3. Tool入口先做严格解析与规范化

`RequestPermissionsHandler`：

1. 只接受Function payload。
2. 解析environment ID并绑定当前 `StepContext.environments`。
3. 以选中environment的cwd解析相对路径。
4. 调用 `normalize_additional_permissions()`。
5. 空profile直接 `RespondToModel`错误。

Normalization会：

- 移除空network/file-system section。
- 尽量canonicalize显式路径，同时保留symlink语义。
- 去重完全相同entry。
- 只允许glob用于deny-read，拒绝glob形式的allow/write。

这把“请求是否合法”放在发审批前完成，避免用户批准一个Core根本无法安全执行的模糊profile。

## 4. Environment ID 是权限命名空间

Permission grant按 `environment_id` 存储：

- Turn state一份map。
- Session state一份map。
- 后续工具只读取当前environment ID对应的grant。

测试证明给 `remote` 的network权限不会自动出现在 `local`。相对路径也基于选中environment cwd解析，而不是主session cwd。

这是云端多workspace/tenant Agent很关键的边界：能力必须绑定资源命名空间，不能只绑定用户或Run。

当前实现仍有TODO：foreign environment路径需要转为Codex host原生cwd；转换失败就返回空Turn grant。这个fail-closed正确，但限制了真正remote filesystem授权。

## 5. Approval policy 先决定“能不能问”

`request_permissions_for_environment()` 对不同策略：

- `Never`：立即返回空grant，不发事件。
- `Granular` 且 `request_permissions=false`：立即返回空grant，不发事件。
- `OnRequest`、`UnlessTrusted`、允许该能力的 `Granular`：进入Guardian或UI路径。

因此“模型调用了权限工具”不代表用户一定看到弹窗。Policy可以在请求进入human loop前直接拒绝。

空grant仍作为成功Tool Observation返回给模型，让模型能换方案；它不是基础设施exception。

## 6. UI路径先登记pending，再发送请求事件

非Guardian路径的顺序是：

1. 注册elicitation pause holder。
2. 创建oneshot response channel。
3. 在active Turn state以 `call_id` 保存pending request、requested profile和environment snapshot。
4. 发 `RequestPermissionsEvent`。
5. 等response或cancellation。

先登记再发事件避免客户端同步响应时找不到callback。pending保存原请求和environment，而不是只保存sender，为后续normalize提供可信基线。

Cancellation会从当前active Turn移除pending entry并返回None；Tool把它转换为可供模型理解的cancelled error。

## 7. Event提供上下文，但响应只用call ID定位

Request event包含：

- call ID。
- Turn ID。
- environment ID。
- startedAt。
- reason。
- requested permissions。
- native cwd。

但 `Op::RequestPermissionsResponse` 的Core匹配主要依赖call ID；真正的Turn/request/environment来自pending entry。优点是客户端response很小，且不能篡改原请求上下文。

风险是call ID冲突/ABA：

- 同一active Turn重复call ID会覆盖旧pending sender，只warning。
- 响应不携带expected Turn ID或request hash。
- late response只会warning “No pending”。
- 若新Turn恰好复用call ID，旧response可能命中新entry。

生产云端协议应使用不可复用approval request ID，并绑定 `(runId, callId, requestHash, generation)`。

## 8. Response 必须与 Request 求交集

客户端可返回permissions、Turn/Session scope和 `strict_auto_review`。Core不直接信任它，而是：

```text
actual grant = intersect(requested profile, response profile, originating cwd)
```

Network只有requested与granted都明确 `enabled=true` 才生效。File-system grant必须被requested access覆盖；Core还会保留约束accepted grant的deny entries。

因此恶意/buggy UI即使返回根目录write，也不能超过模型本次原始请求。安全关键不是客户端按钮，而是Core-side intersection。

## 9. Special path 必须在批准时物化

`ProjectRoots` 等cwd-dependent special entry在intersection后物化为实际绝对路径。测试证明Session scope批准项目根时，最终保存的是请求时cwd的具体路径，而不是一个会在未来cwd变化时重新解释的动态符号。

这是防止scope漂移的重要设计：

```text
approve(project-root at t1) != approve(any future project-root)
```

Glob deny也会基于cwd转为absolute pattern，避免后续Turn工作目录变化重解释同一个grant。

## 10. Turn grant与Session grant分开保存

Normalized response根据scope记录：

- Turn：写入originating `TurnState.granted_permissions_by_environment_id`。
- Session：写入 `SessionState.granted_permissions_by_environment_id`。

多次grant通过 `merge_permission_profiles()` 单调合并：network true保持true，file-system entries做union，deny/glob depth按约束规则合并。

当前没有显式revocation API、TTL、use count或grant ID；Turn结束或Session销毁是主要撤销边界。Session grant也未作为Rollout fact持久化，Resume后不会恢复。

安全上这比永久授权保守，但产品上必须明确“本次Codex session”不是“这个Thread以后永远”。

## 11. Grant是capability上限，具体命令仍要算effective permission

后续shell/exec处理时：

1. 读取environment的Session grant。
2. 读取Turn grant。
3. 合并命令显式additional permissions。
4. 判断effective request是否完全被已有grant覆盖。
5. 必要时将sandbox mode切到 `WithAdditionalPermissions`。

`permissions_preapproved` 不是简单“存在grant”，而是materialize路径后比较：

```text
effective permissions ∩ stored grant == effective permissions
```

只有整个命令需求都在grant内，才可视为预批准。部分覆盖不能跳过剩余审批。

## 12. Session grant会隐式进入后续命令

当命令没有显式请求escalated或另一组additional permissions时，已有grant可以作为implicit additional permissions注入sandbox。意味着一次Session network grant会让同environment后续普通命令获得network，而不必模型每次重复声明。

这是Session scope的真实产品含义，不只是少弹一次框。UI应明确显示：

- 哪个environment。
- 哪些路径/access。
- network是否开启。
- 作用到当前Turn还是后续所有Turn。

否则用户容易把“允许这次命令”误解为Session capability grant。

## 13. Strict Auto Review 只能是Turn scope

Response可设置 `strict_auto_review=true`，含义是后续命令即使policy原本Skip，也要经过Guardian review；sandbox失败后若要无sandbox retry，还必须再次Guardian review。

Core禁止 `strict_auto_review + Session scope`：normalize直接返回空Turn grant并清除strict flag。这避免把高频自动review状态以Session capability形式持久扩大。

Turn scope记录grant时才在originating TurnState开启flag，测试还专门验证它不会误写当前另一个Turn。

## 14. Guardian与Human共享最终normalize

当policy路由到Guardian时，不创建UI pending entry，而是spawn隔离review并等待decision：

- Approved：请求profile，Turn scope。
- ApprovedForSession：请求profile，Session scope。
- Denied/Abort/TimedOut：空Turn grant。
- NetworkPolicyAmendment allow/deny：映射为批准/拒绝。

之后同样调用 `normalize_request_permissions_response()` 并记录grant，所以Guardian不能绕过request intersection与cwd物化。

一个值得审慎的点：`NetworkPolicyAmendment::Allow` 当前映射为批准整个 `requested_permissions`，若同一次profile同时请求network和file-system，decision名称比实际grant窄。更安全的实现应按decision payload只批准对应capability，或禁止混合请求进入network-only decision。

## 15. Approval请求与Grant目前不是durable审计事实

`RequestPermissions` 属于transient Event，不写普通Rollout。Turn/Session grant只在内存map中；Tool最终将response JSON作为FunctionCallOutput进入模型history，但这不是完整approval receipt：

- 没有记录谁批准。
- 没有request hash。
- 没有decision时间/客户端连接。
- 没有actual sandbox policy fingerprint。
- 没有后续哪些command消费了grant。

Resume可以看到模型曾收到某段permissions response，却不能可靠重建安全审计链，也不会重新激活grant。

云端Agent应把approval request、decision和capability grant分别持久化，默认不从历史自动恢复active grant。

## 16. Pending请求无独立deadline

UI路径只等待：

- response oneshot。
- Turn cancellation。

没有request-level deadline/expiry。若客户端不响应，Turn会一直暂停，直到外层取消或连接策略处理。Batch 102对ServerRequest路由的研究也表明generic reverse request没有统一timeout/cap。

更完整的协议需要：

```ts
type ApprovalRequest = {
  id: string;
  expiresAt: string;
  runId: string;
  callId: string;
  requestHash: string;
};
```

过期必须形成显式TimedOut terminal，而不是只让sender消失。

## 17. Deny不是negative grant，Merge也不是revocation

Network profile中 `enabled=false` 不会形成持久negative capability；intersection只在双方true时授予。File-system Deny entry主要用于约束已接受的read grant，不等于从之前Session union中撤销一条allow。

`merge_permission_profiles()` 是单调累加模型。用户后续“拒绝”一次请求不会移除过去批准的Session grant。

如果产品提供“撤销”按钮，需要独立操作：

- 指定grant ID或scope。
- 原子更新capability set generation。
- 让已排队未执行command重新检查generation。
- 记录revocation receipt。

不能把空/false response当撤销。

## 18. 建议的云端Capability模型

```ts
type CapabilityGrant = {
  id: string;
  tenantId: string;
  conversationId: string;
  runId?: string;
  environmentId: string;
  requestedHash: string;
  capability: NetworkCapability | FileCapability;
  scope: "run" | "conversation-session";
  grantedBy: { type: "human" | "policy" | "reviewer"; id?: string };
  issuedAt: string;
  expiresAt: string;
  generation: number;
  status: "active" | "revoked" | "expired";
};
```

每次Tool执行生成 `CapabilityUseReceipt`：记录grant ID、command/tool call、sandbox policy hash和结果。这样“谁批准了什么”与“实际哪次调用用了它”都能审计。

## 19. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Parse | 空profile、unknown field、relative path、duplicate entry、allow glob拒绝 |
| Environment | local/remote隔离、unknown ID、foreign cwd fail-closed、cwd变化 |
| Policy | Never、OnRequest、UnlessTrusted、Granular开/关、Guardian route |
| Identity | duplicate call ID、late response、旧Turn response、新Turn ABA |
| Intersection | UI over-grant root write、partial grant、network false、deny约束 |
| Scope | Turn结束失效、Session跨Turn、Resume不恢复、environment key |
| Strict review | Turn生效、Session组合拒绝、sandbox retry再次review |
| Merge | 多次grant union、部分preapproved、无revocation语义 |
| Persistence | request/decision/grant/use receipt、冷恢复、审计主体 |
| Timeout | client断连、deadline、Turn cancel、late decision terminal |
| Mixed request | network+filesystem经network-only amendment不得全批批准 |

## 20. 对当前项目的学习结论

当前AI SEO Agent的业务工具不需要OS级filesystem grant，但同样需要Capability思维。例如发布内容、写CMS、访问Search Console、调用收费API都不应只保存 `approved=true`。

最小实现可先建立：

1. typed requested capability。
2. policy决定auto-deny/auto-allow/human review。
3. actual grant始终是requested与decision的交集。
4. grant绑定tenant、conversation/run、tool/resource和expiry。
5. Tool执行前再次校验active generation。
6. request、decision、grant、use分别形成durable receipt。

Codex 最值得学习的是typed profile、环境隔离、relative path绑定、Core-side normalization/intersection、special path物化、Turn/Session scope分离、partial preapproval判断、strict auto-review和cancellation cleanup。需要改进/避免的是call ID覆盖/ABA、无request timeout、Session grant不可撤销且无TTL、approval/grant缺durable审计、Resume语义只靠内存失效，以及network amendment可能批准混合profile的全部请求。
