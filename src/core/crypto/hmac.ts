// HMAC-SHA256，RFC 2104。
//
// 仍然是纯 TS——crypto.subtle 在 http:// 的非安全上下文里不存在
// （见 sha256.ts 的说明），而这个应用要能在局域网 IP 上直接打开。

import { sha256Bytes } from '../sha256';

const BLOCK = 64;

/** 预计算 ipad/opad 后的密钥态，避免每次调用都重新拼 128 字节 */
export class Hmac {
  private readonly inner: Uint8Array;
  private readonly outer: Uint8Array;

  constructor(key: Uint8Array) {
    const k = new Uint8Array(BLOCK);
    // 密钥长于块长时先哈希一遍（RFC 2104 §2）
    if (key.length > BLOCK) k.set(sha256Bytes(key));
    else k.set(key);
    this.inner = new Uint8Array(BLOCK);
    this.outer = new Uint8Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      this.inner[i] = k[i] ^ 0x36;
      this.outer[i] = k[i] ^ 0x5c;
    }
  }

  digest(msg: Uint8Array): Uint8Array {
    const a = new Uint8Array(BLOCK + msg.length);
    a.set(this.inner);
    a.set(msg, BLOCK);
    const innerHash = sha256Bytes(a);
    const b = new Uint8Array(BLOCK + 32);
    b.set(this.outer);
    b.set(innerHash, BLOCK);
    return sha256Bytes(b);
  }
}

export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  return new Hmac(key).digest(msg);
}
