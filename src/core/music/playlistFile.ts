// 歌单文件的读写（文件库里的 .drpl 附件）。
//
// 歌单不是独立表，也不进 localStorage 当唯一真相：它就是文件库里的一个文件。
// 这样备份 / 分享 / 文件筛选 / 引用管理全都自动覆盖，后续别的小组件要读歌单
// 也只要调用这里的接口，不用再发明一套存储。
//
// 约定：
//   · 新建时算内容 hash 当 stored_id（和普通附件一致），重名由 pickStoredId 顺延；
//   · 编辑走 overwriteFileContent（只换二进制和大小，id/stored_id 不变）；
//   · 歌单名以**文件名**为准，用户可以在文件库里直接改名。

import {
  deleteFile,
  getFile,
  insertFileRaw,
  listFiles,
  nameSlots,
  overwriteFileContent,
  renameFile,
  type StoredFile,
} from '../repo/files';
import { getBlob } from '../db/blob';
import { hashStem, pickStoredId, sha256Text, stemOf } from '../files/naming';
import {
  PLAYLIST_FILE_EXT,
  PLAYLIST_FORMAT,
  PLAYLIST_MIME,
  PLAYLIST_VERSION,
  cleanPlaylistName,
  emptyPlaylistDoc,
  isPlaylistFile,
  parsePlaylistDoc,
  playlistBlob,
  playlistFileName,
  playlistNameOf,
  serializePlaylistDoc,
  trackRefOf,
  type PlaylistDoc,
} from './format';

const ACTIVE_KEY = 'dr.music.active-playlist';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ---------------- 当前歌单 ----------------

export function getActivePlaylistId(): string | null {
  try {
    return storage()?.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActivePlaylistId(id: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (id) s.setItem(ACTIVE_KEY, id);
    else s.removeItem(ACTIVE_KEY);
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

// ---------------- 查询 ----------------

/** 文件库里的全部歌单，新上传的在前（listFiles 已按时间倒序） */
export function listPlaylists(): StoredFile[] {
  return listFiles().filter(isPlaylistFile);
}

export function getPlaylistFile(id: string): StoredFile | null {
  const f = getFile(id);
  return f && isPlaylistFile(f) ? f : null;
}

/** 文件名去掉后缀后的显示名 */
export function playlistDisplayName(f: StoredFile): string {
  return playlistNameOf(f);
}

/** 读歌单正文。找不到 / 内容坏了都会抛出带人话的错误，调用方直接 toast */
export async function readPlaylist(fileOrId: StoredFile | string): Promise<PlaylistDoc> {
  const f = typeof fileOrId === 'string' ? getPlaylistFile(fileOrId) : fileOrId;
  if (!f) throw new Error('歌单文件不存在（可能已被删除）');
  const blob = await getBlob(f.id);
  if (!blob) throw new Error(`歌单「${playlistNameOf(f)}」的内容丢失了（可能还没同步到本机）`);
  const text = await blob.text();
  const doc = parsePlaylistDoc(text, playlistNameOf(f));
  // 文件名是用户可见的唯一名字：在文件库里改名后，正文里的旧名字不该抢回去
  doc.name = playlistNameOf(f);
  return doc;
}

// ---------------- 写入 ----------------

async function insertPlaylistFile(doc: PlaylistDoc): Promise<StoredFile> {
  const text = serializePlaylistDoc(doc);
  const blob = new Blob([text], { type: PLAYLIST_MIME });
  const sha = await sha256Text(text);
  const stem = sha ? hashStem(sha) : `pl-${Date.now().toString(36)}`;
  const storedId = pickStoredId(stem, PLAYLIST_FILE_EXT, nameSlots());
  return insertFileRaw({
    file: blob,
    name: playlistFileName(doc.name),
    storedId,
    sha256: sha,
  });
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  /** 初始曲目（当前播放队列 / 导入的附件） */
  tracks?: StoredFile[];
  /** 已解析好的歌词单（导入 / 工具调用用）；给了就不再从 tracks 重建 */
  doc?: PlaylistDoc;
}

/** 新建歌单文件。返回落库后的附件（同名时显示名按 _2 顺延）。 */
export async function createPlaylist(input: CreatePlaylistInput): Promise<StoredFile> {
  const base =
    input.doc ??
    (() => {
      const doc = emptyPlaylistDoc(input.name, input.description);
      doc.tracks = (input.tracks ?? []).map(trackRefOf);
      return doc;
    })();
  const doc: PlaylistDoc = {
    ...base,
    format: PLAYLIST_FORMAT,
    version: PLAYLIST_VERSION,
    name: cleanPlaylistName(base.name || input.name),
    description: (base.description ?? '').trim(),
  };
  return insertPlaylistFile(doc);
}

/** 导入：解析一段歌单 JSON 并落成文件库里的 .drpl */
export async function importPlaylistText(text: string, sourceName = '导入的歌单'): Promise<StoredFile> {
  const fallback = sourceName.toLowerCase().endsWith(PLAYLIST_FILE_EXT)
    ? sourceName.slice(0, -PLAYLIST_FILE_EXT.length)
    : stemOf(sourceName) || sourceName;
  const doc = parsePlaylistDoc(text, fallback);
  doc.name = cleanPlaylistName(doc.name || fallback);
  return insertPlaylistFile(doc);
}

/**
 * 覆盖保存。doc.updatedAt 由这里统一刷新；名字变了会同步改文件名，
 * 保证「文件库里的文件名」始终等于歌单名。
 */
export async function writePlaylist(id: string, doc: PlaylistDoc): Promise<StoredFile> {
  const f = getPlaylistFile(id);
  if (!f) throw new Error('歌单文件不存在（可能已被删除）');
  const next: PlaylistDoc = {
    ...doc,
    format: PLAYLIST_FORMAT,
    version: PLAYLIST_VERSION,
    name: cleanPlaylistName(doc.name || playlistNameOf(f)),
    updatedAt: new Date().toISOString(),
  };
  const want = playlistFileName(next.name);
  if (f.name !== want) renameFile(id, want);
  await overwriteFileContent(id, playlistBlob(next));
  return getFile(id)!;
}

/** 只改名字 / 描述（重命名时同时改文件名） */
export async function updatePlaylistMeta(
  id: string,
  patch: { name?: string; description?: string },
): Promise<StoredFile> {
  const f = getPlaylistFile(id);
  if (!f) throw new Error('歌单文件不存在（可能已被删除）');
  const doc = await readPlaylist(f);
  if (patch.name !== undefined) doc.name = cleanPlaylistName(patch.name);
  if (patch.description !== undefined) doc.description = patch.description.trim();
  return writePlaylist(id, doc);
}

export async function deletePlaylist(id: string): Promise<void> {
  const f = getPlaylistFile(id);
  if (!f) throw new Error('歌单文件不存在（可能已被删除）');
  await deleteFile(id);
}
