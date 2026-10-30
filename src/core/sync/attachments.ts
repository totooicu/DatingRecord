// 附件二进制的云端往返：内容寻址上传 + 缺什么补什么。
//
// 为什么要单独一层：库里 attachments 表只有元数据，字节在 IndexedDB 的 blobs store
// （见 ../db/blob.ts 开头那段）。同步快照带的是元数据行，别的设备因此知道
// 「有一张 3.2MB 的 jpg 叫海边的下午」，却拿不到字节。这一层把字节也放上坚果云，
// 并且让每个文件**一生只传一次**。
//
// 远端布局：
//   <base>/attachments/index.json       已上传清单：sha256 → { 字节数, 片数 }
//   <base>/attachments/<sha256>/<i>.bin 附件切片
//
// 对象名就是内容的 sha256，于是三件事一起解决了：
//   · 传没传过 → 查 index.json，不用问服务端
//   · 两台设备传同一张照片 → 落在同一个名字上，覆盖的是同样的字节
//   · 拉回来的对不对 → 拼完重算 sha256 和名字比对，上次断在半路的文件当场露出来
//
// 为什么切片：安卓壳代发 HTTP 时请求体上限 12MB（base64 还要胖 4/3），
// 一次桥调用搬 4MB 出来是 5.3MB 字符串，再大就该换片而不是换上限。
// 40MB 的视频 = 10 个请求，断了从没传完的那片接着来。
//
// 内存这条线要盯住：一次同步里**只在真正要传/要拉的时候才读那一个文件的字节**，
// 读完就撒手。曾经写成一趟循环把所有附件的 Uint8Array 存进一张 Map，
// 两百张照片就是六百 MB，手机直接杀进程——所以这里的队列只装 id、哈希和大小。
//
// 映射文件（source_url 非空）本地没有字节，既不传也不拉，全程跳过。
import { persist, queryAll } from '../db';
import { getBlob, putBlob } from '../db/blob';
import { setFileHash } from '../repo/files';
import { Sha256 } from './sha256';
import * as dav from './webdav';

export const ATTACH_DIR = 'attachments';
export const INDEX_PATH = `${ATTACH_DIR}/index.json`;
/** 单片字节数，见文件头「为什么切片」 */
export const PART_SIZE = 4 * 1024 * 1024;

/** 云端已有的一个附件对象 */
export interface AttachEntry {
  /** 原始字节数（不含 base64 膨胀） */
  s: number;
  /** 片数 */
  p: number;
}

export interface AttachIndex {
  v: 1;
  at: string;
  files: Record<string, AttachEntry>;
}

export interface AttachResult {
  /** 本次传上去的文件数 / 字节数 */
  uploaded: number;
  uploadBytes: number;
  /** 本次从云端补齐的文件数 / 字节数 */
  fetched: number;
  fetchBytes: number;
  /** 云端已有、这次跳过的文件数（常态） */
  skipped: number;
  /** 顺手补算并写回 sha256 的老行数（会让下一次同步的快照多带这些哈希） */
  hashed: number;
  /** 本地缺字节、云端索引也没有这个 hash 的行数（另一台设备关了附件同步就是这样） */
  missingRemote: number;
  /** 既没字节也没哈希的行数——什么都做不了，只能报个数 */
  unknown: number;
}

interface AttRow {
  id: string;
  name: string;
  sha256: string;
  size: number;
  mime: string;
  source_url: string | null;
}

/** 待传队列里的一项：只有指针和大小，没有字节 */
interface UploadItem {
  hash: string;
  rowId: string;
  name: string;
  /** 元数据没记大小的老行留 0，读到时才知道 */
  size: number;
}

export function partPath(hash: string, i: number): string {
  return `${ATTACH_DIR}/${hash}/${i}.bin`;
}

export function partCount(size: number): number {
  return Math.max(1, Math.ceil(size / PART_SIZE));
}

