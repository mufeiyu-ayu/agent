import { LLMConfigError } from '@agent/ai'
import { ProxyAgent } from 'undici'

/**
 * 出站代理：地址只来自 `.env` 的 `OUTBOUND_PROXY_URL`，是这台机器的网络条件，不是服务商的属性。
 * `url` 可能带 `user:pass`，只交给 undici；进文案、接口与日志的只有去掉凭据的 `address`。
 */
export interface OutboundProxyConfig {
  url: string
  /** `协议://主机:端口`，不含凭据与路径。 */
  address: string
  /** 判定「连不上的是代理本身」用；缺省端口已按协议补齐。 */
  hostname: string
  port: number
}

const INVALID_PROXY_URL = '只接受 http:// 或 https:// 开头的代理地址，例如 http://127.0.0.1:7890'
  + '（Clash 的 mixed-port 同时支持 HTTP；不支持 socks5://）'

/** 没配返回 null；格式不对直接抛，让进程启动失败。文案不回显原值，原值里可能有凭据。 */
export function resolveOutboundProxyConfig(env: NodeJS.ProcessEnv): OutboundProxyConfig | null {
  const raw = env.OUTBOUND_PROXY_URL?.trim()

  if (!raw)
    return null

  let url: URL

  try {
    url = new URL(raw)
  }
  catch {
    throw new LLMConfigError('OUTBOUND_PROXY_URL', INVALID_PROXY_URL)
  }

  // `127.0.0.1:7890` 解析不了；`localhost:7890` 会被当成协议 `localhost:`，同样落到这里。
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname)
    throw new LLMConfigError('OUTBOUND_PROXY_URL', INVALID_PROXY_URL)

  const port = url.port || (url.protocol === 'https:' ? '443' : '80')

  return {
    url: raw,
    address: `${url.protocol}//${url.hostname}:${port}`,
    hostname: url.hostname,
    port: Number(port),
  }
}

/** 代理 agent 只在这里构造，`LLMService` 在构造时建一个、全进程共用。 */
export function createOutboundProxyAgent(config: OutboundProxyConfig): ProxyAgent {
  return new ProxyAgent(config.url)
}
