// 背景音乐的运行时单例（后台服务）。
//
// 原来 <audio> 和播放状态全在 MusicPanel 组件里——离开音乐页组件卸载，歌就停了。
// 现在把音频元素和播放状态挪到这个模块级单例（audio 用 document.createElement 建，
// 不依赖任何 React 组件），MusicPanel 退化为订阅式薄视图：
//   · 离开音乐页歌继续放（真正的后台服务）；
//   · 注册成一条「服务」进 head，运行中常驻图标、点图标跳音乐页；
//   · 支持自启动：开软件自动进入「运行中」并尝试播放，被浏览器拦则标「待播放」。

import { useEffect, useState } from 'react';
import { listFiles, type StoredFile } from '../repo/files';
import { objectUrlFor, forgetUrl } from '../db/blob';
import { getPlaylist, setPlaylist } from '../music/playlist';
import {
  registerService,
  isServiceAutostart,
  setServiceAutostart,
  setServiceDetail,
  setServiceNote,
  setServiceRunning,
} from './store';

export type LoopMode = 'list' | 'one' | 'off';

const SERVICE_ID = 'music';
/** 旧版把自启动开关存在这个 key；现在归 store 统一管，见 initMusicService 的搬迁 */
const LEGACY_AUTOSTART_KEY = 'music-autostart';

export interface MusicState {
  tracks: StoredFile[];
  current: StoredFile | null;
  playing: boolean;
  loop: LoopMode;
  speed: number;
  progress: number;
  duration: number;
  /** 自启动被浏览器拦（无用户手势不允许播放）时的待办说明 */
  pendingPlay: boolean;
}

let state: MusicState = {
  tracks: [],
  current: null,
  playing: false,
  loop: 'list',
  speed: 1,
  progress: 0,
  duration: 0,
  pendingPlay: false,
};
const listeners = new Set<(s: MusicState) => void>();
let audio: HTMLAudioElement | null = null;
let url: string | null = null;
let objectId: string | null = null;

function emit(): void {
  for (const fn of listeners) fn(state);
}
function patch(p: Partial<MusicState>): void {
  state = { ...state, ...p };
  emit();
}

export function subscribe(cb: (s: MusicState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => {
    listeners.delete(cb);
  };
}
export function useMusic(): MusicState {
  const [s, setS] = useState<MusicState>(state);
  useEffect(() => subscribe(setS), []);
  return s;
}
export function getMusicState(): MusicState {
  return state;
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.addEventListener('timeupdate', () => {
      if (audio) patch({ progress: audio.currentTime });
    });
    audio.addEventListener('loadedmetadata', () => {
      if (audio) patch({ duration: audio.duration });
    });
    // 服务运行态由音频事件驱动，不走调用点：播放/暂停/切歌/自动下一首
    // 全都会经过这两个事件，head 图标与服务页状态才不会和实际声音脱节。
    audio.addEventListener('play', () => {
      patch({ playing: true, pendingPlay: false });
      setServiceRunning(SERVICE_ID, true);
      setServiceNote(SERVICE_ID, undefined);
    });
    audio.addEventListener('pause', () => {
      patch({ playing: false });
      // 音乐停了服务也跟着停：head 图标消失、服务页显示已停止。
      // 播完自动下一首也会瞬过一下 pause，随后的 play 会再置回运行中。
      setServiceRunning(SERVICE_ID, false);
    });
    audio.addEventListener('ended', () => next(true));
  }
  return audio;
}

async function loadCurrent(): Promise<void> {
  const cur = state.current;
  if (!cur) {
    if (url) {
      if (objectId) forgetUrl(objectId);
      url = null;
      objectId = null;
    }
    setServiceDetail(SERVICE_ID, undefined);
    patch({ playing: false });
    return;
  }
  const u = await objectUrlFor(cur.id);
  if (!u) {
    patch({ playing: false });
    return;
  }
  if (url && objectId) forgetUrl(objectId);
  url = u;
  objectId = cur.id;
  const a = getAudio();
  a.src = u;
  a.playbackRate = state.speed;
  try {
    await a.play();
    // 运行态由上面的 'play' 事件置上；这里只兜「被浏览器拦了」的情况
    patch({ playing: true, pendingPlay: false });
  } catch {
    // 浏览器禁止无手势播放：保持「运行中」但停在待播放态
    patch({ playing: false, pendingPlay: true });
    setServiceRunning(SERVICE_ID, true, '待播放：点一下恢复');
  }
}

export function playAt(i: number): void {
  const track = state.tracks[i];
  if (!track) return;
  patch({ current: track, progress: 0, pendingPlay: false });
  setServiceDetail(SERVICE_ID, track.name);
  void loadCurrent();
}

export function toggle(): void {
  const a = getAudio();
  if (!state.current) {
    if (state.tracks.length > 0) playAt(0);
    return;
  }
  if (a.paused) {
    a.play().then(
      () => patch({ playing: true, pendingPlay: false }),
      () => patch({ playing: false, pendingPlay: true }),
    );
  } else {
    a.pause();
  }
}

