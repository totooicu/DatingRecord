// 极简状态版本管理：任何写操作后 bump()，所有依赖数据的组件自动重查
// （sql.js 是同步 API，直接查库比维护一套前端状态更不容易出现不一致）

import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return version;
}

export function bump(): void {
  version += 1;
  listeners.forEach((l) => l());
}

export function useVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
