// 背景音乐的运行时单例（后台服务）。
//
// 原来 <audio> 和播放状态全在 MusicPanel 组件里——离开音乐页组件卸载，歌就停了。
// 现在把音频元素和播放状态挪到这个模块级单例（audio 用 document.createElement 建，
// 不依赖任何 React 组件），MusicPanel 退化为订阅式薄视图：
//   · 离开音乐页歌继续放（真正的后台服务）；
//   · 注册成一条「服务」进 head，运行中常驻图标、点图标跳音乐页；
//   · 支持自启动：开软件自动进入「运行中」并尝试播放，被浏览器拦则标「待播放」。
//
// 歌单（.drpl 文件）是队列的持久化真相：选中歌单后，增删/排序会防抖写回文件；
// 没选歌单时退回旧的 localStorage 临时队列（见 core/music/playlist.ts）。

import { useEffect, useState } from 'react';
import { listFiles, type StoredFile } from '../repo/files';
import { objectUrlFor, forgetUrl } from '../db/blob';
import { getPlaylist, setPlaylist } from '../music/playlist';
import {
  PLAYLIST_MIME,
  resolvePlaylistTracks,
  trackRefOf,
  type PlaylistDoc,
  type PlaylistTrackRef,
} from '../music/format';
import {
  createPlaylist,
  deletePlaylist,
  getActivePlaylistId,
  getPlaylistFile,
  playlistDisplayName,
  readPlaylist,
  setActivePlaylistId,
  updatePlaylistMeta,
  writePlaylist,
} from '../music/playlistFile';
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
/** 歌单编辑写回文件的防抖时间：连续上下移动不会每一格都写一次 */
const SAVE_DELAY = 350;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

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
  /** 当前选中的歌单文件 id；null = 未保存的临时队列 */
  playlistId: string | null;
  /** 歌单显示名（文件名去掉 .drpl） */
  playlistName: string | null;
  /** 歌单里当前找不到文件的条目数（文件被删 / 换设备还没导入） */
  playlistMissing: number;
  /** 队列改动写回歌单文件的状态 */
  saving: SaveState;
  /** 播放失败的原因（格式不支持 / 文件损坏），null = 正常 */
  error: string | null;
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
  playlistId: null,
  playlistName: null,
  playlistMissing: 0,
  saving: 'idle',
  error: null,
};
const listeners = new Set<(s: MusicState) => void>();
let audio: HTMLAudioElement | null = null;
let url: string | null = null;
let objectId: string | null = null;

/** 当前歌单的完整正文（含暂时找不到的条目），保存时以它为底 */
let activeDoc: PlaylistDoc | null = null;
/** 选中歌单的正文正在异步读取：此时别拿旧队列覆盖界面 */
let activeLoading = false;
/** 自启动恰好撞上歌单异步加载：加载完再补播放 */
let pendingStart = false;
/** 连续编辑的写盘串行链，避免旧内容后落把新内容盖掉 */
let saveChain: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 每次改动 +1：写盘回来时发现又改过，就别把状态标成「已保存」 */
let saveRev = 0;
/** 有没有尚未写回的改动：没改过就不做多余的写盘 */
let dirty = false;
let unloadHooked = false;

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
    // iOS / 部分 WebView：没挂进文档的 <audio> 调 play() 会被静默忽略（既不报错也不出声），
    // 之前从阅读页点「播放」没反应就是这个原因。放进 body、缩成 1px 隐藏起来。
    audio.setAttribute('playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    if (typeof document !== 'undefined' && document.body) document.body.appendChild(audio);
    audio.addEventListener('timeupdate', () => {
      if (audio) patch({ progress: audio.currentTime });
    });
    audio.addEventListener('loadedmetadata', () => {
      if (audio) patch({ duration: audio.duration });
    });
    // 服务运行态由音频事件驱动，不走调用点：播放/暂停/切歌/自动下一首
    // 全都会经过这两个事件，head 图标与服务页状态才不会和实际声音脱节。
    audio.addEventListener('play', () => {
      patch({ playing: true, pendingPlay: false, error: null });
      setServiceRunning(SERVICE_ID, true);
      setServiceNote(SERVICE_ID, undefined);
    });
    audio.addEventListener('pause', () => {
      patch({ playing: false });
      // 音乐停了服务也跟着停：head 图标消失、服务页显示已停止。
      // 播完自动下一首也会瞬过一下 pause，随后的 play 会再置回运行中。
      setServiceRunning(SERVICE_ID, false);
    });
    // 解码失败 / 格式不支持：play() 可能一直 reject，只标 pendingPlay 的话
    // 用户会对着「点击播放」点了又点还是没声。这里留下一条明确的原因。
    audio.addEventListener('error', () => {
      const name = state.current?.name;
      const msg = name ? `「${name}」放不了：文件损坏或格式不被浏览器支持` : '音频加载失败';
      patch({ playing: false, error: msg });
      setServiceRunning(SERVICE_ID, false);
      setServiceNote(SERVICE_ID, '播放失败：格式可能不支持');
    });
    audio.addEventListener('ended', () => next(true));
  }
  return audio;
}

