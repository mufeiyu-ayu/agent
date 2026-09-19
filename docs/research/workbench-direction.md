# 内部数据工作台方向（2026-09-20 定案）

状态：方向定案，未立 Issue，路线正文未改。讨论发生在 2026-09-19 至 09-20 的一个会话，本文只记结论、理由与边界，不写需求细节。新会话先读本文第 1、7、8 节，再看 [`../tasks/README.md`](../tasks/README.md) 与 [`../roadmap.md`](../roadmap.md)。

## 1. 结论

把公司的 GSC / GA4 数据观测项目（gsc）与本仓库合并成一个内部系统：**固定页面是基础，agent 对话是补充**，跑在本机 Docker、局域网访问。第一个用户是用户自己，之后是运营。本 runtime 从此以它为唯一真实负载，路线 R2～R5 的触发全部来自它。

## 2. 为什么

- 运营不会分析数据，小需求（换时间窗、换指标、加筛选、换图形）全压在用户身上，每条都要写页面。
- gsc 的页面写死、运营用得少；它的价值在 8,000 行带口径的数据层。
- runtime 没有真实使用，路线 R2～R5 的进入条件全是「真实使用」，没有负载永远走不到。
- 两个项目独立，两套部署、两套代码。

## 3. 产品形态

| 应用 | 定位 | 用户 | 内容 |
| --- | --- | --- | --- |
| `apps/web` | 工作台 | 运营、用户 | 左侧菜单：搜索概览、文章、收录、经营分析（从 gsc 移植）；Agent 对话 + 右侧预览 + 下载；登录 |
| `apps/admin` | 管理台 | 用户 | Google 接入与重授权、数据同步、配额、收录任务与观察清单、知识库索引、模型与中转站、用户权限、Agent 配方与口径、Runtime 可观测（现有） |

判断一个功能放哪：运营天天用的放工作台，偶尔配一次的放管理台。两个应用都是内部系统，没有 C 端；#134 保留的落地页在固定页面进来时换成带菜单的壳。是否合成一个应用按角色显示菜单，未定。

## 4. agent 对话做什么

- **问数据**：回答带时间窗、时区、取数时间、是否 partial、缺行提示。
- **生成页面**：agent 在容器里写单文件 HTML（数据内联、常用库预装），右侧 `iframe` 预览；页面内筛选、排序、切图例是页面自己的 JS，不经模型。
- **导出**：CSV 第一版；Excel 等容器能跑库之后。
- **底座**：两个通用查询工具（GSC Search Analytics：维度 × 过滤 × 时间窗；GA4 Data API：维度 × 指标 × 时间窗）加收录检查、Sitemap 状态。口径配方是底座上的常用组合，给运营时再加，不是限制。
- **聊天还是构建**：模型看到工具清单自行决定，不另做分类。

## 5. 边界

- 凭据只在后端；容器不出网、不碰凭据，数据由工具取好放进工作区。
- 不让模型自由写 SQL；目录外的分析第一版直接说做不了。
- 走 gsc 已有的缓存与配额层，不直接打 Google（GSC 每分钟限流、URL Inspection 每日 2,000、GA4 按 token 计日配额）。
- 不做分享链接、独立站、外网部署。
- 仍不引入 Multi-agent、LangGraph / workflow engine、微调。

## 6. 合并 gsc

gsc 现状三块：

| 块 | 规模 | 去向 |
| --- | --- | --- |
| Python CLI（`gsc.py` / `ga4.py` 等） | 1,900 行，零依赖 | 给 Codex 读报告用的手工版；agent 跑通即多余，退役 |
| 看板数据层 `dashboard/src/lib/` | 8,000 行 TS：OAuth、GSC / GA4 查询、缓存、配额、口径、SQLite、同步调度、收录任务 | 迁进 `apps/api` 一个模块，SQLite 换 Postgres，凭据同迁 |
| 看板页面 `dashboard/src/app/` | 13,000 行 React（大半是 shadcn 组件壳） | 按常用度移植到 `apps/web` 的 Vue，一页一个 Issue；不进管理台 |

顺序：数据层 → 页面 → agent 数据工具（调同一模块）→ 容器与面板。gsc 本地副本在迁完前是数据源，随便改；公司那份容器照跑不动。不做：页面原样重写；三份 Google 客户端并存。

## 7. 推进：档、触发、里程碑

