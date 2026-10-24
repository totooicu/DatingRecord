// 地址解析：服务端填端口，客户端填「地址:端口?token=」。
//
// 服务器页面本身不监听端口（浏览器做不到），真正监听的是项目自带的
// tools/remote-relay 中继进程；这里只负责把用户填的东西拼成 ws:// 地址。

import type { RemoteConfig } from './types';

const DEFAULT_PORT = 4173;

export interface ParsedAddress {
  /** ws://host:port/path */
  url: string;
  /** host:port，展示用 */
  label: string;
  token: string;
  host: string;
  port: number;
}

/** 把用户输入拼成 WebSocket 地址；地址里带 ?token= 时优先用它 */
export function parseRemoteAddress(input: string, tokenField = ''): ParsedAddress {
  let raw = input.trim();
  if (!raw) throw new Error('请填写地址和端口，例如 192.168.1.8:4173');

  // 允许直接粘贴 http(s) 地址：静默换成 ws(s)，少一步解释
  raw = raw.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  if (!/^wss?:\/\//i.test(raw)) raw = `ws://${raw}`;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('地址格式不对，示例：192.168.1.8:4173 或 ws://192.168.1.8:4173');
  }

  const tokenFromUrl = u.searchParams.get('token') ?? '';
  const token = tokenFromUrl || tokenField.trim();
  const port = Number(u.port || (u.protocol === 'wss:' ? 443 : 80));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('端口号要在 1–65535 之间');
  }
  // 中继固定在这个路径上处理握手；用户只填域名时补全
  const path = u.pathname && u.pathname !== '/' ? u.pathname : '/remote';
  if (!token) throw new Error('缺少访问 token');

  return {
    url: `${u.protocol}//${u.hostname}:${port}${path}?token=${encodeURIComponent(token)}`,
    label: `${u.hostname}:${port}`,
    token,
    host: u.hostname,
    port,
  };
}

/** 服务端页只填端口：域名沿用当前页面所在主机 */
export function addressForHostPort(port: string, token: string): ParsedAddress {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0 || p > 65535) {
    throw new Error('端口号要在 1–65535 之间');
  }
  const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';
  return parseRemoteAddress(`${host}:${p}`, token);
}

export function configOf(a: ParsedAddress): RemoteConfig {
  return { url: a.url, token: a.token, label: a.label };
}

/** 当前页面是否由中继进程提供（能调用 /__remote/listen 才会是 true） */
export function relayOrigin(): string {
  return typeof location !== 'undefined' ? location.origin : '';
}

export { DEFAULT_PORT };
