// 同步引擎：三方比对，只传变化的分片；附件字节单独走内容寻址的对象存储。
//
// 判定表（baseline = 上次同步成功时本地快照的 digest）：
//   local == baseline                  → 本机没改过
//        ＜ 远端 digest 也 == baseline → 两边都没动，什么也不做
//        ＜ 远端 digest != baseline    → 只下载
//   local != baseline                  → 本机改过
//        ＜ 远端 digest 也 != baseline → 两边都改过：先合并再上传
//        否则                           → 只上传
//
// 「只传变化的分片」靠内容寻址：分片文件名是内容哈希，
// 远端清单里已有的哈希直接跳过。注意这只在**等长替换**时省事——
// 插入或删除会让后面所有字节挪位，之后的分片全要重传，见 DEVELOPMENT.md「坚果云增量备份」。
//
// 附件二进制不在快照里（快照只带 attachments 行的元数据，data 一律清空），
// 走 attachments/<sha256>/<i>.bin 单独一套，见 ./attachments.ts。
import {
  getDeviceId,
  getMeta,
  setMeta,
  transact,
  persist,
  noteUndoStep,
  suspendUndo,
  resumeUndo,
  syncWrite,
  currentWrites,
  markSynced,
} from '../db';
import { hlcReceive } from '../time';
import { ensureClosure } from '../repo/collections';
import { SCHEMA_VERSION, type LibraryFile } from '../types';
import { buildLibrary } from '../io';
import {
  ATTACH_DIR,
  INDEX_PATH,
  emptyIndex,
  parseIndex,
  syncAttachments,
  type AttachIndex,
  type AttachResult,
} from './attachments';
import { strippedLibrary, bytesOf, stableJson } from './snapshot';
import { CHUNK_SIZE, digestOf, hashChunks, type ChunkMeta } from './chunk';
import {
  MANIFEST_FILE,
  SNAPSHOT_DIR,
  chunkPath,
  knownHashes,
  missingChunks,
  parseManifest,
  type Manifest,
} from './manifest';
import * as dav from './webdav';
import { mergeRows, emptyCounts, type MergeCounts } from './mergeRows';

/** 远端保留的快照份数：够回滚，又不至于把网盘塞满 */
const KEEP_SNAPSHOTS = 10;

const META_BASE = 'sync.baseline';
const META_LAST = 'sync.last_at';

export type SyncAction = 'upload' | 'download' | 'both' | 'noop';

export interface SyncResult {
  action: SyncAction;
  /** 本次真正上传的分片数 / 字节 */
  uploadedChunks: number;
  uploadedBytes: number;
  /** 因为远端已有而跳过、省下来的分片数 / 字节 */
  savedChunks: number;
  savedBytes: number;
  totalBytes: number;
  /** 从云端拉下来的字节 */
  downloadedBytes: number;
  merged?: MergeCounts;
  /** 开了附件同步才有：这一趟附件上传 / 补齐了多少 */
  attachments?: AttachResult;
  at: string;
}

function sumBytes(metas: ChunkMeta[]): number {
  return metas.reduce((s, m) => s + m.n, 0);
}

/** 附件行按 id 排序：SELECT * 不带 ORDER BY、两台设备插入顺序不同就会给同一堆内容算出
 * 不同 digest，增量同步于是误判成「本机改过」而把后面的分片全重传一遍。
 * 合并时是按 id 逐行落库的，顺序本来无关，这里只是把快照写成规范形式。 */
function sortAttachments<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 生成本次同步用的快照：附件只带元数据行（data 一律清空），二进制另走 attachments 层 */
async function snapshotText(): Promise<string> {
  // 用稳定序列化：否则 meta.exportedAt 每次都在变，分片哈希全换，增量就失效了
  const lib = strippedLibrary(await buildLibrary({ includeAttachments: 'meta' }));
  lib.attachments = sortAttachments(lib.attachments ?? []);
  return stableJson(lib);
}

/** 把远端分片按清单拼回完整快照 */
async function downloadSnapshot(c: dav.DavConfig, m: Manifest): Promise<string> {
  const parts: Uint8Array[] = [];
  for (const ck of m.chunks) {
    const bytes = await dav.getBinary(c, chunkPath(ck.h));
    if (!bytes) throw new Error(`云端缺分片 ${ck.h}，清单与分片目录不一致，请先做一次完整上传`);
    if (bytes.length !== ck.n) throw new Error(`分片 ${ck.h} 大小不对，可能上次上传中断`);
    parts.push(bytes);
  }
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return new TextDecoder().decode(all);
}

