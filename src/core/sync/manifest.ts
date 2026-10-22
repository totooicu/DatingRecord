// 远端清单（manifest.json）的读写与合并。
//
// 远端目录结构：
//   <base>/manifest.json          清单：这一版库由哪些分片按什么顺序拼成
//   <base>/chunks/<hash>.bin      分片，内容寻址，永不改名复用
//   <base>/snapshots/s<ts>.json   轻量历史快照（只含元数据与实体，不含附件二进制）
//
// 清单是「一次写入、整份替换」的小文件（几百字节到几 KB），
// 只有它每次都要上传；分片才走增量。
import type { ChunkMeta } from './chunk';

export interface Manifest {
  /** 清单格式版本，将来换算法时老客户端能识别 */
  v: 1;
  /** 生成时间（ISO） */
  at: string;
  /** 由哪台设备写的（诊断「两台机器互相覆盖」时有用） */
  deviceId: string;
  /** 原始快照的字节数，也是分片的拼接顺序 */
  totalBytes: number;
  /** 快照的类型：合库快照（含附件）/ 轻量快照（不含附件） */
  kind: 'full' | 'lite';
  chunkSize: number;
  chunks: ChunkMeta[];
  /** 整库摘要，用来判断「和上次相比有没有变」 */
  digest: string;
  /** 生成它的库的 schema 版本 */
  schemaVersion: number;
  /** 附件是否随本次上传（附件永远走轻量快照） */
  hasAttachments: boolean;
}

export const MANIFEST_FILE = 'manifest.json';
export const CHUNK_DIR = 'chunks';
export const SNAPSHOT_DIR = 'snapshots';

export function chunkPath(hash: string): string {
  return `${CHUNK_DIR}/${hash}.bin`;
}

/** 远端已有分片的集合：清单里出现过的，在 chunks 目录里就一定在 */
export function knownHashes(m: Manifest | null): Set<string> {
  return new Set(m ? m.chunks.map((c) => c.h) : []);
}

/** 需要上传的分片：云端清单里没有的 */
export function missingChunks(metas: ChunkMeta[], known: Set<string>): ChunkMeta[] {
  return metas.filter((c) => !known.has(c.h));
}

/** 合并两份清单（用于「云端清单比本地旧」时：云端已经有的分片，能省就省） */
export function unionHashes(a: Manifest | null, b: Manifest | null): Set<string> {
  return new Set([...knownHashes(a), ...knownHashes(b)]);
}

/** 校验清单结构（远端文件可能被别的东西改坏） */
export function parseManifest(raw: string): Manifest {
  const m = JSON.parse(raw) as Manifest;
  if (!m || m.v !== 1 || !Array.isArray(m.chunks) || typeof m.totalBytes !== 'number') {
    throw new Error('云端清单格式不正确，可能不是本应用写入的文件');
  }
  return m;
}
