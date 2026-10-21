// 附件的内容寻址工具：hash、hash 名（stored_id）、逐字节比较、文件名与扩展名。
//
// 这一层不碰 SQL：files/ 仓库负责查库，这里只做纯计算，
// 这样「哪些算同一个文件」的规则可以单独推理和复用（上传 / 迁移 / 合并都要用）。

/** 引用名的前缀：stored_id 统一长这样，避免和老的 f_01J... 混淆 */
export const HASH_NAME_PREFIX = 'sha-';

/** 小文件逐字节比较的默认阈值；用户可在设置里改 */
export const DEFAULT_SMALL_LIMIT = 1024 * 1024;

/** 逐字节比较的分块大小：256KB 一块，遇到差异立刻退出，不整读两份 */
const CHUNK = 256 * 1024;

/**
 * 算 SHA-256，输出裸的 64 位小写十六进制（不带前缀）。
 *
 * 非安全上下文（局域网 http 打开）没有 crypto.subtle，返回 '' ——
 * 调用方据此退回「沿用随机 id 当引用名」的老行为，整个上传流程照常可用。
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  try {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return hexOf(new Uint8Array(digest));
  } catch {
    return '';
  }
}

function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** hash 名的主干：sha-<前 32 位十六进制> */
export function hashStem(sha: string): string {
  return `${HASH_NAME_PREFIX}${sha.slice(0, 32)}`;
}

/** 从文件名里取扩展名（含点，小写保留原样）；没有扩展名返回 '' */
export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  // `.png` 这种「点开头」不算扩展名；`a.` 也不算
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i);
}

/** 去掉扩展名的主体 */
export function stemOf(name: string): string {
  const ext = extOf(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/**
 * 给 hash 名配一个扩展名。
 *
 * 有原名就沿用原名的；没有就按 mime 猜一个常见的（预览、下载都要它）。
 */
export function extFor(name: string, mime: string): string {
  const own = extOf(name);
  if (own) return own;
  const m = mime.toLowerCase();
  if (m === 'image/png') return '.png';
  if (m === 'image/jpeg') return '.jpg';
  if (m === 'image/gif') return '.gif';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/svg+xml') return '.svg';
  if (m === 'image/avif') return '.avif';
  if (m === 'video/mp4') return '.mp4';
  if (m === 'video/webm') return '.webm';
  if (m === 'audio/mpeg') return '.mp3';
  if (m === 'audio/wav') return '.wav';
  if (m === 'audio/ogg') return '.ogg';
  if (m === 'application/pdf') return '.pdf';
  if (m === 'text/markdown') return '.md';
  if (m === 'text/plain') return '.txt';
  if (m === 'application/json') return '.json';
  return '';
}

/** 一条已存在的占用记录：引用名 + 是否属于「已确认碰撞」 */
export interface NameSlot {
  storedId: string;
  hashShared: boolean;
}

/**
 * 解析 `A.jpg / A_1.jpg / A_3.jpg` 里的序号，返回已用的最大序号（A 本身算 0）。
 *
 * 只认**同名同扩展名**的：
 *   A.jpg → 0、A_1.jpg → 1、A_3.JPG → 算（扩展名不分大小写）
 *   A_1.png → 不算（扩展名不同，是另一个名字）
 *   别的hash → 不算
 */
export function maxIndexFor(stem: string, ext: string, slots: NameSlot[]): number {
  const want = ext.toLowerCase();
  let max = -1;
  for (const s of slots) {
    const name = s.storedId;
    if (extOf(name).toLowerCase() !== want) continue;
    const st = stemOf(name);
    if (st === stem) max = Math.max(max, 0);
    else {
      const m = /^(.*)_(\d+)$/.exec(st);
      if (m && m[1] === stem) max = Math.max(max, Number(m[2]));
    }
  }
  return max;
}

/**
 * 给新内容挑一个引用名。
 *
 * 规则（和用户对过的口径一致）：
 *   - 这个 hash 从没出现过 → `sha-xxx.jpg`（序号 0）
 *   - 出现过，但全都是别的文件占着 → 顺延到最大序号 +1
 *   - 只有「已确认碰撞」的行占着同名 → 也不能复用（那两个是不同内容）
 */
export function pickStoredId(stem: string, ext: string, slots: NameSlot[]): string {
  const max = maxIndexFor(stem, ext, slots);
  if (max < 0) return `${stem}${ext}`;
  return `${stem}_${max + 1}${ext}`;
}

/** 分块逐字节比较；长度不同直接 false。任一块不同立即返回，不读完整个文件 */
export async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const size = a.size;
  for (let off = 0; off < size; off += CHUNK) {
    const end = Math.min(off + CHUNK, size);
    const [x, y] = await Promise.all([a.slice(off, end).arrayBuffer(), b.slice(off, end).arrayBuffer()]);
    const ux = new Uint8Array(x);
    const uy = new Uint8Array(y);
    for (let i = 0; i < ux.length; i++) if (ux[i] !== uy[i]) return false;
  }
  return true;
}

/**
 * 从「上传的文件」里截一段内容做快速指纹：首 64KB + 尾 64KB 的 SHA-256。
 *
 * 只用于「用户在弹窗里挑一个候选」时先把明显不同的排掉（秒级预览），
 * 不能当作唯一判据 —— 真正的结论仍由 sameBytes 判定。
 */
export async function quickFingerprint(blob: Blob): Promise<string> {
  const head = blob.slice(0, 64 * 1024);
  const tail = blob.slice(Math.max(0, blob.size - 64 * 1024));
  const h = await sha256Hex(head);
  const t = await sha256Hex(tail);
  return `${h}:${t}:${blob.size}`;
}
