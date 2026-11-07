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
import { buildLibrary, importLibrary } from '../io';
import { createSnapshot } from '../snapshots';
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
let inFlight: Promise<SyncResult | OverwriteResult> | null = null;

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

// ---------------- 强制覆盖本地 ----------------

export interface OverwriteResult {
  /** 覆盖前自动留底的那份整库快照 id（可在 AI 对话 → 成果里恢复） */
  backupId: string;
  /** 云端快照的 digest，覆盖成功后它成为新的同步水位 */
  digest: string;
  /** 云端清单的生成时间与写入设备，给人确认「覆盖的是哪一版」 */
  remoteAt: string;
  remoteDeviceId: string;
  /** 云端快照的字节数 */
  bytes: number;
  /** 替换导入的结果（各表条数、跳过的行） */
  imported: Awaited<ReturnType<typeof importLibrary>>;
  at: string;
}

/**
 * 用云端快照**完整替换**本地库：丢弃本机所有未同步改动，云端成为唯一真相。
 *
 * 和普通同步的区别：普通同步走三方比对 + 按 hlc 合并（本地较新的行会保留），
 * 而「换机 / 本地库改乱了」要的是「别合并，就要云端那份」。所以这里不去
 * applyRemote()，而是直接把云端快照交给 importLibrary(..., 'replace')——
 * 复用它已经写好的「清空表 → 重建 → 修集合树 → 落盘」链路，不另起一套。
 *
 * 数据安全（调用方必须已经做过二次确认）：
 *   1. 动手前 createSnapshot('manual') 留一份整库字节，可在「成果」里一键恢复；
 *   2. 与 syncNow 共用同一把 inFlight 锁，不会和自动 / 手动同步并发写库；
 *   3. 云端快照的每一行都要在替换前校验：不是本应用写的、版本过高、分片缺失，
 *      一律在**动本地库之前**抛错；
 *   4. 成功后把 baseline 对齐到云端 digest，之后普通同步不会再拿旧水位误判。
 *
 * 附件字节不在库快照里（内容寻址另存），覆盖后本地只剩云端那批 attachments 行，
 * 字节要补得走「立即同步」——引擎的 noop 分支也会跑 syncAttachments 把缺的拉回来。
 * 这里刻意不碰附件层：IndexedDB 的 blobs 还留着覆盖前的旧字节，
 * 此刻调 syncAttachments 会把那些旧对象当成「本地新增」**上传到云端**，
 * 那就把「覆盖」变成了「拿旧数据污染云端」，与本操作的只读语义相反。
 */
export async function overwriteLocalFromRemote(
  c: dav.DavConfig,
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<OverwriteResult> {
  while (inFlight) {
    const prev = inFlight;
    try {
      await prev;
    } catch {
      /* 上一趟的失败归它的调用方，这里只管等它结束 */
    }
  }
  // 和 syncNow 同一把锁：自动服务撞上来时排队，不允许两趟同时写库 / 写 baseline
  const p = runOverwrite(c, opts).finally(() => {
    inFlight = null;
  });
  inFlight = p;
  return p;
}

async function runOverwrite(
  c: dav.DavConfig,
  opts: { onProgress?: (msg: string) => void },
): Promise<OverwriteResult> {
  const report = opts.onProgress ?? (() => {});
  const now = new Date().toISOString();

  report('读取云端清单…');
  // 不建目录：覆盖是只读云端，往一个从没同步过的目录里 MKCOL 只是凭空造空目录
  const remoteRaw = await dav.getText(c, MANIFEST_FILE);
  if (!remoteRaw) throw new Error('云端还没有 manifest.json：这台设备还没上传过，无法覆盖本地');
  const remote = parseManifest(remoteRaw);
  if (remote.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `云端备份来自新版软件（schema ${remote.schemaVersion} > 本机 ${SCHEMA_VERSION}），请先把软件升到对应版本再覆盖`,
    );
  }

  report('下载云端快照…');
  const text = await downloadSnapshot(c, remote);
  let lib: LibraryFile;
  try {
    lib = JSON.parse(text) as LibraryFile;
  } catch {
    throw new Error('云端快照不是合法 JSON，可能上传中断；请换一份历史快照或重新上传');
  }
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.persons)) {
    throw new Error('云端快照结构不对（缺 persons），可能不是本应用写入的文件');
  }

  // 覆盖前强制留底：这是唯一一次「用户主动丢弃本地数据」的动作，
  // 必须能在刷新之后仍找回覆盖前的状态（内存撤销栈刷新即失效，不够）。
  report('覆盖前自动留底…');
  const backup = await createSnapshot('manual', '强制覆盖本地前的自动留底');
  if (!backup) throw new Error('库还没准备好，无法生成覆盖前的留底快照');
  const backupId = backup.id;

  // 这里不清撤销栈：importLibrary 的 replace 模式是「原地 SQL 重建」，不换库实例，
  // 它自己压的那一步「替换导入」指向的正是覆盖前的库，按一下就能当场退回。
  // 落盘快照管的是「刷新之后还想反悔」，两者各管一段时间，不互相替代。

  report('用云端数据替换本地…');
  const imported = await importLibrary(text, 'replace', {
    // 留底已经由上面的 createSnapshot 完成，别再触发浏览器下载一份 .drp.zip
    onReplaceBackup: async () => `整库快照 ${backupId}`,
  });

  // 覆盖成功 → 本机现在等于云端，对齐水位。syncWrite 保证 setMeta 不算「本机又有新东西」，
  // 否则自动同步会立刻再跑一趟、把刚拉下来的数据又传上去。
  syncWrite(() => {
    setMeta(META_BASE, remote.digest);
    setMeta(META_LAST, now);
  });
  markSynced(currentWrites());
  await persist();

  return {
    backupId,
    digest: remote.digest,
    remoteAt: remote.at,
    remoteDeviceId: remote.deviceId,
    bytes: remote.totalBytes,
    imported,
    at: now,
  };
}
