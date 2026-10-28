// 上传判重：同 hash 的文件不去重则重复占空间，去重则可能张冠李戴。
//
// 规则（和用户对过的口径）：
//   1. 先按内容算 SHA-256；算不出来（非安全上下文）就退回老行为，用随机 id 当引用名。
//   2. 同 hash 的候选里，**大小不同的一律不碰**——大小不同必然不是同一个文件，
//      新文件直接顺延序号（A → A_4）。
//   3. 大小相同：
//      · ≤ 阈值 → 逐字节比较，全等就静默复用，不等就顺延序号并标记 hash_shared。
//      · > 阈值 → 交给用户判断（弹窗），因为逐字节比一个大文件可能卡住主线程。
//   4. 复用 = 不新增记录、不写新二进制，直接把已有文件的引用名返回给调用方。
//   5. 弹窗里除了「复用」和「都不一样」，还可以「覆盖」：用新内容替换选中那条的二进制，
//      记录 id 与引用名都不变 —— 正文里已有的引用照旧可用。用于旧记录内容坏了/丢了。

import { getBlob } from '../db/blob';
import { extFor, hashStem, pickStoredId, sameBytes, sha256Hex } from './naming';
import {
  filesByHash,
  getFile,
  insertFileRaw,
  nameSlots,
  overwriteFileContent,
  type StoredFile,
} from '../repo/files';

/** 等待用户裁决的一次冲突 */
export interface CollisionPrompt {
  /** 上传时用的实际名（用户看的） */
  name: string;
  size: number;
  mime: string;
  /** 大小相同的候选：需要由用户指认同一个，或全部否定 */
  candidates: StoredFile[];
  /** 大小不同、但 hash 相同的文件（只是提示，不参与判定） */
  sizeDiffers: StoredFile[];
}

/** 弹窗里可选的三种处置 */
export type CollisionAction = 'reuse' | 'create' | 'overwrite';

/** 用户对一次冲突的裁决 */
export interface CollisionDecision {
  action: CollisionAction;
  /** reuse / overwrite 指向哪条已有记录；create 为 null */
  target: StoredFile | null;
}

export type UploadOutcome =
  | { kind: 'created'; file: StoredFile; /** 顺延过序号时的完整引用名，用于提示 */ renamed?: string }
  | { kind: 'reused'; file: StoredFile }
  | { kind: 'overwritten'; file: StoredFile; /** 被覆盖掉的那条（同一行，内容是旧的） */ over: StoredFile }
  | { kind: 'ask'; prompt: CollisionPrompt; resolve: (d: CollisionDecision) => Promise<UploadOutcome> };

export interface UploadOptions {
  /** 小文件阈值（字节），超过就弹窗问用户 */
  smallLimit: number;
}

/**
 * 主流程。返回 created / reused / overwritten / ask 四种结果之一。
 *
 * ask 里带着 resolve：UI 把弹窗结果传回来，它再执行对应动作并给出最终 outcome。
 * target 缺省时按第一个候选处理（批量「后续同样处理」就是这个语义）。
 */
export async function uploadFile(file: File, opts: UploadOptions): Promise<UploadOutcome> {
  const sha = await sha256Hex(file);

  // 非安全上下文：算不出 hash，退回「随机 id 当引用名」，功能不退化
  if (!sha) return createFresh(file, '');

  const stem = hashStem(sha);
  const ext = extFor(file.name, file.type);
  const sameHash = filesByHash(sha);
  const sameSize = sameHash.filter((f) => f.size === file.size);

  // 大小不同的：按规则直接视为不同内容
  // 大小不同的一律当成不同内容，直接顺延序号
  if (sameSize.length === 0) return createFresh(file, sha, stem, ext, sameHash.length > 0);

  if (file.size <= opts.smallLimit) {
    const hit = await findByBytes(file, sameSize);
    if (hit) return { kind: 'reused', file: hit };
    return createFresh(file, sha, stem, ext, true);
  }

  // 大文件：交给用户
  const prompt: CollisionPrompt = {
    name: file.name,
    size: file.size,
    mime: file.type,
    candidates: sameSize,
    sizeDiffers: sameHash.filter((f) => f.size !== file.size),
  };
  const resolve = async (d: CollisionDecision): Promise<UploadOutcome> => {
    const target = d.target ?? sameSize[0];
    if (d.action === 'reuse') return { kind: 'reused', file: target };
    if (d.action === 'overwrite') {
      await overwriteFileContent(target.id, file);
      return { kind: 'overwritten', file: getFile(target.id) ?? target, over: target };
    }
    return createFresh(file, sha, stem, ext, true);
  };
  return { kind: 'ask', prompt, resolve };
}

/**
 * 只要结果，不问用户：撞车时一律按「都不一样」处理。
 * 正文编辑器、头像选择器这类「不想被弹窗打断」的场景用它。
 */
export async function uploadFileQuiet(file: File, smallLimit: number): Promise<StoredFile> {
  let out = await uploadFile(file, { smallLimit });
  if (out.kind === 'ask') out = await out.resolve({ action: 'create', target: null });
  // resolve({action:'create'}) 必然落在 created（内部只走 createFresh），断言给它收窄
  if (out.kind === 'ask') throw new Error('上传结果异常');
  return out.file;
}

/** 逐个逐字节比，找到第一个完全相同的就返回（永不读完整超出必要的数据） */
async function findByBytes(file: File, cands: StoredFile[]): Promise<StoredFile | null> {
  for (const c of cands) {
    const blob = await getBlob(c.id);
    if (!blob) continue;
    if (await sameBytes(file, blob)) return c;
  }
  return null;
}

/** 存一条新记录，引用名按占用情况顺延；hashShared 表示「这个 hash 下存在不同内容」 */
async function createFresh(
  file: File,
  sha: string,
  stem = '',
  ext = '',
  hashShared = false,
): Promise<UploadOutcome> {
  const slots = nameSlots();
  let storedId: string;
  if (!sha) {
    // 没有 hash 就没有内容寻址可言，用一个随机串占位，语义等同老 id
    storedId = `raw-${Math.random().toString(36).slice(2, 10)}${ext}`;
  } else {
    storedId = pickStoredId(stem, ext, slots);
  }
  const created = await insertFileRaw({
    file,
    name: file.name || `未命名${ext}`,
    storedId,
    sha256: sha,
    hashShared,
  });
  const renamed = storedId !== `${stem}${ext}` ? storedId : undefined;
  return { kind: 'created', file: created, renamed };
}
