// 歌单（.drpl 文件）相关工具。
//
// 与网页 UI 共用 core/music/playlistFile 的同一套实现：CLI / AI 建出来的歌单
// 同样躺在文件库里，能被筛选、预览、备份，不需要另走一条存储。

import type { ToolDef } from './types';
import { getFile, listFiles, type StoredFile } from '../repo/files';
import {
  createPlaylist,
  deletePlaylist,
  importPlaylistText,
  listPlaylists,
  playlistDisplayName,
  readPlaylist,
  writePlaylist,
} from '../music/playlistFile';
import {
  resolvePlaylistTracks,
  trackRefOf,
  type PlaylistDoc,
} from '../music/format';

const AUDIO_NAME = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;

function assertAudio(f: StoredFile): void {
  if (!f.mime.startsWith('audio/') && !AUDIO_NAME.test(f.name)) {
    throw new Error(`不是音频文件：${f.name}（${f.mime || '未知类型'}）`);
  }
}

/** 参数里的 trackIds → 附件；任何一个不存在 / 不是音频都整笔拒绝，避免歌单半残 */
function filesOf(ids: unknown): StoredFile[] {
  if (!Array.isArray(ids)) return [];
  const out: StoredFile[] = [];
  for (const raw of ids) {
    const id = String(raw);
    const f = getFile(id);
    if (!f) throw new Error(`附件不存在：${id}`);
    assertAudio(f);
    out.push(f);
  }
  return out;
}

function briefDoc(doc: PlaylistDoc) {
  const { tracks, missing } = resolvePlaylistTracks(doc, listFiles());
  return {
    name: doc.name,
    description: doc.description,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    tracks: tracks.map((t) => ({ id: t.id, storedId: t.storedId, name: t.name })),
    missing: missing.map((t) => ({ name: t.name, storedId: t.storedId })),
  };
}

export const PLAYLIST_TOOLS: ToolDef[] = [
  {
    name: 'playlist.list',
    group: 'playlist',
    title: '列出歌单',
    desc: '文件库里的全部 .drpl 歌单：名称、描述、曲目数、缺失数',
    mutating: false,
    params: [],
    run: async () =>
      Promise.all(
        listPlaylists().map(async (f) => {
          try {
            const doc = await readPlaylist(f);
            return {
              id: f.id,
              name: playlistDisplayName(f),
              description: doc.description,
              updatedAt: doc.updatedAt,
              tracks: doc.tracks.length,
              missing: resolvePlaylistTracks(doc, listFiles()).missing.length,
            };
          } catch (e) {
            return { id: f.id, name: playlistDisplayName(f), error: e instanceof Error ? e.message : String(e) };
          }
        }),
      ),
  },
  {
    name: 'playlist.get',
    group: 'playlist',
    title: '歌单详情',
    desc: '读取歌单文件名、描述与曲目；找不到的文件列在 missing 里',
    mutating: false,
    params: [{ name: 'id', type: 'string', desc: '歌单文件 id（f 开头）', required: true }],
    run: async (a) => {
      const f = getFile(a.id as string);
      if (!f) throw new Error(`歌单不存在：${a.id}`);
      const doc = await readPlaylist(f);
      return { id: f.id, storedId: f.storedId, fileName: f.name, ...briefDoc(doc) };
    },
  },
  {
    name: 'playlist.create',
    group: 'playlist',
    title: '新建歌单',
    desc: `在文件库创建 .drpl 歌单；可用 trackIds 指定初始曲目（附件 id 数组）`,
    mutating: true,
    params: [
      { name: 'name', type: 'string', desc: '歌单名（不必带 .drpl）', required: true },
      { name: 'description', type: 'string', desc: '描述，可选' },
      { name: 'trackIds', type: 'array', desc: '初始曲目的附件 id 数组；省略=空歌单' },
    ],
    run: async (a) => {
      const f = await createPlaylist({
        name: a.name as string,
        description: (a.description as string) ?? '',
        tracks: filesOf(a.trackIds),
      });
      return { id: f.id, storedId: f.storedId, fileName: f.name, ...briefDoc(await readPlaylist(f)) };
    },
  },
  {
    name: 'playlist.save',
    group: 'playlist',
    title: '保存歌单',
    desc: '改名 / 改描述 / 整表替换曲目（trackIds 给出时按该顺序覆盖；省略则保持原曲目）',
    mutating: true,
    params: [
      { name: 'id', type: 'string', desc: '歌单文件 id', required: true },
      { name: 'name', type: 'string', desc: '新名称；省略不改' },
      { name: 'description', type: 'string', desc: '新描述；省略不改' },
      { name: 'trackIds', type: 'array', desc: '新的曲目附件 id 数组（整表替换）' },
    ],
    run: async (a) => {
      const f = getFile(a.id as string);
      if (!f) throw new Error(`歌单不存在：${a.id}`);
      const doc = await readPlaylist(f);
      if (a.name !== undefined) doc.name = String(a.name);
      if (a.description !== undefined) doc.description = String(a.description);
      if (a.trackIds !== undefined) doc.tracks = filesOf(a.trackIds).map(trackRefOf);
      const saved = await writePlaylist(f.id, doc);
      return { id: saved.id, storedId: saved.storedId, fileName: saved.name, ...briefDoc(await readPlaylist(saved)) };
    },
  },
  {
    name: 'playlist.import',
    group: 'playlist',
    title: '导入歌单',
    desc: '把一段歌单 JSON（dr.playlist）保存为文件库里的 .drpl；曲目按 storedId 在导入后重新对应',
    mutating: true,
    params: [
      { name: 'text', type: 'string', desc: '歌单 JSON 正文', required: true },
      { name: 'name', type: 'string', desc: '来源文件名，用于兜底命名' },
    ],
    run: async (a) => {
      const f = await importPlaylistText(a.text as string, (a.name as string) || '导入的歌单.drpl');
      return { id: f.id, storedId: f.storedId, fileName: f.name, ...briefDoc(await readPlaylist(f)) };
    },
  },
  {
    name: 'playlist.delete',
    group: 'playlist',
    title: '删除歌单',
    desc: '删除 .drpl 文件（硬删除；曲目文件本身不受影响）',
    mutating: true,
    params: [{ name: 'id', type: 'string', desc: '歌单文件 id', required: true }],
    run: async (a) => {
      const f = getFile(a.id as string);
      if (!f) throw new Error(`歌单不存在：${a.id}`);
      await deletePlaylist(f.id);
      return { ok: true, id: f.id, name: f.name };
    },
  },
];
