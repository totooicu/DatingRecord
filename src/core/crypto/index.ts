// 加密模块出口。

export {
  toHex,
  fromHex,
  randomBytes,
  randomRecoveryCode,
  normalizeRecoveryCode,
  timingSafeEqual,
} from './bytes';
export { hmacSha256, Hmac } from './hmac';
export { ITERATIONS, pbkdf2 } from './kdf';
export { aesCtr, randomIv } from './aes';
export {
  createVault,
  unwrapKey,
  decryptDb,
  reseal,
  rewrapPassphrase,
  isEncRecord,
  type EncRecord,
} from './vault';
