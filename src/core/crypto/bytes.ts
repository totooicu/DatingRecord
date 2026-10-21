// 字节 / 编码小工具。零依赖，到处都要用。

const HEX = '0123456789abcdef';
/** Crockford base32：去掉了 I L O U，手抄不会看错 */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}

export function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** 加密随机数。crypto.getRandomValues 在 http:// 下也有，这才是关键 */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * 定长时间比较：防止靠「早多少毫秒返回」猜出口令。
 * 返回值用按位或累积，不用 || 短路。
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * 恢复码：5 组 × 5 字符 base32，共 25 字符 ≈ 125 bit 熵。
 * 去掉易混字符后照着手抄也不会错，破折号只是给人看的，解析时一律剔除。
 */
export function randomRecoveryCode(): string {
  const b = randomBytes(20);
  let chars = '';
  for (let i = 0; i < b.length; i++) chars += B32[b[i] & 31] + B32[(b[i] >> 3) & 31];
  chars = chars.slice(0, 25);
  return (chars.match(/.{1,5}/g) ?? []).join('-');
}

/** 归一化用户输入的恢复码：去空白破折号、统一大写、纠正常见看错（O→0、I/L→1） */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
