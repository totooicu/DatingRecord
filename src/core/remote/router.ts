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

import {
  setPersistSink,
  onPersisted,
  flushPersist,
  dropPendingPersist,
  hasPendingPersist,
} from '../db';
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
import { RemoteTransport, type TransportHandlers } from './transport';
import { applyRemoteAppearance, hostAppearance } from './appearance';
import { parseRemoteAddress, type ParsedAddress } from './url';
import type { DirectClientSession, DirectHostSession } from './direct';
import type { ClientMessage, LinkKind, PeerInfo, RemoteConfig, RemoteLink, RemotePayload } from './types';

// 状态与会话标记在 ./state，整库快照的编解码在 ./snapshotCodec；
// 本文件只管「消息怎么路由」。下面几个符号是对外（core/remote/index.ts）的，
// 从 ./state 原样转出去，外部 import 路径不用改。
import {
  forgetClient,
  forgetHost,
  getRemoteState,
  publish,
  rememberClient,
  rememberHost,
  savedClientConfig,
} from './state';
import { exportDb, replaceDb, toBase64 } from './snapshotCodec';

export type { RemoteState, RemoteMode } from './state';
export {
  getRemoteState,
  savedClientConfig,
  savedHostConfig,
  saveClientConfig,
  subscribeRemote,
} from './state';

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

let clientTransport: RemoteLink | null = null;
let clientVersion = 0;
let clientConnected = false;
/** 收到过快照的次数：判断「换库是否已经发生」，不依赖具体传输层的回调 */
let snapshotSeq = 0;
/** 最近一次收到任何业务消息的时刻：心跳用它判活 */
let lastInboundAt = 0;
/** 对端回过 pong 才算它能心跳。老版本页面不回 pong，不能因此被判成「假连接」 */
let pongSeen = false;
/** 回到前台的补同步节流 */
let lastWakeAt = 0;
let reconnecting = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_MS = 15000;
const DEAD_MS = 30000;

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
  const transport = new RemoteTransport(cfg.url, cfg.token, 'client', deviceName(), {
    onMessage(msg, from) {
      handleClientPayload(msg, from);
    },
    onClose() {
      // 服务端断开：按需求回到自己的数据（本地库从未被覆盖）
      leaveRemoteAndReload('服务端已断开，已切回本地数据');
    },
  });
  await attachClient(transport, cfg.label, 'relay', cfg, onProgress);
}

/** 客户端接管落盘与附件：此后再也不碰本地 IndexedDB */
function installClientRouting(transport: RemoteLink): void {
  // 接管前先把开机时 migrate 留下的那次 markDirty 丢掉：那是本地库的账，
  // 现在库已经是服务端快照了，再落一次就是把快照原样传回去。
  dropPendingPersist();
  setPersistSink(async (bytes) => {
    try {
      transport.send({ k: 'apply', baseVersion: clientVersion, db: toBase64(bytes) });
    } catch {
      publish({ status: 'error', error: '发送失败：连接已断开' });
    }
  });
  setBlobStore(remoteBlobStore);
}

