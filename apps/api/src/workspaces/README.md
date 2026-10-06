# 会话工作区

一个会话对应长期文件工作区；一次运行按需创建一个临时沙箱。首次 `read` / `write` / `edit` / `bash` 才创建环境，历史消息、文件列表、文件读取与预览不会创建沙箱。

文件位于沙箱 `/workspace/project`。新网页由模型先检查空目录再执行镜像已有的 `kuro-init-react`，普通脚本不初始化网页；恢复只写已确认 Source，不叠加母版文件；Vite 的 .js/.mjs/.cjs/.ts/.mts/.cts 配置或成功 Artifact 都记录 Web Project 身份并重新链接只读 `/opt/react-template/node_modules`。文件、命令参数与输出均不可信；模型不能指定用户、会话、实例 ID 或 OSS 对象 key。身份从 ChatService 的登录态传给 Runtime，再进入工具上下文。沙箱不接收平台凭据；创建时同时禁出网、启用 `secure` 和关闭 `allowPublicTraffic`，避免把禁出网误当成禁公网入站。

可信监督代码从 `/`、root HOME 启动，Python 使用 `-I -S`，不加载用户目录、site 包或用户 shell 配置。命令降为非特权用户并启用 `no_new_privs`，使用模板已有的 `libseccomp.so.2` 禁止非 Unix socket 和 `io_uring_setup`，防止用户经本机 envd 绕过文件权限；缺少该库或过滤器加载失败则不执行命令。Unix IPC、Node/Python 离线检查仍可用，但不能创建 TCP/UDP 连接或 localhost HTTP 服务。进程数和文件大小受限，结束时清理子进程。

`WorkspaceService` 管理当前 Run 的 SDK 实例与数据库租约。只允许当前执行者、未过期租约和预期文件版本发布保存结果。Runtime 在交付终态事件前启动实例收尾，下一轮可根据数据库中的旧 owner 等待本进程已启动的清理；等待不超过 30 秒及本轮剩余预算，并响应工具/用户取消。同 Run 重试也等待旧实例释放，重复释放复用同一结果；非本进程的未知状态和真实并发仍受租约保护。明确抢占失败与迟到的旧清理不能清除新 owner。重启后的过期租约只投影为待核查，不伪称仍在运行或已经释放。OSS 对象按用户/会话前缀与 SHA-256 存储，禁止覆盖；上传重试遇到同名对象也要校验长度与内容哈希，不能把对象存在当成保存成功。只有内容或路径变化才发布新版本，同一内容在一次快照上传或恢复中只传输一次，依赖目录与 `.git` 不持久化。

可信监督结果通过 root-only 临时 GZIP 文件和 SDK 有界流传输（压缩/解压后分别最多 12 MiB），不走 envd 命令 stdout；避免完整 Source/dist 的 Base64 JSON 被命令输出通道卡住或截断，结束后删除本次两个临时文件。用户命令 stdout/stderr 的原有截断事实仍保持。

保存顺序为：采集受限普通文件 → 上传不可变对象 → recorder 在同一事务内更新当前文件清单并确认工具结果 → 推送工具完成并回喂模型。上传失败或事务回滚不发布半份文件。文件事务进入 COMMIT 后等待真实确认，晚到停止只阻止后续事件和模型调用，不伪装成回滚；提交响应丢失则明确提示结果未知。取消和超时关闭整个实例，仅保证最近已确认的文件；当前未确认改动可被舍弃。锁定的 e2b 2.31.0 在创建阶段返回认证拒绝或限流（401/429）时，记录 `create_failed` 并按 owner 条件释放租约；适配器沿用 SDK 的受保护创建入口，并在其创建后兼容检查调用 `kill` 时记录已知实例，避免把后置检查/清理的同类异常当成未创建。该阶段记录按调用隔离，不替换 SDK 全局方法；云适配器显式固定 `debug: false`，确保创建、构造和清理不被 `E2B_DEBUG` 切入本地短路而假报释放。SDK 升级需重跑本地 HTTP fixture。其他错误、响应丢失和释放失败继续保守处理，已知实例 ID 用于登记及清理，未知资源由云端超时兜底；工具报错不能把维护状态改回运行中，不把未知状态报告为已释放。

