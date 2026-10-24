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

/** 业务层：服务端 → 客户端 */
export type RemoteMessage =
  | { k: 'snapshot'; version: number; db: string; reason?: 'init' | 'update' | 'conflict' }
  | { k: 'applied'; version: number }
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
export type ClientMessage = ClientHello | ClientApply | BlobGet | BlobPut | BlobDel | BlobClear;

/** 两个方向的消息并集：传输层不关心方向，路由层按 k 分派 */
export type RemotePayload = RemoteMessage | ClientMessage;

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