/** 客户端侧收到服务端消息：快照换库 / 附件回包 / 错误 */
function handleClientPayload(msg: RemotePayload, _from: string): void {
  lastInboundAt = Date.now();
  if (msg.k === 'ping') {
    try {
      clientTransport?.send({ k: 'pong', ts: msg.ts });
    } catch {
      /* 连接刚好断了：心跳会兜底 */
    }
    return;
  }
  if (msg.k === 'pong') {
    pongSeen = true;
    return;
  }
  if (msg.k === 'version') {
    // 版本对不上就自己拉一份：比直接推快照省流量，老服务端也不会被问懵
    const v = 'version' in msg ? msg.version : undefined;
    if (typeof v === 'number' && v !== clientVersion && !hasPendingPersist()) {
      try {
        clientTransport?.send({ k: 'request-snapshot' });
      } catch {
        /* 心跳兜底 */
      }
    }
    return;
  }
  if (msg.k === 'snapshot') {
    snapshotSeq += 1;
    clientVersion = msg.version;
    replaceDb(msg.db);
    if (!clientConnected) {
      clientConnected = true;
      if (clientTransport) installClientRouting(clientTransport);
      publish({ status: 'connected', version: msg.version });
    } else {
      publish({ version: msg.version });
    }
  } else if (msg.k === 'appearance') {
    // 服务端换了配色：客户端跟着调，但不写自己的 localStorage
    applyRemoteAppearance(msg.appearance);
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
}

/**
 * 把一条已经打通（或即将打通）的连接当成「服务端数据」接过来。
 *
 * 中继和 WebRTC 走同一个函数：挂 handler → 要快照 → 换库 → 装 sink。
 * 失败时把落盘/附件还回本地，页面仍停在原来的位置。
 */
async function attachClient(
  link: RemoteLink,
  label: string,
  kind: LinkKind,
  remember: RemoteConfig | null,
  onProgress?: (msg: string) => void,
): Promise<void> {
  publish({
    mode: 'client',
    status: 'connecting',
    label,
    transport: kind,
    error: '',
    clients: [],
  });
  onProgress?.('正在连接服务端…');
  // 每次接管都从头计数：上一个会话的快照不能被当成本次的首帧
  clientConnected = false;
  const before = snapshotSeq;
  const handlers: TransportHandlers = {
    onMessage(msg) {
      handleClientPayload(msg, '');
    },
    onPeer(ev, peer) {
      if (ev === 'join' && kind === 'direct') publish({ label: `直连 · ${peer.name}` });
    },
    onClose() {
      leaveRemoteAndReload('服务端已断开，已切回本地数据');
    },
  };
  link.attach?.(handlers);
  clientTransport = link;
  lastInboundAt = Date.now();
  pongSeen = false;

  const connectable = link as RemoteLink & { connect?: (timeoutMs?: number) => Promise<void> };
  try {
    if (connectable.connect) await connectable.connect();
    onProgress?.('正在读取服务端数据…');
    link.send({ k: 'request-snapshot' });
    const started = Date.now();
    while (snapshotSeq === before) {
      if (link.closed) throw new Error('连接已断开');
      if (Date.now() - started > 15000) throw new Error('服务端没有返回数据（服务端页面可能已关闭）');
      await new Promise((r) => setTimeout(r, 80));
    }
  } catch (err) {
    link.close();
    clientTransport = null;
    setPersistSink(null);
    setBlobStore(null);
    if (remember) forgetClient();
    const msg = err instanceof Error ? err.message : String(err);
    publish({ mode: 'local', status: 'error', label: '', transport: null, error: `连接失败：${msg}` });
    // 快照已经换过库了：页面里的数据是服务端的，必须重载回本地，不能就这么留在界面上
    if (snapshotSeq !== before) {
      try {
        sessionStorage.setItem('dr.remote.tip', `连接失败：${msg}`);
      } catch {
        /* ignore */
      }
      location.reload();
    }
    throw err;
  }
  if (remember) rememberClient(remember);
}

/**
 * WebRTC 直连客户端：配对成功后原地换库（不刷新页面）。
 *
 * 刷新会关掉 RTCPeerConnection，所以直连不能像中继那样「存标记再 reload」。
 * 开关过程中本地库只被替换、不会被写回 IndexedDB；断开时 reload 回来的还是自己的数据。
 */
export async function adoptDirectClient(session: DirectClientSession): Promise<void> {
  // 配对期间就堵住本地落盘：此时用户如果还在操作，写的是本地库，不能落盘
  setPersistSink(async () => {
    /* 直连模式：本地落盘一律丢弃 */
  });
  try {
    const link = await session.open;
    await attachClient(link, '直连会话', 'direct', null);
  } catch (err) {
    setPersistSink(null);
    session.close();
    const msg = err instanceof Error ? err.message : String(err);
    publish({ mode: 'local', status: 'error', label: '', transport: null, error: `直连失败：${msg}` });
    throw err;
  }
}

/** 断开并 reload：本地库一直在盘上，重载后就是自己的数据 */
export function leaveRemoteAndReload(tip?: string): void {
  forgetClient();
  forgetHost();
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

// ---------------- 连接自愈 ----------------
//
// 手机上的网页随时会被切到后台、锁屏、换网络。socket 有可能已经不通了，
// 浏览器却不触发 close——界面还挂着「已连接」，数据却一动不动，
// 用户只能靠刷新页面恢复。这里补三件事：
//   · 客户端每 15 秒 ping 一次；对端回过 pong 之后，30 秒没有任何消息就原地重连
//   · 回到前台时，服务端广播一次版本号、客户端问一次版本号，对不上才拉整库
//   · 服务端回到前台顺手 bump 一下：后台期间换过库可能来不及重绘
//
// 老版本页面不认 ping / version，最多是这次补同步不生效（和现在一样），
// 不会因为「没回 pong」被误判成断线——pongSeen 就是这么用的。

/** 回到前台：补一次同步，不必刷新页面 */
function onWake(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (getRemoteState().mode === 'local') return;
  const now = Date.now();
  if (now - lastWakeAt < 2000) return;
  lastWakeAt = now;
  if (getRemoteState().mode === 'client') {
    if (getRemoteState().status !== 'connected' || !clientTransport) return;
    try {
      clientTransport.send({ k: 'ping', ts: now });
    } catch {
      /* 发不出去就交给心跳 */
    }
    try {
      clientTransport.send({ k: 'version' });
    } catch {
      /* ignore */
    }
    return;
  }
  if (hostTransport) {
    // 后台期间换过库：先让界面按当前库重画一遍
    bump();
    if (hostTransport.clients.length > 0) {
      try {
        hostTransport.broadcast({ k: 'version', version: hostVersion });
      } catch {
        /* ignore */
      }
    }
  }
}

/** 客户端原地重连：保留界面和远程数据，只换一条链路重新要快照 */
async function reconnectClient(): Promise<void> {
  const cfg = savedClientConfig();
  if (!cfg || reconnecting) return;
  reconnecting = true;
  publish({ status: 'connecting', error: '' });
  try {
    clientTransport?.close();
  } catch {
    /* ignore */
  }
  clientTransport = null;
  const transport = new RemoteTransport(cfg.url, cfg.token, 'client', deviceName(), {
    onMessage(msg) {
      handleClientPayload(msg, '');
    },
    onClose() {
      leaveRemoteAndReload('服务端已断开，已切回本地数据');
    },
  });
  try {
    await attachClient(transport, cfg.label, 'relay', null);
  } catch {
    // 重连也失败：老老实实回本地库，别让人对着连不上的远程库继续写
    leaveRemoteAndReload('连接中断，已切回本地数据');
  } finally {
    reconnecting = false;
  }
}

function heartbeatTick(): void {
  if (getRemoteState().mode !== 'client' || !clientTransport || reconnecting) return;
  // 只有对端答过 pong 才敢用「没消息」判断断线，否则老服务端会被冤枉
  if (pongSeen && Date.now() - lastInboundAt > DEAD_MS) {
    void reconnectClient();
    return;
  }
  try {
    clientTransport.send({ k: 'ping', ts: Date.now() });
  } catch {
    /* onClose 会接手 */
  }
}

/** 页面启动时调一次：回到前台补同步 + 心跳兜底（重复调用无副作用） */
export function initRemoteResilience(): void {
  if (typeof window === 'undefined' || heartbeat !== null) return;
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  window.addEventListener('pageshow', onWake);
  heartbeat = setInterval(heartbeatTick, HEARTBEAT_MS);
}

// ---------------- 服务端 ----------------

let hostTransport: RemoteLink | null = null;
let hostVersion = 1;
let stopHostObserver: (() => void) | null = null;

function broadcastSnapshot(reason: 'init' | 'update' | 'conflict' = 'update', to?: string): void {
  if (!hostTransport) return;
  const msg = { k: 'snapshot' as const, version: hostVersion, db: exportDb(), reason };
  if (to) hostTransport.sendTo(to, msg);
  else hostTransport.broadcast(msg);
  publish({ version: hostVersion });
}

/** 把服务端当前外观发给某个客户端 / 所有客户端；桥没接上时什么都不发 */
function sendAppearanceTo(to?: string): void {
  if (!hostTransport) return;
  const appearance = hostAppearance();
  if (!appearance) return;
  const msg = { k: 'appearance' as const, appearance };
  try {
    if (to) hostTransport.sendTo(to, msg);
    else hostTransport.broadcast(msg);
  } catch {
    /* 连接刚好断了：下一个 join / request-snapshot 会补发 */
  }
}

/** 服务端换了配色就推给所有人（由 ui/theme.ts 监听主题变更后调用） */
export function broadcastAppearance(): void {
  sendAppearanceTo();
}

function handleHostPeer(ev: 'join' | 'leave', peer: PeerInfo): void {
  const clients = [...(hostTransport?.clients ?? [])];
  const label = getRemoteState().transport === 'direct' && ev === 'join' ? `直连 · ${peer.name}` : getRemoteState().label;
  if (ev === 'join') {
    publish({ clients, label });
    // 新客户端一进来就给一份快照，不必等它再问
    try {
      broadcastSnapshot('init', peer.id);
    } catch {
      /* 导出失败（库没初始化）时交给客户端自己重试 */
    }
    sendAppearanceTo(peer.id);
  } else {
    publish({ clients, label });
  }
}

function handleHostClose(): void {
  const direct = getRemoteState().transport === 'direct';
  teardownHost();
  publish({
    mode: 'local',
    status: 'error',
    label: '',
    clients: [],
    transport: null,
    error: direct
      ? '客户端已断开，直连结束。要再连请重新生成邀请码；本机数据不受影响。'
      : '服务端连接已断开：客户端将看不到数据，本机数据不受影响',
  });
}

const HOST_HANDLERS: TransportHandlers = {
  onMessage(msg, from) {
    void handleClientMessage(msg, from);
  },
  onPeer: handleHostPeer,
  onClose: handleHostClose,
};

/**
 * 把一条连接当服务端用（中继 / 直连共用）。
 * 中继要先 connect() 拿 welcome；WebRTC 的通道在配对完成时已经打开。
 */
async function attachHost(
  link: RemoteLink,
  label: string,
  kind: LinkKind,
  remember: RemoteConfig | null,
): Promise<void> {
  if (hostTransport) return;
  publish({ mode: 'host', status: 'connecting', label, transport: kind, error: '', clients: [] });
  link.attach?.(HOST_HANDLERS);
  hostTransport = link;
  const connectable = link as RemoteLink & { connect?: (timeoutMs?: number) => Promise<void> };
  try {
    if (connectable.connect) await connectable.connect();
  } catch (err) {
    hostTransport = null;
    link.close();
    const msg = err instanceof Error ? err.message : String(err);
    publish({ mode: 'local', status: 'error', label: '', transport: null, error: `开启失败：${msg}` });
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
  if (remember) rememberHost(remember);
  publish({
    mode: 'host',
    status: 'connected',
    label,
    clients: [...link.clients],
    transport: kind,
    error: '',
    version: hostVersion,
  });
}

export async function startHost(cfg: RemoteConfig): Promise<void> {
  if (hostTransport) return;
  const transport = new RemoteTransport(cfg.url, cfg.token, 'host', deviceName(), HOST_HANDLERS);
  await attachHost(transport, cfg.label, 'relay', cfg);
}

/**
 * WebRTC 直连服务端：配对码交换完成后调用。
 *
 * 直连不能像中继那样刷新恢复（刷新就丢了 PeerConnection），所以不写会话标记。
 */
export async function adoptDirectHost(session: DirectHostSession): Promise<void> {
  try {
    const link = await session.open;
    await attachHost(link, '直连会话', 'direct', null);
  } catch (err) {
    session.close();
    const msg = err instanceof Error ? err.message : String(err);
    publish({ mode: 'local', status: 'error', label: '', transport: null, error: `直连失败：${msg}` });
    throw err;
  }
}

async function handleClientMessage(msg: RemotePayload, from: string): Promise<void> {
  if (!hostTransport) return;
  const transport = hostTransport;
  lastInboundAt = Date.now();
  switch (msg.k) {
    case 'ping':
      try {
        transport.sendTo(from, { k: 'pong', ts: msg.ts });
      } catch {
        /* ignore */
      }
      return;
    case 'pong':
      return;
    case 'version':
      try {
        transport.sendTo(from, { k: 'version', version: hostVersion });
      } catch {
        /* ignore */
      }
      return;
    case 'request-snapshot':
      try {
        broadcastSnapshot('init', from);
      } catch (e) {
        transport.sendTo(from, { k: 'error', error: e instanceof Error ? e.message : String(e) });
      }
      // 快照后面紧跟一份外观：客户端一进来颜色就和这台设备一致
      sendAppearanceTo(from);
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
  forgetHost();
  publish({ mode: 'local', status: 'idle', label: '', clients: [], transport: null, error: '' });
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
  /** 只有请求里带了 token 才有值：false = token 与服务端不一致 */
  tokenOk?: boolean | null;
  /** 中继所在机器的局域网地址，给「复制给手机」用 */
  addresses?: string[];
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

/** 给配对码用的本机称呼（「设备 ABC123」） */
export function localDeviceName(): string {
  return deviceName();
}

/**
 * 客户端连之前先问中继一句：它在不在、token 对不对、服务端开没开。
 *
 * 这一步是跨域请求，中继的 /__remote/info 允许任何来源读取且不回业务数据。
 * 有了它，「连不上中继」就不会再盖住真正的原因（地址写错 / token 不对 /
 * 服务端压根没开），用户能看到一句能照着改的话。
 */
async function inspectRemote(parsed: ParsedAddress, timeoutMs = 4000): Promise<RelayInfo> {
  const base = parsed.url.startsWith('wss:') ? 'https' : 'http';
  const url = `${base}://${parsed.host}:${parsed.port}/__remote/info?token=${encodeURIComponent(parsed.token)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
  } catch {
    throw new Error(
      `连不上中继（${parsed.label}）：确认地址和端口没写错、中继进程在运行、两台设备在同一网络，` +
        '并注意 127.0.0.1 只对服务端本机有效，其他设备要填它的局域网 IP',
    );
  } finally {
    clearTimeout(timer);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok || !ct.includes('application/json')) {
    throw new Error(`${parsed.label} 不是跨设备中继：这个端口上跑的是别的服务`);
  }
  const info = (await res.json()) as RelayInfo;
  if (!info?.ok) throw new Error(`${parsed.label} 不认这个中继地址`);
  if (info.tokenOk === false) {
    throw new Error('token 不对：请照抄服务端页面上「客户端连接串」里的 token（区分大小写）');
  }
  if (info.hostOnline === false) {
    throw new Error('中继在线，但服务端还没开启：先在服务端页面点「开启跨设备操作」');
  }
  return info;
}

/** 连接前先探一下：只建连不换库，避免把坏地址写进 sessionStorage 再刷新 */
export async function probeRemote(input: string, token: string): Promise<string> {
  const parsed = parseRemoteAddress(input, token);
  await inspectRemote(parsed);
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
  forgetHost();
  rememberClient({ url: parsed.url, token: parsed.token, label: parsed.label });
  location.reload();
}
