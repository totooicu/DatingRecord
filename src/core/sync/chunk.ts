// 增量哈希：库快照 → 一张「分片清单」。
//
// 为什么不直接上传整个 drp.json：一次改动哪怕只改一个字，
// 整份 JSON 的字节都会挪位，网盘只能整份重传。这里把快照切成固定大小
// 的分片，分片内容寻址（文件名 = 内容 sha256 前缀），于是
//   · 内容没变的分片 → 名字没变 → 云端已有，跳过
//   · 只改了一小段 → 只有落在那一段的 1~2 个分片换了名字
// 坚果云按流量计费，这一层直接决定「同步一次要花多少带宽」。
//
// 分片大小 64KB 是有意的折中：太小 → 一次同步几十个请求，慢且容易撞限流；
// 太大 → 改一个字也要传 64KB。日常编辑（改标题、加一句话）通常只动 1 个分片。

import { sha256HexOf } from './sha256';

export const CHUNK_SIZE = 64 * 1024;

/** 内容哈希：SHA-256 的前 32 个十六进制字符（128 bit，碰撞概率可忽略） */
export type ChunkHash = string;

export interface ChunkMeta {
  /** 分片序号，从 0 开始，决定拼回来的顺序 */
  i: number;
  /** 内容哈希（远端文件名就是 <hash>.bin） */
  h: ChunkHash;
  /** 字节数，拼装时用来校验 */
  n: number;
}

export function chunkOf(bytes: Uint8Array, index: number): Uint8Array {
  const start = index * CHUNK_SIZE;
  return bytes.subarray(start, Math.min(start + CHUNK_SIZE, bytes.length));
}

export function chunkCount(bytes: Uint8Array): number {
  return Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
}

/** 把整库快照切成带哈希的分片（同步只上传其中云端没有的那几片） */
export function hashChunks(bytes: Uint8Array): ChunkMeta[] {
  const out: ChunkMeta[] = [];
  const total = chunkCount(bytes);
  for (let i = 0; i < total; i += 1) {
    const piece = chunkOf(bytes, i);
    out.push({ i, h: sha256HexOf(piece).slice(0, 32), n: piece.length });
  }
  return out;
}

/** 内容摘要（整库级别），用来判断「本地有没有变化」 */
export function digestOf(metas: ChunkMeta[], totalBytes: number): string {
  return sha256HexOf(new TextEncoder().encode(metas.map((m) => `${m.i}:${m.h}:${m.n}`).join('|') + `#${totalBytes}`)).slice(0, 32);
}
