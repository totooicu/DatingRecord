// 加密信封：本地库「加密落地」的格式与运算。
//
// 结构（存在 IndexedDB 的一个记录里）：
//
//   masterKey  = 随机 32 字节          —— 只活在内存里，解锁期间有效
//   dbKey      = HMAC(masterKey, 'dr-db-v1')   真正的库加密密钥
//   macKey     = HMAC(masterKey, 'dr-mac-v1')  完整性校验密钥
//   pwKey      = PBKDF2(口令, salt, iter)      包住主密钥的第一把钥匙
//   rcKey      = PBKDF2(恢复码, rcSalt, iter)  包住主密钥的第二把钥匙
//   wrapPw     = AES-CTR(masterKey, pwKey)     口令解开的那一半
//   wrapRc     = AES-CTR(masterKey, rcKey)     恢复码解开的那一半
//   check      = HMAC(macKey, 'dr-check-v1')   钥匙对不对的试金石
//   ct / mac   = 库密文 / 它的 HMAC
//
// 为什么要「随机主密钥 + 两把钥匙各包一份」而不是「口令直接派生库密钥」：
// 那样恢复码就无从谈起了——口令忘了，数据永远打不开。包一份的好处是
// 口令和恢复码各自独立，忘一个还有另一个；改口令只需重包，不用重加密整库。
//
// 完整性用 Encrypt-then-MAC（先加密再对密文算 HMAC），不用 GCM：
// 纯 JS 做 GHASH 容易写错，而 CTR + 独立 HMAC 是更容易验证正确的组合。
// 不防「把旧密文换回来」的回滚攻击——那需要能本地改文件的攻击者，
// 而他能本地改文件时本来就有更多办法，超出本功能的威胁模型。

import { aesCtr, randomIv } from './aes';
import { hmacSha256 } from './hmac';
import { ITERATIONS, pbkdf2 } from './kdf';
import { fromHex, normalizeRecoveryCode, randomBytes, timingSafeEqual, toHex } from './bytes';

const SALT_LEN = 16;

export interface EncRecord {
  v: 1;
  /** PBKDF2 迭代次数（写在记录里，将来调参数不用重新加密整库） */
  iter: number;
  salt: string;
  rcSalt: string;
  /** 主密钥被口令包住的那一份 */
  wrapPw: string;
  wrapRc: string;
  ivPw: string;
  ivRc: string;
  ivDb: string;
  /** 钥匙正确性的试金石：解开 wrap 得到主密钥后必须能复现这个值 */
  check: string;
  /** 库密文。直接存 Uint8Array——hex 会让体积翻倍，没必要 */
  ct: Uint8Array;
  mac: string;
  updatedAt: string;
}

function dbKeyOf(master: Uint8Array): Uint8Array {
  return hmacSha256(master, enc('dr-db-v1'));
}

function macKeyOf(master: Uint8Array): Uint8Array {
  return hmacSha256(master, enc('dr-mac-v1'));
}