Source 与每份 Artifact 分别限制为 200 个文件、单个 2 MiB、总计 8 MiB（两份不共用计数）；stdout 与 stderr 各保存最多 32 KiB 的头尾内容。新 Source 排除 dist、node_modules、store/cache、.git、临时目录、.env* 与私钥文件；Artifact 独立采集完整 dist（包括名为 tmp/dist 的普通资源子目录），禁止的依赖/cache/Secret 路径拒绝整次发布，不静默裁剪。旧已确认清单按原安全路径读取/恢复，百分号或曾命名 tmp/dist 的 HTML 不使整份清单失效；后续保存时，仅保留清单中仍实际存在的旧工作文件，资格不随 Web Project 标签改变，删除不复活。旧文件目录归档保留这类旧 HTML 的原路径，它们不是新 Build Artifact；依赖/cache/Secret 仍不导出。文件接口通过后端会话归属检查；前台无法直接访问私有 Bucket。删除会话后数据库文件入口消失，迟到发布被拒绝；本版本不做 OSS 历史对象物理回收，业务服务不调用 DeleteObject。停用沙箱配置不影响已有文件的 OSS 读取；交付卡代表该次回答保存的内容，以 path + sha256 匹配；点击携带预期哈希，刷新后再次核对，再按当前有效 revision 读取。同 SHA 可跨 manifest revision 打开；内容改变则取消并提示失效，不自动改读新内容，也不提供历史版本回看。普通文件列表仍可显式选择当前文件；切换会话或关闭面板后丢弃迟到结果。

`read` 的脚本与最终模型 observation 共用 24,000 字符上限，计入 JSON 转义和续读元数据，只返回完整行；`nextOffset` 指向实际未返回的第一行，只有读完才为 `null`。超长单行不静默截短，返回 `readCommand`：通过现有 `bash` 每次读取 1,000 个 Unicode 字符，按输出 `nextCharOffset` 续读，再回到 `read` 的下一行。全局 observation 限制保持启用。

## Web Project 与成功构建

通用提示词只保留身份、安全、授权与开发入口；`chat/prompts/workspace-development.prompt.ts` 独立维护开发指南。首次 read/write/edit/bash 意图出现时，先确认 `workspace_development` Step（版本、原文、关联采样时点），整批旧工作区调用返回未执行，再重采样；普通解释不附加指南或执行工具。每个后续 Run 同样按需启用，采样 Step 指向启用 Step，追加指令后重置 token 用量锚点。

`bash` 的 `build:true` 仅接受 `pnpm build`：采集构建前 Source hash → 清除旧 dist → 非特权真实执行 → 成功后核对 Source 未改变、dist 类型/容量/静态引用 → 上传不可变对象 → recorder 同事务确认 Source、不可变 `WorkspaceArtifact`、当前 Artifact 指针和工具记录。Source revision 只在源码变化时递增；Artifact 绑定 user/conversation/run、sourceRevision、命令、开始时点和完整资源清单。失败构建、普通 write/edit/bash 和残留 dist 都不发布新 Artifact。失败保留最近已确认 Source 与上次成功 Preview，stderr/退出码仍在工具记录与时间线。

源码目录 ZIP 直接从同一已确认 Source revision 读取 OSS，保留根配置、lockfile、src/public 的原字节和相对路径。使用有界 ZIP STORE，不创建沙箱。读取期间变版、删会话、取消或内容损坏时不交付半份归档；UI 失败重试固定原 revision，只有明确再次下载才选择当前版本。Code 只读，展示格式化不修改 Source/Artifact；单文件下载入口从工作文件面板移除，普通聊天代码片段保持原行为。

`topuplist_traffic` 仍是七天演示数据，不是真实统计。新页面把演示输入写入 Source，本地交互不依赖业务 API 或宿主查询；默认 React，但用户指定 HTML + Tailwind 时使用同一 Vite/Tailwind 底座的原生入口。旧单文件 HTML 不迁移，继续使用已有隔离预览与演示桥接；普通 Markdown 代码预览维持静态策略。

## 多文件 Preview 的边界

宿主认证后为一个不可变 Artifact 获取 10 分钟的随机只读 capability；最多保留 1000 个活动入口，进程重启后失效；每个入口在读取前扣除 32 MiB / 2000 次请求预算，防止生成页面通过重复资源请求制造无界并发/OSS 流量。每次资源读取仍检查会话归属、用户状态、过期与删除，能力不是 Session 或 Agent 授权。当前 Source/Artifact 更新不改变已经打开的资源目标；失效或读取失败由宿主重试同一个 Artifact。

