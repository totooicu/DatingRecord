// 背景音乐歌单：持久化在 localStorage。
//
// 歌单不是数据库对象——它是「当前选了哪些文件来当背景音乐」的视图，
// 文件本身还在文件库里。这里只存 id 顺序，文件的增删改不影响歌单（
// 文件被删了，歌单里对应 id 自然失效，播放时跳过即可）。
//
// 文件库引用数算上歌单：正在歌单里的文件删除时会提示被引用。

const KEY = 'dr-music-playlist';

export function getPlaylist(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setPlaylist(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch { /* 隐私模式写不进就算了 */ }
}

export function isInPlaylist(id: string): boolean {
  return getPlaylist().includes(id);
}
