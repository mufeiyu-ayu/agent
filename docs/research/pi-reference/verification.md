# 研究交付与验证记录

日期：2026-09-15。源码 revision 与范围见 [source-snapshot](./source-snapshot.md)、[coverage](./coverage.md)。下面区分源码研究、离线断言、图表校验和未实测能力，不把其中一种证据扩张成另一种。

## 1. 按用户目标核对产物

| 要求 | 权威产物 / 证据 |
| --- | --- |
| 学习 Pi 架构、目录、处理风格 | [architecture-and-style](./architecture-and-style.md)、11个主要包与根级91文件的 [coverage](./coverage.md)、模块正文的实际调用链 |
| 全仓重要模块有适当图表 | [6张 Archify 图](./diagrams/README.md)：全仓、runtime、operation流程、附着时序、三类数据投影、云端候选；每张均交付JSON和HTML |
| 核心源码记录并标注 | `modules/` 的路径/符号/行号、短原文与注释、失败分支、配套测试入口；完整 [1714文件清单](./source-files.txt) 用于查漏 |
| 心得和云端建议 | 架构风格、各模块云端取舍、[当前项目对照](./current-agent-mapping.md) |
| 后续学习与重构路线 | [roadmap](./roadmap.md)：L0–L8学习，R0–R5候选演进，前置条件与失败场景；保留已建#115–117顺序 |
| 替换旧研究体系 | 现行目录为pi-reference；旧Codex调研、reference、阶段路线及中间归档已删除，通用学习方法保留在pi-reference |
| 给智能体的目的与阅读方式 | [README](./README.md)、[how-to-read](./how-to-read.md)：按问题路由、版本核实、每次一条链、用户控制节奏 |

本次范围为研究与导航资料、旧研究清理和离线检查。没有修改 Pi 源码、当前产品代码或正式Task状态。Git 提交以仓库历史为准，本次不包含 push、PR、合并或发布。

## 2. 实际执行的离线检查

### 模型 / 观测 / 评估

```sh
/Users/ayu/.nvm/versions/node/v22.20.0/bin/node docs/research/pi-reference/checks/model-study-check.mjs
```

结果：**exit 0，9组 PASS**。直接 import 当前 Pi 源码，检查 EventStream 终态顺序、eager setup、Faux deferred、缺失tool result合成、OAuth并发刷新一次、过时catalog generation不得发布、tier成本、telemetry被动契约、缺失/错误eval不能当作零分。

### Delta / CBOR / framing

```sh
/Users/ayu/.nvm/versions/node/v22.20.0/bin/node docs/research/pi-reference/checks/wire-study-check.mjs
```

结果：**exit 0，PASS**。检查base恢复、独立字典、adoption/immutable边界、危险path拒绝、1200次确定性混合修改收敛、CBOR合法子集/限额与非法编码、逐byte分帧、残帧拒绝。

两个脚本均由子研究者和主会话复跑成功。它们是有限的学习断言，不是原仓完整测试套件或生产竞态验证。命令从 agent 根目录执行；换机器时调整脚本中的 Pi 绝对路径。

### 环境限制的实际证据

Pi checkout 无 `node_modules`，生成 `providers/data/amazon-bedrock.json` 未 hydrate。执行 `packages/ai/scripts/check-model-data.ts` 因缺该文件退出1，已记录在 model coverage。没有为研究安装全仓依赖、刷新目录或跑真实provider。

## 3. 图表JSON与HTML维护

按用户要求，已删除24张PNG、6个四图验收HTML和12份机器验收JSON。源JSON统一放入 `diagrams/specs/`，正式图表保留在diagrams，新增index侧栏入口和统一构建脚本；没有保留截图或联系表附件。

每份源JSON的 `meta.output` 对应同名HTML。清理后已逐份运行validate与deliver，全部达到 **9/9 showcase、0 errors、0 warnings**。当时生成HTML的SHA-256与清理前逐份一致，确认修改输出路径元数据没有改变展示内容。后续深度Review修正了第4张图的订阅说明，并从JSON重新生成；机器回执只用于当次核对，不另存文件。

