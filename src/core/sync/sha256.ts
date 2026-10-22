// SHA-256（纯 JS，支持分块喂数据）。
//
// 为什么不用 crypto.subtle：它只有一次性 API，而我们同步时要给每个 64KB 分片
// 单独算哈希，用 Web Crypto 得等整库 arrayBuffer 再切，内存峰值翻倍；
// 更关键的是 subtle 只在安全上下文可用（https / localhost），
// 局域网 http 调试时会直接拿不到——同步在这种环境下也得能用。
//
// 实现参照 FIPS 180-4，输出小写十六进制。

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;
  private w = new Uint32Array(64);

  update(data: Uint8Array): this {
    let pos = 0;
    this.total += data.length;
    if (this.bufLen > 0) {
      const need = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, need), this.bufLen);
      this.bufLen += need;
      pos = need;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    while (pos + 64 <= data.length) {
      this.block(data, pos);
      pos += 64;
    }
    if (pos < data.length) {
      this.buf.set(data.subarray(pos), 0);
      this.bufLen = data.length - pos;
    }
    return this;
  }

  private block(src: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const j = off + i * 4;
      w[i] = (src[j] << 24) | (src[j + 1] << 16) | (src[j + 2] << 8) | src[j + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    const h = this.h;
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let k = h[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + k) >>> 0;
  }

  hex(): string {
    // 收尾：补 0x80、补零到 56 字节、末尾 8 字节写比特长度（大端）
    const bitsHi = Math.floor(this.total / 0x20000000);
    const bitsLo = (this.total * 8) >>> 0;
    const pad = new Uint8Array(this.bufLen < 56 ? 64 : 128);
    pad.set(this.buf.subarray(0, this.bufLen));
    pad[this.bufLen] = 0x80;
    const end = pad.length;
    pad[end - 8] = (bitsHi >>> 24) & 0xff;
    pad[end - 7] = (bitsHi >>> 16) & 0xff;
    pad[end - 6] = (bitsHi >>> 8) & 0xff;
    pad[end - 5] = bitsHi & 0xff;
    pad[end - 4] = (bitsLo >>> 24) & 0xff;
    pad[end - 3] = (bitsLo >>> 16) & 0xff;
    pad[end - 2] = (bitsLo >>> 8) & 0xff;
    pad[end - 1] = bitsLo & 0xff;
    for (let o = 0; o < pad.length; o += 64) this.block(pad, o);

    let out = '';
    for (let i = 0; i < 8; i += 1) out += this.h[i].toString(16).padStart(8, '0');
    return out;
  }
}

/** 一次算完，返回 64 位十六进制 */
export function sha256HexOf(data: Uint8Array): string {
  return new Sha256().update(data).hex();
}
