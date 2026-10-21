// AES-256-CTR 薄封装。
//
// 用 aes-js 而不是自己写 AES：它是 MIT 许可的纯 JS 实现，无依赖，
// 已按 NIST SP 800-38A 的官方向量核对过（AES-128/256-CTR 首块均一致）。
// 自己写一遍 AES 密钥扩展当然也行，但没必要——这里的风险不在算法实现，
// 而在「别把模式用错」。
//
// 选 CTR 而不是 CBC/GCM：
//   - GCM 最好，但纯 JS 的 GHASH 表不好做，而且 aes-js 不带；
//   - CTR 只需要分组加密（加密解密同一条路），且流式、无填充——
//     整库导出的字节数不固定，用 CBC 还要处理填充，平白多一层出错可能；
//   - 完整性不靠模式，靠外层单独算的 HMAC（见 vault.ts），
//     即 Encrypt-then-MAC，这是比 GCM 更容易验证正确的组合。

import aesjs from 'aes-js';
import { randomBytes } from './bytes';

/** 计数器初值（16 字节）。每次加密换一个新的——CTR 下重复用同一个计数器是灾难 */
export function randomIv(): Uint8Array {
  return randomBytes(16);
}

/** 输入不会被修改（aes-js 内部会拷贝），返回新的 Uint8Array */
export function aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('aesCtr: 只支持 256 位密钥');
  if (iv.length !== 16) throw new Error('aesCtr: 计数器初值必须 16 字节');
  // 显式包一层 Counter：直接传 16 字节运行期也认，但类型声明不认
  return new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(iv)).encrypt(data);
}