/**
 * 同一时刻只许一趟同步。
 *
 * 手动点「立即同步」和自动服务撞上时，两边都在读同一份 baseline、又都要写 manifest
 * 与 baseline —— 后写完的把先写完的说法覆盖掉，云端清单和两边设备的 baseline
 * 就对不上了。这里排队而不是并发，也不把别人的结果直接回给你：
 * 「强制完整上传」不能因为撞上一次自动同步就被吞掉。
 */
let inFlight: Promise<SyncResult> | null = null;

/**
 * 最近一趟同步在拍快照那一刻取到的写入序号。
 * 只有同一时刻一趟在跑（见上面的排队），所以一个变量就够，不用随结果传。
 */
let syncPoint = 0;

/** 现在有没有正在跑的同步（自动服务靠它决定这一拍跳过） */
export function isSyncing(): boolean {
  return inFlight !== null;
}

/**
 * 执行一次同步。
 * @param opts.full 忽略「本机没改过」的短路，强制上传一份（换机建档用）
 * @param opts.attachments 顺带把附件二进制传上去 / 补回来（设置页那个开关，这里默认关）
 */
export async function syncNow(
  c: dav.DavConfig,
  opts: { full?: boolean; attachments?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<SyncResult> {
  while (inFlight) {
    const prev = inFlight;
    try {
      await prev;
    } catch {
      /* 上一趟的失败归它的调用方，这里只管等它结束 */
    }
  }
  const p = runSync(c, opts)
    .then((r) => {
      // 成功了才把「本机有没有欠着」对齐到快照那一刻：传输途中用户又写的那笔仍然算欠，
      // 下一拍接着传；失败就一笔都不对齐，改动触发会自己重试这一趟（退避后）。
      markSynced(syncPoint);
      return r;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = p;
  return p;
}

async function runSync(
  c: dav.DavConfig,
  opts: { full?: boolean; attachments?: boolean; onProgress?: (msg: string) => void },
): Promise<SyncResult> {
  const report = opts.onProgress ?? (() => {});
  const now = new Date().toISOString();
  const withAtt = !!opts.attachments;

  report('检查云端…');
  await dav.ensureDir(c, '');
  for (const dir of [SNAPSHOT_DIR, 'chunks']) await dav.ensureDir(c, dir);
  if (withAtt) await dav.ensureDir(c, ATTACH_DIR);

  const remoteRaw = await dav.getText(c, MANIFEST_FILE);
  const remote = remoteRaw ? parseManifest(remoteRaw) : null;
  const baseline = getMeta(META_BASE);

  // 附件清单只读这一次：之后「这个文件云端有没有」全在内存里查，不再问服务端
  const idxRaw = withAtt ? await dav.getText(c, INDEX_PATH) : null;
  let index: AttachIndex = idxRaw ? parseIndex(idxRaw) : emptyIndex();

  report('生成本地快照…');
  const text = await snapshotText();
  // 拍下「对齐点」：此刻之前的本机写入都进了这份快照，之后写的才算还欠着。
  // 同步自己往库里补的（合并进来的行、补算的指纹、baseline、last_at）由 syncWrite
  // 排除在计数之外——不分开的话，收尾那笔 setMeta 会把自动同步再触发一遍，
  // 自动同步自己喂自己，一趟接一趟打坚果云。真正的对齐在 syncNow 成功之后做。
  syncPoint = currentWrites();
  const bytes = bytesOf(text);
  const metas = hashChunks(bytes);
  const digest = digestOf(metas, bytes.length);

  const localChanged = !!opts.full || digest !== baseline;
  const remoteChanged = !!remote && remote.digest !== baseline;

  const result: SyncResult = {
    action: 'noop',
    uploadedChunks: 0,
    uploadedBytes: 0,
    savedChunks: 0,
    savedBytes: 0,
    totalBytes: bytes.length,
    downloadedBytes: 0,
    at: now,
  };

  // 1) 先把本地数据摆平：该下的下、该合并的合并
  let mergedRemote = false;
  if (!localChanged) {
    if (remote && remoteChanged) {
      report('下载云端变更…');
      await applyRemote(await downloadSnapshot(c, remote), result);
      result.action = 'download';
      result.downloadedBytes = remote.totalBytes;
      mergedRemote = true;
    }
  } else if (remoteChanged && remote!.deviceId !== getDeviceId()) {
    // 两边都改过，且远端不是本机写的 → 先合并再上传
    report('合并云端变更…');
    await applyRemote(await downloadSnapshot(c, remote!), result);
    result.downloadedBytes = remote!.totalBytes;
    result.action = 'both';
    mergedRemote = true;
  } else {
    result.action = 'upload';
  }

  // 2) 附件往返。开关开着就跑，**包括「本机没改过」这条路**：刚合并完远端的行，
  //    本地正是缺字节的时候；用户刚把开关打开、或上次拉到一半断了，
  //    也要有地方把剩下的补完。这一步只碰 attachments/，不动快照分片。
  if (withAtt) {
    report('同步附件…');
    const att = await syncAttachments(c, index, report);
    result.attachments = att.result;
    index = att.index;
  }

  // 3) 只有本机改过才回写云端快照。纯下载那条路上本地内容就等于云端内容，
  //    再写一份只是多占一格历史快照、把清单作者换成自己。
  if (!localChanged) {
    finish(digest, now);
    return result;
  }

  // 4) 合并过、或附件层刚补算了 sha256，本地元数据已经和开头不一样 → 重新生成一份。
  //    补齐的哈希这一趟就带上，别的设备下次同步才知道该去拉哪个对象。
  const rewrote = mergedRemote || (result.attachments?.hashed ?? 0) > 0;
  const finalText = rewrote ? await snapshotText() : text;
  const finalBytes = rewrote ? bytesOf(finalText) : bytes;
  const finalMetas = rewrote ? hashChunks(finalBytes) : metas;
  const finalDigest = rewrote ? digestOf(finalMetas, finalBytes.length) : digest;
  result.totalBytes = finalBytes.length;

  const known = knownHashes(remote);
  const need = missingChunks(finalMetas, known);
  result.uploadedChunks = need.length;
  result.uploadedBytes = sumBytes(need);
  result.savedChunks = finalMetas.length - need.length;
  result.savedBytes = sumBytes(finalMetas) - result.uploadedBytes;

  let done = 0;
  for (const m of need) {
    done += 1;
    report(`上传分片 ${done}/${need.length}（${Math.max(1, Math.round(m.n / 1024))} KB）`);
    const start = m.i * CHUNK_SIZE;
    await dav.putBinary(c, chunkPath(m.h), finalBytes.subarray(start, start + m.n));
  }

  report('写入清单…');
  const manifest: Manifest = {
    v: 1,
    at: now,
    deviceId: getDeviceId(),
    totalBytes: finalBytes.length,
    kind: 'lite',
    chunkSize: CHUNK_SIZE,
    chunks: finalMetas,
    digest: finalDigest,
    schemaVersion: SCHEMA_VERSION,
    // 云端有没有附件字节，以清单为准；这一趟没管附件（开关关着）就沿用远端原来的说法，
    // 别把别人传上去的对象写成「没有」
    hasAttachments: withAtt ? Object.keys(index.files).length > 0 : (remote?.hasAttachments ?? false),
  };
  await dav.putText(c, MANIFEST_FILE, JSON.stringify(manifest));

  // 4) 历史快照 + 只留最近若干份
  await dav.putText(c, `${SNAPSHOT_DIR}/s${now.replace(/[-:.]/g, '')}.json`, finalText);
  await pruneSnapshots(c);

  finish(finalDigest, now);
  return result;
}

/** 把云端快照合并进本地；整次同步只记一步撤销 */
async function applyRemote(remoteText: string, result: SyncResult): Promise<void> {
  const lib = JSON.parse(remoteText) as LibraryFile;
  for (const p of lib.persons ?? []) hlcReceive(p.hlc ?? '');
  for (const e of lib.events ?? []) hlcReceive(e.hlc ?? '');
  for (const col of lib.collections ?? []) hlcReceive(col.hlc ?? '');

  // 合并云端行、闭包补算、撤销记录都是这趟同步自己写的，不计入「本机还有东西没传」
  syncWrite(() => {
    noteUndoStep('同步云端数据');
    suspendUndo();
    try {
      result.merged = transact(() => mergeRows(lib, emptyCounts()));
    } finally {
      resumeUndo();
    }
    ensureClosure();
  });
  await persist();
}

function finish(digest: string, at: string): void {
  syncWrite(() => {
    setMeta(META_BASE, digest);
    setMeta(META_LAST, at);
  });
}

async function pruneSnapshots(c: dav.DavConfig): Promise<void> {
  try {
    const files = (await dav.list(c, SNAPSHOT_DIR))
      .filter((e) => !e.isDir && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
      await dav.remove(c, `${SNAPSHOT_DIR}/${name}`);
    }
  } catch {
    /* 清理失败不影响本次同步结果 */
  }
}

export interface SyncStatus {
  lastAt: string | null;
  hasBaseline: boolean;
}

export function getSyncStatus(): SyncStatus {
  return { lastAt: getMeta(META_LAST), hasBaseline: !!getMeta(META_BASE) };
}
