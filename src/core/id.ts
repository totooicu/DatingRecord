// 全局唯一 ID：ULID（时间有序 + 字符串 + 离线可生成）
// 格式：10 字符时间戳(Crockford Base32) + 16 字符随机 = 26 字符

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  let out = '';
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % ENCODING.length;
    out = ENCODING[mod] + out;
    now = Math.floor(now / ENCODING.length);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < len; i++) out += ENCODING[bytes[i] & 31];
  return out;
}

export function ulid(seedTime: number = Date.now()): string {
  return encodeTime(seedTime, TIME_LEN) + encodeRandom(RANDOM_LEN);
}

export type IdPrefix = 'p' | 'e' | 'c' | 'att' | 'd' | 'lib' | 'f' | 'tpl' | 'ai' | 'msg' | 'snap';

/** 生成带前缀的实体 ID，如 p_01J... */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
