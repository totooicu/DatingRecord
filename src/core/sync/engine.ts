// 同步引擎：三方比对，只传变化的分片。
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
// 远端清单里已有的哈希直接跳过，所以改一行字通常只上传一个 64KB 分片。
import {
  getDeviceId,
  getMeta,
  setMeta,
  transact,
  persist,
  noteUndoStep,
  suspendUndo,
  resumeUndo,
} from '../db';
import { hlcReceive } from '../time';
import { ensureClosure } from '../repo/collections';
import { SCHEMA_VERSION, type LibraryFile } from '../types';
import { buildLibrary } from '../io';
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
  at: string;
}

function sumBytes(metas: ChunkMeta[]): number {
  return metas.reduce((s, m) => s + m.n, 0);
}

/** 生成本同步用的轻量快照（不含附件二进制、不含凭据） */
async function snapshotText(): Promise<string> {
  // 用稳定序列化：否则 meta.exportedAt 每次都在变，分片哈希全换，增量就失效了
  return stableJson(strippedLibrary(await buildLibrary({ includeAttachments: false })));
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
 * 执行一次同步。
 * @param opts.full 忽略「本机没改过」的短路，强制上传一份（换机建档用）
 */
export async function syncNow(
  c: dav.DavConfig,
  opts: { full?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<SyncResult> {
  const report = opts.onProgress ?? (() => {});
  const now = new Date().toISOString();

  report('检查云端…');
  await dav.ensureDir(c, '');
  for (const dir of [SNAPSHOT_DIR, 'chunks']) await dav.ensureDir(c, dir);

  const remoteRaw = await dav.getText(c, MANIFEST_FILE);
  const remote = remoteRaw ? parseManifest(remoteRaw) : null;
  const baseline = getMeta(META_BASE);

  report('生成本地快照…');
  const text = await snapshotText();
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

  // 1) 本机没改过
  if (!localChanged) {
    if (remote && remoteChanged) {
      report('下载云端变更…');
      await applyRemote(await downloadSnapshot(c, remote), result);
      result.action = 'download';
      result.downloadedBytes = remote.totalBytes;
    }
    finish(digest, now);
    return result;
  }

  // 2) 两边都改过，且远端不是本机写的 → 先合并再上传
  const conflict = remoteChanged && remote!.deviceId !== getDeviceId();
  if (conflict) {
    report('合并云端变更…');
    await applyRemote(await downloadSnapshot(c, remote!), result);
    result.downloadedBytes = remote!.totalBytes;
    result.action = 'both';
  } else {
    result.action = 'upload';
  }

  // 3) 合并过的要重新生成：本地的行变了，快照自然变
  const finalText = conflict ? await snapshotText() : text;
  const finalBytes = conflict ? bytesOf(finalText) : bytes;
  const finalMetas = conflict ? hashChunks(finalBytes) : metas;
  const finalDigest = conflict ? digestOf(finalMetas, finalBytes.length) : digest;
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
    hasAttachments: false,
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

  noteUndoStep('同步云端数据');
  suspendUndo();
  try {
    result.merged = transact(() => mergeRows(lib, emptyCounts()));
  } finally {
    resumeUndo();
  }
  ensureClosure();
  await persist();
}

function finish(digest: string, at: string): void {
  setMeta(META_BASE, digest);
  setMeta(META_LAST, at);
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
