// 数据选择路由器。
//
// 需求原话：网页程序里要有一个数据路由器，按当前情况决定数据去哪个库。
// 本项目的所有读写最终都落到 core/db 的「当前实例」，所以路由器只换三样东西：
//
//   ① 当前 Database 实例（本地 ↔ 服务端快照）
//   ② 落盘后端（IndexedDB ↔ 发回服务端）
//   ③ 附件二进制来源（IndexedDB ↔ 向服务端要，只在内存里缓存）
//
// 客户端换库后**绝不写 IndexedDB**：断开连接直接 reload，本地数据原样还在。
// 服务端（host）保留本地落盘，收到客户端的整库快照就替换当前实例并落盘，
// 再把新快照广播给其余客户端——所有来源最终都汇到服务端这一份权威数据上。

import type { Database } from 'sql.js';
import { getDbInstance, resetUndo, setPersistSink, onPersisted, flushPersist } from '../db';
import { getSql, setDbInstance } from '../db/state';
import {
  setBlobStore,
  getBlob,
  putBlob,
  delBlob,
  clearBlobs,
  blobToBase64,
  base64ToBlob,
  forgetUrl,
} from '../db/blob';
import { getDeviceId } from '../db/device';
import { bump } from '../../store';
import { RemoteTransport } from './transport';
import { parseRemoteAddress } from './url';
import type { ClientMessage, PeerInfo, RemoteConfig, RemotePayload } from './types';

const CLIENT_KEY = 'dr.remote.client';
const HOST_KEY = 'dr.remote.host';

export type RemoteMode = 'local' | 'host' | 'client';

export interface RemoteState {
  mode: RemoteMode;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  /** 展示用地址 host:port */
  label: string;
  clients: PeerInfo[];
  error: string;
  version: number;
}

let state: RemoteState = { mode: 'local', status: 'idle', label: '', clients: [], error: '', version: 0 };
const listeners = new Set<() => void>();

function publish(patch: Partial<RemoteState>): void {
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

export function savedHostConfig(): RemoteConfig | null {
  return readJson<RemoteConfig>(HOST_KEY);
}

// ---------------- 快照编解码 ----------------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function exportDb(): string {
  const db = getDbInstance();
  if (!db) throw new Error('数据库尚未初始化');
  return toBase64(new Uint8Array(db.export()));
}

function replaceDb(b64: string): void {
  const sql = getSql();
  if (!sql) throw new Error('数据库引擎尚未就绪');
  const bytes = fromBase64(b64);
  const next: Database = new sql.Database(bytes);
  next.run('PRAGMA foreign_keys = ON');
  const old = getDbInstance();
  setDbInstance(next);
  // 撤销栈保存的是旧实例的整库字节，换库后必须清掉
  resetUndo();
  old?.close();
  bump();
}

// ---------------- 客户端附件代理 ----------------
//
// 客户端不能把服务端附件写进本地 IndexedDB，所以只在内存里缓存 Blob；
// 真正读写都通过消息发给服务端。objectUrlFor 会复用这里的缓存。

