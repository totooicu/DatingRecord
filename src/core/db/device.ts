// 设备 ID：同步时区分来源用，存 localStorage

import { newId } from '../id';

let cache = '';

/**
 * 由宿主环境指定设备 ID（CLI / 自动化用）。
 *
 * 浏览器里设备 ID 来自 localStorage，一个浏览器一份；CLI 每次都是新进程、
 * 没有 localStorage，若也「每次随机生成」，同一台机器上的两次同步就会变成
 * 两个设备互相打架。所以 CLI 把这个 ID 写进库里的 meta 表，跨进程稳定。
 */
export function overrideDeviceId(id: string): void {
  cache = id.trim();
}

export function getDeviceId(): string {
  if (cache) return cache;
  try {
    cache = localStorage.getItem('dr.deviceId') ?? '';
  } catch {
    cache = '';
  }
  if (!cache) {
    cache = newId('d');
    try {
      localStorage.setItem('dr.deviceId', cache);
    } catch {
      /* 隐私模式下忽略 */
    }
  }
  return cache;
}