| 档 | 交付 | 触发 | 规模（估） |
| --- | --- | --- | --- |
| 0 源码阅读 | 主线三块（数据模型、入口、循环）读完；三笔带读 #115 / #116 / #126；产出一次运行的四态清单（内存、数据库、模型输入、UI 各由谁写、请求结束后剩什么） | 现在 | 1～2 周 |
| 0.5 真实对话验证 | 六条提示各打一种路径（纯聊天、单工具、同轮多工具、thinking + 工具、幻觉工具、Grounding），每个坑一个 Issue | 读完 | 几天 |
| 1 自用 | 数据层迁入；页面移植；数据工具；容器与写 / 读 / 跑三个工具；右侧预览与下载。**M1：用户自己能用对话做出真数据页面** | 0.5 完成 | 8～12 周 |
| 2 自用加重 | R2 关页续跑与 `packages/agent` 分包；R3 审批门最小版。**M2：长任务不丢，危险动作先问** | R2：第一次因关页丢任务；R3：消耗配额的动作进工具清单 | 5～7 周 |
| 3 开放同事 | 登录权限（工作台与管理台共用）、Admin 按人看运行、口径配方、结果亮过程。**M3：同事在局域网用** | 第一个同事要用 | 3～4 周 |
| 后 | R1 可重建、R4 多端、第二 provider、skill / MCP、compaction、定时任务、管理台各页、吸收 gsc 剩余 | 各自触发；第二 provider 的触发是 DeepSeek 页面质量不够 | 各 1～4 周 |

估算按已完成 Issue 的实际速度校准；瓶颈是学习环节不是实现，豁免按 Issue 单独记。一次只在讨论会话立下一个 Issue，不预排。

## 8. 对原路线的改动

- 骨架不变：R2 → R1 → R3 → R4 → R5、学习出口、`workflow.md` 硬约束。
- OS sandbox 从「明确后置」移出，进第 1 档。
- `web_fetch` 的空位换成 gsc 数据工具；`web_fetch` 仍 Gated。
- 各步触发具体化见第 7 节；Admin Task 4 的触发即「第一个同事要用」。
- 分包仍在 R2。第 1 档新代码写在现有位置（`apps/api/src/tools/` 等），零 Nest 装饰器、零 Prisma import，数据库与 Docker 只经注入接口用，到 R2 随 `git mv` 进 `packages/agent`。
- 路线正文（`roadmap.md`、`pi-reference/roadmap.md`）等第 0 档完成后按本节改写。

## 9. 否决的选项

| 选项 | 否决理由 |
| --- | --- |
| gsc 安装我们的包 | 栈不通（Python + Next）；循环要 Postgres 与流端点，不是库；`packages/agent` 不存在 |
| 按我们规范重写 gsc 整体 | 页面重写纯成本；数据层要迁但先要知道要哪些 |
| agent 替代固定页面 | 误读用户意图；固定页面是基础，agent 补长尾 |
| 只做规格驱动图表、不要容器 | 用户要 agent 自己试错的能力；容器进第 1 档 |
| 懒路径：gsc 做 MCP server，同事用 Claude.ai | 数据经第三方、按席位付费、没有服务端引用校验；作为基线记录 |
| 提前分包 | 一个消费者；接口取决于 operation 模型；搬完是半空的包 |
| 对话放管理台或 gsc 看板 | 管理台是运维面；gsc 看板运营不开 |
| 现在接第二模型 | 先在 DeepSeek 跑通 |

## 10. 未决

- DeepSeek V4 Pro 写页面的质量是否够，用运营十条需求测。runtime 三处 DeepSeek 专用（`packages/ai/src/deepseek.ts` 模型表、请求固定带 `thinking` / `reasoning_effort`、回填要求 `reasoning_content`），换模型时一并泛化成兼容开关表。
- 工作台与管理台是否合成一个应用。
- 口径由谁兜底：现状无人，靠结果亮出过程。
- 运营十条小需求原话：目录种子与验收集，待用户收集。
- 沙箱镜像语言、数据内联还是页面拉 JSON、刷新 Google 数据的权限：到对应 Issue 定。
- Phase 8 文章检索管线（4,700 行）：留作「文章内容 × 流量」跨源问答，暂不动。

## 11. 相关项目位置

两台电脑路径不同，按文件夹名找：

| 项目 | 文件夹名 | 家里电脑 | 公司电脑 |
| --- | --- | --- | --- |
| 本仓库 | `agent` | `~/Desktop/agent` | 桌面 |
| GSC / GA4 观测 | `gsc`（公司电脑叫 `gsc-insights`） | `~/Desktop/company/gsc` | `~/Desktop/gsc-insights` |
| C 端站（Nuxt） | `vcode_frontend` | `~/Desktop/company/vcode_frontend` | `~/Desktop/vcode_frontend` |
| 后端 API（Laravel） | `vcode_api` | `~/Desktop/company/vcode_api` | `~/Desktop/vcode_api` |
| B 端管理（Nuxt） | `vcode_backend` | `~/Desktop/company/vcode_backend` | `~/Desktop/vcode_backend` |
| Pi 源码 | `pi` | `~/Learn/pi` | 无 |

gsc 里先看：根 `AGENTS.md`（口径约束）、`README.md`、`dashboard/src/lib/`（数据层）、`dashboard/src/app/api/`（9 条路由，无鉴权，局域网）、`docs/GA4-WORKSPACE-PLAN.md`（经营分析提案）。vcode 三个仓库只读。agent 仓库转私有后，gsc 相关代码可直接放本仓库。
