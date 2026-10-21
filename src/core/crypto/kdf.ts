// PBKDF2-HMAC-SHA256，RFC 8018。
//
// 用它是为了让「试一个口令」变贵：离线爆破一个 24 位随机盐 + 高迭代次数的
// 派生，成本比直接哈希高几个量级。纯 JS 跑不快，所以迭代次数是拍过 benchmark
// 定的（见 ITERATIONS 的注释），不盲目抄 OWASP 建议的 60 万——那在手机上要十几秒。

import { Hmac } from './hmac';

/**
 * 迭代次数。选 12000 的理由：在中端手机上约 0.3–0.8 秒，能明显拖慢爆破，
 * 又不至于让用户每次解锁都等到怀疑卡死。OWASP 对 PBKDF2-HMAC-SHA256 的
 * 建议是 60 万次，那需要 WebCrypto（原生，快 50 倍）；纯 JS 追不上，取平衡。
 */
export const ITERATIONS = 12_000;

/** 派生 32 字节密钥。dkLen 固定 32（SHA-256 输出长度），多块用不上 */
export function pbkdf2(passphrase: string, salt: Uint8Array, iterations = ITERATIONS): Uint8Array {
  const pw = new TextEncoder().encode(passphrase.normalize('NFKC'));
  const h = new Hmac(pw);
  // 块序号 1（大端四字节），整条消息是 salt || 0x00000001
  const seed = new Uint8Array(salt.length + 4);
  seed.set(salt);
  seed[salt.length + 3] = 1;

  let u = h.digest(seed);
  const out = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = h.digest(u);
    for (let j = 0; j < out.length; j++) out[j] ^= u[j];
  }
  return out;
}