export function next(auto = false): void {
  if (state.tracks.length === 0) return;
  if (state.loop === 'off' && auto) {
    patch({ playing: false });
    return;
  }
  if (state.loop === 'one' && auto) {
    const a = getAudio();
    a.currentTime = 0;
    a.play().catch(() => {});
    return;
  }
  const i = state.current ? state.tracks.findIndex((t) => t.id === state.current!.id) : -1;
  playAt((i + 1) % state.tracks.length);
}

export function prev(): void {
  if (state.tracks.length === 0) return;
  const i = state.current ? state.tracks.findIndex((t) => t.id === state.current!.id) : 0;
  playAt((i - 1 + state.tracks.length) % state.tracks.length);
}

export function seek(v: number): void {
  const a = getAudio();
  if (a && state.duration) {
    a.currentTime = v;
    patch({ progress: v });
  }
}

export function cycleLoop(): void {
  patch({ loop: state.loop === 'list' ? 'one' : state.loop === 'one' ? 'off' : 'list' });
}

export function setSpeed(sp: number): void {
  patch({ speed: sp });
  const a = getAudio();
  if (a) a.playbackRate = sp;
}

export function addTracks(files: StoredFile[]): void {
  const ids = new Set(state.tracks.map((t) => t.id));
  const added = files.filter((f) => !ids.has(f.id));
  if (added.length === 0) return;
  const tracks = [...state.tracks, ...added];
  patch({ tracks });
  setPlaylist(tracks.map((t) => t.id));
}

export function removeTrack(id: string): void {
  if (state.current?.id === id) {
    getAudio().pause();
    setServiceDetail(SERVICE_ID, undefined);
    patch({ current: null, playing: false, progress: 0, duration: 0 });
    void loadCurrent();
  }
  const tracks = state.tracks.filter((t) => t.id !== id);
  patch({ tracks });
  setPlaylist(tracks.map((t) => t.id));
}

export function reorder(i: number, dir: -1 | 1): void {
  const j = i + dir;
  if (j < 0 || j >= state.tracks.length) return;
  const tracks = [...state.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  patch({ tracks });
  setPlaylist(tracks.map((t) => t.id));
}

export function isAutostart(): boolean {
  return isServiceAutostart(SERVICE_ID);
}
export function setAutostart(on: boolean): void {
  // 自启动偏好存进 store 的统一存档（dr.svc.autostart），刷新后由
  // restoreAutostartServices() 兑现；checkbox 的受控状态也靠它翻。
  setServiceAutostart(SERVICE_ID, on);
  if (on) startService();
  else stopService();
}

/** 进入「运行中」并试图播放（自启动或用户手动开启都走这） */
export function startService(): void {
  syncTracks();
  if (state.tracks.length === 0) {
    // 没歌可放：开不了机，保持已停止（否则 head 会挂个空转的服务图标）
    setServiceRunning(SERVICE_ID, false, '还没有可播放的音频');
    return;
  }
  setServiceRunning(SERVICE_ID, true);
  if (!state.current) playAt(0);
  else void loadCurrent();
}

export function stopService(): void {
  getAudio().pause();
  setServiceRunning(SERVICE_ID, false, undefined);
  patch({ playing: false, pendingPlay: false });
  setServiceNote(SERVICE_ID, undefined);
}

/** 把文件库里的歌单同步进单例（文件可能被删/改名） */
export function syncTracks(): void {
  const ids = getPlaylist();
  const all = listFiles();
  const tracks = ids.map((id) => all.find((f) => f.id === id)).filter(Boolean) as StoredFile[];
  const currentStillThere = state.current && tracks.some((t) => t.id === state.current!.id);
  const current = currentStillThere ? state.current : (tracks[0] ?? null);
  setServiceDetail(SERVICE_ID, current?.name);
  patch({ tracks, current });
}

/** 开机初始化：注册服务（自启动与否交给 store 存档，App 统一恢复） */
export function initMusicService(): void {
  // 先把文件库里的歌单同步进单例，音乐页才看得到列表（无论是否自启动）
  syncTracks();
  // 旧版开关搬迁：music-autostart → store 的 dr.svc.autostart，只搬一次
  try {
    const legacy = localStorage.getItem(LEGACY_AUTOSTART_KEY);
    if (legacy !== null) {
      if (legacy === '1') setServiceAutostart(SERVICE_ID, true);
      localStorage.removeItem(LEGACY_AUTOSTART_KEY);
    }
  } catch {
    /* ignore */
  }
  // 交出启动函数：App 加载完毕后调 restoreAutostartServices() 时，
  // 若存档里这条开了自启动，就会调到 startService。
  registerService(
    {
      id: SERVICE_ID,
      kind: 'music',
      title: '背景音乐',
      running: false,
      autostart: isServiceAutostart(SERVICE_ID),
      target: { type: 'settings', key: 'panelMusic' },
    },
    startService,
  );
}
