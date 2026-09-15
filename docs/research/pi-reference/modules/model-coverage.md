# 模型、Telemetry、Evals 研究覆盖与验证证据

> 对应 [研究笔记](./model-telemetry-evals.md)。Pi 根目录 `/Users/ayu/Learn/pi`；固定 HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`。日期：2026-09-15。Pi 源码只读；没有调用 provider、OAuth、模型目录网络源或运行 `.eval.ts`，没有安装依赖。

## 覆盖口径

- **实现阅读：**读过源码的控制流、数据转换与失败路径；核心 API adapter 已通读，Google Vertex 通过已通读的 Google adapter 加完整 diff 阅读覆盖。
- **测试研究：**下面记录能证明对应行为的现有测试与断言；部分大测试文件按相关场景定位阅读，不等于逐行审计整个测试库。
- **原生已运行：**9组无需依赖/网络的断言，直接 import 当前 Pi 源码，见后文。
- **目录检查已运行但未通过：**generated model data 在 checkout 缺失；不把 metadata 缺失当 provider 源码错误。
- **数据/产物分类：**生成目录值、fixture、模型常量、README/changelog 被识别用途；不把它们冒充运行控制流，也不声称逐项验证所有型号的外部参数。

研究覆盖以子模块、请求闭环和重要行为为单位；“找到文件”不等于“读懂”，更不等于“在线验证”。本页明确区分三者。

## 1. `packages/ai/src`：核心、入口与契约

以下 Pi 相对路径均以 `/Users/ayu/Learn/pi/` 为根。

| 子模块 | 实现阅读证据 | 配套测试研究/实际验证 |
| --- | --- | --- |
| `index.ts`、`package.json` | side-effect-free core export；provider/API/OAuth 独立子路径；SDK pinned versions；core 不自动注册所有模型 | `lazy-module-load.test.ts`、`model-catalog-types.test.ts` 是 bundling/types 证据入口；未跑依赖型检查 |
| `types.ts` | 10种 KnownApi；Provider vs Api 区分；Context、Message、Usage、StopReason、事件、图片、deferred、compat、options 全部契约 | `pre-generation-error.test.ts`、`total-tokens.test.ts`；原生检查终态与 setup |
| [models.ts](/Users/ayu/Learn/pi/packages/ai/src/models.ts) | createModels、注册、getModels/getAvailable、refresh、applyAuth、stream/complete、deferred、createProvider、cost/thinking helpers | `models-runtime.test.ts:219/570/735/943/1076/1108` 分别定位 refresh、late publication、取消、OAuth 一次刷新、option merge、header transform；原生 auth/generation/cost/dispatch 检查通过 |
| `models-store.ts` | app-owned catalog store；内存实现复制边界、signal 检查 | `models-runtime.test.ts:365` restore/cache；原生 generation 检查只覆盖发布竞争，不验证文件持久化 |
| `model-catalog.ts`、`models.generated.ts` | 生成 provider import 聚合；API分组摊平并保留类型 | `model-catalog-types.test.ts`；目录 data 缺失，未 import builtinModels |
| `images-models.ts` | ImagesProvider/ImagesModels、共享 auth、in-flight refresh dedupe、图片错误结果 | `images-models.test.ts`；未执行 |
| `session-resources.ts` | cleanup 注册集合；尝试全部 cleanup 后 AggregateError | WS adapter 注册关闭器；未测试真实 socket |
| `compat.ts` | 旧全局 registry、sourceId注销、内建 override 保留、env key 注入、Cloudflare特殊桥接 | `compat-env.test.ts`、`providers.test.ts`；迁移层，不作为新架构推荐 |
| `legacy-api-aliases.ts` | 老 streamAnthropic/streamGoogle 等别名到 lazy API | 静态导出/映射阅读；未单独运行 |
| `images.ts`、`images-api-registry.ts`、`image-models.ts`、`providers/images/register-builtins.ts` | 图片旧 registry/全局目录入口与 lazy OpenRouter generation | `images.test.ts`、`image-model-data.test.ts`、`openrouter-images.test.ts`；未执行 |
| `cli.ts` | standalone `pi-ai list/login`，cwd auth.json 读写；不走云端租户存储 | 只读代码，没有执行 login 或访问 auth.json |
| `bedrock-provider.ts`、`bun-oauth.ts`、`oauth.ts`、`compat/extension-oauth-types.ts` | Node-only provider静态挂载；Bun打包 loader注册；旧扩展OAuth类型桥 | 原生构建/浏览器 smoke 未执行 |

## 2. `src/api`：每一种 wire protocol 均已研究

| 实现及关键位置 | 阅读覆盖 | 现有测试证据入口（本次未执行 Vitest） |
| --- | --- | --- |
| [openai-completions.ts:311](/Users/ayu/Learn/pi/packages/ai/src/api/openai-completions.ts:311) | 全部 stream/request/compat/message/tool/cache/usage/stop 转换；thinking 格式全分支 | `openai-completions-{raw-stop-reason,empty-tools,tool-choice,tool-result-images,reasoning-details,thinking-as-text,thinking-token-budget,retry,cache-control-format,prompt-cache,response-model,vllm-priority}.test.ts` |
| [openai-responses.ts:112](/Users/ayu/Learn/pi/packages/ai/src/api/openai-responses.ts:112) | auth、request、cache、reasoning、tool placement、service tier、error cleanup | `openai-responses-{compat,partial-json-cleanup,terminal-event}.test.ts` |
| [openai-responses-shared.ts:432](/Users/ayu/Learn/pi/packages/ai/src/api/openai-responses-shared.ts:432) | 全部 convert messages/tools、slot聚合、权威end、signature backfill、finish映射 | `openai-responses-{foreign-toolcall-id,message-id,namespace,empty-tool-result,tool-result-images}.test.ts`；`azure-openai-responses-reasoning-replay.test.ts` |
| [azure-openai-responses.ts:70](/Users/ayu/Learn/pi/packages/ai/src/api/azure-openai-responses.ts:70) | 与 Responses 共享 parser，Azure deployment、resource、version、baseUrl规则 | `azure-openai-{base-url,tool-choice}.test.ts` |
| [openai-codex-responses.ts:230](/Users/ayu/Learn/pi/packages/ai/src/api/openai-codex-responses.ts:230) | 全部 WS/SSE、retry、timeout、header、account、zstd、session/account cache、delta continuation、fallback边界、cleanup | `openai-codex-stream.test.ts`；`codex-websocket-cached-probe.ts` 是独立在线 probe，未运行；两个 cache-affinity-e2e 文件也未运行 |
| [anthropic-messages.ts:502](/Users/ayu/Learn/pi/packages/ai/src/api/anthropic-messages.ts:502) | 全部 SSE repair、blocks/signatures、usage、fallback、OAuth命名/identity、cache、effort、工具转换、stop | `anthropic-{sse-parsing,auth-token,eager-tool-input-compat,empty-thinking-signature-compat,force-adaptive-thinking,mid-conversation-effort,temperature-compat,thinking-disable,tool-name-normalization,cache-write-1h-cost}.test.ts` |
| [google-generative-ai.ts:54](/Users/ayu/Learn/pi/packages/ai/src/api/google-generative-ai.ts:54) | 全部 stream/config、block切换、signature、tool id、usage与thinking level/budget | `google-{raw-stop-reason,thinking-disable,thinking-level-map,thinking-signature}.test.ts` |
| [google-vertex.ts:71](/Users/ayu/Learn/pi/packages/ai/src/api/google-vertex.ts:71) | 已通读 Google基础实现，再读完整diff：API key/ADC/project/location/custom URL、不同budget规则 | `google-vertex-api-key-resolution.test.ts` |
| [google-shared.ts:131](/Users/ayu/Learn/pi/packages/ai/src/api/google-shared.ts:131) | 全部 message/tool/strict-mode转换、signed空块、multimodal函数响应、retry wrapper | `google-shared-{convert-tools,gemini3-unsigned-tool-call,image-tool-result-routing,retry,signed-empty-blocks}.test.ts` |
| [bedrock-converse-stream.ts:116](/Users/ayu/Learn/pi/packages/ai/src/api/bedrock-converse-stream.ts:116) | 全部 SDK配置、ARN区域、AWS凭据、proxy、middleware、block handlers、byte/base64、cache、thinking、messages/tools、终态与诊断 | `bedrock-{credentials,endpoint-resolution,custom-headers,response-headers,error-metadata,convert-messages,thinking-payload,redacted-reasoning,raw-stop-reason,cache-write-1h-cost}.test.ts` |
| [mistral-conversations.ts:119](/Users/ayu/Learn/pi/packages/ai/src/api/mistral-conversations.ts:119) | 全部原生chat completions、wire转换、9字符ID、SSE、thinking、usage、stop | `mistral-{http-transport,raw-stop-reason,reasoning-mode,tool-schema}.test.ts` |
| [pi-messages.ts:353](/Users/ayu/Learn/pi/packages/ai/src/api/pi-messages.ts:353) | 全部请求/错误body、SSE读流、事件converter、rewrite诊断、缺terminal错误 | `pi-messages.test.ts:97/189/206/228` 覆盖 text+tool、HTTP错误、server error、premature EOF |
| [openrouter-images.ts:40](/Users/ayu/Learn/pi/packages/ai/src/api/openrouter-images.ts:40) | 独立非流式图片请求、data URI解析、usage/error | `openrouter-images.test.ts`、`images-models.test.ts` |
| `lazy.ts` + 全部11个 `*.lazy.ts` | setup错误转stream，模块lazy加载，Bedrock variable import与Bun override；image lazy返回Promise | `lazy-module-load.test.ts`、`providers.test.ts:344` capability；原生 eager setup 已验证 |
| `transform-messages.ts` | 全部图片降级、跨model签名、tool ID、error/abort跳过、孤立call修复 | `lax-message-content.test.ts`、`tool-call-without-result.test.ts`、`tool-call-id-normalization.test.ts`、`transform-messages-copilot-openai-to-anthropic.test.ts`；原生孤立call修复通过 |
| `constrained-sampling.ts` | 全部strict子集变换、prefer/require、grammar参数与单调JSON编码 | `constrained-sampling.test.ts`、`mistral-tool-schema.test.ts` |
| `simple-options.ts`、`openai-prompt-cache.ts` | context/output clamp、thinking预算、透传、cache key截断 | `sampling-options.test.ts`、`reasoning-options.test.ts`、`max-thinking.test.ts`、`telemetry-options.test.ts` |
| `github-copilot-headers.ts` | user/agent initiator、vision检测、Copilot header | `github-copilot-anthropic.test.ts` |
| `cloudflare.ts`、`cloudflare-ai-binding.ts` | 固定endpoint常量；已认证AI binding fetch透传、construction时检查 | `cloudflare-ai-binding.test.ts`、`cloudflare-stream.test.ts` |

## 3. `src/providers`：40个具体文本 provider 的组合分类

所有 factory 源码已读；它们多数只有十几行，差异来自目录、auth与API组合。下列每个名字对应 `packages/ai/src/providers/<name>.ts`。39个静态provider配套同名 `*.models.ts`，Radius只有动态目录；图片provider单列。

| 家族 | 完整成员 | 核心区别 / 测试入口 |
| --- | --- | --- |
| 普通 OpenAI completions | `ant-ling`、`baseten`、`cerebras`、`deepseek`、`groq`、`huggingface`、`moonshotai`、`moonshotai-cn`、`nvidia`、`qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual`、`together`、`xiaomi`、`xiaomi-token-plan-ams`、`xiaomi-token-plan-cn`、`xiaomi-token-plan-sgp`、`zai`、`zai-coding-cn` | 每家env key/baseURL/catalog不同，统一envApiKeyAuth；对应 `baseten-models`、`qwen-token-plan-models`、`together-models`、`xiaomi-models`、`zai-coding-plan-models` 等测试。metadata未hydrate，不能确认所有model实际能力 |
| 普通 Anthropic messages | `minimax`、`minimax-cn`、`vercel-ai-gateway` | 相同API，不同host/key/catalog；当前 Vercel factory 只注册 Anthropic API，以本文件为准 |
| first-party及专门SDK | `anthropic`、`openai`、`azure-openai-responses`、`google`、`google-vertex`、`amazon-bedrock`、`mistral` | Anthropic bearer优先级；Vertex ADC；Bedrock ambient AWS；对应 `providers.test.ts` auth场景 |
| OAuth或双auth | `openai-codex`、`kimi-coding`、`xai` | Codex仅OAuth；Kimi Anthropic API；xAI Responses；各OAuth单测 |
| 多API网关 | `github-copilot`、`fireworks`、`opencode`、`opencode-go`、`openrouter`、`cloudflare-ai-gateway` | model.api dispatch；Copilot按credential availableModelIds过滤；OpenCode加session header；Cloudflare按resolved env替换endpoint。`providers.test.ts:369`、`opencode-provider-headers.test.ts`、`fireworks-deferred-tools.test.ts` |
| Workers直连 | `cloudflare-workers-ai` | completions + account scoped env + Cloudflare endpoint wrapper |
| 动态Pi网关 | [radius.ts](/Users/ayu/Learn/pi/packages/ai/src/providers/radius.ts)、`radius-config.ts` | `/v1/config`载入动态model，持久publish；兼容老credential中的catalog。schema检查是浅形状过滤，不替代云端严格配置校验 |
| 图片 | `openrouter-images.ts` | 单独ImagesProvider；与聊天可共享auth，但generation契约独立 |
| 集合与adapter辅助 | `all.ts`、`cloudflare-auth.ts`、`cloudflare-stream.ts`、`opencode-headers.ts` | 显式组合、环境/headers差异局部化；无模型执行循环 |
| 模拟provider | [faux.ts:684](/Users/ayu/Learn/pi/packages/ai/src/providers/faux.ts:684) | 队列脚本响应、工厂函数、分块速度、usage/cache估算、deferred fetch/cancel；进程内状态，不是真实model或持久batch。原生 deferred 检查通过；`faux-provider.test.ts` 提供更多abort/ordering断言 |

上表成员合计40个文本 provider，`all.ts` 当前注册顺序也已核对；数量是factory数量，不是在线可用provider数量。

## 4. `src/auth` 与每种 OAuth

| 文件 | 研究证据 | 配套测试/边界 |
| --- | --- | --- |
| `types.ts` | CredentialStore.modify唯一写路径、AuthInteraction、ModelAuth、ProviderAuth全契约 | 无租户字段；跨进程互斥由store决定 |
| `context.ts` | 可注入env/fileExists，默认Node环境及浏览器false行为 | 未读用户环境密钥 |
| `credential-store.ts` | per-provider promise链；queued abort不执行、active mutation保存前检查signal | `models-runtime.test.ts:704/735/943`；原生并发OAuth刷新通过 |
| `helpers.ts` | envApiKeyAuth、lazyOAuth载入 | `providers.test.ts:283/301` |
| `resolve.ts` | stored credential所有权、显式override、locked refresh、timeout、error cause保留 | `models-runtime.test.ts:777/858/927/1018/1052`；实际原生刷新一致性通过 |
| `env-api-keys.ts` | legacy env映射、Vertex异步import race、AWS ambient marker | `env-api-keys.test.ts`、`compat-env.test.ts`；legacy不是新request auth入口 |
| `oauth/pkce.ts` | Web Crypto random verifier + SHA256 challenge | 不执行登录 |
| `oauth/device-code.ts` | polling interval默认5秒、slow_down +5秒或server值、deadline与abort | `oauth-device-code.test.ts` |
| `oauth/anthropic.ts` | 全部callback state校验、PKCE、manual/callback race、code exchange、refresh、finally关闭 | `anthropic-oauth.test.ts`；真实授权未执行 |
| `oauth/openai-codex.ts` | 全部browser/device选择、loopback/manual、token字段校验、account id、refresh | `openai-codex-oauth.test.ts` |
| `oauth/github-copilot.ts` | 全部device flow、GitHub token→Copilot token、endpoint派生、model picker/policy过滤、有限policy enable | `github-copilot-oauth.test.ts`；login含POST model policy，不是纯读操作；本次未执行 |
| `oauth/openrouter.ts` | 全部随机callback path、one-shot claim、timeout、manual race、code换永久key，refresh原样返回 | `openrouter-oauth.test.ts` |
| `oauth/kimi-coding.ts` | 全部device flow、可信URL scheme检查、token字段、有限refresh retry、Bearer headers | `kimi-coding-oauth.test.ts`；“Models clears it”注释落后于实际resolve保留凭据实现 |
| `oauth/xai.ts` | 全部device flow、HTTPS verification URL、token校验、refresh时保留未旋转refresh token | `xai-oauth.test.ts` |
| `oauth/radius.ts` | 全部gateway discovery、browser/device flow、token endpoint、refresh；catalog与auth分离 | `radius-oauth.test.ts` |
| `oauth/load.ts`、`oauth/oauth-page.ts` | bundler-opaque loader + Bun override；callback页面转义文本 | 无页面浏览器验收；HTML是登录提示，不是产品前端 |

## 5. `src/utils` 全子模块

| 文件 | 读取确认的职责 | 测试证据入口 |
| --- | --- | --- |
| `event-stream.ts` | 双栈FIFO、等待consumer队列、首终态、result、end | `event-stream.test.ts` 全5个用例已读；原生ordering通过 |
| `assistant-message-frame.ts` | shared-partial去重、权威end、tool checkpoint、字段白名单、纯reducer、terminal排除 | `assistant-message-frame.test.ts:41/230/268/359/451/514/545/563` 重点断言；依赖partial-json，未执行 |
| `validation.ts` | TypeBox编译缓存、plain-schema coercion、nullable union、optional null、error path | `validation.test.ts:64/101/126/146/194` 重点断言；未执行 |
| `json-parse.ts` | 修复string控制字符/无效escape；完整JSON优先；partial-json回退 | `anthropic-sse-parsing.test.ts`、工具增量相关测试 |
| `constrained-sampling.ts` 在api目录 | schema/grammar是发模型前的格式约束，不能代替validation | 见API表 |
| `deferred-tools.ts` | 用toolResult.addedToolNames与已使用工具决定放置位置 | `deferred-tools.test.ts` |
| `estimate.ts` | 最近适用usage + trailing估算，prefix timestamp防旧usage复用，新增tool定义估算 | `context-estimate.test.ts` |
| `overflow.ts` | error regex/exclusion、silent overflow、zero-output length与recoverable length | `context-overflow.test.ts`；`overflow.test.ts`含真实模型，不执行 |
| `retry.ts` | error分类、非retry billing、指数退避、abort规范化及callbacks | `retry.test.ts` |
| `provider-retry.ts` | SDK初始请求retry、Retry-After、可取消sleep、默认0 | `provider-retry.test.ts`、`openai-completions-retry.test.ts` |
| `error-body.ts` | SDK错误多形状、status/body、排除stream/class instance、截断 | `error-body.test.ts`、`provider-error-body-{passthrough,regression}.test.ts` |
| `diagnostics.ts` | 稳定记录error/detail；append不做策略 | Bedrock/Pi/WS诊断测试；diagnostic与errorMessage控制作用分开 |
| `abort.ts`、`abort-signals.ts` | 停止等待但观察晚到rejection；组合signal与解绑 | `models-runtime`、`openai-codex-stream`中取消场景；原生generation检查包含非协作旧任务 |
| `node-http-proxy.ts` | per-target NO_PROXY、大小写env优先级、HTTP(S)限定 | `node-http-proxy.test.ts`；未操作本机代理 |
| `provider-env.ts` | scoped env→process.env→Bun Linux sandbox fallback | 非通用secret store，不采集用户环境 |
| `headers.ts` | Headers转record；null表示抑制默认头时的转换辅助 | `fetch-option`、`bedrock-custom-headers`、`cloudflare-stream` |
| `hash.ts`、`openai-prompt-cache.ts` 在api目录 | 非密码学短hash缩短工具ID/cache key | tool id及prompt cache测试；不能做认证或安全唯一性 |
| `pi-user-agent.ts` | browser-safe OS读取形成User-Agent | 非模型输入控制 |
| `sanitize-unicode.ts` | 去除孤立surrogate，保留合法pair | `unicode-surrogate.test.ts` |
| `sleep.ts` | signal可取消timer | OAuth/retry引用 |
| `text.ts` | 只提取text content，忽略thinking/image/tool | eval transcript等调用 |
| `typebox-helpers.ts` | StringEnum使用enum避免部分provider的anyOf/const限制 | tool schema调用 |
| `uuid.ts` | UUIDv7时间+单调序列、回拨时保证普通ID顺序、显式timestamp保留 | `uuid.test.ts`；未用它替代数据库唯一约束 |

## 6. `scripts` 与 generated/fixture 分类

| 文件/目录 | 实际研究范围 | 未执行/未验证 |
| --- | --- | --- |
| `scripts/generate-models.ts` | CLI strict/data-only/json-only选项、远端来源、provider分类、compat/thinking/strict/tool-search metadata、优先级去重、staging+hash验证+rename回退；模型枚举/价格/别名覆盖表按数据分类，未逐项对远端核价 | generator一加载就执行，未import/运行；不下载目录；3,141行包含大量人工metadata覆盖，不称为全部外部事实已核实 |
| `scripts/model-data.ts` | 全部manifest schema、model结构/ID/API/hash验证；provider shard与aggregator匹配 | `model-data-validation.test.ts`、`generate-models-strict.test.ts`；直接checker因缺data退出1 |
| `scripts/check-model-data.ts` | 校验命令入口、失败提示 | 已运行，结果见下方 |
| `scripts/models-dev-reasoning-options.ts`、`scripts/openrouter-reasoning-options.ts` | 全部effort→thinkingLevelMap、mandatory-off处理 | `reasoning-options.test.ts`、`openrouter-reasoning-options.test.ts` |
| `scripts/generate-image-models.ts` | 全部image modality筛选、价格单位换算、strict empty处理、sorted generated TS | `image-model-data.test.ts`；未访问OpenRouter |
| `scripts/generate-test-image.ts` | canvas绘制白底红圆fixture | 未执行；`test/data/red-circle.png`只分类为多模态输入fixture |
| `src/providers/*.models.ts` | 全部是JSON import+flatten模板；模型值不在这些8行文件中 | `src/providers/data/`缺失；不能统计/核验型号目录值 |
| `src/models.generated.ts` | 静态聚合39个provider，已读 | 不代表已配置/有权使用 |
| `src/image-models.generated.ts` | 生成的图片metadata表，结构与generator已研究，值按数据产物分类 | 未逐项核实当前价格/可用性 |
| `README.md`、`CHANGELOG.md`、tsconfig/vitest配置 | 使用说明、历史与测试入口分类；行为以源码为准 | 不把历史changelog当当前支持矩阵 |
| `test/{text,images,image-tool-result,abort,stream,tokens,empty,xhigh,interleaved-thinking,cross-provider-handoff,responseid,overflow,...}.test.ts` | 通用真实provider matrix及edge场景的入口分类 | filename没有e2e也可能读取真实key。未运行全Vitest；不能因skip机制存在认定离线安全 |
| `test/{azure,bedrock,cloudflare}-utils.ts`、`test/oauth.ts`、`test/scratch.ts`、`test/codex-websocket-cached-probe.ts` | 配套endpoint/auth helper与临时probe分类 | 不执行scratch/probe，不访问用户认证 |

## 7. Telemetry 全子模块

| 文件 | 研究证据 | 验证 |
| --- | --- | --- |
| `src/index.ts` | 全部Span/Context、serializable schema、infer/exact types、显式parent binding；schema仅类型推断 | `test/telemetry.test.ts`类型expect与runtime场景；原生检查证明runtime接受未声明span名，不能宣传runtime validation |
| `src/noop.ts` | 同步调用一次callback、原结果/错误、freeze inert span | 原生callback结果/错误同一性通过 |
| `src/memory.ts` | 全部被动记录、属性复制、显式status、settlement、late child、detached snapshot | 原生parent/child、late mutation、原错误检查通过 |
| `src/testing/{index,types,conformance}.ts` | 全部runner-independent conformance、9个callback/status/recording/parentage/passivity用例 | `test/conformance.test.ts`注册全部cases与snapshot isolation；未运行Vitest |
| README/CHANGELOG/package/tsconfig | 文档、依赖和发布边界 | 无远端exporter，未验证OTel/vendor集成 |

## 8. Evals 全子模块

| 文件 | 研究证据 | 验证 |
| --- | --- | --- |
| `src/pi-harness.ts` | 全部model selection、临时home/workspace、services/session、prompt/reload、abort、stats/transcript、artifact-before-cleanup、AggregateError | `test/pi-harness.test.ts`只测选择model规则，不能证明整个isolated run；本次未运行agent eval |
| `src/{smoke,docs,extensions,models,providers}.eval.ts` | 全部任务输入、实际assert/judge、prompt A/B、reload、local Acme probe、source保存 | 五类都需要生成模型；全部未执行 |
| `src/vitest-evals/harness-table.ts` | 全部canonical JSON、input ID、repetitions、baseline/candidates、成功/失败artifact | `test/vitest-evals/harness-table.test.ts`已读完整；未执行 |
| `src/vitest-evals/summary.ts` | 全部group/pair、score资格、correctness lift、效率均值、diagnostic、terminal report | `test/vitest-evals/summary.test.ts`缺失/错误/多candidate等重点断言；原生harness error不当0分/0token通过 |
| `src/vitest-evals/artifacts.ts` | 全部Vitest artifact注册、basename限制、runId哈希目录、JSONL/source权限 | `test/vitest-evals/artifacts.test.ts`已读完整；未执行 |
| `src/vitest-evals/reporter.ts` | 全部collect observations、runs.jsonl、report.json/txt、interrupted处理 | 无真实eval产物；不声称已有质量分 |
| `src/vitest-evals/setup.ts` | afterEach保存session artifact | Vitest未运行 |
| `scripts/run-evals.mjs` | 全部CLI参数/model完整性校验、artifact目录、spawn Vitest/env透传 | 未运行，避免生成模型请求 |
| `vitest.config.ts`、`vitest.test.config.ts`、README/package/tsconfig | `.eval.ts`与纯test独立配置；eval串行文件120s/单例300s timeout | 依赖缺失，不安装 |

## 9. 实际运行证据

### 9.1 原生离线检查：通过

已保存可复跑脚本：[checks/model-study-check.mjs](../checks/model-study-check.mjs)。脚本只读取源码并使用内存模拟对象；包含明确本机Pi路径，没有凭据或环境快照。Node22原生type stripping允许跳过整个SDK安装链。

执行命令：

```sh
/Users/ayu/.nvm/versions/node/v22.20.0/bin/node /Users/ayu/Desktop/agent/docs/research/pi-reference/checks/model-study-check.mjs
```

输出（exit 0）：

```text
PASS: 9 offline groups: event order, eager setup, faux deferred, message repair, OAuth serialization, generation guard, tier cost, telemetry passivity, paired eval exclusion
```

| 组 | 真实断言 | 证据边界 |
| --- | --- | --- |
| 事件终态 | 1/2/3 terminal/4 late只读出1/2/3，result=3 | 不验证backpressure、网络分发 |
| eager setup | 不消费stream也立即调用setup，失败产生error结果 | 不代表实际SDK连接时序 |
| Faux deferred | 一次提交→pending fetch→ready；callCount保持1 | 进程内模拟，不是可重启的真实任务 |
| 历史修复 | 缺tool result合成error，原数组长度不变 | 不证明合成项已持久化 |
| OAuth串行 | 两个getAuth并发只刷新一次，均拿新token | mock refresh，无外部登录；无跨进程竞争 |
| generation | 旧非协作refresh晚发布被拒，新版本保持 | 无DB commit不确定性实验 |
| cost tier | input threshold匹配后整请求使用该档，精确到预期数值 | 不核对供应商账单 |
| telemetry | 同结果/错误、parent-child、settled mutation无效、late child无记录、schema无runtime限制 | 不是第三方exporter验证 |
| 配对eval | candidate harness error导致eligiblePairs=0，cost/token未补0，记录diagnostic | 不评价模型质量 |

### 9.2 目录完整性检查：缺少本地生成数据

```sh
cd /Users/ayu/Learn/pi
/Users/ayu/.nvm/versions/node/v22.20.0/bin/node packages/ai/scripts/check-model-data.ts
```

输出（exit 1）：

```text
amazon-bedrock.json is not valid JSON: ENOENT: no such file or directory, open '/Users/ayu/Learn/pi/packages/ai/src/providers/data/amazon-bedrock.json'
Model data is missing or stale. Run `npm run hydrate:model-data` from the repository root.
```

本次不hydrate，因为研究本地源码不需要真实目录刷新。生成目录的整体运行验证、所有Vitest回归、真实provider request/OAuth、模型质量eval均保持“未执行”，不能用9组定向检查代替它们。

## 10. 复读时应验证的易漂移点

- checkout HEAD改变后，先重新定位symbols和行号；不要复制本快照的provider型号/价格结论。
- `Api`类型存在、factory注册、catalog metadata、auth configured、真实request成功是五层证据。
- `deferred`类型和Faux模拟不代表内建provider已实现durable response。
- telemetryContext透传不代表已有LLM spans；schema metadata不等于runtime validation/自动脱敏。
- 已阅读的provider兼容实现是学习样本；云端产品应遵守自己的租户、持久化、审批和终态边界。
