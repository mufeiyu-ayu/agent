# 会话工作区

一个会话对应长期文件工作区；一次运行按需创建一个临时沙箱。首次 `read` / `write` / `edit` / `bash` 才创建环境，历史消息、文件列表、文件读取与预览不会创建沙箱。

文件位于沙箱 `/workspace/project`。文件、命令参数与输出均不可信；模型不能指定用户、会话、实例 ID 或 OSS 对象 key。身份从 ChatService 的登录态传给 Runtime，再进入工具上下文。沙箱不接收平台凭据；创建时同时禁出网、启用 `secure` 和关闭 `allowPublicTraffic`，避免把禁出网误当成禁公网入站。

可信监督代码从 `/`、root HOME 启动，Python 使用 `-I -S`，不加载用户目录、site 包或用户 shell 配置。命令降为非特权用户并启用 `no_new_privs`，使用模板已有的 `libseccomp.so.2` 禁止非 Unix socket 和 `io_uring_setup`，防止用户经本机 envd 绕过文件权限；缺少该库或过滤器加载失败则不执行命令。Unix IPC、Node/Python 离线检查仍可用，但不能创建 TCP/UDP 连接或 localhost HTTP 服务。进程数和文件大小受限，结束时清理子进程。

`WorkspaceService` 管理当前 Run 的 SDK 实例与数据库租约。只允许当前执行者、未过期租约和预期文件版本发布保存结果。同 Run 重试须等待旧实例释放收尾，重复释放等待同一结果；明确抢占失败不能清除已有租约。重启后的过期租约只投影为待核查，不伪称仍在运行或已经释放。OSS 对象按用户/会话前缀与 SHA-256 存储，禁止覆盖；上传重试遇到同名对象也要校验长度与内容哈希，不能把对象存在当成保存成功。只有内容或路径变化才发布新版本，同一内容在一次快照上传或恢复中只传输一次，依赖目录与 `.git` 不持久化。

保存顺序为：采集受限普通文件 → 上传不可变对象 → recorder 在同一事务内更新当前文件清单并确认工具结果 → 推送工具完成并回喂模型。上传失败或事务回滚不发布半份文件。文件事务进入 COMMIT 后等待真实确认，晚到停止只阻止后续事件和模型调用，不伪装成回滚；提交响应丢失则明确提示结果未知。取消和超时关闭整个实例，仅保证最近已确认的文件；当前未确认改动可被舍弃。创建结果未知或释放失败保留维护状态，由云端超时兜底，不把未知状态报告为已释放。

默认上限：200 个工作文件、单个 2 MiB、总计 8 MiB；stdout 与 stderr 各保存最多 32 KiB 的头尾内容。文件接口通过后端会话归属检查；前台无法直接访问私有 Bucket。删除会话后数据库文件入口消失，迟到发布被拒绝；本版本不做 OSS 历史对象物理回收，业务服务不调用 DeleteObject。停用沙箱配置不影响已有文件的 OSS 读取；前台打开交付卡片会等待刷新后的版本，切换会话或关闭面板后丢弃迟到结果。

## 页面与 Demo

`topuplist_traffic` 是明确标注来源的七天流量演示接口，没有 Google 实时数据接入。Agent 自己编写自包含 HTML、运行检查并修正错误。交互预览仍使用独立可信外层和无 `allow-same-origin` 的子 iframe；CSP 限制 HTTP、worker、嵌套页面与 WebRTC，前导脚本锁定 RTC/Worker 入口。唯一宿主查询为 `window.kuro.query('topuplist.traffic')`，宿主绑定当前会话、校验消息来源并限频，不向页面提供 Cookie 或令牌。普通 Markdown 代码预览维持静态策略。

用户入口：`GET /api/conversations/:id/workspace`、`/file?path=...&revision=...`、`/traffic`。详细参数与命令结果仍记录在 Run Trace。

## 管理台监测

`WorkspaceMonitoringService` 在云实例创建前写入独立 `SandboxExecution` 记录，再确认创建、释放与存活时长；同一 Run 复用实例。记录保存用户、会话、Run 和标题快照，无关联级联删除，删除会话不会删掉运行历史。生命周期从启用后开始记录，控制台或手动 smoke 创建的实例不算平台任务历史，不补算旧任务。

管理台 `/workspaces` 主表每个会话工作区一行，汇总当前文件量、最近沙箱状态、运行记录数与累计确认时长。`GET /api/admin/workspaces?page=1&pageSize=20` 按工作区分页，同时返回缓存的云概况；文件只返回数量和总字节，用户展示字段只关联当前页。会话删除后，用独立生命周期记录保留汇总入口，文件量和版本显示未知。点击行打开抽屉，通过 `GET /api/admin/workspaces/:conversationId/history?page=1&pageSize=20` 仅查询该工作区的分页历史；原 Run 仍存在时可跳转 Run Trace，已删除时不生成失效链接。