/** 人话字节数 */
export function humanSize(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** 云端还没有附件清单时的样子 */
export function emptyIndex(): AttachIndex {
  return { v: 1, at: '', files: {} };
}

/**
 * 读云端清单。
 * 没有这个文件 = 云端还一个附件都没有（首次同步的常态，不是异常）；
 * 有但解析不出来必须报错停下——当成空清单会让下次把整库附件重传一遍。
 */
export function parseIndex(text: string): AttachIndex {
  let raw: Partial<AttachIndex>;
  try {
    raw = JSON.parse(text) as Partial<AttachIndex>;
  } catch {
    throw new Error('云端附件清单 attachments/index.json 读不出来，先别同步——删掉它等于让所有附件重传一遍');
  }
  const files: Record<string, AttachEntry> = {};
  for (const [h, v] of Object.entries(raw.files ?? {})) {
    const e = v as Partial<AttachEntry> | null;
    const s = Number(e?.s ?? 0);
    if (!/^[0-9a-f]{64}$/.test(h) || !(s > 0)) continue; // 单条坏记录不牵连别的
    files[h] = { s, p: Math.max(1, Number(e?.p ?? partCount(s))) };
  }
  return { v: 1, at: String(raw.at ?? ''), files };
}

function localRows(): AttRow[] {
  return queryAll<AttRow>(
    'SELECT id, name, sha256, size, mime, source_url FROM attachments ORDER BY created_at ASC',
  );
}

/**
 * 本地附件的只读盘点：不联网、不写库，给 CLI / AI 和「要不要开这个开关」的判断用。
 * 数字口径和 syncAttachments 一致（同样跳过映射文件、同样按 blob 是否存在分「有字节 / 缺字节」）。
 */
export async function inspectAttachments(): Promise<{
  total: number;
  mapped: number;
  haveBytes: number;
  /** 本地只剩元数据行，等着从云端补回来的 */
  missingBytes: number;
  /** 有内容指纹（云端认得它） */
  hashed: number;
  /** 没指纹：既传不上去也没法拉，同步时只能报个数 */
  unnamed: number;
  /** 本地已有字节的总大小 */
  bytes: number;
}> {
  const rows = localRows();
  let mapped = 0;
  let haveBytes = 0;
  let missingBytes = 0;
  let hashed = 0;
  let unnamed = 0;
  let bytes = 0;
  for (const row of rows) {
    if (row.source_url) {
      mapped += 1;
      continue;
    }
    if (row.sha256) hashed += 1;
    else unnamed += 1;
    const blob = await getBlob(row.id);
    if (blob) {
      haveBytes += 1;
      bytes += row.size || blob.size;
    } else if (row.sha256) {
      missingBytes += 1;
    }
  }
  return { total: rows.length, mapped, haveBytes, missingBytes, hashed, unnamed, bytes };
}

/** 4MB 一片喂进去算哈希，别让 SHA 实现内部再复制一份 */
function sha256Hex(bytes: Uint8Array): string {
  const h = new Sha256();
  for (let off = 0; off < bytes.length; off += PART_SIZE) {
    h.update(bytes.subarray(off, Math.min(off + PART_SIZE, bytes.length)));
  }
  return h.hex();
}

/** 云端是不是已经有这个内容了（大小对得上才算有，防止上次传了一半写进清单） */
function remoteHas(index: AttachIndex, hash: string, size: number): boolean {
  const e = index.files[hash];
  return !!e && e.s === size && e.p === partCount(size);
}

/**
 * 跑一次附件往返：先补齐本地缺的，再上传本地有的。
 * 顺序是有意的——刚合并完远端行时本地正缺字节，先拉才能在本次同步里把两端对齐。
 *
 * @param index 云端清单（engine 已经为读它发过一次请求，这里不重复要）
 */
export async function syncAttachments(
  c: dav.DavConfig,
  index: AttachIndex,
  onProgress: (msg: string) => void = () => {},
): Promise<{ result: AttachResult; index: AttachIndex }> {
  const r: AttachResult = {
    uploaded: 0,
    uploadBytes: 0,
    fetched: 0,
    fetchBytes: 0,
    skipped: 0,
    hashed: 0,
    missingRemote: 0,
    unknown: 0,
  };
  const rows = localRows();

  const need: AttRow[] = []; // 有行没字节 → 等拉
  const upload = new Map<string, UploadItem>(); // hash → 待传（同内容多行只传一份）

  for (const row of rows) {
    if (row.source_url) continue; // 映射文件没有二进制
    const blob = await getBlob(row.id);
    if (!blob) {
      if (row.sha256) need.push(row);
      else r.unknown += 1;
      continue;
    }
    if (!row.sha256) {
      // 老行没算过哈希：内容就在手上，读这一次算出来。
      // 哈希写回元数据后，这行的内容才算「有名字」——快照要下一次同步才带上它，
      // 但对象名此刻已经是对的，不会传到错地方。
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = sha256Hex(bytes);
      setFileHash(row.id, hash);
      r.hashed += 1;
      if (!remoteHas(index, hash, bytes.length) && /^[0-9a-f]{64}$/.test(hash)) {
        upload.set(hash, { hash, rowId: row.id, name: row.name, size: bytes.length });
      } else {
        r.skipped += 1;
      }
      continue;
    }
    const size = row.size || blob.size;
    if (!/^[0-9a-f]{64}$/.test(row.sha256)) {
      r.unknown += 1;
      continue;
    }
    if (remoteHas(index, row.sha256, size)) {
      r.skipped += 1; // 一个字节都不读，这是稳态里的绝大多数
      continue;
    }
    if (!upload.has(row.sha256)) {
      upload.set(row.sha256, { hash: row.sha256, rowId: row.id, name: row.name, size });
    }
  }

  // 补算的哈希当场落盘：它就在 attachments 表里，光改内存中的 sql.js 副本，
  // 页面一刷新就没了——下次同步又会当成「没算过」，白读一遍字节。
  if (r.hashed > 0) await persist();

  // ---- 补齐：本地只有行、没有字节，而云端有对象 ----
  for (const row of need) {
    const e = index.files[row.sha256];
    if (!e) {
      r.missingRemote += 1;
      continue;
    }
    onProgress(`拉取附件 ${row.name || row.sha256.slice(0, 8)}（${humanSize(e.s)}）`);
    const bytes = await fetchObject(c, row.sha256, e);
    if (!bytes) {
      r.missingRemote += 1;
      onProgress(`${row.name || row.sha256.slice(0, 8)}：云端索引说有，片却不全或内容对不上名字，这次先跳过`);
      continue;
    }
    await putBlob(row.id, new Blob([bytes], { type: row.mime || 'application/octet-stream' }));
    r.fetched += 1;
    r.fetchBytes += bytes.length;
  }

  // ---- 上传：本地有字节、云端索引还没有 ----
  for (const one of upload.values()) {
    const blob = await getBlob(one.rowId); // 上面查过存在，这里才真读字节
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // 传之前对一次名字：内容寻址写错了没人会发现，只有多年后打开这张图的人会说「图不对」
    if (sha256Hex(bytes) !== one.hash) {
      onProgress(`跳过 ${one.name || one.hash.slice(0, 8)}：库里记的哈希和字节对不上，先到「文件」页跑一次「数据迁移」看体检结果`);
      continue;
    }
    const parts = partCount(bytes.length);
    // 先建这个对象自己那一级目录：真实 WebDAV（坚果云也一样）不接受「父集合不存在」的 PUT，
    // 直接传回 409。目录已存在时 MKCOL 回 405，dav.mkcol 把它当成功，所以每个对象一条请求，
    // 稳态里传新文件才走得到这里。
    await dav.mkcol(c, `${ATTACH_DIR}/${one.hash}`);
    for (let i = 0; i < parts; i += 1) {
      onProgress(`上传附件 ${one.name || one.hash.slice(0, 8)} 第 ${i + 1}/${parts} 片 · ${humanSize(bytes.length)}`);
      await dav.putBinary(c, partPath(one.hash, i), bytes.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
    }
    index.files[one.hash] = { s: bytes.length, p: parts };
    r.uploaded += 1;
    r.uploadBytes += bytes.length;
  }

  if (r.uploaded > 0) {
    index.at = new Date().toISOString();
    await dav.putText(c, INDEX_PATH, JSON.stringify(index));
  }
  return { result: r, index };
}

/** 把一个对象的所有片拼回来并复核哈希；片不全或内容对不上名字 → null（宁可说没有） */
async function fetchObject(c: dav.DavConfig, hash: string, e: AttachEntry): Promise<Uint8Array<ArrayBuffer> | null> {
  const h = new Sha256();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < e.p; i += 1) {
    const piece = await dav.getBinary(c, partPath(hash, i));
    if (!piece) return null;
    h.update(piece);
    parts.push(piece);
    total += piece.length;
  }
  if (total !== e.s) return null; // 上次传到一半断了：清单说 4MB，实体只有 2MB
  if (h.hex() !== hash) return null;
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return all;
}
