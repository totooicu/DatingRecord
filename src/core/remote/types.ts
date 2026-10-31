// 跨设备操作的协议定义。
//
// 数据流只有一条：客户端把整库快照发给服务端，服务端落库后把新快照广播回所有客户端。
// 这和本项目的持久化模型一致（每次写都是整库 export），不需要另写一套增量协议。
//
// 消息分两层：
//   中继层（t / from / to）—— 由 tools/remote-relay 负责转发，浏览器不解析
//   业务层（k）—— 服务端与客户端之间真正的内容

export type PeerRole = 'host' | 'client';

/** 中继 → 浏览器 */
export interface RelayMessage {
  t: 'welcome' | 'peer' | 'msg' | 'error' | 'pong';
  id?: string;
  role?: PeerRole;
  name?: string;
  hostOnline?: boolean;
  clients?: PeerInfo[];
  event?: 'join' | 'leave';
  from?: string;
  msg?: RemotePayload;
  error?: string;
}

export interface PeerInfo {
  id: string;
  name: string;
  role: PeerRole;
}

/** 外观偏好：随连接走一趟，客户端照抄服务端的配色（只调色，不改客户端存档） */
export interface RemoteAppearance {
  accent: string;
  base: string;
  mode: 'light' | 'dark';
}

/** 心跳：收到就原样回 pong。用来发现「socket 还在、其实已经不通」的假连接 */
export interface Ping {
  k: 'ping';
  ts: number;
}
export interface Pong {
  k: 'pong';
  ts: number;
}
/** 版本探针：客户端问一句「你那边是第几版」，服务端回 VersionInfo */
export interface VersionProbe {
  k: 'version';
}
/** 版本回包 / 服务端回到前台时广播的当前版本：不一样就让客户端自己拉快照 */
export interface VersionInfo {
  k: 'version';
  version: number;
}

/** 业务层：服务端 → 客户端 */
export type RemoteMessage =
  | { k: 'snapshot'; version: number; db: string; reason?: 'init' | 'update' | 'conflict' }
  | { k: 'applied'; version: number }
  | Ping
  | Pong
  | VersionInfo
  | { k: 'appearance'; appearance: RemoteAppearance }
  | { k: 'blob'; reqId: string; data: string | null }
  | { k: 'error'; error: string };

/** 业务层：客户端 → 服务端 */
export interface ClientHello {
  k: 'request-snapshot';
}
export interface ClientApply {
  k: 'apply';
  baseVersion: number;
  db: string;
}
export interface BlobGet {
  k: 'blob-get';
  reqId: string;
  id: string;
}
export interface BlobPut {
  k: 'blob-put';
  id: string;
  data: string;
}
export interface BlobDel {
  k: 'blob-del';
  id: string;
}
export interface BlobClear {
  k: 'blob-clear';
}
export type ClientMessage =
  | ClientHello
  | ClientApply
  | BlobGet
  | BlobPut
  | BlobDel
  | BlobClear
  | Ping
  | Pong
  | VersionProbe;

/** 两个方向的消息并集：传输层不关心方向，路由层按 k 分派 */
export type RemotePayload = RemoteMessage | ClientMessage;

/** 传输方式：中继（局域网 ws）还是 WebRTC 直连 */
export type LinkKind = 'relay' | 'direct';

/**
 * 路由器眼里的「一条连接」。
 * 中继和 WebRTC 各自实现它，路由层不关心底下是 ws 还是 DataChannel。
 */
export interface RemoteLink {
  readonly id: string;
  readonly closed: boolean;
  /** 连着的对端（直连只有一个，中继是多个客户端） */
  readonly clients: PeerInfo[];
  send(msg: RemotePayload | object): void;
  sendTo(to: string, msg: RemotePayload | object): void;
  broadcast(msg: RemotePayload | object): void;
  close(): void;
  /** 直连：通道可能先于路由层打开，用它补挂 handler 并补发排队消息 */
  attach?(handlers: import('./transport').TransportHandlers): void;
}

export interface RemoteConfig {
  /** ws://host:port/remote */
  url: string;
  token: string;
  /** 展示用：host:port */
  label: string;
}

export function isRemoteMessage(v: unknown): v is RemoteMessage {
  return !!v && typeof v === 'object' && typeof (v as { k?: unknown }).k === 'string';
}
