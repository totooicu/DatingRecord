// 「当前播放队列」的临时存档：只在**没有选中歌单**时使用。
//
// 有歌单时，队列的真相在 .drpl 文件里（见 core/music/playlistFile.ts）；
// 这里保留旧版行为：没有歌单、或用户把歌单「卸下」后，当前队列仍能跨刷新恢复。
//
// 文件库引用数算上歌单：正在播放队列里的文件删除时会提示被引用。

import { listFiles } from '../repo/files';

const KEY = 'dr-music-playlist';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getPlaylist(): string[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (raw === null) {
      // 从没存过歌单（新用户 / 旧版本还没写过这个 key）：
      // 播种成「文件库全部音频」——与 7dc62fb 之前 MusicPanel 的
      // 初始行为一致。落库一次，之后用户删空歌单就是真的空，
      // 不会被再次自动收养。
      const seeded = listFiles()
        .filter((f) => f.mime.startsWith('audio/'))
        .map((f) => f.id);
      setPlaylist(seeded);
      return seeded;
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setPlaylist(ids: string[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

export function isInPlaylist(id: string): boolean {
  return getPlaylist().includes(id);
}