确认时长包含实例存在期间等待模型和工具的时间，是平台观察到的生命周期，不是云账单。未记录旧任务的工作区确认时长为 `null`；创建结果未知、释放失败或云端已不再列出的实例，其结束时间和时长保留未知。SDK 的 `endAt` 只作为超时到期时间。

普通读取查询 E2B SDK 实例列表（30 秒缓存）与 OSS `GetBucketStat`（直连、1 小时缓存）。OSS 要求后端凭据具有 `oss:GetBucketStat` 权限，SDK 数据位于返回对象的 `stat` 字段；官方统计有小时级延迟，较旧的 `LastModifiedTime` 不覆盖较新快照。整个 Bucket 的对象量包含历史版本和测试对象，不能当作当前逻辑文件量。查询失败保留上次有效值，首次失败返回 `null`，成功的零用量才返回零。

`POST /api/admin/workspaces/refresh?page=1&pageSize=20` 是页面唯一刷新动作：重新查询云端沙箱，读取 OSS 统计，核对未确认记录后返回当前分页与云概况，前端一次更新；仅使用完整、成功的云列表核对记录，不连接、唤醒或删除实例；创建预算内的记录不被核查抢先修改，迟到核查不能覆盖释放终态。核对通过批量 SQL 更新并逐行校验状态与更新时间，避免未确认历史积累后逐条数据库往返；主表与历史都将已到期的活动状态投影为待核查，不伪造释放事实。管理员鉴权、来源校验、分页 DTO 校验和响应包装沿用全局配置。

## 验证

- 常规测试：`workspace-files.test.ts`、`workspace.service.test.ts`、`workspace-tools.test.ts`。
- 真实 PostgreSQL：`workspace.db.test.ts`，仅允许 TEST_DATABASE_URL，在隔离 schema 中验证发布事务、回滚、过期/旧 owner、并发及归属，以及实例复用、取消/超时释放、释放失败、创建记录失败与删会话后保留历史。
- 云监测：`workspace-cloud.service.test.ts` 验证 OSS SDK 返回结构、直连、缓存与失败保留；管理台 `e2e/workspaces.spec.ts` 验证历史分页、时长与未知状态展示。
- 浏览器：`apps/web/e2e/workspace-build.spec.ts` 覆盖工具构建与纠错展示、JS 交互、查询桥接、下载、TS 片段、窄屏及 WebRTC 隔离。
- 手动云验证：先确认账号、地域、Bucket 和模板均为获准开发资源，再在 `apps/api` 下运行 `node --env-file=../../.env --import tsx src/workspaces/workspace-cloud.smoke.ts`。测试凭据需允许本轮 `_checks/<runId>/` 的读、写、删除。检查纠错、超时、输出、Python/shell 提权、envd 绕过、入站鉴权、网络隔离、后台进程清理、链接拒绝和跨实例 OSS 恢复；最后分页核对本轮所有实例不存在，并删除本轮对象、用 HeadObject 确认不存在。失败时保留输出的 runId / 对象 key 供核查，不把清理未知当成功；不进默认测试。

命令监督启用 Linux child subreaper，后台子孙通过内核重新归属监督进程，重复冻结、杀死并 waitpid 到 ECHILD 才确认清空，不依赖单次 PID 快照。工作区元数据写入和收尾使用独立 5 秒数据库预算，数据库实际等待受 statement timeout 约束；租约复核、状态更新和对应文件清单读取共用同一事务，恢复路径不再另做无预算读取。

运行中的程序内存与后台服务不保存；服务重启不自动续跑整段 Agent Run。环境配置见根 `.env.example`，沙箱 SDK 请求尊重 OUTBOUND_PROXY_URL，OSS SDK 直连；代理与主密钥只留在后端。

本轮开发 Bucket 为 private、BlockPublicAccess=true、未开启版本控制；不要启用版本控制后仍假设 `x-oss-forbid-overwrite` 生效。

官方边界：[极速版 E2B 兼容范围](https://help.aliyun.com/zh/agent-sandbox/user-guide/e2b-compatibility-description)、[入站与出站网络控制](https://help.aliyun.com/zh/agent-sandbox/user-guide/network-access-control)、[OSS 同名对象禁止覆盖](https://help.aliyun.com/zh/oss/user-guide/http-status-code-409)。