`node diagrams/build.mjs --check` 已通过：临时重建6张图与现有HTML逐字节一致，index也与JSON元数据及页面模板一致。本地Safari实际打开index后，六张图均可加载，菜单逐项切换时标题、序号和iframe目标对应；未启动HTTP服务。

`node diagrams/build.test.mjs` 已通过：删除或重命名JSON时，`--check` 报告遗留HTML且保持只读，正常构建同步清理生成页面与菜单；非生成的手写HTML会阻止构建，内容不被删除。回归检查只修改临时副本。

首次生成时已通过1440×900、1600×1000、1920×1080、2048×1320的浏览器尺寸检查，并实际查看浅/深色截图。用户已验收图集HTML；本次只校正第4张图的源码语义。交互按钮没有完成全面自动化实测，不把页面可打开等同于所有点击流程通过。

第4张图修正后，在临时目录重新执行 `visual-check`，四种尺寸均无溢出；实际查看1440浅色与2048深色截图，订阅标签和说明卡片显示完整。临时截图与回执核对后删除，研究目录未增加附件。

## 4. 源码事实交叉复查

独立研究者两轮核对重要图与主文档，已修正：

- deferred来自模型响应，显式poll后回response；不是tool→deferred。
- 无工具回复先回checkpoint，不绕过inbox/before_run_end进入terminal。
- Watch属于Lane；Harness.watchSession仍stub；UI投影有snapshot/resnapshot来源。
- Gate/poll permit与用户审批区分。
- 插件profile按serverId + sessionPath保存，不按Branch。
- 通用server包与提供业务服务的experimental宿主区分。
- public/private两层attachmentId分别说明；校准当前agent的源码锚点。

这些修改回到真实实现核实，没有为了图简洁而改变运行语义。

用户要求深度Review后，另修正五项：SDK默认磁盘持久化及项目信任边界、共享Lane watch与客户端订阅的层次、图表构建遗留HTML检测与清理、Pi的小默认能力与扩展工作流哲学，以及`before_run_end`后重新检查inbox、让新输入优先的结束流程。对应源码锚点、图表JSON和学习入口已同步。

## 5. 文档、目录与边界检查

- 首轮只检查选定的37份Markdown与540个本地链接，遗漏了顶层codex和旧learning-roadmap；该结果不能证明目录替换完整。用户指出后，目录检查扩大到整个research，链接检查覆盖全部研究文档及外部入口。
- 旧资料清理阶段检查过27份Markdown、515个不同本地链接；新增图集入口后重新核对全研究目录链接。research顶层仅保留README、pi-reference及两份项目专题资料，PNG数量为0；图表文件为specs中的6份JSON、6张图表HTML、index、build脚本与README。
- `source-files.txt` 与当前Pi的 `git ls-tree -r HEAD` 字节级一致；Pi HEAD仍为固定revision，工作树干净。
- 6组JSON的输出路径与HTML一一对应；`build.mjs --check` 确认当前HTML与最终JSON及模板逐字节一致。
- 按用户后续明确要求，旧codex、codex-reference、learning-roadmap及中间archive目录均已删除，移除65份归档Markdown。通用学习方法已保留在pi-reference；现行入口无旧资料链接。work-log中的旧路径仅记录历史动作。
- `git diff --check` 通过；正式Task目录和产品源码无改动。
- 深度Review修复后重新检查27份Markdown、636处本地链接与源码行号，目标文件和行号均存在。

## 6. 本次不声称已验证

真实模型/OAuth/gateway兼容性、实时价格与模型可用权限、Vitest全suite、Unix真实连接/背压、进程kill/restart、断电/磁盘满、生产多租户隔离、外部副作用exactly-once、任意历史模型请求的精确重建。模块中“测试证据”若未注明运行，均指读取断言。

研究覆盖与实现/验收状态始终分开：Pi仍未完成的能力已记录；我们未来云端需要补的责任已写入roadmap，本次不替任一仓库宣布那些能力实现完成。
