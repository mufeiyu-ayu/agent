# Google 数据个人连接

入口 `/api/google-data`，前台在插件系统目录的「Google 数据」。`GoogleDataService` 负责个人授权、加密凭据、资源选择与验证；`GoogleDataClient` 仅向固定 Google HTTPS 端点请求，有超时、响应大小和分页上限。它不走 MCP 协议，也不参与 Google 登录账号绑定。

- 每个 Kuro 用户一个 Google 数据账号；GSC/GA4 按实际返回 scopes 开放。Google 数据账号可以与登录邮箱不同。
- `connect` 生成 state + PKCE，回调绑定当前用户与 Session，state 一次消费且十分钟到期；独立 Web 客户端配置指纹防止应用配置更换后复用旧令牌。
- 刷新令牌与 access token 加密存储，接口只返回账号、权限状态与选择。单 API 实例合并刷新；多副本前需数据库互斥。
- revision 阻止迟到授权、刷新、选择与查询覆盖新连接或断开。重授权失败保留旧连接；换 Google 账号成功后清空旧资源，不能继承旧账号刷新令牌。
- GSC 站点、GA4 资源及 Web 数据流都通过 Google 列表核验，浏览器不能代替服务端决定归属。GA4 验证强制 streamId 过滤，界面由用户确认生产流；不硬编码 Topuplist ID。
- 验证请求绑定页面持有的 revision，多标签页改资源后旧页面不能显示另一资源的验证成功。验证只读取有界报告：GSC 前 10 至前 3 天 final、最多一行；GA4 最近 7 天至昨天、最多一行。不返回分析结论，空行不解释为零流量，也不将验证结果发送给模型。
- `disconnect` 删除本站凭据和资源选择，保留 revision；不自动调用 Google revoke。Google 撤销可能影响该用户在同一 Cloud 项目所有客户端的授权，界面提供 Google 端管理链接并说明差异。已有聊天记录不随断开删除。
- 错误仅返回稳定安全原因，不暴露 Google 原始错误、授权码或令牌。401/invalid_grant 标需重连；403 说明资源权限/API 配置，429/5xx 不误报授权成功。

部署配置、控制台步骤与真实验收见 [Google 数据连接配置](../../../../docs/google-data-connection.md)。聊天查询通过下面的内置工具接入；不含公司分析 Skill 或共享连接。

验证：`google-data-client.test.ts`（固定出口/响应边界）、`google-data.db.test.ts`（真实隔离 PostgreSQL + 受控 HTTP OAuth/API、鉴权/校验/故障竞争）、`apps/web/e2e/google-data.spec.ts`（受控浏览器交互）。这些不代替真实 Google 授权与资源权限验收。


## 聊天查询

`gsc_inspect` 由 `gsc-inspection.ts` 校验最多20个所属站点 URL，`GscInspectionService` 调用 URL Inspection。成功结果按 userId / Google sub / site / URL 保存到 GoogleInspection，24小时内默认复用；每次仍核对连接 revision。失败不覆盖旧成功，返回错误或未检查，不当作未收录。GoogleInspectionBudget 用 PostgreSQL 原子预留同站点太平洋日最多2000次本平台预算，失败计数；这不是 Google 实时余额，其他系统用量未知。每批两路请求、45秒内部期限，用户取消或连接改变后停止并排空工作，迟到结果不交付。缓存不是实时抓取，必须展示原 checkedAt。

`google-query-input.ts` 为三个工具维护共用 Schema 与执行端解析；`GoogleQueryService` 复用连接层的查询授权与固定 Google 出口。工具位于 `tools/google/google-query-tools.ts`，不新增 HTTP Controller。

- `gsc_query`：明确日期，date/hour/page/query/country/device/searchAppearance 分组、AND 字符串/正则过滤、搜索类型和聚合方式。hour 与 hourly_all 配对，按 America/Los_Angeles 当前日限制最近10天；日查询不伪换算成北京自然日。
- `ga4_metadata`：默认只查自定义字段，customOnly=false 可查标准字段，search 在当前资源元数据中筛选；只返回有界的字段说明与匹配数，超过时提示缩小查询。
- `ga4_query`：最多两个明确日期区间，维度/指标先经当前资源元数据检查；逻辑/数值过滤、排序、分页和币种按限定参数传给 runReport。强制将所选 streamId 作为独立 AND 条件，模型不能覆盖它。元数据同 Run 复用，每次仍核对当前连接版本。
- 参数日期窗口最多366天、默认100/最多1000上游页大小、偏移最多100000，整体参数最多12000字符。维度/指标最多9/10，过滤最多三层20叶子。模型不能指定用户、站点、资源、流、token、URL 或额外未知参数。
- `queryObservation` 保留完整 JSON 与质量信息并按整行裁剪。GA4 多日期范围实测 limit=1 可展开两条 dateRange 记录，因此按基础维度组裁剪/推进 nextOffset；物理 returnedCount 与 returnedGroups 分开，rowCount 保留 Google 原值。输出最多1000物理行且小于外层 observation 字符预算；无法容纳一整组时明确失败，不产生半份 JSON。超出分页偏移上限返回 paginationLimitReached，不提供无效继续位置。
- 原始数值字符串保留精度；缺行、错误、截断、暂计、阈值/采样/other损失分别呈现，不推断为0；总计应无分组独立查询。Google 400 参数/组合错误给出安全提示，不悄悄删字段降级。
- 只接 Google 已采集数据，未接文章正文/发布时间/文章库关联、收录巡检、业务数据库、净利润或完整渠道归因。

验证：`google-query-input.test.ts` 检查参数与结构裁剪；`google-data.db.test.ts` 扩展真实隔离库 + 受控 Google HTTP + Runtime/ToolInvocation/Step；`google-query.live.db.test.ts` 只有显式 GOOGLE_QUERY_LIVE_VALIDATION=1 时读取本地已授权连接并调用真实 Google/模型。真实验收要求唯一连接，多个连接时显式给 GOOGLE_QUERY_LIVE_USER_ID；令牌不复制，正常刷新沿用本地连接服务，聊天消息与Step仅写临时测试schema，完成后清理。报告在 `/tmp/issue259-google-query-live.json` 与 `/tmp/issue259-google-query-protocol-live.json`，含查询数据但不含凭据。普通测试不发公网请求。
