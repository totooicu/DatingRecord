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
import { registerService, setServiceNote, setServiceRunning } from './store';

export type LoopMode = 'list' | 'one' | 'off';

const SERVICE_ID = 'music';
const AUTOSTART_KEY = 'music-autostart';

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
    audio.addEventListener('ended', () => next(true));
    audio.addEventListener('play', () => patch({ playing: true }));
    audio.addEventListener('pause', () => patch({ playing: false }));
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
    patch({ playing: true, pendingPlay: false });
  } catch {
    // 浏览器禁止无手势播放：保持「运行中」但停在待播放态
    patch({ playing: false, pendingPlay: true });
    setServiceNote(SERVICE_ID, '待播放：点一下恢复');
  }
}

export function playAt(i: number): void {
  const track = state.tracks[i];
  if (!track) return;
  patch({ current: track, progress: 0, pendingPlay: false });
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
  return localStorage.getItem(AUTOSTART_KEY) === '1';
}
export function setAutostart(on: boolean): void {
  localStorage.setItem(AUTOSTART_KEY, on ? '1' : '0');
  // 同步 store 里这条服务的 autostart 字段：受控的开关要靠它来翻状态，
  // 否则 React 重渲染会把 checkbox 改回原样（点上去「状态没变」）。
  setServiceAutostart(SERVICE_ID, on);
  if (on) startService();
  else stopService();
}

/** 进入「运行中」并试图播放（自启动或用户手动开启都走这） */
export function startService(): void {
  syncTracks();
  setServiceRunning(SERVICE_ID, true);
  if (!state.current && state.tracks.length > 0) playAt(0);
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
  patch({ tracks, current: currentStillThere ? state.current : (tracks[0] ?? null) });
}

/** 开机初始化：注册服务 + 自启动 */
export function initMusicService(): void {
  // 先把文件库里的歌单同步进单例，音乐页才看得到列表（无论是否自启动）
  syncTracks();
  registerService({
    id: SERVICE_ID,
    kind: 'music',
    title: '背景音乐',
    running: false,
    autostart: isAutostart(),
    target: { type: 'settings', key: 'panelMusic' },
  });
  if (isAutostart()) startService();
}
