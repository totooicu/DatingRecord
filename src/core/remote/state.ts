// 远程连接的状态与会话标记。
//
// 从 router.ts 里分出来：这一层只回答两个问题——「现在是什么模式、连着谁」
// 和「刷新后要不要自动回到远程」。它不认识传输层，也不认识快照，
// 所以谁都能安全 import 它，不会跟 router 绕成环。

import type { LinkKind, PeerInfo, RemoteConfig } from './types';

const CLIENT_KEY = 'dr.remote.client';
const HOST_KEY = 'dr.remote.host';

export type RemoteMode = 'local' | 'host' | 'client';

export interface RemoteState {
  mode: RemoteMode;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  /** 展示用地址 host:port，或「直连 · 设备名」 */
  label: string;
  clients: PeerInfo[];
  error: string;
  version: number;
  /** 当前这条连接是走中继还是 WebRTC 直连 */
  transport: LinkKind | null;
}

let state: RemoteState = {
  mode: 'local',
  status: 'idle',
  label: '',
  clients: [],
  error: '',
  version: 0,
  transport: null,
};
const listeners = new Set<() => void>();

/** 改状态并通知订阅者：所有状态变更都走这里，避免有人直接改 state 导致界面不刷新 */
export function publish(patch: Partial<RemoteState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function getRemoteState(): RemoteState {
  return state;
}

export function subscribeRemote(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------- 会话标记 ----------------
//
// 只用 sessionStorage 存「连接到哪」，不存任何业务数据。
// 刷新页面时靠它决定是否自动回到远程；断开时删掉标记即可回到本地。

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 无痕模式可能禁用 sessionStorage：这轮连接仍然可用，只是刷新后不自动恢复 */
  }
}

function clearKey(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function savedClientConfig(): RemoteConfig | null {
  return readJson<RemoteConfig>(CLIENT_KEY);
}

/** 一键地址解析出的连接：写进会话，紧接着 prepareClientBoot() 会照它启动 */
export function saveClientConfig(cfg: RemoteConfig): void {
  writeJson(CLIENT_KEY, cfg);
}

export function savedHostConfig(): RemoteConfig | null {
  return readJson<RemoteConfig>(HOST_KEY);
}

/** 断开时清掉标记：刷新后回到本地，而不是又连回刚才那台 */
export function clearRemoteSession(): void {
  clearKey(CLIENT_KEY);
  clearKey(HOST_KEY);
}

/** 只忘掉客户端那一半：主机还在跑，只是这一端退出了 */
export function forgetClient(): void {
  clearKey(CLIENT_KEY);
}

export function forgetHost(): void {
  clearKey(HOST_KEY);
}

/** 记住这次客户端连接：刷新后 prepareClientBoot() 会照它自动重连 */
export function rememberClient(cfg: RemoteConfig): void {
  writeJson(CLIENT_KEY, cfg);
}

/** 记住这次开的主机会话：刷新后服务能照原样继续跑 */
export function rememberHost(cfg: RemoteConfig): void {
  writeJson(HOST_KEY, cfg);
}
