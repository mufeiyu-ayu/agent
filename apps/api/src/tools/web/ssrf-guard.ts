import type { LookupFunction } from 'node:net'
import dns from 'node:dns'
import { BlockList, isIP } from 'node:net'

/**
 * `web_fetch` 的 SSRF 防护（Issue #206）：模型给的网址不可信，不能借服务器访问本机、内网、
 * 同一 docker 网络里的服务或云厂商元数据服务。只给 `web_fetch` 用。
 */
const BLOCKED_ADDRESSES = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, 'ipv4')
}

// 内嵌 IPv4 的几种 IPv6 形式（IPv4 兼容、NAT64、SIIT、6to4）也拦，否则可能经转换打到内网或元数据服务。
for (const [network, prefix] of [
  ['::', 96], // 含 ::、::1 与 IPv4 兼容地址
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, 'ipv6')
}

/**
 * 请求前检查：解析出全部地址，只要有一个在黑名单里就拒绝。主机是 IP 字面量时 lookup 原样返回，
 * 同样在这里判断，而且只能靠这里：连接 IP 时不经过 lookup，连接时的检查拦不到。
 */
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const blocked = blockedAddressError(host, await dns.promises.lookup(host, { all: true }))

  if (blocked)
    throw blocked
}

/**
 * 直连时 undici Agent 的 `connect.lookup`：在建立连接那一刻重新解析并校验，防 DNS 换绑
 * （第一次解析到公网、连接时解析到内网）。net 开着 autoSelectFamily（默认）时用 `all: true` 调它。
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    const failure = error ?? blockedAddressError(hostname, addresses)

    if (failure)
      return callback(failure, '')

    if (options.all)
      return callback(null, addresses)

    // 关了 autoSelectFamily 时 net 只要一个地址。
    const [first] = addresses

    return first ? callback(null, first.address, first.family) : callback(new Error(`web_fetch: no address for ${hostname}`), '')
  })
}

/** 有一个地址在黑名单里就返回拦截错误。IPv4 映射的 IPv6（`::ffff:a.b.c.d`）由 BlockList 按内含的 IPv4 判断。 */
function blockedAddressError(host: string, addresses: Array<{ address: string }>): Error | undefined {
  const blocked = addresses.find(({ address }) => {
    const family = isIP(address)
    return family === 0 || BLOCKED_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6')
  })

  return blocked && new Error(`web_fetch blocked ${host}: ${blocked.address} is a private or reserved address`)
}