入口响应仅含可信包装器，HTTP CSP 强制 `sandbox allow-scripts`（无 allow-same-origin），即使直接导航/新窗口也不变成 Kuro origin 的生成页面。包装器在另一个 opaque srcdoc 中渲染原构建 HTML，仅补固定资源 base 与 RTC/Worker 锁定，不把 dist 合并或改写成 self-contained。继承的 CSP 仅允许该 capability 资源路径的脚本、CSS、图片与字体；禁 connect/frame/worker/form/WebRTC，父包装器阻断子页面自身导航，生成页面不接收 Cookie/平台密钥。原始资源返回 attachment + nosniff + 无脚本 sandbox；模块/字体只向 opaque origin 提供无凭据 CORS，HTML 原文永不直接作为可执行文档响应。相对模块、CSS url、SVG/图片、查询参数及 MIME 保持真实文件链路。普通 `href="#section"` 在当前 opaque 文档内滚动；原生 `.html` 内部链接只允许同 capability 资源目录，由可信包装器通知宿主切到固定清单的 `/document?path=...` 再隔离渲染，不放开生成页面自身导航或外网，也不提供通用路由。

用户入口：`GET /api/conversations/:id/workspace`、`/file?path=...&revision=...`、`/archive?revision=...`、`/artifacts/:artifactId/preview?origin=...`、兼容 `/traffic`；capability 入口在 `/api/workspace-preview/:token/`。详细参数、检查结果与构建身份仍记录在 Run Trace。

## 管理台监测

`WorkspaceMonitoringService` 在云实例创建前写入独立 `SandboxExecution` 记录，再确认创建、释放与存活时长；同一 Run 复用实例。记录保存用户、会话、Run 和标题快照，无关联级联删除，删除会话不会删掉运行历史。生命周期从启用后开始记录，控制台或手动 smoke 创建的实例不算平台任务历史，不补算旧任务。

管理台 `/workspaces` 主表每个会话工作区一行，汇总当前文件量、最近沙箱状态、运行记录数与累计确认时长。`GET /api/admin/workspaces?page=1&pageSize=20` 按工作区分页，同时返回缓存的云概况；文件只返回数量和总字节，用户展示字段只关联当前页。会话删除后，用独立生命周期记录保留汇总入口，文件量和版本显示未知。点击行打开抽屉，通过 `GET /api/admin/workspaces/:conversationId/history?page=1&pageSize=20` 仅查询该工作区的分页历史；原 Run 仍存在时可跳转 Run Trace，已删除时不生成失效链接。

确认时长包含实例存在期间等待模型和工具的时间，是平台观察到的生命周期，不是云账单。未记录旧任务的工作区确认时长为 `null`；创建结果未知、释放失败或云端已不再列出的实例，其结束时间和时长保留未知。SDK 的 `endAt` 只作为超时到期时间。

普通读取查询 E2B SDK 实例列表（30 秒缓存）与 OSS `GetBucketStat`（直连、1 小时缓存）。OSS 要求后端凭据具有 `oss:GetBucketStat` 权限，SDK 数据位于返回对象的 `stat` 字段；官方统计有小时级延迟，较旧的 `LastModifiedTime` 不覆盖较新快照。整个 Bucket 的对象量包含历史版本和测试对象，不能当作当前逻辑文件量。查询失败保留上次有效值，首次失败返回 `null`，成功的零用量才返回零。

`POST /api/admin/workspaces/refresh?page=1&pageSize=20` 是页面唯一刷新动作：重新查询云端沙箱，读取 OSS 统计，核对未确认记录后返回当前分页与云概况，前端一次更新；仅使用完整、成功的云列表核对记录，不连接、唤醒或删除实例；创建预算内的记录不被核查抢先修改，迟到核查不能覆盖释放终态。核对通过批量 SQL 更新并逐行校验状态与更新时间，避免未确认历史积累后逐条数据库往返；主表与历史都将已到期的活动状态投影为待核查，不伪造释放事实。管理员鉴权、来源校验、分页 DTO 校验和响应包装沿用全局配置。

## 验证

