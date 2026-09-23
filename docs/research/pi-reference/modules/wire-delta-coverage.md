# 补充研究：Chord delta、CBOR 与 Unix transport

> Pi 快照：`/Users/ayu/Learn/pi`，HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`。本页补充状态同步主链下的算法、数据边界和连接所有权；只读 Pi，未运行真实连接测试或安装依赖。

## 1. 先确定三层各自解决什么

```text
可变 JSON state
  → track.flush(): Op[]                         改动的语义
  → delta.encoder(): WireOp[]                   路径字典与省略
  → protocol envelope + CBOR + length prefix    校验、编码、消息边界
  → ordered byte transport                     实际发送、排队、关闭
  → 反向解码 + delta.apply()                    更新接收方副本
```

**delta 不是领域事件，也不是 CRDT。**它让一个有序状态流的接收方收敛到 producer 的 JSON 值，没有多写者冲突合并、审批或工具幂等语义。应用仍需决定：哪个 state、谁可写、何时 flush、checkpoint 保存在哪、断线后从哪里恢复。

## 2. Chord delta：在 flush 时比较，避免记录每次赋值

源码：`packages/chord/src/delta/index.ts`，1,267行；配套 `packages/chord/test/delta.test.ts`，1,141行。本次两者全部阅读。

### 2.1 六个语义操作

| Op | 含义 | 关键限制 |
| --- | --- | --- |
| `['r', value]` | 替换整个根值 | base checkpoint；根替换只用它 |
| `['s', path, value]` | 设置子路径 | path不能为空 |
| `['d', path]` | 删除子路径 | 对数组等价splice删除一个元素，避免洞 |
| `['a', path, text]` | 字符串追加 | 目标必须已经是字符串 |
| `['t', path, count]` | 从字符串头部去掉count字符 | count非负；适合rolling output window |
| `['p', path, index, remove, items]` | 数组splice | root array可用空path；整个数组替换在flush归一化成r/s |

track()（`packages/chord/src/delta/index.ts:435`） 返回 `state` proxy、原始 `target`、flush/rebase/discard/dirty。调用者只通过proxy修改；赋入对象被adopt，保留外部引用可以读，但在proxy外写会绕过追踪。

proxy做两件事：更新真实root；把路径标进dirty trie。重复写同一字段不会积累一串旧操作。父路径被替换后，子路径pending失效；数组按append/diff/replace区分；`push`合并成一个尾部splice，结构重排走diff。`sort/reverse/fill/copyWithin`返回proxy以保留链式追踪。

首次flush必发r，之后只比较dirty路径的baseline与当前值；相等改动会消失。`rebase()`只让下一次flush发base；`discard()`接受改动为本地baseline但不对外发delta。`dirty=true`表示有待比较工作，不保证最终非空delta。

### 2.2 文本与数组的最小必要算法

diffString（`packages/chord/src/delta/index.ts:205`） 优先检测追加，否则尝试“旧字符串后缀 == 新字符串前缀”得到t+a。`overlap()`扫描默认最多65,536字符、probe最多64字符、候选默认8个；重复内容找不到时回退s。**有界探测可漏掉更短编码机会，但不会为了压缩造出错误值。**文件中的微秒数字是源码注释中的历史测量，本次未复现性能基准。

diffArray（`packages/chord/src/delta/index.ts:273`）：等长数组逐index diff；长度变化先找相同前/后缀，能描述成单一splice就发splice；重排又伴随保留index修改时没有唯一对齐，保留index diff，再描述尾部长度变化。它保证最终值，不保存“用户本来意图移动哪一项”。

baseline前进也避免全量clone：纯append/scalar/string路径用`syncBaseline()`；结构复杂的数组变化则把已生成ops应用回baseline。字符串不可变，可以共享；对象仍复制以隔开继续写入的producer。

### 2.3 ownership 是契约的一部分

原文，`packages/chord/src/delta/index.ts:947`：

```ts
if (op[0] === "r") {
  // Adopted, not copied. The consumer owns the batch it was handed.
```

`track.flush()` 的payload已从producer复制出来，但 `apply()` 不再复制它。同一个batch传给两个进程内consumer，会使两份副本共享对象。扇出点应clone每一份，或每个consumer独立解码网络payload。测试 `packages/chord/test/delta.test.ts:519` 显式固定这种adoption行为，不能当bug随手加clone。

applyImmutable()（`packages/chord/src/delta/index.ts:1014`） 只复制沿被修改路径的containers，保留未触碰分支共享；也会adopt替换payload。`apply()` 是逐op原地变更，后一个非法op抛错不等于前面的变更已回滚。需要事务边界的持久化层必须自行确保原子性。

### 2.4 路径与值使用不同安全规则

assertValidOp()（`packages/chord/src/delta/index.ts:785`） 与 assertValidWireOp()（`packages/chord/src/delta/index.ts:828`） 分开：decoded op必须有完整path，wire才允许path id/short form。未知verb报错，不能静默跳过新producer的操作。

路径禁止 `__proto__`、`constructor`、`prototype`；resolve只走own property；write用`defineProperty`，不触发继承setter。数组必须numeric index且不能跨过尾部造洞，阻止一个小op让数组长到几十亿元素。proxy也拒绝delete数组元素、undefined数组值、defineProperty/setPrototypeOf/preventExtensions；显式length扩展填null。

**值中可以包含名为`__proto__`的普通数据key，路径不能用它逃出对象。**clone用own descriptor保留这个key。另一边，op validator**不递归验证payload是JsonValue**：测试 `packages/chord/test/delta.test.ts:893` 明确允许`Map`/`Date`作为payload通过形状检查。网络入口还要递归验证可序列化值；不要把“path安全”写成“整个payload可信”。

### 2.5 字典状态与恢复点

encoder()（`packages/chord/src/delta/index.ts:1105`） 对路径第一次inline，第二次出现发 `['#', id, path]` 并用id，之后复用id。同batch连续相同path直接省略，靠tuple arity区分；短形式绝不跨batch。

原文，`packages/chord/src/delta/index.ts:1126`（前两行为注释）：

```ts
seen.clear();
ids.clear();
nextId = 0;
previous = undefined;
```

r会清空字典，decoder也对应清空。这样从最后一个base开始，新的decoder不用知道更早的path id。**一对encoder/decoder只服务一个独立state stream。**同一transport connection里的多个state不能共用一份字典；后加入的consumer必须先得到自己的base。字典自身没有独立大小上限，checkpoint周期和流生命周期由上层管理。

### 2.6 delta测试覆盖

| 测试位置 | 实际断言 |
| --- | --- |
| `packages/chord/test/delta.test.ts:29` | repeated append、rolling t+a、nested proxies、parent overwrite |
| `packages/chord/test/delta.test.ts:267` | deterministic reindexing/splice mutations、append-tail合并、100,000元素push |
| `packages/chord/test/delta.test.ts:445` | first base、一次性rebase、discard baseline |
| `packages/chord/test/delta.test.ts:508` | immutable替换payload、consumer adoption、与producer隔离 |
| `packages/chord/test/delta.test.ts:577` | flush消除重复/被覆盖写入、宽状态性能护栏 |
| `packages/chord/test/delta.test.ts:708` | prototype逃逸、interned危险path、inherited getter、reserved data key |
| `packages/chord/test/delta.test.ts:755` | sparse/巨型index、字符串index、数组删除、300,000元素splice |
| `packages/chord/test/delta.test.ts:865` | decoded/wire grammar区分与不递归查payload |
| `packages/chord/test/delta.test.ts:920` | second-use interning、short form、null字符path不冲突、base重置/recovery |
| `packages/chord/test/delta.test.ts:1035` | seeded mixed nested状态收敛；随后3,000随机根替换场景 |

以上Vitest文件已阅读，未执行；原生定向收敛断言另见第6节。

## 3. CBOR：小而严格的协议子集

全部读取：`packages/protocol/src/cbor/options.ts`、`packages/protocol/src/cbor/encoder.ts`、`packages/protocol/src/cbor/decoder.ts`、`packages/protocol/src/cbor/index.ts` 和 `packages/protocol/test/cbor/cbor.test.ts`。

### 3.1 编解码算法

writer使用可增长Uint8Array（初始最多256bytes），容量翻倍但不超过byte limit；整数按CBOR major type和最短整数argument宽度编码，负数用`-1-value`；非整数和`-0`用float64。text经UTF-8编码后反解比对，拒绝孤立surrogate导致的信息损失。

支持null、boolean、有限安全JS integer、有限float64、string、Uint8Array、array和plain/null-prototype object。对象undefined属性省略；array hole/undefined拒绝；循环引用拒绝；enumerable symbol key拒绝。它不是通用所有RFC8949值的实现：不支持tag、indefinite container、float16/float32、BigInt/Date/Map。

reader维护offset，所有read检查剩余字节；decode必须正好读完一个item，尾随数据报错；UTF-8 fatal；map必须string key且不能重复，`defineProperty`避免`__proto__`污染。二进制byte string返回新Uint8Array，隔离输入buffer的后续改动。

默认限额：`packages/protocol/src/cbor/options.ts:6` 16MiB payload、单container最多1,000,000项、depth64；caller可进一步收紧，配置depth最大512。decoder在按声明长度遍历前先检查上限。上限解决单payload边界，不自动限制连接数、总请求速率或所有连接累计内存。

map编码按对象现有枚举顺序，不做canonical key排序。需要签名/内容寻址时不可假定两个逻辑相等对象一定编码成相同bytes。

### 3.2 和外层protocol的分工

`packages/protocol/src/codec.ts:20` 还要用TypeBox schema与Chord `isJsonValue`双重验证协议消息。CBOR能解出Uint8Array，不等于这个值能通过具体JSON envelope。低层CBOR合法、消息schema合法、service参数合法、业务权限合法是不同层。

`packages/protocol/src/framing.ts:43` 再解决任意bytes chunk切分：4bytes unsigned big-endian长度；最多按64KiB块接收，完整后合并，不在刚收到长度头时就分配全部16MiB。oversize/truncated使decoder终止失败；protocol decoder失败后也不再接收下一帧。framing本身允许zero-length payload，但它不是合法CBOR消息。

### 3.3 测试证据

`packages/protocol/test/cbor/cbor.test.ts:24` 有RFC已知向量：整数宽度、负数、safe边界、float64、-0、多语言、byte string、array/map。其后覆盖undefined、holes、nonfinite、BigInt/Date/Map、symbol key、cycle、深度、BOM、`__proto__`数据、duplicate key、invalid/overlong/surrogate UTF-8、truncated和trailing、tag/indefinite/不支持浮点宽度，以及caller限制。文件已全部阅读，未运行Vitest。

## 4. Unix server：先证明文件是自己的，再删除

完整入口：`packages/server/src/transports/unix/address.ts`、`packages/server/src/transports/unix/listener.ts`、`packages/server/src/transports/unix/types.ts`、`packages/server/src/transports/unix/preset.ts`、`packages/server/src/transports/unix/index.ts`。

`getUnixSocketPath()`只接受canonical lowercase UUIDv4，避免把serverId当随意路径片段。listener创建父目录（默认0700），探测public/bind path是否stale；普通文件拒绝删除，连接成功或1s无响应按live保守处理。只有明确connection refused/missing等才判stale。

`start()`先bind同目录`bind-<path hash>`，lstat记录dev/ino，再hard-link到public route，chmod默认0600，然后unlink临时bind。关闭时只清理当初记录的inode；rename到preserved临时名后再次核对身份，若期间变成别人的文件就保留/恢复并报错。这解决startup/shutdown与另一个server替换同一路径时的所有权竞争。

**这个方案依赖本地文件系统socket/hard-link/rename语义。**权限只限制本地文件访问，serverId只标识连接对象；它们不是云端租户认证或互联网访问授权。client明确拒绝Windows；不能把服务端chmod的win32分支理解成整套Unix transport跨平台承诺。

### 发出与关闭

UnixByteConnection.send()（`packages/server/src/transports/unix/listener.ts:212`） 收到chunk时复制，累计pendingBytes，然后用promise链按调用顺序write；write callback或close使Promisesettle。默认pending cap是maxFrameLength四倍；最小必须容纳一个maxFrame+4字节头。超cap返回rejection，最终断连接由Server处理send失败策略，不能只凭此方法说它已经destroy socket。

`close(finalChunk)`设closing，最多等5s后destroy；finalChunk在writeTail settle后交给socket.end。已经正在写的chunk可以完成；尚未进入write的排队send会因closing而拒绝。它保证有限关闭与末尾错误的机会，不承诺对慢peer无限flush全部队列。`reportError`观察回调的异常被吞掉，不改变listener状态。

## 5. Unix client：发出顺序、backpressure与发现是三件事

client/unix.ts（`packages/client/src/unix.ts`） 全部299行已读。`createUnixTransportFactory()`每次connect建新socket；连接前error reject factory，连接后error/close只触发一个terminal handler；local close置terminal避免再发重复回调。

`UnixByteTransport.send()`同样复制chunk、限制pending bytes并串行发送；write()（`packages/client/src/unix.ts:186`） **同时等write callback，以及write返回false时的drain**。server对应实现只等callback，这是具体差异，不能画成完全相同的发送器。socket writable/drain说明本地缓冲状态，不代表对端已应用或持久化消息。

`discoverUnixServers()`扫描UUIDv4.sock候选，lstat要求socket，用完整Client握手核验serverId；最多16个并发probe，每个默认1s覆盖connect+handshake；只忽略已知stale、timeout、version/protocol错误，意外FS错误上抛；结果按serverId排序。发现过程不删stale socket，删除责任属于listener startup。`probeUnixServer` finally dispose并等socket关闭。

### 已阅读的Unix测试

| 文件 | 断言边界 |
| --- | --- |
| server/unix-connection.test.ts（`packages/server/test/unix-connection.test.ts:44`） | ControlledSocket已有pending write时，final protocol error等write callback后才end；只模拟一个正在写的chunk |
| server/unix.test.ts（`packages/server/test/unix.test.ts:68`） | live socket不unlink、普通文件不删除、nested parent权限、关闭只删自己的inode、stale socket重建 |
| server/listener.test.ts（`packages/server/test/listener.test.ts:28`） | 多listener启动/关闭与启动失败回滚已启动listener |
| client/unix-transport.test.ts（`packages/client/test/unix-transport.test.ts:57`） | 真实Unix socket完整handshake/request、逐byte/分片响应、truncated最后frame、missing socket |
| client/unix.test.ts（`packages/client/test/unix.test.ts:95`） | 排序发现、非法名字/非socket/mismatched ID忽略、stale/timeout不删除、16并发上限、pre-handshake close、意外FS错误 |

全部5个文件已完整阅读。**本次未执行这些连接测试**，没有创建/终止Unix server或清理用户socket；不能从测试源码推出本机平台验收通过。

## 6. 原生离线检查及局限

2026-09-15 运行过直接 import Pi delta、CBOR、framing 的离线断言脚本，无第三方依赖、不连接网络；脚本硬编码本机路径，已于 2026-09-16 删除。当时实际 exit 0：

```text
PASS: delta base recovery, path dictionary, ownership, safety, 1200 deterministic mutations; CBOR subset/bounds; bytewise framing and truncation
```

检查包括base之后用fresh decoder恢复、second-use字典、缺path拒绝、prototype/sparse拒绝、adoption/immutable边界、30×40次确定性混合修改收敛；CBOR多类型roundtrip、reserved data key、duplicate/invalid UTF-8/trailing/tag/indefinite/unsafe integer拒绝、depth/container限制；逐byte frame与truncated end。它不替代完整Vitest、性能基准或真实socket backpressure测试。

## 7. 云端应学习的取舍

1. **先学边界再学压缩。**我们先有持久事件seq/cursor、state版本和snapshot/replay规则，测出频繁整块state传输成本后再考虑delta/path dictionary。文本token delta不必先换成CBOR。
2. **保留有序与恢复点。**一份state一份字典；snapshot/base要带清楚生命周期和版本。多浏览器订阅不能共用可变对象，不能把delta当领域事实或丢失后自动可恢复。
3. **记录与连接分离。**write/drain完成不等于DB commit或客户端应用完成。云端断线恢复应根据持久游标重放，慢consumer断开后重新hydrate；不能靠扩大无界队列拖住runtime。
4. **部署假设显式重写。**Unix的文件权限、UUID socket discovery、本地loopback换成真正的authenticated transport、tenant routing和服务发现。继续复用上层协议/调用语义即可，不需要让NestJS也模仿本地socket目录。
5. **校验分层，不删防线。**frame byte limit→CBOR合法值→protocol schema/JsonValue→service参数→业务权限各自存在；delta path检查只是一层，不能代替后面几层。
