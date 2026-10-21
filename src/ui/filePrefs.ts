// 文件库的用户偏好：判重阈值。
//
// 放 localStorage 而不是 meta 表：它是「这台设备上的手感设置」，
// 不是库数据，没必要跟着备份跑。

import { DEFAULT_SMALL_LIMIT } from '../core/files';

const KEY = 'dr.file.smallLimit';

export const SMALL_LIMIT_OPTIONS = [
  { v: 512 * 1024, label: '512 KB' },
  { v: 1024 * 1024, label: '1 MB' },
  { v: 2 * 1024 * 1024, label: '2 MB' },
  { v: 4 * 1024 * 1024, label: '4 MB' },
];

export function getSmallLimit(): number {
  const raw = Number(localStorage.getItem(KEY) ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SMALL_LIMIT;
}

export function setSmallLimit(v: number): void {
  localStorage.setItem(KEY, String(v));
}