/**
 * 加载当前曲目的二进制。
 * autoPlay=false 只准备 src（切换歌单时用），不触发播放，等服务/播放键发令。
 */
async function loadCurrent(autoPlay = true): Promise<void> {
  const cur = state.current;
  if (!cur) {
    if (url) {
      if (objectId) forgetUrl(objectId);
      url = null;
      objectId = null;
    }
    setServiceDetail(SERVICE_ID, undefined);
    patch({ playing: false, progress: 0, duration: 0 });
    return;
  }
  const u = await objectUrlFor(cur.id);
  if (!u) {
    patch({ playing: false, error: `「${cur.name}」的文件不在本机（可能还没同步过来）` });
    return;
  }
  if (url && objectId) forgetUrl(objectId);
  url = u;
  objectId = cur.id;
  const a = getAudio();
  a.src = u;
  a.playbackRate = state.speed;
  patch({ error: null });
  if (!autoPlay) {
    patch({ progress: 0, duration: 0, pendingPlay: false });
    return;
  }
  try {
    await a.play();
    // 运行态由上面的 'play' 事件置上；这里只兜「被浏览器拦了」的情况
    patch({ playing: true, pendingPlay: false });
  } catch (e) {
    markPlayFailure(e, cur.name);
  }
}

/**
 * play() 失败分两种：被浏览器拦（NotAllowedError，点一下就好）和真放不了
 * （格式不支持 / 文件损坏）。后者再标成「待播放」就会让用户对着按钮点个不停。
 */