function checkOf(macKey: Uint8Array): string {
  return toHex(hmacSha256(macKey, enc('dr-check-v1')));
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** 建库：生成随机主密钥，用口令和恢复码各包一份，加密整库 */
export function createVault(
  passphrase: string,
  rawRecoveryCode: string,
  dbBytes: Uint8Array,
): { record: EncRecord; masterKey: Uint8Array } {
  // 归一化后再派生：用户抄下来的码可能带空格、小写、把 0 写成 O
  const recoveryCode = normalizeRecoveryCode(rawRecoveryCode);
  const masterKey = randomBytes(32);
  const salt = randomBytes(SALT_LEN);
  const rcSalt = randomBytes(SALT_LEN);
  const ivPw = randomIv();
  const ivRc = randomIv();
  const ivDb = randomIv();

  const wrapPw = aesCtr(pbkdf2(passphrase, salt), ivPw, masterKey);
  const wrapRc = aesCtr(pbkdf2(recoveryCode, rcSalt), ivRc, masterKey);
  const dbKey = dbKeyOf(masterKey);
  const macKey = macKeyOf(masterKey);
  const ct = aesCtr(dbKey, ivDb, dbBytes);

  return {
    masterKey,
    record: {
      v: 1,
      iter: ITERATIONS,
      salt: toHex(salt),
      rcSalt: toHex(rcSalt),
      wrapPw: toHex(wrapPw),
      wrapRc: toHex(wrapRc),
      ivPw: toHex(ivPw),
      ivRc: toHex(ivRc),
      ivDb: toHex(ivDb),
      check: checkOf(macKey),
      ct,
      mac: toHex(hmacSha256(macKey, ct)),
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 用口令或恢复码试开锁。成功返回主密钥，失败返回 null。
 *
 * 两个分支都要走到最后一步再比较，失败时也要照样做一次派生——
 * 否则「口令错」会比「口令对」早返回，等于把对不对告诉了爆破者。
 */
export function unwrapKey(
  record: EncRecord,
  credential: string,
  useRecovery: boolean,
): Uint8Array | null {
  // 恢复码必须归一化：界面上是带破折号显示的，用户照着打下来也带破折号，
  // 而建库时存的是去掉破折号的版本——不归一化就对不上，而且错得毫无线索。
  if (useRecovery) credential = normalizeRecoveryCode(credential);
  const salt = fromHex(useRecovery ? record.rcSalt : record.salt);
  const wrap = fromHex(useRecovery ? record.wrapRc : record.wrapPw);
  const iv = fromHex(useRecovery ? record.ivRc : record.ivPw);
  const candidate = aesCtr(pbkdf2(credential, salt, record.iter), iv, wrap);
  const macKey = macKeyOf(candidate);
  if (!timingSafeEqual(hmacSha256(macKey, enc('dr-check-v1')), fromHex(record.check))) {
    return null;
  }
  return candidate;
}

/** 主密钥解开后，取出明文库字节；密文被改过会抛错（MAC 不匹配） */
export function decryptDb(record: EncRecord, masterKey: Uint8Array): Uint8Array {
  const macKey = macKeyOf(masterKey);
  if (!timingSafeEqual(hmacSha256(macKey, record.ct), fromHex(record.mac))) {
    throw new Error('库密文完整性校验失败：文件可能被改动过，或已损坏');
  }
  return aesCtr(dbKeyOf(masterKey), fromHex(record.ivDb), record.ct);
}

/** 保存：用新明文重加密密文，换一个新计数器初值（CTR 下绝不能重复用） */
export function reseal(record: EncRecord, masterKey: Uint8Array, dbBytes: Uint8Array): EncRecord {
  const ivDb = randomIv();
  const macKey = macKeyOf(masterKey);
  const ct = aesCtr(dbKeyOf(masterKey), ivDb, dbBytes);
  return {
    ...record,
    ivDb: toHex(ivDb),
    ct,
    mac: toHex(hmacSha256(macKey, ct)),
    updatedAt: new Date().toISOString(),
  };
}

/** 改口令：换一把 pwKey 重包主密钥，整库密文不动（这是包两层的最大好处） */
export function rewrapPassphrase(
  record: EncRecord,
  masterKey: Uint8Array,
  newPassphrase: string,
): EncRecord {
  const salt = randomBytes(SALT_LEN);
  const ivPw = randomIv();
  const wrapPw = aesCtr(pbkdf2(newPassphrase, salt), ivPw, masterKey);
  return { ...record, salt: toHex(salt), ivPw: toHex(ivPw), wrapPw: toHex(wrapPw), updatedAt: new Date().toISOString() };
}

/** 是否结构完好：版本、迭代次数、密文长度至少对得上 */
export function isEncRecord(x: unknown): x is EncRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<EncRecord>;
  return (
    r.v === 1 &&
    typeof r.iter === 'number' &&
    r.iter > 0 &&
    typeof r.salt === 'string' &&
    typeof r.rcSalt === 'string' &&
    typeof r.wrapPw === 'string' &&
    typeof r.wrapRc === 'string' &&
    typeof r.ivPw === 'string' &&
    typeof r.ivRc === 'string' &&
    typeof r.ivDb === 'string' &&
    typeof r.check === 'string' &&
    typeof r.mac === 'string' &&
    r.ct instanceof Uint8Array
  );
}
