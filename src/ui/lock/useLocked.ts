// 锁定态的 React 绑定（useSyncExternalStore，和 store.ts 同一套路）
import { useSyncExternalStore } from 'react';
import { isLocked, subscribeLock } from '../../core/lock';

export function useLocked(): boolean {
  return useSyncExternalStore(subscribeLock, isLocked, isLocked);
}
