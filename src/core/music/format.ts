// 歌单文件格式（.drpl）。
//
// 歌单是文件库里的普通文件：正文是一段 JSON，和别的附件一样走内容寻址
// （stored_id）与 IndexedDB 二进制。用独立后缀而不是 .json，是为了在文件
// 筛选里一眼认出来，也不会和用户自己上传的 json 混在一起。
//
// 引用曲目的原则：
//   · storedId 是跨设备唯一能对上的名字（内容 hash），优先用它；
//   · id 是本机的附件 id，重名/碰撞时更精确，但换库就没意义了；
//   · name / mime / size 只是快照，文件找不到时用来提示「哪首缺了」。
// 三样都存，读取时按 id → storedId → 名字唯一匹配的顺序解析。

import { stemOf } from '../files/naming';
import type { StoredFile } from '../repo/files';

/** 后缀不带点（筛选、比较用） */
export const PLAYLIST_EXT = 'drpl';
/** 后缀带点（拼文件名用） */
export const PLAYLIST_FILE_EXT = '.drpl';
export const PLAYLIST_MIME = 'application/x-dr-playlist';
export const PLAYLIST_FORMAT = 'dr.playlist';
export const PLAYLIST_VERSION = 1;

export interface PlaylistTrackRef {
  /** 内容寻址名，跨设备恢复用 */
  storedId: string;
  /** 本机附件 id；导入到别的设备后可能失效 */
  id?: string;
  name: string;
  mime: string;
  size: number;
}

export interface PlaylistDoc {
  format: typeof PLAYLIST_FORMAT;
  version: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  tracks: PlaylistTrackRef[];
}

export function isPlaylistFile(f: Pick<StoredFile, 'name' | 'mime'>): boolean {
  return (f.name || '').toLowerCase().endsWith(PLAYLIST_FILE_EXT) || f.mime === PLAYLIST_MIME;
}

/** 歌单显示名：文件名去掉 .drpl；没有名字时给个兜底 */
export function playlistNameOf(f: Pick<StoredFile, 'name'>): string {
  const stem = stemOf(f.name || '').trim();
  return stem || '未命名歌单';
}

/** 把用户输入整理成合法的歌单名（去掉后缀、压空白、限长） */
export function cleanPlaylistName(name: string): string {
  const raw = (name || '').trim().replace(/\.drpl$/i, '').replace(/\s+/g, ' ').trim();
  if (!raw) return '未命名歌单';
  return raw.slice(0, 60);
}

/** 歌单文件名：<名字>.drpl */
export function playlistFileName(name: string): string {
  return `${cleanPlaylistName(name)}${PLAYLIST_FILE_EXT}`;
}

/** 唯一的显示名：同名时顺延 (2)、(3)…（stored_id 另有一套 hash 序号，互不影响） */
export function uniquePlaylistName(name: string, files: Pick<StoredFile, 'name'>[]): string {
  const base = cleanPlaylistName(name);
  const used = new Set(
    files
      .filter((f) => (f.name || '').toLowerCase().endsWith(PLAYLIST_FILE_EXT))
      .map((f) => playlistNameOf(f).toLowerCase()),
  );
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now().toString(36)})`;
}

/** 附件 → 歌单条目快照 */
export function trackRefOf(f: StoredFile): PlaylistTrackRef {
  return { storedId: f.storedId, id: f.id, name: f.name, mime: f.mime, size: f.size };
}

export function emptyPlaylistDoc(name: string, description = ''): PlaylistDoc {
  const now = new Date().toISOString();
  return {
    format: PLAYLIST_FORMAT,
    version: PLAYLIST_VERSION,
    name: cleanPlaylistName(name),
    description: description.trim(),
    createdAt: now,
    updatedAt: now,
    tracks: [],
  };
}

function normalizeTrack(raw: unknown): PlaylistTrackRef | null {
  // 允许手写 ["sha-xxx.mp3"] 这种简写
  if (typeof raw === 'string') {
    const key = raw.trim();
    if (!key) return null;
    return { storedId: key, name: key, mime: '', size: 0 };
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const storedId = typeof o.storedId === 'string' ? o.storedId : typeof o.storedId === 'number' ? String(o.storedId) : '';
  const id = typeof o.id === 'string' ? o.id : undefined;
  if (!storedId && !id) return null;
  return {
    storedId: storedId || id || '',
    id,
    name: typeof o.name === 'string' && o.name ? o.name : (storedId || id || '未知曲目'),
    mime: typeof o.mime === 'string' ? o.mime : '',
    size: typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : 0,
  };
}

/**
 * 解析歌单 JSON。
 *
 * 只认 `tracks` 数组这一条硬要求（方便用户手写 / 别的工具生成），
 * format 对不上会明确报错，避免把随便一个 json 当歌单吞进去。
 */
export function parsePlaylistDoc(text: string, fallbackName = '未命名歌单'): PlaylistDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('不是合法的歌单文件（JSON 解析失败）');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('不是合法的歌单文件（顶层必须是对象）');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.format === 'string' && o.format !== PLAYLIST_FORMAT) {
    throw new Error(`不是歌单文件（format = ${o.format}）`);
  }
  if (!Array.isArray(o.tracks)) {
    throw new Error('不是合法的歌单文件（缺少 tracks 数组）');
  }
  const now = new Date().toISOString();
  const tracks = o.tracks.map(normalizeTrack).filter(Boolean) as PlaylistTrackRef[];
  return {
    format: PLAYLIST_FORMAT,
    version: typeof o.version === 'number' ? o.version : PLAYLIST_VERSION,
    name: cleanPlaylistName(typeof o.name === 'string' ? o.name : fallbackName),
    description: typeof o.description === 'string' ? o.description : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
    tracks,
  };
}

/** 存盘用：稳定缩进，方便用户在预览/下载后直接读或改 */
export function serializePlaylistDoc(doc: PlaylistDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function playlistBlob(doc: PlaylistDoc): Blob {
  return new Blob([serializePlaylistDoc(doc)], { type: PLAYLIST_MIME });
}

export interface ResolvedPlaylist {
  /** 当前文件库里真的找得到的曲目，顺序与歌单一致 */
  tracks: StoredFile[];
  /** 找不到的条目（文件被删 / 换设备还没导入） */
  missing: PlaylistTrackRef[];
}

/**
 * 把歌单条目解析成本机附件。
 *
 * 查找顺序：id → storedId → 名字（只有唯一命中才算，避免张冠李戴）。
 * 名字兜底是为了「备份导出再导入后 id 变了、但内容 hash 也变了」的旧数据。
 */
export function resolvePlaylistTracks(doc: PlaylistDoc, all: StoredFile[]): ResolvedPlaylist {
  const byId = new Map(all.map((f) => [f.id, f]));
  const byStored = new Map<string, StoredFile>();
  const byName = new Map<string, StoredFile | null>();
  for (const f of all) {
    if (!byStored.has(f.storedId)) byStored.set(f.storedId, f);
    const key = f.name.toLowerCase();
    byName.set(key, byName.has(key) ? null : f);
  }

  const tracks: StoredFile[] = [];
  const missing: PlaylistTrackRef[] = [];
  const seen = new Set<string>();
  for (const ref of doc.tracks) {
    const hit =
      (ref.id ? byId.get(ref.id) : undefined) ??
      (ref.storedId ? byStored.get(ref.storedId) : undefined) ??
      (ref.name ? byName.get(ref.name.toLowerCase()) ?? undefined : undefined);
    if (!hit) {
      missing.push(ref);
      continue;
    }
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    tracks.push(hit);
  }
  return { tracks, missing };
}