type PendingBlob = { resolve: (v: string | null) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, PendingBlob>();
const blobCache = new Map<string, Blob>();
let reqSeq = 0;

function requestBlob(id: string, timeoutMs = 15000): Promise<string | null> {
  return new Promise((resolve) => {
    const reqId = `b${Date.now().toString(36)}-${(reqSeq += 1)}`;
    const timer = setTimeout(() => {
      pending.delete(reqId);
      resolve(null);
    }, timeoutMs);
    pending.set(reqId, { resolve, timer });
    try {
      clientSend({ k: 'blob-get', reqId, id });
    } catch {
      clearTimeout(timer);
      pending.delete(reqId);
      resolve(null);
    }
  });
}

const remoteBlobStore = {
  async get(id: string): Promise<Blob | null> {
    const hit = blobCache.get(id);
    if (hit) return hit;
    const data = await requestBlob(id);
    if (!data) return null;
    const blob = base64ToBlob(data);
    blobCache.set(id, blob);
    return blob;
  },
  async put(id: string, blob: Blob): Promise<void> {
    blobCache.set(id, blob);
    const data = await blobToBase64(blob);
    clientSend({ k: 'blob-put', id, data });
  },
  async del(id: string): Promise<void> {
    blobCache.delete(id);
    forgetUrl(id);
    clientSend({ k: 'blob-del', id });
  },
  async clear(): Promise<void> {
    blobCache.clear();
    clientSend({ k: 'blob-clear' });
  },
};

// ---------------- 客户端 ----------------

let clientTransport: RemoteTransport | null = null;
let clientVersion = 0;
let clientConnected = false;

function clientSend(msg: ClientMessage): void {
  if (!clientTransport) throw new Error('尚未连接到服务端');
  clientTransport.send(msg);
}

/**
 * 客户端启动前调用：先堵住本地落盘。
 *
 * initDb 的迁移/种子数据会 markDirty，如果等拿到远程快照再换 sink，
 * 那 500ms 的定时器可能已经把本地库写回 IndexedDB 了——虽然数据没变，
 * 但「远程模式不写本地」这条约束就破了。
 */
export function prepareClientBoot(): RemoteConfig | null {
  const cfg = savedClientConfig();
  if (!cfg) return null;
  setPersistSink(async () => {
    /* 远程模式：本地落盘一律丢弃 */
  });
  return cfg;
}

/** 客户端启动：连上服务端、拿快照换库，成功后才允许渲染业务界面 */
export async function bootClient(cfg: RemoteConfig, onProgress?: (msg: string) => void): Promise<void> {
  publish({ mode: 'client', status: 'connecting', label: cfg.label, error: '', clients: [] });
  onProgress?.('正在连接服务端…');
  let firstSnapshot: { version: number; db: string } | null = null;
  const transport = new RemoteTransport(cfg.url, cfg.token, 'client', deviceName(), {
    onMessage(msg) {
      if (msg.k === 'snapshot') {
        const wasConnected = clientConnected;
        clientVersion = msg.version;
        replaceDb(msg.db);
        if (!wasConnected) {
          clientConnected = true;
          installClientRouting(transport);
          publish({ status: 'connected', version: msg.version });
        } else {
          publish({ version: msg.version });
        }
        firstSnapshot = firstSnapshot ?? { version: msg.version, db: msg.db };
      } else if (msg.k === 'blob') {
        const p = pending.get(msg.reqId);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(msg.reqId);
          p.resolve(msg.data);
        }
      } else if (msg.k === 'error') {
        publish({ status: 'error', error: msg.error });
      }
    },
    onClose() {
      // 服务端断开：按需求回到自己的数据（本地库从未被覆盖）
      leaveRemoteAndReload('服务端已断开，已切回本地数据');
    },
  });
  clientTransport = transport;
  try {
    await transport.connect();
    onProgress?.('正在读取服务端数据…');
    transport.send({ k: 'request-snapshot' });
    // 等第一份快照；超时说明服务端在线但没响应
    const started = Date.now();
    while (!firstSnapshot) {
      if (transport.closed) throw new Error('连接已断开');
      if (Date.now() - started > 15000) throw new Error('服务端没有返回数据（服务端页面可能已关闭）');
      await new Promise((r) => setTimeout(r, 80));
    }
  } catch (err) {
    transport.close();
    clientTransport = null;
    setPersistSink(null);
    setBlobStore(null);
    clearKey(CLIENT_KEY);
    const msg = err instanceof Error ? err.message : String(err);
    publish({ mode: 'local', status: 'error', label: '', error: `连接失败：${msg}` });
    throw err;
  }
  writeJson(CLIENT_KEY, cfg);
}

/** 客户端接管落盘与附件：此后再也不碰本地 IndexedDB */
function installClientRouting(transport: RemoteTransport): void {
  setPersistSink(async (bytes) => {
    try {
      transport.send({ k: 'apply', baseVersion: clientVersion, db: toBase64(bytes) });
    } catch {
      publish({ status: 'error', error: '发送失败：连接已断开' });
    }
  });
  setBlobStore(remoteBlobStore);
}

/** 断开并 reload：本地库一直在盘上，重载后就是自己的数据 */
export function leaveRemoteAndReload(tip?: string): void {
  clearKey(CLIENT_KEY);
  clearKey(HOST_KEY);
  if (tip) {
    try {
      sessionStorage.setItem('dr.remote.tip', tip);
    } catch {
      /* ignore */
    }
  }
  try {
    clientTransport?.close();
  } catch {
    /* ignore */
  }
  clientTransport = null;
  if (typeof location !== 'undefined') location.reload();
}

export function takeRemoteTip(): string {
  try {
    const t = sessionStorage.getItem('dr.remote.tip') ?? '';
    sessionStorage.removeItem('dr.remote.tip');
    return t;
  } catch {
    return '';
  }
}

// ---------------- 服务端 ----------------

let hostTransport: RemoteTransport | null = null;
let hostVersion = 1;
let stopHostObserver: (() => void) | null = null;

function broadcastSnapshot(reason: 'init' | 'update' | 'conflict' = 'update', to?: string): void {
  if (!hostTransport) return;
  const msg = { k: 'snapshot' as const, version: hostVersion, db: exportDb(), reason };
  if (to) hostTransport.sendTo(to, msg);
  else hostTransport.broadcast(msg);
  publish({ version: hostVersion });
}

