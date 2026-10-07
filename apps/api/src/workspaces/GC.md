# 工作区对象回收与核查

仅保留当前 Source、当前最近成功 Artifact 与仍有效的旧预览。不提供 Git、历史选择或回滚；不可变 SHA 是安全发布手段，不是用户历史版本。

## 发布与回收边界

- 上传前持久登记 `WorkspaceUpload`（Run、Bucket、目标 key），明确结束后记 `settled`；PUT 未得到明确响应或登记收尾失败，保留 `active/unknown`。超时、租约过期、进程消失都不是“云端一定没有迟到 PUT”的证明。
- `WorkspaceGcTarget` 不设会话 FK，记录固定 user/conversation/Bucket；会话删除与 tombstone 同事务，级联不会丢清理目标。删除确认后 API 立即失效，旧 owner 不能发布；在途上传阻止清空，迟到确认之后再对账。切换 Bucket 的旧目标不自动迁移或删除。
- Source、Artifact 与 Step 仍同事务确认。上传完成不等于指针已确认；COMMIT 响应未知时，GC 与 recorder 共用 PostgreSQL advisory transaction lock，等待实际事务结局后读取完整有效引用，不把未知当回滚。
- 取得 owner、上传登记、文件确认、预览授权、删除与 GC 共用会话存储互斥。初始快照需要保留的对象本轮保守跳过（引用解除由 generation/旧预览到期续扫），GC 对其余候选逐对象在锁内重新判定并确认持久删除屏障，再执行 OSS 删除；屏障与操作 ID 阻止新 owner、上传和同 SHA 发布，直到得到明确云请求结局。不能仅靠数据库锁：SDK/事务超时后，云端 DELETE 仍可能迟到。旧 dry-run 结果不能作为直接删除清单。正在执行/提交或不明 owner，以及活动/未知上传都保守跳过。
- 当前 Source 与当前 Artifact 的已确认 SHA 才可跳过 PUT；owner 与上传登记在此次保存确认前持续保护引用，不能任意复用历史 hash。多个路径、Source/Artifact 共享同对象，只有全部有效引用解除才可删；前端隐藏的文件仍完整参与引用、恢复与 ZIP。
- 新 Artifact 确认时，旧构建记 `retiredAt`，不能历史重开/无限续期。当前构建发放能力前在同一互斥内持久记录 `previewExpiresAt`（10 分钟）；旧能力在保护期内固定旧资源，回收进程不依赖 API 的内存 Map。过期后独占对象与旧记录一起淘汰；失败构建不切换当前 Artifact。能力进程重启后失效，前台可打开当前最近成功构建，不将旧 token 映射新内容。
- 清理需求持久化 `generation`：目标登记（包括会话 tombstone）、上传收尾及维护解除未知保护推进代次；Source/Artifact 保存被同一上传保护流程覆盖。逐对象 DELETE 屏障及其收尾不推进代次。collector 只用开始扫描的代次 CAS 确认 pending，不能吞掉扫描期间新增的删除/孤儿清理需求；启动/定时恢复继续扫描新需求。本扫描曾因旧预览保护保留对象时，收尾即使已到期也保留 pending，由下一轮重新列举；自然到期不靠 generation 推进。自动 apply 初次明确 blocked 时保留 pending 并停止无效 OSS 扫描，人工 dry-run 仍可完整列举。
- GC 错误不修改 Source/Artifact/工具成功记录。删除幂等；明确拒绝后的部分失败可重新列举并复核，已删对象不再重复，剩余目标保持 pending。数据库/云删除响应未知保留持久写入屏障，禁止自动重新发布同 SHA；核查后才解除并重试，不宣称完成。

## 启用与维护

先应用 migration，停止旧版本 API，再核定环境、Bucket、数据库和允许回收的会话范围；旧 API 没有持久保护，不能与新 GC 并行。升级迁移为已有非当前 Artifact 保守留一个原能力窗口。

`OSS_WORKSPACE_GC_ENABLED` 默认关闭，避免实施/升级时未经范围授权删除既有对象；核定范围后设为 `true` 才启用问答收尾/删除触发、启动恢复与每分钟 pending 对账。该后端调度不是前台清单轮询，不启动新沙箱。不要修改私人 `.env` 或用整桶年龄生命周期替代引用判断。

在 `apps/api` 下，默认只读，环境取根 `.env`：

```sh
node --env-file=../../.env --import tsx src/workspaces/workspace-gc.ts
node --env-file=../../.env --import tsx src/workspaces/workspace-gc.ts --conversation <已核定会话ID>
```

默认遍历数据库已知工作区与持久删除目标，OSS 列举使用 prefix + 完整 marker 分页；报告 retained/candidates/unknown/blocked/failed。活动/未知状态、身份不一致、非当前但未退役记录或损坏清单不能作为可删候选。孤儿但无法关联会话的业务前缀及 `_checks/` 不自动纳入，须先单独核定。

只有收到该环境与会话范围的具体删除授权后才执行：

```sh
node --env-file=../../.env --import tsx src/workspaces/workspace-gc.ts \
  --conversation <ID> --bucket <核定Bucket> --database <host:port/database> --apply
```

禁止无会话范围 apply、整桶清理或自行扩 RAM。需要 `oss:ListObjects`、目标前缀的 `oss:DeleteObject`，原读写仍需相应权限；拒绝响应/签名错误如实报告，SDK 异常与凭据不进入报告。仅适用于未启用版本控制的 Bucket；不把删除标记当物理回收，也不清理 OSS 历史版本。

### 未知上传、进程重启与失败恢复

正常明确完成的上传和删除可由 pending 对账自动恢复；`active/unknown` 上传保留 key 与 Run，不能自动按年龄解除保护。先核查 Run/Step/当前 Source/Artifact、所有该环境的写入进程和云请求结局。必要时停止相关写入进程，取得上游请求已结束的依据；**进程重启或租约过期本身不够**。确认无在途 PUT 后，维护入口提供显式解除，且仍拒绝数据库中 RUNNING Run：

```sh
node --env-file=../../.env --import tsx src/workspaces/workspace-gc.ts \
  --conversation <ID> --bucket <Bucket> --database <host:port/database> \
  --settle-upload <已核查UploadID> --confirm-no-inflight
```

未知删除同样不能以超时/重启认定结束：先停止相关写入并取得 OSS DELETE 的实际结局，再用同样的范围参数加 `--settle-delete <已核查DeleteID> --confirm-no-inflight` 解除屏障。普通进行中的删除只按数据库实际状态有界等待，未知则拒绝新存储写入；已确认 Source/Artifact 仍可读取。操作 ID 防止旧收尾改写新的删除状态。

这些操作只解除已核查的保护，随后仍是只读对账；删除另需 `--apply` 的范围授权。无法取得确定结局时继续保留，不伪造回滚/清理成功。独立测试使用隔离 PostgreSQL 与受控 OSS 故障，涵盖真实锁、引用共享、COMMIT 响应丢失、迟到 PUT、删除失败及新进程重试。

## 恢复限制

数据库备份只含文件指针，**不是完整工作区文件备份**。回收后恢复旧数据库可能指向已删除的 Source/Artifact；需重新生成相应文件和构建，不能宣称完整恢复或回滚。不要为旧数据库备份永久保留废弃对象。本任务不增加 OSS 文件备份系统。

实现、隔离验证、真实云验证与既有数据清理分别记录。dry-run 不等于已获删除授权，也不等于执行清理；云验证只允许本轮随机隔离资源并清理它们。既有业务/测试前缀先报告具体环境、Bucket、数据库、对象范围和 dry-run，再等待范围授权。
