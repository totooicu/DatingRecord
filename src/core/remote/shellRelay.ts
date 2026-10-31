// 壳端「跨设备操作」服务器（桥动作 remote.*）的网页侧客户端。
//
// 和 core/compat/bridge 的其它能力一样：**不判断环境，只发一次 action 看有没有
// 人回**。浏览器里没有壳，探一次超时（1.2s）就当「不支持」，不会弹错。
//
// 壳端保持和 tools/remote-relay/server.mjs 相同的接口（/remote?token=、
// /__remote/info、/__remote/listen），所以 core/remote/router 完全不用改：
// 对路由器来说，壳端服务和 Node 中继只是「连到哪个 ws 地址」的区别。

import { invoke } from '../compat/bridge';

export interface ShellRelayStatus {
  /** 端口是否在监听 */
  running: boolean;
  port: number;
  token: string;
  /** 开机自启动偏好（壳端存档） */
  autostart: boolean;
  /** 壳里的网页有没有以服务端身份连上来 */
  hostOnline: boolean;
  /** 已连上的客户端数 */
  clients: number;
  /** 手机局域网 IPv4，wlan 优先 */
  addresses: string[];
}

/** 桥不存在时别让用户干等：探测只要 1.2 秒（与 file.capabilities 同一取舍） */
const PROBE_MS = 1200;

let capable: Promise<boolean> | null = null;

function toStatus(r: Record<string, unknown>): ShellRelayStatus {
  const addresses = Array.isArray(r.addresses) ? r.addresses.map((x) => String(x)).filter(Boolean) : [];
  return {
    running: r.running === true,
    port: Number(r.port) > 0 ? Number(r.port) : 4173,
    token: typeof r.token === 'string' ? r.token : '',
    autostart: r.autostart === true,
    hostOnline: r.hostOnline === true,
    clients: Number(r.clients) >= 0 ? Number(r.clients) : 0,
    addresses,
  };
}

/** 当前环境有没有壳端服务（结果缓存：一次会话里桥不会中途长出来） */
export function shellRelayCapable(): Promise<boolean> {
  if (!capable) {
    capable = invoke('remote.capabilities', {}, PROBE_MS)
      .then((r) => r.version === 1)
      .catch(() => false);
  }
  return capable;
}

/** 读一次状态；不支持 / 超时都返回 null（调用方按「没有壳端服务」处理） */
export async function shellRelayStatus(timeoutMs = 3000): Promise<ShellRelayStatus | null> {
  if (!(await shellRelayCapable())) return null;
  try {
    return toStatus(await invoke('remote.status', {}, timeoutMs));
  } catch {
    return null;
  }
}

/** 开启 / 改端口；返回绑定后的真实状态（端口被占用会抛，消息可直接展示） */
export async function startShellRelay(port: number, token: string): Promise<ShellRelayStatus> {
  const r = await invoke('remote.start', { port, token }, 8000);
  return toStatus(r);
}

export async function stopShellRelay(): Promise<ShellRelayStatus | null> {
  if (!(await shellRelayCapable())) return null;
  try {
    return toStatus(await invoke('remote.stop', {}, 5000));
  } catch {
    return null;
  }
}

export async function setShellRelayAutostart(enabled: boolean): Promise<ShellRelayStatus | null> {
  if (!(await shellRelayCapable())) return null;
  try {
    return toStatus(await invoke('remote.autostart', { enabled }, 3000));
  } catch {
    return null;
  }
}

/** 手机局域网地址（优先 wlan / 有 192.168 的），没有就 null */
export function lanAddressOf(st: ShellRelayStatus | null): string | null {
  if (!st) return null;
  return st.addresses.find((a) => !a.startsWith('127.')) ?? null;
}

/** 壳端页面自己连哪里：永远走 loopback，不受页面部署域名影响 */
export function loopbackWsUrl(st: Pick<ShellRelayStatus, 'port' | 'token'>): string {
  return `ws://127.0.0.1:${st.port}/remote?token=${encodeURIComponent(st.token)}`;
}

/** 给别的设备打开：http://手机IP:端口（与 Node 中继托管页面同一个入口） */
export function lanPageUrl(st: Pick<ShellRelayStatus, 'port' | 'addresses'>): string | null {
  const ip = st.addresses.find((a) => !a.startsWith('127.'));
  return ip ? `http://${ip}:${st.port}` : null;
}