- 常规测试：`workspace-files.test.ts`、`workspace.service.test.ts`、`workspace-tools.test.ts`。`tools/workspace/workspace-read.test.ts` 需要本机 Python 3（仅标准库），以临时目录/当前账号映射运行真实 FILE_SCRIPT，经 ReadTool、ToolInvocation 和 observation 验证分页及超长行替代命令；不是云端 Linux 隔离验证。
- 真实 PostgreSQL：`workspace.db.test.ts`，仅允许 TEST_DATABASE_URL，在隔离 schema 中验证发布事务、回滚、过期/旧 owner、并发及归属，以及实例复用、取消/超时释放、释放失败、创建记录失败与删会话后保留历史。
- SDK 与云监测：`workspace-cloud.service.test.ts` 用本机 HTTP fixture 和真实锁定 SDK 验证 401/429、丢失响应及创建后检查失败的分类，不创建真实云资源；另验证 OSS SDK 返回结构、直连、缓存与失败保留；管理台 `e2e/workspaces.spec.ts` 验证历史分页、时长与未知状态展示。
- 浏览器：`apps/web/e2e/workspace-build.spec.ts` 覆盖旧 HTML/演示桥接与只读源码兼容；`workspace-project.spec.ts` 覆盖真实多文件模块/CSS/SVG/查询参数、侧栏/整页/窄屏、Source ZIP 与构建隔离。`workspace-project.test.ts` 用真实 Python 文件采集和标准库 ZIP 解包验证 Source/dist 分离、目录/链接/文件类型、容量及静态资源引用；`workspace.db.test.ts` 增加 Artifact 同事务、CAS/回滚、固定资源版本、归档和删会话期间迟到读取。
- 两个真实 Agent 案例：在获准本机开发/测试库和开发云资源下，在 `apps/api` 运行 `node --env-file=../../.env --import tsx src/workspaces/workspace-project.smoke.ts`。只读开发库现有模型配置（默认模型，缺省选已探活可见 DeepSeek），在独立 TEST_DATABASE_URL schema 经真实 ChatService 执行 React 与 HTML 两例的生成/续改，另验证 Python；不启动应用 dev server，不部署。提示可直接复制脚本中的 CASES。records.json、真实 Source/dist、ZIP、浏览器截图及 report.json 留在本机输出目录；脚本清理本轮随机用户 OSS、临时沙箱和 schema。失败记录不是 PASS，不能用 fixture 或母版 smoke 代替。
- 手动云验证：先确认账号、地域、Bucket 和模板均为获准开发资源，再在 `apps/api` 下运行 `node --env-file=../../.env --import tsx src/workspaces/workspace-cloud.smoke.ts`。测试凭据需允许本轮 `_checks/<runId>/` 的读、写、删除。检查纠错、超时、输出、Python/shell 提权、envd 绕过、入站鉴权、网络隔离、后台进程清理、链接拒绝和跨实例 OSS 恢复；最后分页核对本轮所有实例不存在，并删除本轮对象、用 HeadObject 确认不存在。失败时保留输出的 runId / 对象 key 供核查，不把清理未知当成功；不进默认测试。

命令监督启用 Linux child subreaper，后台子孙通过内核重新归属监督进程，重复冻结、杀死并 waitpid 到 ECHILD 才确认清空，不依赖单次 PID 快照。工作区元数据写入和收尾使用独立 5 秒数据库预算，数据库实际等待受 statement timeout 约束；租约复核、状态更新和对应文件清单读取共用同一事务，恢复路径不再另做无预算读取。

运行中的程序内存与后台服务不保存；服务重启不自动续跑整段 Agent Run。环境配置见根 `.env.example`，沙箱 SDK 请求尊重 OUTBOUND_PROXY_URL，OSS SDK 直连；代理与主密钥只留在后端。

本轮开发 Bucket 为 private、BlockPublicAccess=true、未开启版本控制；不要启用版本控制后仍假设 `x-oss-forbid-overwrite` 生效。

官方边界：[极速版 E2B 兼容范围](https://help.aliyun.com/zh/agent-sandbox/user-guide/e2b-compatibility-description)、[入站与出站网络控制](https://help.aliyun.com/zh/agent-sandbox/user-guide/network-access-control)、[OSS 同名对象禁止覆盖](https://help.aliyun.com/zh/oss/user-guide/http-status-code-409)。