function markPlayFailure(e: unknown, name?: string): void {
  if (e instanceof Error && e.name === 'NotAllowedError') {
    patch({ playing: false, pendingPlay: true });
    setServiceRunning(SERVICE_ID, true, '待播放：点一下恢复');
    return;
  }
  patch({
    playing: false,
    pendingPlay: false,
    error: name ? `「${name}」放不了：浏览器可能不支持这种音频格式` : '音频播放失败',
  });
  setServiceRunning(SERVICE_ID, false);
  setServiceNote(SERVICE_ID, '播放失败：格式可能不支持');
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
    // 切换歌单后 src 已经准备好；没有 src 时先按当前曲目加载
    if (!a.src) {
      void loadCurrent();
      return;
    }
    a.play().then(
      () => patch({ playing: true, pendingPlay: false }),
      (e) => markPlayFailure(e, state.current?.name),
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

// ---------------- 队列持久化 ----------------

/**
 * 队列变了：选中歌单时更新内存里的歌单正文并防抖写文件；
 * 没选歌单时退回 localStorage 临时队列。
 */
function persistQueue(): void {
  const ids = state.tracks.map((t) => t.id);
  if (!state.playlistId || !activeDoc) {
    setPlaylist(ids);
    return;
  }
  activeDoc = { ...activeDoc, tracks: state.tracks.map(trackRefOf) };
  saveRev += 1;
  dirty = true;
  patch({ saving: 'saving' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPlaylistSave();
  }, SAVE_DELAY);
}

/** 立刻把待写内容落盘（切换/删除歌单、离开页面前调用） */
export function flushPlaylistSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const id = state.playlistId;
  const doc = activeDoc;
  const rev = saveRev;
  if (!id || !doc || !dirty) return saveChain;
  // 快照一份：后续编辑只改 activeDoc，不污染这次写盘
  const snapshot: PlaylistDoc = { ...doc, tracks: [...doc.tracks] };
  dirty = false;
  saveChain = saveChain.then(async () => {
    try {
      if (!getPlaylistFile(id)) throw new Error('歌单文件不存在');
      await writePlaylist(id, snapshot);
      if (state.playlistId === id && saveRev === rev) patch({ saving: 'saved' });
    } catch {
      if (state.playlistId === id) {
        dirty = true;
        patch({ saving: 'error' });
      }
    }
  });
  return saveChain;
}

/** 当前歌单正文（只读副本）；没有选中歌单时为 null */
export function getActivePlaylistDoc(): PlaylistDoc | null {
  return activeDoc ? { ...activeDoc, tracks: [...activeDoc.tracks] } : null;
}

// ---------------- 歌单操作 ----------------

/**
 * 读取并切换到某个歌单。
 * play=true 时立刻从头播放（预览弹窗里的「播放这个歌单」）。
 */
export async function openPlaylist(id: string, opts: { play?: boolean } = {}): Promise<void> {
  await flushPlaylistSave();
  const f = getPlaylistFile(id);
  if (!f) throw new Error('歌单文件不存在（可能已被删除）');
  activeLoading = true;
  patch({ playlistId: id, saving: 'idle' });
  try {
    const doc = await readPlaylist(f);
    activeDoc = doc;
    dirty = false;
    setActivePlaylistId(id);
    const { tracks, missing } = resolvePlaylistTracks(doc, listFiles());
    if (state.playing) getAudio().pause();
    const current = tracks[0] ?? null;
    patch({
      playlistId: id,
      playlistName: playlistDisplayName(f) || doc.name,
      playlistMissing: missing.length,
      tracks,
      current,
      progress: 0,
      duration: 0,
      pendingPlay: false,
      saving: 'idle',
      error: null,
    });
    setServiceDetail(SERVICE_ID, current?.name);
    if (opts.play && current) playAt(0);
    else if (current) void loadCurrent(false);
    else void loadCurrent();
  } catch (err) {
    activeDoc = null;
    setActivePlaylistId(null);
    patch({ playlistId: null, playlistName: null, playlistMissing: 0, saving: 'idle' });
    throw err;
  } finally {
    activeLoading = false;
  }
  maybeResumePendingStart();
}

/** 卸下歌单：当前队列保留成临时队列（不删文件） */
export async function detachPlaylist(): Promise<void> {
  if (!state.playlistId) return;
  await flushPlaylistSave();
  activeDoc = null;
  dirty = false;
  setActivePlaylistId(null);
  patch({ playlistId: null, playlistName: null, playlistMissing: 0, saving: 'idle', error: null });
  setPlaylist(state.tracks.map((t) => t.id));
}

/** 新建歌单并选中它；withTracks=true 时把当前队列一起存进去 */
export async function saveQueueAsPlaylist(
  name: string,
  description = '',
  withTracks = true,
): Promise<StoredFile> {
  await flushPlaylistSave();
  const file = await createPlaylist({
    name,
    description,
    tracks: withTracks ? state.tracks : [],
  });
  await openPlaylist(file.id);
  return file;
}

/** 改名 / 改描述；文件名同步改，正文里的 tracks 不受影响 */
export async function renameActivePlaylist(name: string, description = ''): Promise<void> {
  const id = state.playlistId;
  if (!id) throw new Error('当前没有选中歌单');
  await flushPlaylistSave();
  const f = await updatePlaylistMeta(id, { name, description });
  const doc = await readPlaylist(f);
  activeDoc = doc;
  dirty = false;
  patch({ playlistName: playlistDisplayName(f) || doc.name });
}

/** 删除当前歌单文件；歌继续按当前队列放，队列变成未保存的临时队列 */
export async function deleteActivePlaylist(): Promise<void> {
  const id = state.playlistId;
  if (!id) return;
  await flushPlaylistSave();
  activeDoc = null;
  dirty = false;
  setActivePlaylistId(null);
  await deletePlaylist(id);
  patch({ playlistId: null, playlistName: null, playlistMissing: 0, saving: 'idle' });
  setPlaylist(state.tracks.map((t) => t.id));
}

/** 开机时恢复上次选中的歌单；失败就退回临时队列 */
async function restoreActivePlaylist(id: string): Promise<void> {
  const f = getPlaylistFile(id);
  if (!f) {
    setActivePlaylistId(null);
    dirty = false;
    patch({ playlistId: null, playlistName: null, playlistMissing: 0 });
    syncTracks();
    return;
  }
  activeLoading = true;
  patch({ playlistId: id });
  try {
    const doc = await readPlaylist(f);
    activeDoc = doc;
    dirty = false;
    const { tracks, missing } = resolvePlaylistTracks(doc, listFiles());
    const current = state.current && tracks.some((t) => t.id === state.current!.id)
      ? state.current
      : tracks[0] ?? null;
    patch({
      playlistId: id,
      playlistName: playlistDisplayName(f) || doc.name,
      playlistMissing: missing.length,
      tracks,
      current,
      progress: 0,
      duration: 0,
    });
    setServiceDetail(SERVICE_ID, current?.name);
    if (current) void loadCurrent(false);
    else void loadCurrent();
    maybeResumePendingStart();
  } catch {
    activeDoc = null;
    dirty = false;
    setActivePlaylistId(null);
    patch({ playlistId: null, playlistName: null, playlistMissing: 0 });
    syncTracks();
  } finally {
    activeLoading = false;
  }
}

function maybeResumePendingStart(): void {
  if (!pendingStart) return;
  pendingStart = false;
  if (state.tracks.length === 0) {
    setServiceRunning(SERVICE_ID, false, '还没有可播放的音频');
    return;
  }
  setServiceRunning(SERVICE_ID, true);
  const i = state.current ? state.tracks.findIndex((t) => t.id === state.current!.id) : 0;
  playAt(i >= 0 ? i : 0);
}

// ---------------- 曲目增删改 ----------------

export function addTracks(files: StoredFile[]): void {
  const ids = new Set(state.tracks.map((t) => t.id));
  const added = files.filter((f) => !ids.has(f.id));
  if (added.length === 0) return;
  const tracks = [...state.tracks, ...added];
  patch({ tracks });
  persistQueue();
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
  persistQueue();
}

export function reorder(i: number, dir: -1 | 1): void {
  const j = i + dir;
  if (j < 0 || j >= state.tracks.length) return;
  const tracks = [...state.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  patch({ tracks });
  persistQueue();
}

// ---------------- 服务 ----------------

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
  // 歌单还在异步读取：先记下来，读完后补播，别误报「没有音频」
  if (state.playlistId && activeLoading && !activeDoc) {
    pendingStart = true;
    setServiceRunning(SERVICE_ID, true);
    return;
  }
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
  pendingStart = false;
  getAudio().pause();
  setServiceRunning(SERVICE_ID, false, undefined);
  patch({ playing: false, pendingPlay: false });
  setServiceNote(SERVICE_ID, undefined);
}

/** 把文件库里的歌单/队列同步进单例（文件可能被删/改名） */
export function syncTracks(): void {
  if (state.playlistId) {
    const f = getPlaylistFile(state.playlistId);
    if (f) {
      if (!activeDoc) {
        // 正文还在异步加载：保持空白，别用旧队列冒充这个歌单
        if (!activeLoading) void restoreActivePlaylist(f.id);
        return;
      }
      const name = playlistDisplayName(f) || activeDoc.name;
      if (activeDoc.name !== name) activeDoc = { ...activeDoc, name };
      const { tracks, missing } = resolvePlaylistTracks(activeDoc, listFiles());
      const currentStillThere = state.current && tracks.some((t) => t.id === state.current!.id);
      const current = currentStillThere ? state.current : tracks[0] ?? null;
      const changed = current?.id !== state.current?.id;
      setServiceDetail(SERVICE_ID, current?.name);
      patch({ tracks, current, playlistName: name, playlistMissing: missing.length });
      if (changed && !state.playing) {
        if (current) void loadCurrent(false);
        else void loadCurrent();
      }
      return;
    }
    // 歌单文件被外部删了：卸下它，退回临时队列
    activeDoc = null;
    dirty = false;
    setActivePlaylistId(null);
    patch({ playlistId: null, playlistName: null, playlistMissing: 0, saving: 'idle' });
  }

  const ids = getPlaylist();
  const all = listFiles();
  const tracks = ids.map((id) => all.find((f) => f.id === id)).filter(Boolean) as StoredFile[];
  const currentStillThere = state.current && tracks.some((t) => t.id === state.current!.id);
  const current = currentStillThere ? state.current : (tracks[0] ?? null);
  const changed = current?.id !== state.current?.id;
  setServiceDetail(SERVICE_ID, current?.name);
  patch({ tracks, current });
  if (changed && !state.playing) {
    if (current) void loadCurrent(false);
    else void loadCurrent();
  }
}

/** 页面要走了：把防抖里还没写的改动赶紧落盘一次 */
function hookUnloadFlush(): void {
  if (unloadHooked || typeof window === 'undefined') return;
  unloadHooked = true;
  window.addEventListener('pagehide', () => {
    void flushPlaylistSave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPlaylistSave();
  });
}

/** 开机初始化：注册服务（自启动与否交给 store 存档，App 统一恢复） */
export function initMusicService(): void {
  hookUnloadFlush();
  // 上次选中的歌单异步读正文；没选歌单就按旧版从 localStorage 临时队列同步
  const activeId = getActivePlaylistId();
  if (activeId) {
    patch({ playlistId: activeId });
    activeLoading = true;
    void restoreActivePlaylist(activeId).finally(() => {
      activeLoading = false;
    });
  } else {
    syncTracks();
  }
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

// 歌单格式常量在本模块的对外出口，方便 UI 判断 accept 类型
export { PLAYLIST_MIME };
export type { PlaylistDoc, PlaylistTrackRef };
