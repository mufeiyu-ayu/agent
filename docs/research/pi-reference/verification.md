# 研究交付与验证记录

源码 revision 与范围见 [source-snapshot](./source-snapshot.md)、[coverage](./coverage.md)。本页只记录**当前可复核的状态**：做了哪些检查、命令是什么、结果如何、哪些明确没有验证。历史性的整理过程（删除截图、目录替换、首轮链接检查遗漏等）已从本页移除，需要时看 `docs/work-log.md`。

## 1. 按用户目标核对产物

| 要求 | 权威产物 / 证据 |
| --- | --- |
| 掌握 Pi 架构、目录、处理风格（供 AI 参照） | [architecture-and-style](./architecture-and-style.md)、[glossary](./glossary.md)、11 个主要包与根级 91 文件的 [coverage](./coverage.md)、模块正文的实际调用链 |
| 全仓重要模块有适当图表 | [8 张 Archify 图](./diagrams/README.md)：全仓、durable runtime、operation 流程、附着时序、三类数据投影、云端候选、普通 CLI 主链（含回复/工具分支）、生命周期与可定制点；每张均交付 JSON 与 HTML |
| 核心源码记录并标注 | `modules/` 的路径/符号/行号、短原文与注释、失败分支、配套测试入口；完整 [1714 文件清单](./source-files.txt) 用于查漏 |
| 心得和云端建议 | 架构风格、各模块云端取舍、[当前项目对照](./current-agent-mapping.md) |
| 实现路线 | [roadmap](./roadmap.md)：R0→R2→R1→R3→R4→R5 实现顺序，每步列出 AI 查的 Pi 素材与不借鉴的终端/provider 内容，附规模估算；保留已建 #115–117 顺序 |
| 给智能体的目的与阅读方式 | [README](./README.md)、[how-to-read](./how-to-read.md)：按问题路由、版本核实、每次一条链、只向用户汇报结论 |

本目录不修改 Pi 源码、当前产品代码或正式 Task 状态。

## 2. 两轮核实的方式与结果

### 第一轮（codex，2026-09-15）

静态通读全仓，产出模块文档、6 张图、离线断言脚本；独立研究者两轮交叉核对重要图与主文档，修正 deferred 来源、无工具回复走 checkpoint、Watch 归 Lane、Gate/permit 与审批区分、插件 profile 按 sessionPath、public/private attachmentId 等语义。

### 第二轮（Claude，2026-09-15）

- **机械校验**：脚本逐条打开全部 `/Users/ayu/Learn/pi/...:行号` 与 `/Users/ayu/Desktop/agent/...:行号` 链接（含图表 JSON），核对文件存在、行号在范围内、链接文字里的符号出现在锚点附近。当前 529 条，0 条失效，相对链接 0 条失效。
- **源码复核**：五个独立核查者按模块对照 pi 源码逐条核实 149 条行为性断言，随后主会话亲自通读 `packages/agent`（旧 loop、harness 全部 runtime/drive/execution/session 文件、events/hooks/reducer）、`packages/ai` 核心（models/lazy/event-stream/frame/transform/retry/overflow/openai-completions/validation）、`coding-agent` 主链（sdk/system-prompt/main/agent-session/session-manager/extensions 类型/rpc）、`experimental`（session-worker/manager/services/transcript/agent-controller/mini）、`server/client/protocol/chord` 关键文件。
- **结果**：0 条事实错误；约 20 处表述精确化（lane 按名即创建、requestAbort 已公开、默认工具集受 settings 影响、工具 ID 归一化条件、参数校验两条路径、cost tier 计算基数、serverId 检查顺序、AggregateError 仅多错误时、约 12 处行号漂移）；新增 runtime §3.5 宿主 API 与错误契约、coding-agent §2.3 system prompt 装配 / §3.4 恢复与模型切换 / §6.4 扩展事件目录、model §4.1 DeepSeek 专项、chord §6.5 传输插槽与控制面认证、术语表、第 7 张图（含回复用户分支）、第 8 张生命周期与可定制点图、当前项目流协议与取消行。

## 3. 实际执行的离线检查

```sh
/Users/ayu/.nvm/versions/node/v22.20.0/bin/node docs/research/pi-reference/checks/model-study-check.mjs
/Users/ayu/.nvm/versions/node/v22.20.0/bin/node docs/research/pi-reference/checks/wire-study-check.mjs
```

两者均 **exit 0，PASS**。前者 9 组：EventStream 终态顺序、eager setup、Faux deferred、缺失 tool result 合成、OAuth 并发刷新一次、过时 catalog generation 不得发布、tier 成本、telemetry 被动契约、缺失/错误 eval 不能当作零分。后者：delta base 恢复、独立字典、adoption/immutable 边界、危险 path 拒绝、1200 次确定性混合修改收敛、CBOR 合法子集/限额与非法编码、逐 byte 分帧、残帧拒绝。它们直接 import 当前 Pi 源码，是有限的学习断言，不是原仓完整测试套件。换机器时调整脚本中的 Pi 绝对路径。

环境限制：Pi checkout 无 `node_modules`，`providers/data/amazon-bedrock.json` 未 hydrate，`packages/ai/scripts/check-model-data.ts` 因缺该文件退出 1。没有安装全仓依赖、刷新目录或跑真实 provider。

## 4. 图表

```sh
cd docs/research/pi-reference/diagrams
node build.mjs            # 逐图 validate + deliver（showcase），生成 index
node build.mjs --check    # 临时重建并与现有 HTML 逐字节比较
node build.test.mjs       # 删除/重命名/只读/手写 HTML 保护回归
```

当前三者均通过：8 张图 showcase 校验，HTML 与 JSON 同步。第三轮按用户反馈重排：01/02/06/08 改为自上而下的紧凑网格（origin [36,40]、gap 96/48，viewBox 从 940×528 缩到 868×384～492，屏幕上放大约一成），03/07 改为时间自上而下的时序图，8 张图全部开启 `animation: "trace"`。查看器按容器适配缩放，节点字号由渲染器固定（标题 11、副标题 9、连线 8 个单位），因此文字大小只能通过压缩空白间接提高。图集 HTML 曾在本地 Safari 打开验证菜单切换（第一轮）；第三轮重排后尚未在浏览器中做人工视觉检查，悬停/动画表现未验证。

## 5. 本次不声称已验证

真实模型/OAuth/gateway 兼容性、实时价格与模型可用权限、Vitest 全 suite、Unix 真实连接/背压、进程 kill/restart、断电/磁盘满、生产多租户隔离、外部副作用 exactly-once、任意历史模型请求的精确重建。模块中"测试证据"若未注明运行，均指读取断言。

研究覆盖与实现/验收状态始终分开：Pi 仍未完成的能力已记录；我们未来云端需要补的责任已写入 roadmap，本次不替任一仓库宣布那些能力实现完成。