export async function startHost(cfg: RemoteConfig): Promise<void> {
  if (hostTransport) return;
  publish({ mode: 'host', status: 'connecting', label: cfg.label, error: '', clients: [] });
  const transport = new RemoteTransport(cfg.url, cfg.token, 'host', deviceName(), {
    onMessage(msg, from) {
      void handleClientMessage(msg, from);
    },
    onPeer(ev, peer) {
      if (ev === 'join') {
        publish({ clients: [...(hostTransport?.clients ?? [])] });
        // 新客户端一进来就给一份快照，不必等它再问
        try {
          broadcastSnapshot('init', peer.id);
        } catch {
          /* 导出失败（库没初始化）时交给客户端自己重试 */
        }
      } else {
        publish({ clients: [...(hostTransport?.clients ?? [])] });
      }
    },
    onClose() {
      teardownHost();
      publish({
        mode: 'local',
        status: 'error',
        label: '',
        clients: [],
        error: '服务端连接已断开：客户端将看不到数据，本机数据不受影响',
      });
    },
  });
  hostTransport = transport;
  try {
    await transport.connect();
  } catch (err) {
    hostTransport = null;
    transport.close();
    const msg = err instanceof Error ? err.message : String(err);
    publish({ mode: 'local', status: 'error', label: '', error: `开启失败：${msg}` });
    throw err;
  }
  hostVersion = Math.max(1, hostVersion);
  // 服务端自己的每一次写入也推给客户端，客户端才能跟着更新
  stopHostObserver = onPersisted(() => {
    hostVersion += 1;
    try {
      broadcastSnapshot('update');
    } catch {
      /* 导出失败不阻塞落盘 */
    }
  });
  writeJson(HOST_KEY, cfg);
  publish({
    mode: 'host',
    status: 'connected',
    label: cfg.label,
    clients: [...transport.clients],
    error: '',
    version: hostVersion,
  });
}

async function handleClientMessage(msg: RemotePayload, from: string): Promise<void> {
  if (!hostTransport) return;
  const transport = hostTransport;
  switch (msg.k) {
    case 'request-snapshot':
      try {
        broadcastSnapshot('init', from);
      } catch (e) {
        transport.sendTo(from, { k: 'error', error: e instanceof Error ? e.message : String(e) });
      }
      return;
    case 'apply': {
      if (msg.baseVersion !== hostVersion) {
        // 别人先写过了：把最新快照发回去，客户端据此刷新（本次改动不会覆盖别人）
        try {
          broadcastSnapshot('conflict', from);
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        hostVersion += 1;
        replaceDb(msg.db);
        // 落盘并让观察者广播最新快照；replaceDb 已 bump，界面会重新查询
        flushPersist();
      } catch (e) {
        transport.sendTo(from, { k: 'error', error: `写入失败：${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    case 'blob-get': {
      try {
        const blob = await getBlob(msg.id);
        transport.sendTo(from, { k: 'blob', reqId: msg.reqId, data: blob ? await blobToBase64(blob) : null });
      } catch {
        transport.sendTo(from, { k: 'blob', reqId: msg.reqId, data: null });
      }
      return;
    }
    case 'blob-put':
      try {
        await putBlob(msg.id, base64ToBlob(msg.data));
      } catch {
        /* 附件写入失败不影响库本身 */
      }
      return;
    case 'blob-del':
      await delBlob(msg.id).catch(() => undefined);
      return;
    case 'blob-clear':
      await clearBlobs().catch(() => undefined);
      return;
    default:
      return;
  }
}

export function stopHost(reload = false): void {
  teardownHost();
  clearKey(HOST_KEY);
  publish({ mode: 'local', status: 'idle', label: '', clients: [], error: '' });
  if (reload) location.reload();
}

function teardownHost(): void {
  stopHostObserver?.();
  stopHostObserver = null;
  try {
    hostTransport?.close();
  } catch {
    /* ignore */
  }
  hostTransport = null;
}

// ---------------- 中继控制 ----------------
//
// 中继进程如果同时托管了这个页面，就能通过同源接口再开一个端口；
// 纯静态托管（GitHub Pages）没有这个接口，页面只能连已启动的中继。

export interface RelayInfo {
  ok: boolean;
  port?: number;
  hostOnline?: boolean;
  clients?: number;
}

export async function relayInfo(): Promise<RelayInfo | null> {
  try {
    const res = await fetch('/__remote/info', { cache: 'no-store' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    const data = (await res.json()) as RelayInfo;
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

/** 让同源中继在指定端口上再开一个监听；不是中继托管时返回 false */
export async function ensureRelayListener(port: number, token: string): Promise<boolean> {
  const info = await relayInfo();
  if (!info) return false;
  try {
    // 同端口也要 POST：页面上的 token 可能刚换过，中继要跟着更新；
    // 不同端口则让中继再开一个监听。
    const res = await fetch('/__remote/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, token }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error || '中继拒绝开启端口');
    return true;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ---------------- 工具函数 ----------------

function deviceName(): string {
  try {
    return `设备 ${getDeviceId().slice(-6)}`;
  } catch {
    return '未命名设备';
  }
}

/** 连接前先探一下：只建连不换库，避免把坏地址写进 sessionStorage 再刷新 */
export async function probeRemote(input: string, token: string): Promise<string> {
  const parsed = parseRemoteAddress(input, token);
  const t = new RemoteTransport(parsed.url, parsed.token, 'client', deviceName(), {
    onMessage() {
      /* 探测阶段不需要业务消息 */
    },
  });
  await t.connect(6000);
  t.close();
  return parsed.label;
}

/** UI：客户端连接（预检 → 存标记 → reload 走远程启动流程） */
export async function connectClient(input: string, token: string): Promise<void> {
  const parsed = parseRemoteAddress(input, token);
  await probeRemote(input, token);
  clearKey(HOST_KEY);
  writeJson(CLIENT_KEY, { url: parsed.url, token: parsed.token, label: parsed.label });
  location.reload();
}
