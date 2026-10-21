// 设备 ID：同步时区分来源用，存 localStorage

import { newId } from '../id';

let cache = '';

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
