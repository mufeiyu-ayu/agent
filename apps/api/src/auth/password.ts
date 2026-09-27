import { Buffer } from 'node:buffer'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// OWASP 推荐的 scrypt 参数：N=2^17、r=8、p=1，约 128MB 内存；maxmem 要显式放大。
const N = 2 ** 17
const R = 8
const P = 1
const KEY_LENGTH = 32
const MAX_MEM = 256 * 1024 * 1024

/** 返回自描述串 `scrypt$N$r$p$salt$hash`（base64url），校验时按串里的参数算，改参数不影响旧密码。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, N, R, P, KEY_LENGTH)

  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$')

  if (algorithm !== 'scrypt' || !salt || !hash)
    return false

  const expected = Buffer.from(hash, 'base64url')

  // 串被截断或改坏时直接判错：空哈希会让 timingSafeEqual 对任意密码返回 true。
  if (expected.length < KEY_LENGTH || ![n, r, p].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0))
    return false
  const actual = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p), expected.length)

  return timingSafeEqual(actual, expected)
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, { N: n, r, p, maxmem: MAX_MEM }, (error, key) => {
      if (error)
        reject(error)
      else
        resolve(key)
    })
  })
}
