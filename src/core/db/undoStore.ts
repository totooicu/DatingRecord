// 撤销状态的「发布」半边：引擎只管改栈，改完调用 notifyUndo()；
// React 那边用 useSyncExternalStore(subscribeUndo, getUndoState) 订阅。
//
// 拆开是因为引擎文件已经够长，而这里只跟订阅者打交道、完全不碰快照——
// 订阅机制要是哪天想换成别的方式（比如事件总线），只动这一个文件。

export type UndoOp = 'write' | 'undo' | 'redo';

/** 给 UI 看的那一小块（不碰整库数据） */
export interface UndoStepInfo {
  label: string;
  at: number;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  top: UndoStepInfo | null;
  /** 最近一次变化是哪来的——提示条要靠它决定显示「可撤销」还是「已撤销」 */
  lastOp: UndoOp | null;
  /** 每次变化自增，供 React 的 useEffect 依赖 */
  seq: number;
}

const listeners = new Set<() => void>();
let seq = 0;
let cache: UndoState = { canUndo: false, canRedo: false, top: null, lastOp: null, seq: 0 };

/** 引擎在栈发生变化后调用 */
export function notifyUndo(s: {
  canUndo: boolean;
  canRedo: boolean;
  top: UndoStepInfo | null;
  op: UndoOp;
}): void {
  seq += 1;
  cache = { ...s, lastOp: s.op, seq };
  listeners.forEach((l) => l());
}

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUndoState(): UndoState {
  return cache;
}
