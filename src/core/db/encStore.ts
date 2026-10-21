// 本地库加密的落盘与生命周期。
//
// 分工：crypto/vault.ts 管「怎么加解密」，这个文件管「什么时候、对谁」——
// 读盘时先问一句「加密了吗、开了吗」，写盘时决定写密文还是明文。
//
// 会话主密钥只活在内存里（模块级变量），刷新即丢——这正是不丢数据的前提：
// 丢了密钥顶多重来一次解锁，密文还在。
//
// 边界：启用加密时会把已有的明文 main.sqlite 删掉；反之关闭时把密文删掉。
// 两个副本同时存在是最危险的状态（那份明文谁都能读），所以这两步必须紧挨着做。

import {
  createVault,
  decryptDb,
  isEncRecord,
  randomRecoveryCode,
  reseal,
  rewrapPassphrase,
  unwrapKey,
  type EncRecord,
} from '../crypto';
import { ENC_KEY, idbDelete, idbGet, idbGetEnc, idbPut, idbPutEnc, IDB_KEY } from './idb';
import { getDbInstance } from './state';

/** 加密状态。'locked' = 盘上有密文但本会话还没解开 */
export type EncStatus = 'none' | 'locked' | 'open';

let record: EncRecord | null = null;
/** 会话主密钥；null = 本会话未解锁 */
let masterKey: Uint8Array | null = null;
/** 清空数据时临时留着的种子：主密钥 + 旧的包裹记录，供重封空库用 */
let pendingReseed: { rec: EncRecord; key: Uint8Array } | null = null;

export function getEncStatus(): EncStatus {
  if (record && masterKey) return 'open';
  if (record) return 'locked';
  return 'none';
}

export function getEncRecord(): EncRecord | null {
  return record;
}

/**
 * 启动时探测盘上的加密记录。
 * 只是把它读进内存、判断状态——不解密（那要用户输口令）。
 */
export async function probeEnc(): Promise<EncStatus> {
  const raw = await idbGetEnc();
  record = isEncRecord(raw) ? raw : null;
  return getEncStatus();
}

/**
 * 解锁：用口令或恢复码解开主密钥，返回明文库字节。
 * 失败返回 null（口令/恢复码不对），此时 record 仍留着，可以重试。
 */
export async function unlockEnc(credential: string, useRecovery: boolean): Promise<Uint8Array | null> {
  if (!record) return null;
  const key = unwrapKey(record, credential, useRecovery);
  if (!key) return null;
  try {
    const bytes = decryptDb(record, key);
    masterKey = key;
    return bytes;
  } catch {
    // 密文损坏：钥匙可能是对的，但数据读不出来
    return null;
  }
}

/**
 * 取出明文库字节。加密没开时读明文，开着且已解锁时解密，锁着时返回 null。
 * initDb 靠它决定能不能继续——返回 null 且盘上确有密文，说明该先解锁。
 */
export async function readPlaintextBytes(): Promise<Uint8Array | null> {
  if (getEncStatus() === 'open') {
    const rec = record;
    return rec && masterKey ? decryptDb(rec, masterKey) : null;
  }
  return idbGet();
}

/**
 * 启用加密：把当前明文库整块加密，删掉明文副本。
 * 返回恢复码——只在这里生成一次，之后再也看不到，必须让用户当场抄走。
 *
 * 字节取自**内存里的活库**而不是盘上的 main.sqlite：后者可能还差一次
 * debounce 未落盘，照它加密会把用户刚敲的字段退回旧值。
 */
export async function enableEnc(passphrase: string): Promise<string | null> {
  if (record) return null;
  const db = getDbInstance();
  if (!db) return null;
  const bytes = new Uint8Array(db.export());
  const recoveryCode = randomRecoveryCode();
  const vault = createVault(passphrase, recoveryCode, bytes);
  await idbPutEnc(vault.record);
  // 密文落盘成功后才删明文；反过来会在加密失败时丢数据
  await idbDelete(IDB_KEY);
  record = vault.record;
  masterKey = vault.masterKey;
  return recoveryCode;
}

/**
 * 关闭加密：写回明文、删掉密文。需要本会话已解锁。
 *
 * 明文同样取自活库——从密文解出来的那份可能比内存旧。
 * 顺序是「先写明文、后删密文」：中途失败最多剩两份数据，不会丢。
 */
export async function disableEnc(): Promise<boolean> {
  if (!record || !masterKey) return false;
  const db = getDbInstance();
  const bytes = db ? new Uint8Array(db.export()) : decryptDb(record, masterKey);
  await idbPut(bytes);
  await idbDelete(ENC_KEY);
  record = null;
  masterKey = null;
  return true;
}

/** 改口令：只重包主密钥，整库密文不动（这是包两层的最大好处） */
export async function changeEncPassphrase(newPassphrase: string): Promise<boolean> {
  if (!record || !masterKey) return false;
  record = rewrapPassphrase(record, masterKey, newPassphrase);
  await idbPutEnc(record);
  return true;
}

/** 忘记口令、用恢复码解开后，重新设一个口令 */
export async function resetEncPassphraseWithRecovery(
  recoveryCode: string,
  newPassphrase: string,
): Promise<Uint8Array | null> {
  if (!record) return null;
  const key = unwrapKey(record, recoveryCode, true);
  if (!key) return null;
  masterKey = key;
  await changeEncPassphrase(newPassphrase);
  return decryptDb(record, key);
}

/** 加密开启时，persist 走这条路：重新加密整库密文 */
export async function saveEncrypted(bytes: Uint8Array): Promise<void> {
  if (!record || !masterKey) return;
  record = reseal(record, masterKey, bytes);
  await idbPutEnc(record);
}

/**
 * 清空全部数据的第一步：删掉盘上密文，但把主密钥和两把「包裹」留在内存里。
 *
 * 为什么不能顺手把加密也关了：用户点的是「清空数据」，不是「关闭加密」。
 * 关掉之后他不会收到任何提示，下次打开发现不用输口令了，只会更慌。
 * 真正要防的是「盘上留着旧密文」——那会让清空在下次启动时悄悄失效，
 * 所以密文必须立刻删，内存里的种子先留着。
 */
export async function dropEncContent(): Promise<void> {
  const rec = record;
  const key = masterKey;
  await idbDelete(ENC_KEY);
  record = null;
  masterKey = null;
  if (rec && key) pendingReseed = { rec, key };
}

/**
 * 清空全部数据的第二步（initDb 建好空库之后调用）：
 * 用原来那把主密钥把空库重新封一遍。口令、恢复码、迭代次数全都原样保留，
 * 用户感知到的只有「数据没了」。
 */
export async function resealAfterReset(): Promise<void> {
  const seed = pendingReseed;
  if (!seed) return;
  pendingReseed = null;
  const db = getDbInstance();
  if (!db) return;
  record = reseal(seed.rec, seed.key, new Uint8Array(db.export()));
  await idbPutEnc(record);
}
